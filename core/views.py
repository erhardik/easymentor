# ---------- DJANGO ----------
import io
import os
import re
import tempfile
import threading
import uuid
import zipfile

from django.conf import settings
from django.shortcuts import render, redirect
from django.http import JsonResponse, HttpResponse
from django.contrib.auth import authenticate, login
from django.utils import timezone
from django.views.decorators.http import require_http_methods
from django.db import close_old_connections
from django.db.models import Count
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.views.decorators.http import require_http_methods
from django.http import JsonResponse
from django.db.models import Max 
from django.db.models import Q
# ---------- LOCAL FORMS ----------
from .forms import UploadFileForm

# ---------- LOCAL MODELS ----------
from .models import (
    AcademicModule,
    Attendance,
    CallRecord,
    Mentor,
    OtherCallRecord,
    ResultCallRecord,
    ResultUpload,
    ResultUploadJob,
    Student,
    StudentResult,
    Subject,
    WeekLock,
)

# ---------- LOCAL UTILITIES ----------
from .utils import import_students_from_excel, resolve_mentor_identity
from .attendance_utils import import_attendance
from .result_utils import import_compiled_bulk_all, import_compiled_result_sheet, import_result_sheet
from .pdf_report import generate_student_pdf, generate_student_prefilled_pdf
from .module_utils import get_current_module

TEST_NAMES = ["T1", "T2", "T3", "T4", "REMEDIAL"]


def _session_mentor_obj(request):
    mentor_key = request.session.get("mentor")
    mentor = resolve_mentor_identity(mentor_key)
    if mentor and mentor_key != mentor.name:
        request.session["mentor"] = mentor.name
    return mentor


def _active_module(request):
    return get_current_module(request)


def _result_report_text(test_name, subject_name, mentor_name, total, received, not_received, message_done):
    if test_name == "T1":
        rule = f"Less than 9 marks in {test_name}"
    elif test_name == "T2":
        rule = "Less than 9 marks in T2 & less than 18 in (T1+T2)"
    elif test_name == "T3":
        rule = "Less than 9 marks in T3 & less than 27 in (T1+T2+T3)"
    elif test_name == "T4":
        rule = "Less than 18 marks in SEE & less than 35 in (T1+T2+T3+SEE)"
    else:
        rule = "Less than 35 marks in REMEDIAL"

    return f"""📞Phone call done regarding failed in {subject_name} ({rule})
Name of Faculty- {mentor_name}
Total no of calls- {total:02d}
Received Calls - {received:02d}
Not received- {not_received:02d}
No of Message done as call not Received - {message_done:02d}"""


def _result_filter_config(test_name):
    test_name = (test_name or "").upper()
    if test_name == "T1":
        return {
            "current_key": "current_fail",
            "current_label": "T1<9",
            "total_key": "total_fail",
            "total_label": "till T1<9",
            "either_key": "either_fail",
            "either_label": "Either (T1<9 OR till T1<9)",
            "current_threshold": 9,
            "total_threshold": 9,
            "exam_col_label": "T1 marks /25",
            "total_col_label": "Total till T1 /25",
            "display_columns": [
                {"key": "marks_current", "label": "T1 marks /25"},
                {"key": "marks_total", "label": "Total till T1 /25"},
            ],
        }
    if test_name == "T2":
        return {
            "current_key": "current_fail",
            "current_label": "T2<9",
            "total_key": "total_fail",
            "total_label": "T1+T2<18",
            "either_key": "either_fail",
            "either_label": "Either (T2<9 OR T1+T2<18)",
            "current_threshold": 9,
            "total_threshold": 18,
            "exam_col_label": "T2 marks /25",
            "total_col_label": "T1+T2 /50",
            "display_columns": [
                {"key": "marks_t1", "label": "T1 marks /25"},
                {"key": "marks_current", "label": "T2 marks /25"},
                {"key": "marks_total", "label": "T1+T2 /50"},
            ],
        }
    if test_name == "T3":
        return {
            "current_key": "current_fail",
            "current_label": "T3<9",
            "total_key": "total_fail",
            "total_label": "T1+T2+T3<27",
            "either_key": "either_fail",
            "either_label": "Either (T3<9 OR T1+T2+T3<27)",
            "current_threshold": 9,
            "total_threshold": 27,
            "exam_col_label": "T3 marks /25",
            "total_col_label": "T1+T2+T3 /75",
            "display_columns": [
                {"key": "marks_t1", "label": "T1 marks /25"},
                {"key": "marks_t2", "label": "T2 marks /25"},
                {"key": "marks_current", "label": "T3 marks /25"},
                {"key": "marks_total", "label": "T1+T2+T3 /75"},
            ],
        }
    if test_name == "T4":
        return {
            "current_key": "current_fail",
            "current_label": "T4<18",
            "total_key": "total_fail",
            "total_label": "T1+T2+T3+T4<35",
            "either_key": "either_fail",
            "either_label": "Either (T4<18 OR T1+T2+T3+T4<35)",
            "current_threshold": 18,
            "total_threshold": 35,
            "exam_col_label": "T4 marks /50",
            "total_col_label": "T1+T2+T3+(T4/2) /100",
            "display_columns": [
                {"key": "marks_t1", "label": "T1 marks /25"},
                {"key": "marks_t2", "label": "T2 marks /25"},
                {"key": "marks_t3", "label": "T3 marks /25"},
                {"key": "marks_current", "label": "T4 marks /50"},
                {"key": "marks_t4_half", "label": "T4/2 /25"},
                {"key": "marks_total", "label": "T1+T2+T3+(T4/2) /100"},
            ],
        }
    return {
        "current_key": "current_fail",
        "current_label": "REM<35",
        "total_key": "total_fail",
        "total_label": "REM<35",
        "either_key": "either_fail",
        "either_label": "Either (REM<35)",
        "current_threshold": 35,
        "total_threshold": 35,
        "exam_col_label": "REM marks /100",
        "total_col_label": "Total till REM /100",
        "display_columns": [
            {"key": "marks_current", "label": "REM marks /100"},
            {"key": "marks_total", "label": "Total till REM /100"},
        ],
    }

# ---------------- LOGIN ----------------
def login_page(request):
    error = ""

    if request.method == "POST":
        username = request.POST.get("username")
        password = request.POST.get("password")

        # coordinator login
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            request.session.pop("mentor", None)
            _active_module(request)
            return redirect("/reports/")

        # mentor login
        if password == "mentor@LJ123":
            mentor = resolve_mentor_identity(username)
            if mentor:
                request.session["mentor"] = mentor.name
                _active_module(request)
                return redirect("/mentor-dashboard/")

        error = "Invalid username or password"

    return render(request, "login.html", {"error": error})


