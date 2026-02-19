from django.urls import path
from .views import (
    login_page,
    upload_students,
    upload_attendance,
    delete_week,
    mentor_dashboard,
    save_call,
    mark_message,
    mentor_report,
    coordinator_dashboard,
    print_student,
    lock_week,
    control_panel,
    update_mobile,
    view_attendance,
    semester_register
)
from .mobile_api import (
    api_mobile_login,
    api_mobile_logout,
    api_mobile_weeks,
    api_mobile_calls,
    api_mobile_save_call,
    api_mobile_mark_message,
    api_mobile_retry_list,
)

urlpatterns = [
    path('', login_page),
    path('mentor-dashboard/', mentor_dashboard),
    path('upload-students/', upload_students),
    path('upload-attendance/', upload_attendance),
    path('delete-week/', delete_week),
    path('save-call/', save_call),
    path('mark-message/', mark_message),
    path('mentor-report/', mentor_report),
    path('print-student/<str:enrollment>/', print_student),
    path('reports/', coordinator_dashboard),
    path('lock-week/', lock_week),
    path('control-panel/', control_panel),
    path('update-mobile/', update_mobile),
    path('view-attendance/', view_attendance),
    path("semester-register/", semester_register, name="semester_register"),
    path("api/mobile/login/", api_mobile_login),
    path("api/mobile/logout/", api_mobile_logout),
    path("api/mobile/weeks/", api_mobile_weeks),
    path("api/mobile/calls/", api_mobile_calls),
    path("api/mobile/save-call/", api_mobile_save_call),
    path("api/mobile/mark-message/", api_mobile_mark_message),
    path("api/mobile/retry-list/", api_mobile_retry_list),


]
