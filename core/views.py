# ---------- DJANGO ----------
from django.shortcuts import render, redirect
from django.http import JsonResponse, HttpResponse
from django.contrib.auth import authenticate, login
from django.utils import timezone
from django.views.decorators.http import require_http_methods
from django.db.models import Count
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.views.decorators.http import require_http_methods
from django.http import JsonResponse
from django.db.models import Max 
# ---------- LOCAL FORMS ----------
from .forms import UploadFileForm

# ---------- LOCAL MODELS ----------
from .models import Mentor, Student, Attendance, CallRecord, WeekLock
from .models import WeekLock, CallRecord

# ---------- LOCAL UTILITIES ----------
from .utils import import_students_from_excel
from .attendance_utils import import_attendance
from .pdf_report import generate_student_pdf

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
            return redirect("/reports/")

        # mentor login
        if password == "mentor@LJ123":
            if Mentor.objects.filter(name=username).exists():
                request.session["mentor"] = username
                return redirect("/mentor-dashboard/")

        error = "Invalid username or password"

    return render(request, "login.html", {"error": error})


# ---------------- STUDENT MASTER ----------------
@login_required
def upload_students(request):

    message = ""

    if request.method == 'POST':
        form = UploadFileForm(request.POST, request.FILES)
        if form.is_valid():
            file = request.FILES['file']
            try:
                added, updated, skipped = import_students_from_excel(file)
                message = f"Added: {added} | Updated: {updated} | Skipped: {skipped}"
            except Exception as e:
                message = f"Upload failed: {str(e)}"
    else:
        form = UploadFileForm()

    students = Student.objects.select_related("mentor").order_by("roll_no")

    return render(request, 'upload.html', {
        'form': form,
        'message': message,
        'students': students
    })