# ---------------- STUDENT MASTER ----------------
@login_required
def upload_students(request):
    module = _active_module(request)

    message = ""
    skipped_rows = []

    if request.method == 'POST':
        form = UploadFileForm(request.POST, request.FILES)
        if form.is_valid():
            file = request.FILES['file']
            try:
                added, updated, skipped, skipped_rows = import_students_from_excel(file, module)
                message = f"Added: {added} | Updated: {updated} | Skipped: {skipped}"
            except Exception as e:
                message = f"Upload failed: {str(e)}"
    else:
        form = UploadFileForm()

    students = Student.objects.select_related("mentor").filter(module=module).order_by("roll_no")

    return render(request, 'upload.html', {
        'form': form,
        'message': message,
        'students': students,
        'skipped_rows': skipped_rows[:200],
    })

# ---------------- ATTENDANCE VIEW & UPLOAD ----------------
@require_http_methods(["GET","POST"])
def upload_attendance(request):
    module = _active_module(request)

    # -------- OPEN PAGE --------
    if request.method == "GET":
        return render(request, "upload_attendance.html")

    # -------- AJAX UPLOAD --------
    try:
        week_no = int(request.POST.get('week'))
        rule = request.POST.get('rule')
        weekly_file = request.FILES.get('weekly_file')
        overall_file = request.FILES.get('overall_file')

        # Week-1 has no overall
        if week_no == 1:
            overall_file = None

        # lock check
        if WeekLock.objects.filter(module=module, week_no=week_no, locked=True).exists():
            return JsonResponse({
                "ok": False,
                "msg": f"Week {week_no} is LOCKED. Upload not allowed."
            })

        # import
        count = import_attendance(weekly_file, overall_file, week_no, module, rule)

        # mentor-wise counts
        mentor_stats = list(
            CallRecord.objects.filter(week_no=week_no, student__module=module)
            .values("student__mentor__name")
            .annotate(total=Count("id"))
            .order_by("student__mentor__name")
        )

        total_calls = sum(m["total"] for m in mentor_stats)

        return JsonResponse({
            "ok": True,
            "msg": f"{count} students require follow-up calls for Week {week_no}",
            "week": week_no,
            "mentor_stats": mentor_stats,
            "total_calls": total_calls
        })

    except Exception as e:
        return JsonResponse({
            "ok": False,
            "msg": str(e)
        })


def _process_result_upload(module, username, test_name, subject_id, upload_mode, bulk_confirm, file_obj, progress_cb=None, cancel_cb=None):
    is_all_tests = test_name == "ALL_EXAMS"
    is_all_subjects = str(subject_id).upper() == "ALL"

    if is_all_tests and is_all_subjects:
        summary = import_compiled_bulk_all(
            file_obj,
            username,
            module=module,
            progress_cb=progress_cb,
            cancel_cb=cancel_cb,
        )
        return {
            "ok": True,
            "msg": (
                f"Bulk replace completed. Created uploads: {summary['uploads_created']}. "
                f"Rows matched: {summary['rows_matched']}. Failed calls: {summary['rows_failed']}."
            ),
            "test_name": "ALL_EXAMS",
            "subject_name": "ALL",
            "upload_id": "",
            "mentor_stats": [],
            "total_calls": summary["rows_failed"],
            "upload_mode": upload_mode,
            "found_subjects": summary.get("found_subjects", []),
            "used_subject": "ALL",
        }

    subject = Subject.objects.filter(id=subject_id, module=module, is_active=True).first()
    if not subject:
        raise Exception("Invalid subject")
    if subject.result_format == Subject.FORMAT_T4_ONLY and test_name != "T4":
        raise Exception("This subject is configured as Only T4. Please upload in T4.")

    upload, _ = ResultUpload.objects.update_or_create(
        module=module,
        test_name=test_name,
        subject=subject,
        defaults={"uploaded_by": username},
    )

    if upload_mode == "compiled":
        summary = import_compiled_result_sheet(file_obj, upload, progress_cb=progress_cb, cancel_cb=cancel_cb)
    else:
        summary = import_result_sheet(file_obj, upload, progress_cb=progress_cb, cancel_cb=cancel_cb)

    mentor_stats = list(
        ResultCallRecord.objects.filter(upload=upload)
        .values("student__mentor__name")
        .annotate(total=Count("id"))
        .order_by("student__mentor__name")
    )
    total_calls = sum(m["total"] for m in mentor_stats)
    return {
        "ok": True,
        "msg": (
            f"Processed {summary['rows_total']} rows. "
            f"Matched: {summary['rows_matched']}. "
            f"Fail calls generated: {summary['rows_failed']}."
        ),
        "test_name": test_name,
        "subject_name": subject.name,
        "upload_id": upload.id,
        "mentor_stats": mentor_stats,
        "total_calls": total_calls,
        "upload_mode": upload_mode,
        "found_subjects": summary.get("found_subjects", []),
        "used_subject": summary.get("used_subject", ""),
    }


def _run_result_upload_job(job_id, module_id, username, test_name, subject_id, upload_mode, bulk_confirm, temp_path):
    close_old_connections()
    try:
        job = ResultUploadJob.objects.filter(job_id=job_id).first()
        if not job:
            return
        job.status = ResultUploadJob.STATUS_RUNNING
        job.message = "Reading marks and preparing result call list..."
        job.save(update_fields=["status", "message", "updated_at"])

        def cancel_cb():
            return ResultUploadJob.objects.filter(job_id=job_id, cancel_requested=True).exists()

        def progress_cb(current, total, enrollment, student_name, message):
            ResultUploadJob.objects.filter(job_id=job_id).update(
                progress_current=current or 0,
                progress_total=total or 0,
                current_enrollment=(enrollment or ""),
                current_student_name=(student_name or ""),
                message=(message or "Processing result upload..."),
                updated_at=timezone.now(),
            )

        module = AcademicModule.objects.filter(id=module_id).first()
        if not module:
            raise Exception("Module not found")

        with open(temp_path, "rb") as f:
            payload = _process_result_upload(
                module=module,
                username=username,
                test_name=test_name,
                subject_id=subject_id,
                upload_mode=upload_mode,
                bulk_confirm=bulk_confirm,
                file_obj=f,
                progress_cb=progress_cb,
                cancel_cb=cancel_cb,
            )

        if cancel_cb():
            ResultUploadJob.objects.filter(job_id=job_id).update(
                status=ResultUploadJob.STATUS_CANCELLED,
                message="Upload cancelled.",
                updated_at=timezone.now(),
            )
            return

        ResultUploadJob.objects.filter(job_id=job_id).update(
            status=ResultUploadJob.STATUS_COMPLETED,
            message="Upload completed.",
            result_payload=payload,
            progress_current=1,
            progress_total=1,
            updated_at=timezone.now(),
        )
    except Exception as exc:
        cancelled = ResultUploadJob.objects.filter(job_id=job_id, cancel_requested=True).exists()
        ResultUploadJob.objects.filter(job_id=job_id).update(
            status=(ResultUploadJob.STATUS_CANCELLED if cancelled else ResultUploadJob.STATUS_FAILED),
            message=("Upload cancelled." if cancelled else str(exc)),
            updated_at=timezone.now(),
        )
    finally:
        try:
            if temp_path and os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass
        close_old_connections()


