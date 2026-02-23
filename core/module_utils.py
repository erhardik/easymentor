from .models import AcademicModule


DEFAULT_MODULE_NAME = "FY2 - Batch 2026-29_Sem-1"


def get_or_create_default_module():
    module, _ = AcademicModule.objects.get_or_create(
        name=DEFAULT_MODULE_NAME,
        defaults={
            "academic_batch": "2026-29",
            "year_level": "FY",
            "variant": "FY2-CE",
            "semester": "Sem-1",
            "is_active": True,
        },
    )
    return module


def get_current_module(request):
    module_id = request.session.get("current_module_id")
    module = None
    if module_id:
        module = AcademicModule.objects.filter(id=module_id, is_active=True).first()
    if not module:
        module = AcademicModule.objects.filter(is_active=True).order_by("-id").first()
    if not module:
        module = get_or_create_default_module()
    request.session["current_module_id"] = module.id
    return module

