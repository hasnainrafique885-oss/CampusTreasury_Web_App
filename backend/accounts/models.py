from django.contrib.auth.models import AbstractUser
from django.db import models


class Role(models.TextChoices):
    """Single source of truth for role choices — mirrors the ROLES registry
    in the original frontend (script.js), so 'admin' / 'accountant' / 'viewer'
    keep exactly the same meaning and permission shape server-side."""
    ADMIN = 'admin', 'Admin'
    ACCOUNTANT = 'accountant', 'Accountant'
    VIEWER = 'viewer', 'Viewer'


# Permission matrix per role — used by accounts.permissions.RolePermission
ROLE_PERMS = {
    Role.ADMIN: {'can_edit': True, 'can_delete': True, 'can_manage_users': True, 'can_view_audit': True},
    Role.ACCOUNTANT: {'can_edit': True, 'can_delete': False, 'can_manage_users': False, 'can_view_audit': True},
    Role.VIEWER: {'can_edit': False, 'can_delete': False, 'can_manage_users': False, 'can_view_audit': False},
}


class User(AbstractUser):
    """Extends Django's built-in user with a role field. `username` is the
    User ID staff log in with (e.g. 'admin', 'accountant')."""
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.VIEWER)
    full_name = models.CharField(max_length=150, blank=True)
    is_locked = models.BooleanField(default=False)
    failed_login_attempts = models.PositiveIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)

    def perms(self):
        return ROLE_PERMS.get(self.role, ROLE_PERMS[Role.VIEWER])

    def __str__(self):
        return f'{self.username} ({self.role})'


class AuditLog(models.Model):
    """Records who did what, mirroring the in-app Audit Log page. Written
    automatically by accounts.middleware.AuditLogMiddleware for every
    create/update/delete request that reaches the API."""

    class Action(models.TextChoices):
        CREATE = 'create', 'Create'
        UPDATE = 'update', 'Update'
        DELETE = 'delete', 'Delete'
        LOGIN = 'login', 'Login'
        LOGIN_FAILED = 'login_failed', 'Login Failed'
        LOGOUT = 'logout', 'Logout'
        OTHER = 'other', 'Other'

    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='audit_entries')
    username_snapshot = models.CharField(max_length=150, blank=True)
    action = models.CharField(max_length=20, choices=Action.choices, default=Action.OTHER)
    model_name = models.CharField(max_length=100, blank=True)
    object_repr = models.CharField(max_length=255, blank=True)
    path = models.CharField(max_length=255, blank=True)
    method = models.CharField(max_length=10, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    details = models.JSONField(default=dict, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f'{self.timestamp} · {self.username_snapshot} · {self.action} · {self.model_name}'