# ---------------- ATTENDANCE VIEW & UPLOAD ----------------
@require_http_methods(["GET","POST"])
def upload_attendance(request):

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
        if WeekLock.objects.filter(week_no=week_no, locked=True).exists():
            return JsonResponse({
                "ok": False,
                "msg": f"Week {week_no} is LOCKED. Upload not allowed."
            })

        # import
        count = import_attendance(weekly_file, overall_file, week_no, rule)

        # mentor-wise counts
        mentor_stats = list(
            CallRecord.objects.filter(week_no=week_no)
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

def next_dir(current_sort, current_dir, column):
    if current_sort == column and current_dir == "asc":
        return "desc"
    return "asc"


def view_attendance(request):

    # mentors should not access coordinator view
    if "mentor" in request.session:
        return redirect("/mentor-dashboard/")

    # get available weeks
    weeks = Attendance.objects.values_list("week_no", flat=True)\
                              .distinct().order_by("week_no")

    selected_week = request.GET.get("week")
    # If no week selected → auto open latest week
    if not selected_week:
        latest = Attendance.objects.order_by("-week_no").first()
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

        qs = Attendance.objects.filter(week_no=selected_week)\
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

    weeks = Attendance.objects.values_list("week_no", flat=True)\
                              .distinct().order_by("week_no")

    message = ""

    # DELETE SINGLE WEEK
    if request.method == "POST" and "delete_week" in request.POST:
        week_no = int(request.POST.get("week"))

        Attendance.objects.filter(week_no=week_no).delete()
        CallRecord.objects.filter(week_no=week_no).delete()

        message = f"Week-{week_no} deleted successfully"

    # DELETE ALL (password protected)
    if request.method == "POST" and "delete_all" in request.POST:

        password = request.POST.get("password")
        user = authenticate(username=request.user.username, password=password)

        if user:
            Attendance.objects.all().delete()
            CallRecord.objects.all().delete()
            message = "ALL WEEKS DELETED"
        else:
            message = "Wrong password"

    return render(request, "delete_week.html", {
        "weeks": weeks,
        "message": message
    })


# ---------------- LOCK WEEK ----------------
def lock_week(request):
    if request.method == "POST":
        week = int(request.POST.get("week"))
        WeekLock.objects.update_or_create(
            week_no=week,
            defaults={"locked": True}
        )
        return redirect(f"/reports/?week={week}")
    return redirect("/reports/")


# ---------------- MENTOR DASHBOARD ----------------
def mentor_dashboard(request):

    mentor_name = request.session.get("mentor")
    if not mentor_name:
        return redirect("/")

    mentor = Mentor.objects.get(name=mentor_name)

    # all uploaded weeks
    weeks = sorted(
        Attendance.objects.values_list("week_no", flat=True).distinct()
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
            week_no=selected_week
        ).select_related("student")

    # build attendance map
    attendance_map = {}
    if selected_week:
        atts = Attendance.objects.filter(week_no=selected_week, student__mentor=mentor)
        for a in atts:
            attendance_map[a.student_id] = a
    
    all_done = False
    not_connected = []

    if selected_week:
        week_calls = CallRecord.objects.filter(
            student__mentor=mentor,
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



# ---------------- SAVE CALL ----------------
def save_call(request):

    if request.method == "POST":

        call = CallRecord.objects.get(id=request.POST.get("id"))
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
        call=CallRecord.objects.get(id=request.POST.get("id"))
        call.message_sent=True
        call.save()
        return JsonResponse({"ok":True})


# ---------------- MENTOR REPORT ----------------
def mentor_report(request):

    mentor = request.session.get("mentor")
    if not mentor:
        return redirect("/")

    week = request.GET.get("week")
    if not week:
        return render(request,"mentor_report.html")

    week = int(week)

    students = Student.objects.filter(mentor__name=mentor).count()

    below80 = Attendance.objects.filter(
        week_no=week, student__mentor__name=mentor, call_required=True
    ).count()

    calls_done = CallRecord.objects.filter(
        week_no=week, student__mentor__name=mentor, final_status__isnull=False
    ).count()

    received = CallRecord.objects.filter(
        week_no=week, student__mentor__name=mentor, final_status="received"
    ).count()

    not_received = CallRecord.objects.filter(
        week_no=week, student__mentor__name=mentor, final_status="not_received"
    ).count()

    message_done = CallRecord.objects.filter(
        week_no=week, student__mentor__name=mentor, message_sent=True
    ).count()

    not_done = below80 - calls_done

    report = f"""
Follow up Attendance < 80% (Week-{week} only & Overall Week-01 to {week}):

Mentor Name: {mentor}
Total no. Of students under mentorship: {students}
No. Of students under mentorship whose attendance < 80%: {below80}
No. Of call done: {calls_done}
No. Of call received: {received}
No. Of call not received: {not_received}
No. Of message done when call not received: {message_done}
Call not done: {not_done}
"""

    return render(request,"mentor_report.html",{"report":report,"week":week})


# ---------------- PDF PRINT ----------------
def print_student(request, enrollment):

    student = Student.objects.get(enrollment=enrollment)

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{student.name}.pdf"'

    generate_student_pdf(response, student)
    return response


# ---------------- COORDINATOR DASHBOARD ----------------
def coordinator_dashboard(request):

    if "mentor" in request.session:
        return redirect("/mentor-dashboard/")

    week = request.GET.get("week")
    if not week:
        return render(request,"coordinator_dashboard.html")

    week = int(week)
    mentors = Mentor.objects.all()
    data = []

    for m in mentors:

        total_students = Student.objects.filter(mentor=m).count()

        need_call = Attendance.objects.filter(
            week_no=week, student__mentor=m, call_required=True
        ).count()

        done = CallRecord.objects.filter(
            week_no=week, student__mentor=m, final_status__isnull=False
        ).count()

        pending = need_call - done

        message_pending = CallRecord.objects.filter(
            week_no=week, student__mentor=m,
            final_status="not_received", message_sent=False
        ).count()

        percent = round((done/need_call)*100,1) if need_call else 0

        data.append({
            "mentor":m.name,
            "students":total_students,
            "need_call":need_call,
            "done":done,
            "pending":pending,
            "msg":message_pending,
            "percent":percent
        })

    return render(request,"coordinator_dashboard.html",{"data":data,"week":week})

def update_mobile(request):

    if request.method == "POST":
        enrollment = request.POST.get("enrollment")
        field = request.POST.get("field")
        value = request.POST.get("value")

        student = Student.objects.get(enrollment=enrollment)

        if field == "father":
            student.father_mobile = value
        elif field == "mother":
            student.mother_mobile = value

        student.save()

        return JsonResponse({"ok": True})

    
# ---------------- CONTROL PANEL ----------------
def control_panel(request):

    if "mentor" in request.session:
        return redirect("/")

    students = Student.objects.select_related("mentor").all().order_by("roll_no")

    return render(request,"control_panel.html",{"students":students})


# ---------------- SEM REGISTER ----------------

def semester_register(request):

    # all uploaded weeks
    weeks = sorted(
        Attendance.objects.values_list("week_no", flat=True).distinct()
    )

    students = Student.objects.select_related("mentor").all().order_by("roll_no")

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
