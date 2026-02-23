from .models import AcademicModule
from .module_utils import get_current_module


def module_context(request):
    if not request.user.is_authenticated and not request.session.get("mentor"):
        return {
            "module_list": [],
            "current_module": None,
            "can_manage_modules": False,
        }

    current = get_current_module(request)
    return {
        "module_list": AcademicModule.objects.filter(is_active=True).order_by("-id"),
        "current_module": current,
        "can_manage_modules": bool(request.user.is_authenticated and not request.session.get("mentor")),
    }