@login_required
@require_http_methods(["GET"])
def upload_results_progress(request, job_id):
    if "mentor" in request.session:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=403)
    module = _active_module(request)
    job = ResultUploadJob.objects.filter(job_id=job_id, module=module).first()
    if not job:
        return JsonResponse({"ok": False, "msg": "Job not found"}, status=404)
    return JsonResponse(
        {
            "ok": True,
            "job_id": job.job_id,
            "status": job.status,
            "message": job.message or "",
            "progress_current": job.progress_current,
            "progress_total": job.progress_total,
            "current_enrollment": job.current_enrollment or "",
            "current_student_name": job.current_student_name or "",
            "result": job.result_payload or {},
        }
    )


@login_required
@require_http_methods(["POST"])
def upload_results_cancel(request, job_id):
    if "mentor" in request.session:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=403)
    module = _active_module(request)
    updated = ResultUploadJob.objects.filter(
        job_id=job_id,
        module=module,
        status__in=[ResultUploadJob.STATUS_QUEUED, ResultUploadJob.STATUS_RUNNING],
    ).update(cancel_requested=True, message="Cancelling upload...", updated_at=timezone.now())
    if not updated:
        return JsonResponse({"ok": False, "msg": "Upload is already finished."})
    return JsonResponse({"ok": True, "msg": "Cancel requested."})


@login_required
@require_http_methods(["GET", "POST"])
def upload_results(request):
    if "mentor" in request.session:
        return redirect("/mentor-dashboard/")
    module = _active_module(request)

    if request.method == "GET":
        return render(
            request,
            "upload_results.html",
            {
                "tests": TEST_NAMES,
                "subjects": Subject.objects.filter(module=module, is_active=True).order_by("name"),
            },
        )

    try:
        test_name = (request.POST.get("test_name") or "").strip().upper()
        subject_id = request.POST.get("subject_id")
        upload_mode = (request.POST.get("upload_mode") or "subject").strip().lower()
        bulk_confirm = (request.POST.get("bulk_confirm") or "").strip().lower()
        file_obj = request.FILES.get("result_file")

        allowed_tests = set(TEST_NAMES) | {"ALL_EXAMS"}
        if test_name not in allowed_tests:
            return JsonResponse({"ok": False, "msg": "Invalid test name"})
        if not subject_id:
            return JsonResponse({"ok": False, "msg": "Subject is required"})
        if not file_obj:
            return JsonResponse({"ok": False, "msg": "Result file is required"})
        if upload_mode not in {"subject", "compiled"}:
            return JsonResponse({"ok": False, "msg": "Invalid upload mode"})

        is_all_tests = test_name == "ALL_EXAMS"
        is_all_subjects = str(subject_id).upper() == "ALL"
        if is_all_tests != is_all_subjects:
            return JsonResponse({"ok": False, "msg": "Please select BOTH ALL EXAMS and ALL subjects for bulk upload."})
        if is_all_tests and is_all_subjects and upload_mode != "compiled":
            return JsonResponse({"ok": False, "msg": "ALL_EXAMS + ALL subjects is supported only for Compiled sheet mode."})
        if is_all_tests and is_all_subjects and bulk_confirm != "yes":
            return JsonResponse({"ok": False, "msg": "Bulk upload cancelled. Please select YES to replace old uploads."})

        suffix = os.path.splitext(getattr(file_obj, "name", ""))[1] or ".xlsx"
        fd, temp_path = tempfile.mkstemp(prefix="result_upload_", suffix=suffix, dir=tempfile.gettempdir())
        with os.fdopen(fd, "wb") as tmp:
            for chunk in file_obj.chunks():
                tmp.write(chunk)

        job_key = str(uuid.uuid4())
        job = ResultUploadJob.objects.create(
            job_id=job_key,
            module=module,
            created_by=request.user.username,
            status=ResultUploadJob.STATUS_QUEUED,
            message="Upload queued...",
        )

        t = threading.Thread(
            target=_run_result_upload_job,
            kwargs={
                "job_id": job.job_id,
                "module_id": module.id,
                "username": request.user.username,
                "test_name": test_name,
                "subject_id": str(subject_id),
                "upload_mode": upload_mode,
                "bulk_confirm": bulk_confirm,
                "temp_path": temp_path,
            },
            daemon=True,
        )
        t.start()
        return JsonResponse({"ok": True, "job_id": job.job_id})
    except Exception as e:
        return JsonResponse({"ok": False, "msg": str(e)})


