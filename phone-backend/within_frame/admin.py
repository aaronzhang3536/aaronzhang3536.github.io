from django.contrib import admin
from .models import Application, Membership, Record


@admin.register(Application)
class ApplicationAdmin(admin.ModelAdmin):
    list_display = ("slug", "name", "enabled", "public_signup")

    def has_module_permission(self, request):
        return request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser

    has_add_permission = has_view_permission
    has_change_permission = has_view_permission
    has_delete_permission = has_view_permission


@admin.register(Membership)
class MembershipAdmin(ApplicationAdmin):
    list_display = ("application", "user", "active")
    list_filter = ("application", "active")


@admin.register(Record)
class RecordAdmin(admin.ModelAdmin):
    list_display = ("id", "application", "owner", "key", "modified_at")
    list_filter = ("state__application",)
    readonly_fields = ("id", "state", "key", "value", "modified_at")

    def get_queryset(self, request):
        query = super().get_queryset(request).select_related("state__user", "state__application")
        return query if request.user.is_superuser else query.filter(state__user=request.user, state__application__enabled=True, state__application__membership__user=request.user, state__application__membership__active=True)

    @admin.display(description="应用")
    def application(self, obj):
        return obj.state.application.name

    @admin.display(description="归属用户")
    def owner(self, obj):
        return obj.state.user.username

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
