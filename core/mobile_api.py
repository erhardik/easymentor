import json
import secrets
from datetime import timedelta

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .models import (
    AcademicModule,
    Attendance,
    CallRecord,
    Mentor,
    MentorAuthToken,
    OtherCallRecord,
    ResultCallRecord,
    ResultUpload,
    Student,
)
from .utils import resolve_mentor_identity


SHARED_MENTOR_PASSWORD = "mentor@LJ123"
TOKEN_TTL_HOURS = 24 * 7


def _json_body(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except Exception:
        return {}


def _token_from_request(request):
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return ""


def _auth_mentor(request):
    raw = _token_from_request(request)
    if not raw:
        return None
    token_obj = (
        MentorAuthToken.objects.select_related("mentor")
        .filter(token=raw, is_active=True)
        .first()
    )
    if not token_obj:
        return None
    if token_obj.expires_at <= timezone.now():
        token_obj.is_active = False
        token_obj.save(update_fields=["is_active"])
        return None
    return token_obj.mentor


def _mentor_modules(mentor):
    return (
        AcademicModule.objects.filter(is_active=True, students__mentor=mentor)
        .distinct()
        .order_by("-id")
    )


def _module_id_from_request(request):
    qv = request.GET.get("module_id")
    if qv:
        return qv
    body = _json_body(request) if request.method in {"POST", "PUT", "PATCH"} else {}
    bv = body.get("module_id")
    if bv:
        return str(bv)
    hv = request.headers.get("X-Module-Id", "")
    return hv.strip() or None


def _resolve_module(request, mentor, required=False):
    modules = _mentor_modules(mentor)
    if not modules.exists():
        return None
    module_id = _module_id_from_request(request)
    if module_id:
        picked = modules.filter(id=module_id).first()
        if picked:
            return picked
        if required:
            return "__INVALID__"
    return modules.first()


def _attendance_map(mentor, week_no, module):
    rows = Attendance.objects.filter(
        week_no=week_no,
        student__mentor=mentor,
        student__module=module,
    ).select_related("student")
    out = {}
    for row in rows:
        out[row.student_id] = row
    return out


def _result_report_text(upload, mentor_name, total, received, not_received, message_done):
    test_name = upload.test_name
    subject_name = upload.subject.name
    if test_name == "T1":
        rule = "Less than 9 marks in T1"
    elif test_name == "T2":
        rule = "Less than 9 marks in T2 & less than 18 in (T1+T2)"
    elif test_name == "T3":
        rule = "Less than 9 marks in T3 & less than 27 in (T1+T2+T3)"
    elif test_name == "T4":
        rule = "Less than 18 marks in SEE & less than 35 in (T1+T2+T3+SEE)"
    else:
        rule = "Less than 35 marks in REMEDIAL"

    return (
        f"📞Phone call done regarding failed in {subject_name} ({rule})\n"
        f"Name of Faculty- {mentor_name}\n"
        f"Total no of calls- {total:02d}\n"
        f"Received Calls - {received:02d}\n"
        f"Not received- {not_received:02d}\n"
        f"No of Message done as call not Received - {message_done:02d}"
    )


@csrf_exempt
@require_http_methods(["POST"])
def api_mobile_login(request):
    body = _json_body(request)
    mentor_name = (body.get("mentor") or "").strip()
    password = body.get("password") or ""

    if password != SHARED_MENTOR_PASSWORD:
        return JsonResponse({"ok": False, "msg": "Invalid credentials"}, status=401)

    mentor = resolve_mentor_identity(mentor_name)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Invalid credentials"}, status=401)

    MentorAuthToken.objects.filter(mentor=mentor, is_active=True).update(is_active=False)

    token = secrets.token_hex(32)
    expires_at = timezone.now() + timedelta(hours=TOKEN_TTL_HOURS)
    MentorAuthToken.objects.create(
        mentor=mentor,
        token=token,
        expires_at=expires_at,
        is_active=True,
    )

    return JsonResponse(
        {
            "ok": True,
            "token": token,
            "mentor": mentor.name,
            "expires_at": expires_at.isoformat(),
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
def api_mobile_logout(request):
    token = _token_from_request(request)
    if token:
        MentorAuthToken.objects.filter(token=token, is_active=True).update(is_active=False)
    return JsonResponse({"ok": True})


@require_http_methods(["GET"])
def api_mobile_modules(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    modules = list(_mentor_modules(mentor))
    selected = _resolve_module(request, mentor)
    return JsonResponse(
        {
            "ok": True,
            "modules": [
                {
                    "module_id": m.id,
                    "name": m.name,
                    "batch": m.academic_batch,
                    "year_level": m.year_level,
                    "variant": m.variant,
                    "semester": m.semester,
                }
                for m in modules
            ],
            "selected_module_id": selected.id if selected else None,
        }
    )


@require_http_methods(["GET"])
def api_mobile_weeks(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor)
    if not module:
        return JsonResponse({"ok": True, "weeks": [], "latest_week": None, "module_id": None})

    weeks = sorted(
        Attendance.objects.filter(student__mentor=mentor, student__module=module)
        .values_list("week_no", flat=True)
        .distinct()
    )
    latest = weeks[-1] if weeks else None
    return JsonResponse({"ok": True, "weeks": weeks, "latest_week": latest, "module_id": module.id})


@require_http_methods(["GET"])
def api_mobile_calls(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor, required=True)
    if module == "__INVALID__":
        return JsonResponse({"ok": False, "msg": "Invalid module"}, status=400)
    if not module:
        return JsonResponse({"ok": True, "records": [], "all_done": False, "module_id": None})

    week = request.GET.get("week")
    if not week:
        return JsonResponse({"ok": False, "msg": "week is required"}, status=400)

    week_no = int(week)
    attendance_map = _attendance_map(mentor, week_no, module)

    calls = (
        CallRecord.objects.filter(student__mentor=mentor, student__module=module, week_no=week_no)
        .select_related("student")
        .order_by("student__roll_no", "student__name")
    )

    data = []
    for c in calls:
        a = attendance_map.get(c.student_id)
        data.append(
            {
                "call_id": c.id,
                "week_no": c.week_no,
                "student": {
                    "roll_no": c.student.roll_no,
                    "enrollment": c.student.enrollment,
                    "name": c.student.name,
                    "student_mobile": c.student.student_mobile,
                    "father_mobile": c.student.father_mobile,
                    "mother_mobile": c.student.mother_mobile,
                },
                "week_percentage": a.week_percentage if a else None,
                "overall_percentage": a.overall_percentage if a else None,
                "final_status": c.final_status,
                "talked_with": c.talked_with,
                "duration": c.duration,
                "parent_reason": c.parent_reason,
                "message_sent": c.message_sent,
            }
        )

    total = len(data)
    done = len([x for x in data if x["final_status"] is not None])

    return JsonResponse(
        {
            "ok": True,
            "week": week_no,
            "mentor": mentor.name,
            "module_id": module.id,
            "total": total,
            "done": done,
            "all_done": total > 0 and done == total,
            "records": data,
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
def api_mobile_save_call(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor, required=True)
    if module == "__INVALID__":
        return JsonResponse({"ok": False, "msg": "Invalid module"}, status=400)

    body = _json_body(request)
    call_id = body.get("id")
    status = body.get("status")
    talked = body.get("talked")
    duration = (body.get("duration") or "").strip()
    reason = (body.get("reason") or "").strip()

    call = (
        CallRecord.objects.select_related("student", "student__mentor")
        .filter(id=call_id, student__mentor=mentor, student__module=module)
        .first()
    )
    if not call:
        return JsonResponse({"ok": False, "msg": "Call not found"}, status=404)

    if not call.attempt1_time:
        call.attempt1_time = timezone.now()
    elif not call.attempt2_time:
        call.attempt2_time = timezone.now()

    if status == "received":
        if not reason:
            return JsonResponse(
                {"ok": False, "msg": "Parent remark is required for received calls"},
                status=400,
            )
        if talked not in {"father", "mother", "guardian"}:
            talked = "guardian"
        call.final_status = "received"
        call.talked_with = talked
        call.duration = duration
        call.parent_reason = reason
    elif status == "not_received":
        call.final_status = "not_received"

    call.save()
    return JsonResponse({"ok": True})


@csrf_exempt
@require_http_methods(["POST"])
def api_mobile_mark_message(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor, required=True)
    if module == "__INVALID__":
        return JsonResponse({"ok": False, "msg": "Invalid module"}, status=400)

    body = _json_body(request)
    call_id = body.get("id")
    call = (
        CallRecord.objects.select_related("student", "student__mentor")
        .filter(id=call_id, student__mentor=mentor, student__module=module)
        .first()
    )
    if not call:
        return JsonResponse({"ok": False, "msg": "Call not found"}, status=404)
    call.message_sent = True
    call.save(update_fields=["message_sent"])
    return JsonResponse({"ok": True})


@require_http_methods(["GET"])
def api_mobile_retry_list(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor, required=True)
    if module == "__INVALID__":
        return JsonResponse({"ok": False, "msg": "Invalid module"}, status=400)
    if not module:
        return JsonResponse({"ok": True, "week": None, "records": [], "module_id": None})

    week = request.GET.get("week")
    if not week:
        return JsonResponse({"ok": False, "msg": "week is required"}, status=400)
    week_no = int(week)
    attendance_map = _attendance_map(mentor, week_no, module)

    calls = (
        CallRecord.objects.filter(
            student__mentor=mentor,
            student__module=module,
            week_no=week_no,
            final_status="not_received",
        )
        .select_related("student")
        .order_by("student__roll_no", "student__name")
    )

    data = []
    for c in calls:
        a = attendance_map.get(c.student_id)
        data.append(
            {
                "call_id": c.id,
                "student_name": c.student.name,
                "roll_no": c.student.roll_no,
                "father_mobile": c.student.father_mobile,
                "mother_mobile": c.student.mother_mobile,
                "student_mobile": c.student.student_mobile,
                "week_percentage": a.week_percentage if a else None,
                "overall_percentage": a.overall_percentage if a else None,
                "message_sent": c.message_sent,
            }
        )

    return JsonResponse({"ok": True, "week": week_no, "records": data, "module_id": module.id})


@require_http_methods(["GET"])
def api_mobile_result_cycles(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor, required=True)
    if module == "__INVALID__":
        return JsonResponse({"ok": False, "msg": "Invalid module"}, status=400)
    if not module:
        return JsonResponse({"ok": True, "cycles": [], "latest_upload_id": None, "module_id": None})

    uploads = (
        ResultUpload.objects.filter(module=module, calls__student__mentor=mentor, calls__student__module=module)
        .select_related("subject")
        .distinct()
        .order_by("-uploaded_at")
    )
    data = [
        {
            "upload_id": u.id,
            "test_name": u.test_name,
            "subject_name": u.subject.name,
            "uploaded_at": u.uploaded_at.isoformat(),
        }
        for u in uploads
    ]
    latest = data[0]["upload_id"] if data else None
    return JsonResponse({"ok": True, "cycles": data, "latest_upload_id": latest, "module_id": module.id})


@require_http_methods(["GET"])
def api_mobile_result_calls(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor, required=True)
    if module == "__INVALID__":
        return JsonResponse({"ok": False, "msg": "Invalid module"}, status=400)
    if not module:
        return JsonResponse({"ok": True, "records": [], "all_done": False, "upload": None, "module_id": None})

    upload_id = request.GET.get("upload_id")
    upload = None
    if upload_id:
        upload = ResultUpload.objects.select_related("subject").filter(id=upload_id, module=module).first()
    if not upload:
        upload = (
            ResultUpload.objects.filter(module=module, calls__student__mentor=mentor, calls__student__module=module)
            .select_related("subject")
            .distinct()
            .order_by("-uploaded_at")
            .first()
        )
    if not upload:
        return JsonResponse({"ok": True, "records": [], "all_done": False, "upload": None})

    calls = (
        ResultCallRecord.objects.filter(upload=upload, student__mentor=mentor, student__module=module)
        .select_related("student", "upload", "upload__subject")
        .order_by("student__roll_no", "student__name")
    )
    data = []
    for c in calls:
        data.append(
            {
                "call_id": c.id,
                "upload_id": upload.id,
                "test_name": upload.test_name,
                "subject_name": upload.subject.name,
                "student": {
                    "roll_no": c.student.roll_no,
                    "enrollment": c.student.enrollment,
                    "name": c.student.name,
                    "student_mobile": c.student.student_mobile,
                    "father_mobile": c.student.father_mobile,
                    "mother_mobile": c.student.mother_mobile,
                },
                "final_status": c.final_status,
                "talked_with": c.talked_with,
                "duration": c.duration,
                "parent_reason": c.parent_reason,
                "message_sent": c.message_sent,
                "fail_reason": c.fail_reason,
                "marks_current": c.marks_current,
                "marks_total": c.marks_total,
            }
        )

    total = len(data)
    done = len([x for x in data if x["final_status"] is not None])
    return JsonResponse(
        {
            "ok": True,
            "upload": {
                "upload_id": upload.id,
                "test_name": upload.test_name,
                "subject_name": upload.subject.name,
            },
            "module_id": module.id,
            "records": data,
            "total": total,
            "done": done,
            "all_done": total > 0 and done == total,
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
def api_mobile_save_result_call(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor, required=True)
    if module == "__INVALID__":
        return JsonResponse({"ok": False, "msg": "Invalid module"}, status=400)

    body = _json_body(request)
    call_id = body.get("id")
    status = body.get("status")
    talked = body.get("talked")
    duration = (body.get("duration") or "").strip()
    reason = (body.get("reason") or "").strip()

    call = (
        ResultCallRecord.objects.select_related("student", "student__mentor")
        .filter(id=call_id, student__mentor=mentor, student__module=module)
        .first()
    )
    if not call:
        return JsonResponse({"ok": False, "msg": "Call not found"}, status=404)

    if not call.attempt1_time:
        call.attempt1_time = timezone.now()
    elif not call.attempt2_time:
        call.attempt2_time = timezone.now()

    if status == "received":
        if not reason:
            return JsonResponse(
                {"ok": False, "msg": "Parent remark is required for received calls"},
                status=400,
            )
        if talked not in {"father", "mother", "guardian"}:
            talked = "guardian"
        call.final_status = "received"
        call.talked_with = talked
        call.duration = duration
        call.parent_reason = reason
    elif status == "not_received":
        call.final_status = "not_received"

    call.save()
    return JsonResponse({"ok": True})


@csrf_exempt
@require_http_methods(["POST"])
def api_mobile_mark_result_message(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor, required=True)
    if module == "__INVALID__":
        return JsonResponse({"ok": False, "msg": "Invalid module"}, status=400)

    body = _json_body(request)
    call_id = body.get("id")
    call = (
        ResultCallRecord.objects.select_related("student", "student__mentor")
        .filter(id=call_id, student__mentor=mentor, student__module=module)
        .first()
    )
    if not call:
        return JsonResponse({"ok": False, "msg": "Call not found"}, status=404)
    call.message_sent = True
    call.save(update_fields=["message_sent"])
    return JsonResponse({"ok": True})


@require_http_methods(["GET"])
def api_mobile_result_retry_list(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor, required=True)
    if module == "__INVALID__":
        return JsonResponse({"ok": False, "msg": "Invalid module"}, status=400)
    if not module:
        return JsonResponse({"ok": True, "records": [], "module_id": None})

    upload_id = request.GET.get("upload_id")
    upload = None
    if upload_id:
        upload = ResultUpload.objects.select_related("subject").filter(id=upload_id, module=module).first()
    if not upload:
        return JsonResponse({"ok": True, "records": [], "module_id": module.id})

    calls = (
        ResultCallRecord.objects.filter(
            student__mentor=mentor,
            student__module=module,
            upload=upload,
            final_status="not_received",
        )
        .select_related("student")
        .order_by("student__roll_no", "student__name")
    )
    data = []
    for c in calls:
        data.append(
            {
                "call_id": c.id,
                "student_name": c.student.name,
                "roll_no": c.student.roll_no,
                "father_mobile": c.student.father_mobile,
                "mother_mobile": c.student.mother_mobile,
                "student_mobile": c.student.student_mobile,
                "message_sent": c.message_sent,
                "fail_reason": c.fail_reason,
            }
        )
    return JsonResponse({"ok": True, "records": data, "module_id": module.id})


@require_http_methods(["GET"])
def api_mobile_result_report(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor, required=True)
    if module == "__INVALID__":
        return JsonResponse({"ok": False, "msg": "Invalid module"}, status=400)
    if not module:
        return JsonResponse({"ok": True, "report": "", "stats": {}, "module_id": None})

    upload_id = request.GET.get("upload_id")
    upload = None
    if upload_id:
        upload = ResultUpload.objects.select_related("subject").filter(id=upload_id, module=module).first()
    if not upload:
        upload = (
            ResultUpload.objects.filter(module=module, calls__student__mentor=mentor, calls__student__module=module)
            .select_related("subject")
            .distinct()
            .order_by("-uploaded_at")
            .first()
        )
    if not upload:
        return JsonResponse({"ok": True, "report": "", "stats": {}})

    calls = ResultCallRecord.objects.filter(upload=upload, student__mentor=mentor, student__module=module)
    total = calls.count()
    received = calls.filter(final_status="received").count()
    not_received = calls.filter(final_status="not_received").count()
    message_done = calls.filter(message_sent=True).count()
    report = _result_report_text(upload, mentor.name, total, received, not_received, message_done)
    return JsonResponse(
        {
            "ok": True,
            "report": report,
            "upload": {
                "upload_id": upload.id,
                "test_name": upload.test_name,
                "subject_name": upload.subject.name,
            },
            "module_id": module.id,
            "stats": {
                "total": total,
                "received": received,
                "not_received": not_received,
                "message_done": message_done,
                "pending": max(total - received - not_received, 0),
            },
        }
    )


@require_http_methods(["GET"])
def api_mobile_other_calls(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor, required=True)
    if module == "__INVALID__":
        return JsonResponse({"ok": False, "msg": "Invalid module"}, status=400)
    if not module:
        return JsonResponse({"ok": True, "records": [], "module_id": None})

    students = Student.objects.filter(module=module, mentor=mentor).order_by("roll_no", "name")
    existing = {
        c.student_id: c
        for c in OtherCallRecord.objects.filter(mentor=mentor, student__module=module, student__in=students).select_related("student")
    }
    to_create = []
    for s in students:
        if s.id not in existing:
            to_create.append(OtherCallRecord(student=s, mentor=mentor))
    if to_create:
        OtherCallRecord.objects.bulk_create(to_create)

    rows = (
        OtherCallRecord.objects.filter(mentor=mentor, student__module=module)
        .select_related("student")
        .order_by("student__roll_no", "student__name")
    )
    data = []
    for c in rows:
        data.append(
            {
                "call_id": c.id,
                "student": {
                    "roll_no": c.student.roll_no,
                    "enrollment": c.student.enrollment,
                    "name": c.student.name,
                    "student_mobile": c.student.student_mobile,
                    "father_mobile": c.student.father_mobile,
                    "mother_mobile": c.student.mother_mobile,
                },
                "final_status": c.final_status,
                "talked_with": c.talked_with,
                "duration": c.duration,
                "parent_remark": c.parent_remark,
                "call_done_reason": c.call_done_reason,
                "last_called_target": c.last_called_target,
            }
        )

    return JsonResponse({"ok": True, "records": data, "module_id": module.id})


@csrf_exempt
@require_http_methods(["POST"])
def api_mobile_save_other_call(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)
    module = _resolve_module(request, mentor, required=True)
    if module == "__INVALID__":
        return JsonResponse({"ok": False, "msg": "Invalid module"}, status=400)

    body = _json_body(request)
    call_id = body.get("id")
    status = body.get("status")
    talked = body.get("talked")
    duration = (body.get("duration") or "").strip()
    remark = (body.get("remark") or "").strip()
    call_reason = (body.get("call_reason") or "").strip()
    target = (body.get("target") or "").strip()

    call = (
        OtherCallRecord.objects.select_related("student", "mentor")
        .filter(id=call_id, mentor=mentor, student__module=module)
        .first()
    )
    if not call:
        return JsonResponse({"ok": False, "msg": "Call not found"}, status=404)

    if not call.attempt1_time:
        call.attempt1_time = timezone.now()
    elif not call.attempt2_time:
        call.attempt2_time = timezone.now()

    if target in {"student", "father"}:
        call.last_called_target = target

    if status == "received":
        call.final_status = "received"
        if talked not in {"father", "mother", "guardian", "student"}:
            talked = "guardian"
        call.talked_with = talked
        call.duration = duration
        call.parent_remark = remark
        call.call_done_reason = call_reason
    elif status == "not_received":
        call.final_status = "not_received"
        call.call_done_reason = call_reason or call.call_done_reason

    call.save()
    return JsonResponse({"ok": True})
