import json
import secrets
from datetime import timedelta

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .models import Attendance, CallRecord, Mentor, MentorAuthToken


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


def _attendance_map(mentor, week_no):
    rows = Attendance.objects.filter(
        week_no=week_no,
        student__mentor=mentor,
    ).select_related("student")
    out = {}
    for row in rows:
        out[row.student_id] = row
    return out


@csrf_exempt
@require_http_methods(["POST"])
def api_mobile_login(request):
    body = _json_body(request)
    mentor_name = (body.get("mentor") or "").strip()
    password = body.get("password") or ""

    if password != SHARED_MENTOR_PASSWORD:
        return JsonResponse({"ok": False, "msg": "Invalid credentials"}, status=401)

    mentor = Mentor.objects.filter(name=mentor_name).first()
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
def api_mobile_weeks(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)

    weeks = sorted(
        Attendance.objects.filter(student__mentor=mentor)
        .values_list("week_no", flat=True)
        .distinct()
    )
    latest = weeks[-1] if weeks else None
    return JsonResponse({"ok": True, "weeks": weeks, "latest_week": latest})


@require_http_methods(["GET"])
def api_mobile_calls(request):
    mentor = _auth_mentor(request)
    if not mentor:
        return JsonResponse({"ok": False, "msg": "Unauthorized"}, status=401)

    week = request.GET.get("week")
    if not week:
        return JsonResponse({"ok": False, "msg": "week is required"}, status=400)

    week_no = int(week)
    attendance_map = _attendance_map(mentor, week_no)

    calls = (
        CallRecord.objects.filter(student__mentor=mentor, week_no=week_no)
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

    body = _json_body(request)
    call_id = body.get("id")
    status = body.get("status")
    talked = body.get("talked")
    duration = (body.get("duration") or "").strip()
    reason = (body.get("reason") or "").strip()

    call = (
        CallRecord.objects.select_related("student", "student__mentor")
        .filter(id=call_id, student__mentor=mentor)
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

    body = _json_body(request)
    call_id = body.get("id")
    call = (
        CallRecord.objects.select_related("student", "student__mentor")
        .filter(id=call_id, student__mentor=mentor)
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

    week = request.GET.get("week")
    if not week:
        return JsonResponse({"ok": False, "msg": "week is required"}, status=400)
    week_no = int(week)
    attendance_map = _attendance_map(mentor, week_no)

    calls = (
        CallRecord.objects.filter(
            student__mentor=mentor,
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
                "week_percentage": a.week_percentage if a else None,
                "overall_percentage": a.overall_percentage if a else None,
                "message_sent": c.message_sent,
            }
        )

    return JsonResponse({"ok": True, "week": week_no, "records": data})
