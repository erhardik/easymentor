from django.contrib import admin
from .models import Mentor, Student, Attendance, CallRecord
from django.utils.html import format_html
from django.contrib import admin
from django.templatetags.static import static
from django.utils.html import format_html

# -------- Mentor --------
@admin.register(Mentor)
class MentorAdmin(admin.ModelAdmin):
    list_display = ('id', 'name')
    search_fields = ('name',)


# -------- Student --------
@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = (
        'roll_no',
        'name',
        'enrollment',
        'mentor',
        'batch',
        'father_mobile',
        'mother_mobile',
    )

    search_fields = ('name', 'enrollment', 'roll_no', 'father_mobile')
    list_filter = ('mentor', 'batch')
    ordering = ('roll_no',)

def print_file(self,obj):
    return format_html(f'<a target="_blank" href="/print-student/{obj.enrollment}/">Print</a>')
print_file.short_description="Register"

list_display = (
    'roll_no','name','enrollment','mentor','batch',
    'father_mobile','mother_mobile','print_file'
)


# -------- Attendance --------
@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = (
        'week_no',
        'student',
        'week_percentage',
        'overall_percentage',
        'call_required'
    )

    list_filter = ('week_no', 'call_required', 'student__mentor')
    search_fields = ('student__name', 'student__enrollment')


# -------- Call Record --------
@admin.register(CallRecord)
class CallRecordAdmin(admin.ModelAdmin):
    list_display = (
        'student',
        'week_no',
        'final_status',
        'talked_with',
        'duration',
        'message_sent',
        'created_at'
    )

    list_filter = ('week_no', 'final_status', 'student__mentor')
    search_fields = ('student__name', 'student__enrollment')

admin.site.site_header = "LJ Attendance Follow-up ERP"
admin.site.site_title = "LJ Admin"
admin.site.index_title = "Coordinator Control Panel"

class AdminMedia:
    class Media:
        css = {"all": (static("admin.css"),)}

admin.site.__class__ = type(
    "CustomAdminSite",
    (admin.site.__class__, AdminMedia),
    {}
)