@login_required
def view_results(request):
    if "mentor" in request.session:
        return redirect("/mentor-dashboard/")
    module = _active_module(request)

    subjects = list(Subject.objects.filter(module=module, is_active=True).order_by("name"))
    selected_test = (request.GET.get("test") or "").upper()
    selected_subject = request.GET.get("subject")
    selected_filter = request.GET.get("filter", "either_fail")
    mentor_filter = request.GET.get("mentor", "")
    sort = request.GET.get("sort", "roll")
    direction = request.GET.get("dir", "asc")

    latest_upload = ResultUpload.objects.filter(module=module).select_related("subject").order_by("-uploaded_at").first()
    if not selected_test and not selected_subject and latest_upload:
        selected_test = latest_upload.test_name
        selected_subject = str(latest_upload.subject_id)

    if selected_test not in TEST_NAMES:
        selected_test = latest_upload.test_name if latest_upload else "T1"

    if not selected_subject and subjects:
        selected_subject = str(subjects[0].id)

    uploads = ResultUpload.objects.filter(module=module).select_related("subject").order_by("test_name", "subject__name")
    upload_map = {(u.test_name, str(u.subject_id)): u for u in uploads}
    selected_upload = upload_map.get((selected_test, str(selected_subject))) if selected_subject else None
    if not selected_upload and latest_upload and not request.GET.get("test") and not request.GET.get("subject"):
        selected_upload = latest_upload
        selected_test = latest_upload.test_name
        selected_subject = str(latest_upload.subject_id)

    matrix_rows = []
    for test in TEST_NAMES:
        cells = []
        for s in subjects:
            up = upload_map.get((test, str(s.id)))
            applicable = True
            if s.result_format == Subject.FORMAT_T4_ONLY and test != "T4":
                applicable = False
            cells.append({"subject": s, "upload": up, "applicable": applicable})
        matrix_rows.append({"test": test, "cells": cells})

    config = _result_filter_config(selected_test)
    records = []
    rows = []
    total_count = 0
    mentor_counts = []
    upload_waiting = False

    if selected_subject and not selected_upload:
        upload_waiting = True

    if selected_upload:
        base_qs = (
            StudentResult.objects.filter(upload=selected_upload)
            .select_related("student", "student__mentor", "upload", "upload__subject")
        )
        if selected_filter == config["current_key"]:
            base_qs = base_qs.filter(marks_current__lt=config["current_threshold"])
        elif selected_filter == config["total_key"]:
            base_qs = base_qs.filter(marks_total__lt=config["total_threshold"])
        elif selected_filter == config["either_key"]:
            base_qs = base_qs.filter(
                Q(marks_current__lt=config["current_threshold"]) |
                Q(marks_total__lt=config["total_threshold"])
            )

        mentor_counts = (
            base_qs.values("student__mentor__name")
            .annotate(c=Count("id"))
            .order_by("student__mentor__name")
        )
        total_count_all = base_qs.count()

        qs = base_qs
        if mentor_filter:
            qs = qs.filter(student__mentor__name=mentor_filter)

        sort_map = {
            "roll": "student__roll_no",
            "enroll": "student__enrollment",
            "name": "student__name",
            "mentor": "student__mentor__name",
            "exam": "marks_current",
            "total": "marks_total",
        }
        order = sort_map.get(sort, "student__roll_no")
        if direction == "desc":
            order = "-" + order
        records = qs.order_by(order)
        total_count = records.count()

        # Build previous-upload comparison maps for changed historical marks (same subject only).
        prev_mark_map = {}
        for prev_test in ["T1", "T2", "T3"]:
            prev_upload = (
                ResultUpload.objects.filter(module=module, test_name=prev_test, subject_id=selected_upload.subject_id)
                .order_by("-uploaded_at")
                .first()
            )
            if not prev_upload:
                continue
            prev_rows = StudentResult.objects.filter(upload=prev_upload).values("student_id", "marks_current")
            prev_mark_map[prev_test] = {r["student_id"]: r["marks_current"] for r in prev_rows}

        display_columns = config["display_columns"]
        for r in records:
            row_cells = []
            for col in display_columns:
                key = col["key"]
                value = None
                if key == "marks_t4_half":
                    value = (r.marks_current / 2.0) if r.marks_current is not None else None
                else:
                    value = getattr(r, key, None)

                changed = False
                hover = ""
                if selected_test in {"T2", "T3", "T4"} and key in {"marks_t1", "marks_t2", "marks_t3"}:
                    ref_test = "T1" if key == "marks_t1" else ("T2" if key == "marks_t2" else "T3")
                    prev_value = prev_mark_map.get(ref_test, {}).get(r.student_id)
                    if prev_value is not None and value is not None and float(prev_value) != float(value):
                        changed = True
                        hover = f"Previous {ref_test}: {prev_value}"

                row_cells.append(
                    {
                        "key": key,
                        "label": col["label"],
                        "value": value,
                        "is_changed": changed,
                        "hover": hover,
                    }
                )

            rows.append(
                {
                    "roll_no": r.student.roll_no,
                    "enrollment": r.enrollment,
                    "name": r.student.name,
                    "mentor": r.student.mentor.name,
                    "cells": row_cells,
                }
            )
    else:
        total_count_all = 0

    return render(
        request,
        "view_results.html",
        {
            "tests": TEST_NAMES,
            "subjects": subjects,
            "matrix_rows": matrix_rows,
            "selected_test": selected_test,
            "selected_subject": str(selected_subject or ""),
            "selected_upload": selected_upload,
            "upload_waiting": upload_waiting,
            "records": records,
            "rows": rows,
            "mentor_counts": mentor_counts,
            "total_count": total_count,
            "filter": selected_filter,
            "filter_current_key": config["current_key"],
            "filter_current_label": config["current_label"],
            "filter_total_key": config["total_key"],
            "filter_total_label": config["total_label"],
            "filter_either_key": config["either_key"],
            "filter_either_label": config["either_label"],
            "exam_col_label": config["exam_col_label"],
            "total_col_label": config["total_col_label"],
            "display_columns": config["display_columns"],
            "table_colspan": 4 + len(config["display_columns"]),
            "current_threshold": config["current_threshold"],
            "total_threshold": config["total_threshold"],
            "mentor_filter": mentor_filter,
            "total_count_all": total_count_all,
            "sort": sort,
            "dir": direction,
            "dir_roll": next_dir(sort, direction, "roll"),
            "dir_enroll": next_dir(sort, direction, "enroll"),
            "dir_name": next_dir(sort, direction, "name"),
            "dir_mentor": next_dir(sort, direction, "mentor"),
            "dir_exam": next_dir(sort, direction, "exam"),
            "dir_total": next_dir(sort, direction, "total"),
        },
    )


@login_required
def subjects_page(request):
    if "mentor" in request.session:
        return redirect("/mentor-dashboard/")
    module = _active_module(request)
    return render(
        request,
        "subjects.html",
        {
            "subjects": Subject.objects.filter(module=module).order_by("name"),
            "format_full": Subject.FORMAT_FULL,
            "format_t4_only": Subject.FORMAT_T4_ONLY,
        },
    )


@login_required
@require_http_methods(["POST"])
def add_subject(request):
    if "mentor" in request.session:
        return redirect("/mentor-dashboard/")
    module = _active_module(request)
    name = (request.POST.get("name") or "").strip()
    result_format = (request.POST.get("result_format") or Subject.FORMAT_FULL).strip()
    if not name:
        messages.error(request, "Subject name is required.")
        return redirect("/subjects/")
    if result_format not in {Subject.FORMAT_FULL, Subject.FORMAT_T4_ONLY}:
        result_format = Subject.FORMAT_FULL
    Subject.objects.get_or_create(
        module=module,
        name=name,
        defaults={"is_active": True, "result_format": result_format},
    )
    messages.success(request, "Subject saved.")
    return redirect("/subjects/")


@login_required
@require_http_methods(["POST"])
def edit_subject(request, subject_id):
    if "mentor" in request.session:
        return redirect("/mentor-dashboard/")
    module = _active_module(request)
    name = (request.POST.get("name") or "").strip()
    result_format = (request.POST.get("result_format") or Subject.FORMAT_FULL).strip()
    if not name:
        messages.error(request, "Subject name is required.")
        return redirect("/subjects/")
    subject = Subject.objects.filter(id=subject_id, module=module).first()
    if subject:
        subject.name = name
        if result_format not in {Subject.FORMAT_FULL, Subject.FORMAT_T4_ONLY}:
            result_format = Subject.FORMAT_FULL
        subject.result_format = result_format
        subject.save(update_fields=["name", "result_format"])
        messages.success(request, "Subject updated.")
    return redirect("/subjects/")


@login_required
@require_http_methods(["POST"])
def delete_subject(request, subject_id):
    if "mentor" in request.session:
        return redirect("/mentor-dashboard/")
    module = _active_module(request)
    subject = Subject.objects.filter(id=subject_id, module=module).first()
    if subject:
        subject.is_active = False
        subject.save(update_fields=["is_active"])
        messages.success(request, "Subject archived.")
    return redirect("/subjects/")

def next_dir(current_sort, current_dir, column):
    if current_sort == column and current_dir == "asc":
        return "desc"
    return "asc"


