from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import AuditLog, User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    fieldsets = DjangoUserAdmin.fieldsets + (
        ('CampusTreasury role', {'fields': ('role', 'full_name', 'is_locked', 'failed_login_attempts', 'locked_until')}),
    )
    list_display = ('username', 'full_name', 'role', 'is_active', 'is_staff')
    list_filter = ('role', 'is_active')


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('timestamp', 'username_snapshot', 'action', 'model_name', 'object_repr')
    list_filter = ('action', 'model_name')
    search_fields = ('username_snapshot', 'object_repr', 'path')
    readonly_fields = [f.name for f in AuditLog._meta.fields]
