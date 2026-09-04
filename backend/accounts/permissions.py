from rest_framework.permissions import BasePermission, SAFE_METHODS


class RolePermission(BasePermission):
    """
    Maps the three CampusTreasury roles onto REST verbs, matching the
    original frontend's PERMS table:
      - viewer      → read-only (GET/HEAD/OPTIONS)
      - accountant  → read + create/update, no delete
      - admin       → full access
    Use together with IsAuthenticated (already the DRF default).
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser:
            return True

        perms = user.perms()

        if request.method in SAFE_METHODS:
            return True
        if request.method == 'DELETE':
            return perms['can_delete']
        # POST / PUT / PATCH
        return perms['can_edit']


class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and (user.is_superuser or user.perms()['can_manage_users']))


class CanViewAudit(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and (user.is_superuser or user.perms()['can_view_audit']))