def view_attendance(request):

    # mentors should not access coordinator view
    if "mentor" in request.session:
        return redirect("/mentor-dashboard/")
    module = _active_module(request)

    # get available weeks
    weeks = Attendance.objects.filter(student__module=module).values_list("week_no", flat=True)\
                              .distinct().order_by("week_no")

    selected_week = request.GET.get("week")
    # If no week selected → auto open latest week
    if not selected_week:
        latest = Attendance.objects.filter(student__module=module).order_by("-week_no").first()
        if latest:
            selected_week = latest.week_no
    filter_type = request.GET.get("filter", "all")
    mentor_filter = request.GET.get("mentor")
    sort = request.GET.get("sort", "roll")
    direction = request.GET.get("dir", "asc")

    records = None
    mentor_counts = []
    total_count = 0

    # load data only when week selected
    if selected_week:
        selected_week = int(selected_week)

        qs = Attendance.objects.filter(week_no=selected_week, student__module=module)\
            .select_related("student", "student__mentor")

        # ---------- FILTERS ----------
        if filter_type == "weekly":
            qs = qs.filter(week_percentage__lt=80)

        elif filter_type == "overall":
            qs = qs.filter(overall_percentage__lt=80)

        elif filter_type == "either":
            qs = qs.filter(call_required=True)
        
        if mentor_filter:
            qs = qs.filter(student__mentor__name=mentor_filter)

        # ---------- SORTING ----------
        sort_map = {
            "roll": "student__roll_no",
            "enroll": "student__enrollment",
            "name": "student__name",
            "mentor": "student__mentor__name",
            "week": "week_percentage",
            "overall": "overall_percentage",
        }

        order = sort_map.get(sort, "student__roll_no")
        if direction == "desc":
            order = "-" + order

        records = qs.order_by(order)

        # ---------- COUNTS ----------
        mentor_counts = (
            records.values("student__mentor__name")
            .annotate(c=Count("id"))
            .order_by("student__mentor__name")
        )

        total_count = records.count()

    # ---------- ALWAYS RETURN ----------
    return render(request, "view_attendance.html", {
        "weeks": weeks,
        "records": records,
        "selected_week": selected_week,
        "filter": filter_type,
        "sort": sort,
        "dir": direction,
        "mentor_filter": mentor_filter,
        
        # sorting toggle directions
        "dir_roll": next_dir(sort, direction, "roll"),
        "dir_enroll": next_dir(sort, direction, "enroll"),
        "dir_name": next_dir(sort, direction, "name"),
        "dir_mentor": next_dir(sort, direction, "mentor"),
        "dir_week": next_dir(sort, direction, "week"),
        "dir_overall": next_dir(sort, direction, "overall"),

        # counts
        "mentor_counts": mentor_counts,
        "total_count": total_count,
    })



# ---------------- DELETE WEEK ----------------
def delete_week(request):
    module = _active_module(request)

    weeks = Attendance.objects.filter(student__module=module).values_list("week_no", flat=True)\
                              .distinct().order_by("week_no")

    message = ""

    # DELETE SINGLE WEEK
    if request.method == "POST" and "delete_week" in request.POST:
        week_no = int(request.POST.get("week"))

        Attendance.objects.filter(week_no=week_no, student__module=module).delete()
        CallRecord.objects.filter(week_no=week_no, student__module=module).delete()

        message = f"Week-{week_no} deleted successfully"

    # DELETE ALL (password protected)
    if request.method == "POST" and "delete_all" in request.POST:

        password = request.POST.get("password")
        user = authenticate(username=request.user.username, password=password)

        if user:
            Attendance.objects.filter(student__module=module).delete()
            CallRecord.objects.filter(student__module=module).delete()
            message = "ALL WEEKS DELETED"
        else:
            message = "Wrong password"

    return render(request, "delete_week.html", {
        "weeks": weeks,
        "message": message
    })


@login_required
def delete_results(request):
    if "mentor" in request.session:
        return redirect("/")
    module = _active_module(request)

    uploads = ResultUpload.objects.filter(module=module).select_related("subject").order_by("-uploaded_at")
    message = ""

    if request.method == "POST" and "delete_upload" in request.POST:
        upload_id = request.POST.get("upload_id")
        upload = ResultUpload.objects.filter(id=upload_id, module=module).select_related("subject").first()
        if upload:
            label = f"{upload.test_name} - {upload.subject.name}"
            upload.delete()
            message = f"Deleted result upload: {label}"
        else:
            message = "Upload not found."

    if request.method == "POST" and "delete_all" in request.POST:
        password = request.POST.get("password")
        user = authenticate(username=request.user.username, password=password)
        if user:
            ResultUpload.objects.filter(module=module).delete()
            message = "ALL RESULT UPLOADS DELETED"
        else:
            message = "Wrong password"

    uploads = ResultUpload.objects.filter(module=module).select_related("subject").order_by("-uploaded_at")
    return render(
        request,
        "delete_results.html",
        {
            "uploads": uploads,
            "message": message,
        },
    )


# ---------------- LOCK WEEK ----------------
def lock_week(request):
    module = _active_module(request)
    if request.method == "POST":
        week = int(request.POST.get("week"))
        WeekLock.objects.update_or_create(
            module=module,
            week_no=week,
            defaults={"locked": True}
        )
        return redirect(f"/reports/?week={week}")
    return redirect("/reports/")


# ---------------- MENTOR DASHBOARD ----------------
def mentor_dashboard(request):
    mentor = _session_mentor_obj(request)
    if not mentor:
        return redirect("/")
    module = _active_module(request)

    # all uploaded weeks
    weeks = sorted(
        Attendance.objects.filter(student__module=module).values_list("week_no", flat=True).distinct()
    )

    # selected week
    selected_week = request.GET.get("week")

    if not selected_week and weeks:
        selected_week = weeks[-1]
    else:
        selected_week = int(selected_week) if selected_week else None

    records = []

    if selected_week:
        records = CallRecord.objects.filter(
            student__mentor=mentor,
            student__module=module,
            week_no=selected_week
        ).select_related("student")

    # build attendance map
    attendance_map = {}
    if selected_week:
        atts = Attendance.objects.filter(week_no=selected_week, student__mentor=mentor, student__module=module)
        for a in atts:
            attendance_map[a.student_id] = a
    
    all_done = False
    not_connected = []

    if selected_week:
        week_calls = CallRecord.objects.filter(
            student__mentor=mentor,
            student__module=module,
            week_no=selected_week
        )

        total = week_calls.count()
        finished = week_calls.exclude(final_status__isnull=True).count()

        if total > 0 and total == finished:
            all_done = True
            not_connected = week_calls.filter(final_status="not_received")

    
    return render(request,"mentor_dashboard.html",{
        "mentor": mentor,
        "weeks": weeks,
        "selected_week": selected_week,
        "records": records,
        "attendance_map": attendance_map,
        "all_done": all_done,
        "not_connected": not_connected
    })
def mentor_other_calls(request):
    mentor = _session_mentor_obj(request)
    if not mentor:
        return redirect("/")
    module = _active_module(request)
    students = Student.objects.filter(module=module, mentor=mentor).order_by("roll_no", "name")

    existing = {
        x.student_id: x
        for x in OtherCallRecord.objects.filter(mentor=mentor, student__module=module, student__in=students).select_related("student")
    }
    to_create = []
    for s in students:
        if s.id not in existing:
            to_create.append(OtherCallRecord(student=s, mentor=mentor))
    if to_create:
        OtherCallRecord.objects.bulk_create(to_create)

    qs = (
        OtherCallRecord.objects.filter(mentor=mentor, student__module=module)
        .select_related("student")
        .order_by("student__roll_no", "student__name")
    )
    status_weight = {None: 0, "": 0, "not_received": 1, "received": 2}
    records = sorted(
        list(qs),
        key=lambda x: (status_weight.get(x.final_status, 0), x.student.roll_no or 999999),
    )
    return render(
        request,
        "mentor_other_calls.html",
        {
            "mentor": mentor,
            "records": records,
        },
    )


def save_other_call(request):
    if request.method != "POST":
        return JsonResponse({"ok": False})

    mentor = _session_mentor_obj(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _active_module(request)

    call = OtherCallRecord.objects.select_related("student", "mentor").filter(
        id=request.POST.get("id"),
        mentor=mentor,
        student__module=module,
    ).first()
    if not call:
        return JsonResponse({"ok": False, "msg": "Call not found"}, status=404)

    status = request.POST.get("status")
    talked = request.POST.get("talked")
    duration = request.POST.get("duration")
    remark = request.POST.get("remark")
    call_reason = request.POST.get("call_reason")
    target = request.POST.get("target")
    call_category = (request.POST.get("call_category") or "other").strip().lower()
    week_no_raw = (request.POST.get("week_no") or "").strip()
    day_no_raw = (request.POST.get("day_no") or "").strip()
    exam_name = (request.POST.get("exam_name") or "").strip()
    subject_name = (request.POST.get("subject_name") or "").strip()
    marks_obtained_raw = (request.POST.get("marks_obtained") or "").strip()
    marks_out_of_raw = (request.POST.get("marks_out_of") or "").strip()

    if not call.attempt1_time:
        call.attempt1_time = timezone.now()
    elif not call.attempt2_time:
        call.attempt2_time = timezone.now()

    if target in {"student", "father"}:
        call.last_called_target = target
    if call_category not in {"less_attendance", "poor_result", "other"}:
        call_category = "other"
    call.call_category = call_category

    if call_category == "less_attendance":
        try:
            week_no = int(week_no_raw)
            day_no = int(day_no_raw)
        except (TypeError, ValueError):
            return JsonResponse({"ok": False, "msg": "Week number and day number are required."}, status=400)

        # Store as attendance call record so it appears in SIF attendance section.
        attendance_call, _ = CallRecord.objects.get_or_create(
            student=call.student,
            week_no=week_no,
            defaults={"attempt1_time": timezone.now()},
        )
        if not attendance_call.attempt1_time:
            attendance_call.attempt1_time = timezone.now()
        elif not attendance_call.attempt2_time:
            attendance_call.attempt2_time = timezone.now()

        parent_text = (remark or "Sick").strip()
        faculty_text = (call_reason or f"Absent on WK-{week_no} DAY-{day_no}").strip()
        attendance_call.talked_with = talked or "father"
        attendance_call.duration = duration or ""
        attendance_call.parent_reason = f"PARENT::{parent_text}||FACULTY::{faculty_text}"
        if status in {"received", "not_received"}:
            attendance_call.final_status = status
        attendance_call.save()
        call.exam_name = ""
        call.subject_name = ""
        call.marks_obtained = None
        call.marks_out_of = None

    if call_category == "poor_result":
        if not exam_name or not subject_name:
            return JsonResponse({"ok": False, "msg": "Exam name and subject name are required."}, status=400)
        call.exam_name = exam_name
        call.subject_name = subject_name
        try:
            call.marks_obtained = float(marks_obtained_raw) if marks_obtained_raw else None
            call.marks_out_of = float(marks_out_of_raw) if marks_out_of_raw else None
        except ValueError:
            return JsonResponse({"ok": False, "msg": "Marks must be numeric."}, status=400)
    elif call_category == "other":
        call.exam_name = ""
        call.subject_name = ""
        call.marks_obtained = None
        call.marks_out_of = None

    if status == "received":
        call.final_status = "received"
        call.talked_with = talked
        call.duration = duration
        if call_category == "poor_result":
            call.parent_remark = (remark or "Student will Study more").strip()
        else:
            call.parent_remark = remark or ""
        call.call_done_reason = call_reason or ""
    elif status == "not_received":
        call.final_status = "not_received"
        call.call_done_reason = call_reason or call.call_done_reason

    call.save()
    return JsonResponse({"ok": True})


# ---------------- SAVE CALL ----------------
def save_call(request):

    if request.method == "POST":
        module = _active_module(request)

        call = CallRecord.objects.get(id=request.POST.get("id"), student__module=module)
        status = request.POST.get("status")
        talked = request.POST.get("talked")
        duration = request.POST.get("duration")
        reason = request.POST.get("reason")

        if not call.attempt1_time:
            call.attempt1_time = timezone.now()

        elif not call.attempt2_time:
            call.attempt2_time = timezone.now()

        if status == "received":
            call.final_status = "received"
            call.talked_with = talked
            call.duration = duration
            call.parent_reason = reason
        elif call.attempt2_time:
            call.final_status = "not_received"

        call.save()
        return JsonResponse({"ok": True})


# ---------------- MESSAGE SENT ----------------
def mark_message(request):
    if request.method=="POST":
        module = _active_module(request)
        call=CallRecord.objects.get(id=request.POST.get("id"), student__module=module)
        call.message_sent=True
        call.save()
        return JsonResponse({"ok":True})


# ---------------- MENTOR REPORT ----------------
def mentor_report(request):
    mentor_obj = _session_mentor_obj(request)
    if not mentor_obj:
        return redirect("/")
    module = _active_module(request)

    week = request.GET.get("week")
    if not week:
        return render(request,"mentor_report.html")

    week = int(week)

    students = Student.objects.filter(module=module, mentor=mentor_obj).count()

    below80 = Attendance.objects.filter(
        week_no=week, student__mentor=mentor_obj, student__module=module, call_required=True
    ).count()

    calls_done = CallRecord.objects.filter(
        week_no=week, student__mentor=mentor_obj, student__module=module, final_status__isnull=False
    ).count()

    received = CallRecord.objects.filter(
        week_no=week, student__mentor=mentor_obj, student__module=module, final_status="received"
    ).count()

    not_received = CallRecord.objects.filter(
        week_no=week, student__mentor=mentor_obj, student__module=module, final_status="not_received"
    ).count()

    message_done = CallRecord.objects.filter(
        week_no=week, student__mentor=mentor_obj, student__module=module, message_sent=True
    ).count()

    not_done = below80 - calls_done

    report = f"""
Follow up Attendance < 80% (Week-{week} only & Overall Week-01 to {week}):

Mentor Name: {mentor_obj.name}
Total no. Of students under mentorship: {students}
No. Of students under mentorship whose attendance < 80%: {below80}
No. Of call done: {calls_done}
No. Of call received: {received}
No. Of call not received: {not_received}
No. Of message done when call not received: {message_done}
Call not done: {not_done}
"""

    return render(request,"mentor_report.html",{"report":report,"week":week})


def mentor_result_calls(request):
    mentor = _session_mentor_obj(request)
    if not mentor:
        return redirect("/")
    module = _active_module(request)
    uploads = list(
        ResultUpload.objects.filter(module=module, calls__student__mentor=mentor, calls__student__module=module)
        .distinct()
        .order_by("-uploaded_at")
    )

    selected_upload = None
    upload_id = request.GET.get("upload")
    if upload_id:
        selected_upload = ResultUpload.objects.filter(id=upload_id, module=module).first()
    if not selected_upload and uploads:
        selected_upload = uploads[0]

    records = []
    all_done = False
    not_connected = []
    if selected_upload:
        records = (
            ResultCallRecord.objects.filter(upload=selected_upload, student__mentor=mentor)
            .filter(student__module=module)
            .select_related("student", "upload", "upload__subject")
            .order_by("student__roll_no", "student__name")
        )
        total = records.count()
        finished = records.exclude(final_status__isnull=True).count()
        if total > 0 and total == finished:
            all_done = True
            not_connected = records.filter(final_status="not_received")

    return render(
        request,
        "mentor_result_calls.html",
        {
            "mentor": mentor,
            "uploads": uploads,
            "selected_upload": selected_upload,
            "records": records,
            "all_done": all_done,
            "not_connected": not_connected,
        },
    )


def save_result_call(request):
    if request.method != "POST":
        return JsonResponse({"ok": False})

    mentor = _session_mentor_obj(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _active_module(request)

    call = ResultCallRecord.objects.select_related("student", "student__mentor").filter(
        id=request.POST.get("id"),
        student__mentor=mentor,
        student__module=module,
    ).first()
    if not call:
        return JsonResponse({"ok": False, "msg": "Call not found"}, status=404)

    status = request.POST.get("status")
    talked = request.POST.get("talked")
    duration = request.POST.get("duration")
    reason = request.POST.get("reason")

    if not call.attempt1_time:
        call.attempt1_time = timezone.now()
    elif not call.attempt2_time:
        call.attempt2_time = timezone.now()

    if status == "received":
        call.final_status = "received"
        call.talked_with = talked
        call.duration = duration
        call.parent_reason = reason
    elif status == "not_received":
        call.final_status = "not_received"

    call.save()
    return JsonResponse({"ok": True})


def mark_result_message(request):
    if request.method != "POST":
        return JsonResponse({"ok": False})

    mentor = _session_mentor_obj(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _active_module(request)

    call = ResultCallRecord.objects.select_related("student", "student__mentor").filter(
        id=request.POST.get("id"),
        student__mentor=mentor,
        student__module=module,
    ).first()
    if not call:
        return JsonResponse({"ok": False, "msg": "Call not found"}, status=404)

    call.message_sent = True
    call.save(update_fields=["message_sent"])
    return JsonResponse({"ok": True})


def mentor_result_report(request):
    mentor = _session_mentor_obj(request)
    if not mentor:
        return redirect("/")
    module = _active_module(request)

    uploads = list(
        ResultUpload.objects.filter(module=module, calls__student__mentor=mentor, calls__student__module=module)
        .distinct()
        .order_by("-uploaded_at")
    )

    selected_upload = None
    upload_id = request.GET.get("upload")
    if upload_id:
        selected_upload = ResultUpload.objects.filter(id=upload_id, module=module).first()
    if not selected_upload and uploads:
        selected_upload = uploads[0]

    report = ""
    if selected_upload:
        calls = ResultCallRecord.objects.filter(
            upload=selected_upload,
            student__mentor=mentor,
            student__module=module,
        )
        total = calls.count()
        received = calls.filter(final_status="received").count()
        not_received = calls.filter(final_status="not_received").count()
        message_done = calls.filter(message_sent=True).count()
        report = _result_report_text(
            selected_upload.test_name,
            selected_upload.subject.name,
            mentor.name,
            total,
            received,
            not_received,
            message_done,
        )

    return render(
        request,
        "mentor_result_report.html",
        {
            "uploads": uploads,
            "selected_upload": selected_upload,
            "report": report,
        },
    )


# ---------------- PDF PRINT ----------------
def print_student(request, enrollment):
    if not request.user.is_authenticated and "mentor" not in request.session:
        return redirect("/")

    module = _active_module(request)
    student = Student.objects.select_related("mentor").get(module=module, enrollment=enrollment)
    mentor = _session_mentor_obj(request)
    if mentor and student.mentor_id != mentor.id:
        return HttpResponse("Unauthorized", status=403)

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{student.name}.pdf"'

    generate_student_pdf(response, student)
    return response


def _safe_pdf_name(text):
    cleaned = re.sub(r"[^A-Za-z0-9 _-]+", "", str(text or "")).strip()
    cleaned = re.sub(r"\s+", "_", cleaned)
    return cleaned or "Student"


def mentor_prefilled_sif_pdf(request, enrollment):
    mentor = _session_mentor_obj(request)
    if not mentor:
        return redirect("/")
    module = _active_module(request)
    student = Student.objects.select_related("mentor").filter(module=module, enrollment=enrollment, mentor=mentor).first()
    if not student:
        return HttpResponse("Unauthorized", status=403)

    roll = student.roll_no if student.roll_no is not None else "NA"
    filename = f"{roll}_{_safe_pdf_name(student.name)}_SIF.pdf"
    response = HttpResponse(content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    generate_student_prefilled_pdf(response, student)
    return response


def mentor_prefilled_sif_zip(request):
    mentor = _session_mentor_obj(request)
    if not mentor:
        return redirect("/")
    module = _active_module(request)

    students = list(
        Student.objects.select_related("mentor")
        .filter(module=module, mentor=mentor)
        .order_by("roll_no", "name")
    )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for s in students:
            pdf_bytes = io.BytesIO()
            generate_student_prefilled_pdf(pdf_bytes, s)
            roll = s.roll_no if s.roll_no is not None else "NA"
            pdf_name = f"{roll}_{_safe_pdf_name(s.name)}_SIF.pdf"
            zf.writestr(pdf_name, pdf_bytes.getvalue())

    zip_name = f"{_safe_pdf_name(mentor.name)}_Prefilled_SIF.zip"
    response = HttpResponse(buffer.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{zip_name}"'
    return response


# ---------------- COORDINATOR DASHBOARD ----------------
def coordinator_dashboard(request):

    if "mentor" in request.session:
        return redirect("/mentor-dashboard/")
    module = _active_module(request)

    week = request.GET.get("week")
    if not week:
        return render(request,"coordinator_dashboard.html")

    week = int(week)
    mentors = Mentor.objects.filter(student__module=module).distinct()
    data = []

    for m in mentors:

        total_students = Student.objects.filter(module=module, mentor=m).count()

        need_call = Attendance.objects.filter(
            week_no=week, student__mentor=m, student__module=module, call_required=True
        ).count()

        received = CallRecord.objects.filter(
            week_no=week, student__mentor=m, student__module=module, final_status="received"
        ).count()

        not_received = CallRecord.objects.filter(
            week_no=week, student__mentor=m, student__module=module, final_status="not_received"
        ).count()

        done = received + not_received
        not_done = max(need_call - done, 0)

        message_sent = CallRecord.objects.filter(
            week_no=week, student__mentor=m, student__module=module, message_sent=True
        ).count()

        percent = round((done/need_call)*100,1) if need_call else 0

        data.append({
            "mentor":m.name,
            "students":total_students,
            "need_call":need_call,
            "done":done,
            "received":received,
            "not_received":not_received,
            "not_done":not_done,
            "msg_sent":message_sent,
            "percent":percent
        })

    return render(request,"coordinator_dashboard.html",{"data":data,"week":week})


@login_required
def coordinator_result_report(request):
    if "mentor" in request.session:
        return redirect("/mentor-dashboard/")
    module = _active_module(request)

    uploads = ResultUpload.objects.filter(module=module).order_by("-uploaded_at")
    selected_upload = None
    upload_id = request.GET.get("upload")
    if upload_id:
        selected_upload = ResultUpload.objects.filter(id=upload_id, module=module).first()
    if not selected_upload:
        selected_upload = uploads.first()

    data = []
    if selected_upload:
        mentors = (
            Mentor.objects.filter(student__module=module, student__resultcallrecord__upload=selected_upload)
            .distinct()
            .order_by("name")
        )
        for m in mentors:
            qs = ResultCallRecord.objects.filter(upload=selected_upload, student__mentor=m, student__module=module)
            need_call = qs.count()
            received = qs.filter(final_status="received").count()
            not_received = qs.filter(final_status="not_received").count()
            done = received + not_received
            not_done = max(need_call - done, 0)
            msg_sent = qs.filter(message_sent=True).count()
            percent = round((done / need_call) * 100, 1) if need_call else 0
            data.append(
                {
                    "mentor": m.name,
                    "need_call": need_call,
                    "done": done,
                    "received": received,
                    "not_received": not_received,
                    "not_done": not_done,
                    "msg_sent": msg_sent,
                    "percent": percent,
                }
            )

    return render(
        request,
        "coordinator_result_report.html",
        {
            "uploads": uploads,
            "selected_upload": selected_upload,
            "data": data,
        },
    )

def update_mobile(request):

    if request.method == "POST":
        if not request.user.is_authenticated and "mentor" not in request.session:
            return JsonResponse({"ok": False, "error": "Unauthorized"}, status=401)

        module = _active_module(request)
        enrollment = request.POST.get("enrollment")
        field = request.POST.get("field")
        value = request.POST.get("value")

        student = Student.objects.get(module=module, enrollment=enrollment)
        mentor = _session_mentor_obj(request)
        is_mentor_update = bool(mentor)
        if is_mentor_update and student.mentor_id != mentor.id:
            return JsonResponse({"ok": False, "error": "Unauthorized"}, status=403)

        if field == "father":
            student.father_mobile = value
            student.father_mobile_updated_by_mentor = is_mentor_update
        elif field == "mother":
            student.mother_mobile = value
        elif field == "student":
            student.student_mobile = value
            student.student_mobile_updated_by_mentor = is_mentor_update

        student.save()

        return JsonResponse({"ok": True})

    
# ---------------- CONTROL PANEL ----------------
def control_panel(request):

    if "mentor" in request.session:
        return redirect("/")

    module = _active_module(request)
    students = Student.objects.select_related("mentor").filter(module=module).order_by("roll_no")

    return render(request,"control_panel.html",{"students":students})


def mentor_print_sif(request):
    mentor = _session_mentor_obj(request)
    if not mentor:
        return redirect("/")
    module = _active_module(request)

    students = Student.objects.select_related("mentor").filter(module=module, mentor=mentor).order_by("roll_no", "name")
    return render(
        request,
        "mentor_print_sif.html",
        {
            "mentor": mentor,
            "students": students,
        },
    )


# ---------------- MODULE SWITCH ----------------
@require_http_methods(["POST"])
def switch_module(request):
    if not request.user.is_authenticated and "mentor" not in request.session:
        return redirect("/")
    module_id = request.POST.get("module_id")
    module = AcademicModule.objects.filter(id=module_id, is_active=True).first()
    if module:
        request.session["current_module_id"] = module.id
    next_url = request.POST.get("next") or request.META.get("HTTP_REFERER") or "/reports/"
    return redirect(next_url)


@login_required
def manage_modules(request):
    if "mentor" in request.session:
        return redirect("/mentor-dashboard/")

    if request.method == "POST":
        batch = (request.POST.get("academic_batch") or "").strip()
        year_level = (request.POST.get("year_level") or "FY").strip()
        variant = (request.POST.get("variant") or "FY2-CE").strip()
        semester = (request.POST.get("semester") or "Sem-1").strip()
        if not batch:
            messages.error(request, "Batch is required.")
            return redirect("/modules/")
        if year_level not in {x[0] for x in AcademicModule.YEAR_CHOICES}:
            year_level = "FY"
        if variant not in {x[0] for x in AcademicModule.VARIANT_CHOICES}:
            variant = "FY2-CE"
        if semester not in {x[0] for x in AcademicModule.SEM_CHOICES}:
            semester = "Sem-1"

        name = f"{variant} - Batch {batch}_{semester}"
        module, created = AcademicModule.objects.get_or_create(
            name=name,
            defaults={
                "academic_batch": batch,
                "year_level": year_level,
                "variant": variant,
                "semester": semester,
                "is_active": True,
            },
        )
        request.session["current_module_id"] = module.id
        if created:
            messages.success(request, f"Module created: {module.name}")
        else:
            messages.info(request, f"Module already exists: {module.name}")
        return redirect("/modules/")

    return render(
        request,
        "modules.html",
        {
            "modules": AcademicModule.objects.filter(is_active=True).order_by("-id"),
            "year_choices": AcademicModule.YEAR_CHOICES,
            "variant_choices": AcademicModule.VARIANT_CHOICES,
            "sem_choices": AcademicModule.SEM_CHOICES,
        },
    )


# ---------------- SEM REGISTER ----------------

def semester_register(request):
    module = _active_module(request)

    # all uploaded weeks
    weeks = sorted(
        Attendance.objects.filter(student__module=module).values_list("week_no", flat=True).distinct()
    )

    students = Student.objects.select_related("mentor").filter(module=module).order_by("roll_no")

    table = []

    for s in students:

        row = {
            "roll": s.roll_no,
            "enrollment": s.enrollment,
            "name": s.name,
            "mentor": s.mentor.name
        }

        overall = None

        for w in weeks:
            rec = Attendance.objects.filter(student=s, week_no=w).first()
            if rec:
                row[f"week_{w}"] = rec.week_percentage
                overall = rec.overall_percentage
            else:
                row[f"week_{w}"] = None

        row["overall"] = overall
        table.append(row)

    return render(request, "semester_register.html", {
        "weeks": weeks,
        "rows": table
    })
