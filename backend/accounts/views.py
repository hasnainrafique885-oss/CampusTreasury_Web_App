from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import AuditLog, User
from .permissions import CanViewAudit, IsAdmin
from .serializers import (
    AuditLogSerializer,
    ChangePasswordSerializer,
    MyTokenObtainPairSerializer,
    UserCreateUpdateSerializer,
    UserSerializer,
)

MAX_LOGIN_ATTEMPTS = 5
LOCK_MINUTES = 0.5  # 30 seconds — matches the frontend's lockout copy


class LoginView(TokenObtainPairView):
    """POST {username, password} → {access, refresh, user}.
    Enforces the same 5-attempt / 30-second lockout the frontend UI showed,
    now actually backed by the server instead of being purely cosmetic."""
    serializer_class = MyTokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        username = request.data.get('username', '')
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            user = None

        if user and user.locked_until and timezone.now() < user.locked_until:
            AuditLog.objects.create(
                username_snapshot=username, action=AuditLog.Action.LOGIN_FAILED,
                model_name='auth', object_repr='account locked',
                ip_address=request.META.get('REMOTE_ADDR'),
            )
            return Response(
                {'detail': 'Account locked after 5 failed attempts. Please wait and try again.'},
                status=status.HTTP_423_LOCKED,
            )

        response = super().post(request, *args, **kwargs)

        if response.status_code == 200:
            if user:
                user.failed_login_attempts = 0
                user.locked_until = None
                user.last_login = timezone.now()
                user.save(update_fields=['failed_login_attempts', 'locked_until', 'last_login'])
            AuditLog.objects.create(
                user=user, username_snapshot=username, action=AuditLog.Action.LOGIN,
                model_name='auth', object_repr='login success',
                ip_address=request.META.get('REMOTE_ADDR'),
            )
        else:
            if user:
                user.failed_login_attempts += 1
                if user.failed_login_attempts >= MAX_LOGIN_ATTEMPTS:
                    user.locked_until = timezone.now() + timezone.timedelta(minutes=LOCK_MINUTES)
                user.save(update_fields=['failed_login_attempts', 'locked_until'])
            AuditLog.objects.create(
                username_snapshot=username, action=AuditLog.Action.LOGIN_FAILED,
                model_name='auth', object_repr='bad credentials',
                ip_address=request.META.get('REMOTE_ADDR'),
            )
        return response


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class LogoutView(APIView):
    """POST {refresh} — blacklists the refresh token so it can't be reused
    (django-rest-framework-simplejwt token_blacklist app). The access token
    itself just expires naturally per ACCESS_TOKEN_LIFETIME; there is no
    server-side revocation for access tokens in the simplejwt blacklist
    model, which is standard practice for short-lived access tokens."""

    def post(self, request):
        refresh = request.data.get('refresh')
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except Exception:
                pass  # already invalid/expired — logout should still succeed
        AuditLog.objects.create(
            user=request.user, username_snapshot=request.user.username,
            action=AuditLog.Action.LOGOUT, model_name='auth', object_repr='logout',
            ip_address=request.META.get('REMOTE_ADDR'),
        )
        return Response({'detail': 'Logged out'})


class ChangePasswordView(APIView):
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data['old_password']):
            return Response({'old_password': 'Incorrect password'}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(serializer.validated_data['new_password'])
        user.save()
        return Response({'detail': 'Password updated'})


class UserViewSet(viewsets.ModelViewSet):
    """Full user management — restricted to Admins only (canManageUsers),
    exactly like the frontend's Users page."""
    queryset = User.objects.all().order_by('username')
    permission_classes = [IsAdmin]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return UserCreateUpdateSerializer
        return UserSerializer

    @action(detail=True, methods=['post'])
    def unlock(self, request, pk=None):
        user = self.get_object()
        user.failed_login_attempts = 0
        user.locked_until = None
        user.save(update_fields=['failed_login_attempts', 'locked_until'])
        return Response(UserSerializer(user).data)


class AuditLogListView(generics.ListAPIView):
    """Read-only audit trail — matches canViewAudit (admin + accountant)."""
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [CanViewAudit]
    filterset_fields = ['action', 'model_name', 'username_snapshot']
    search_fields = ['username_snapshot', 'object_repr', 'path']
    ordering_fields = ['timestamp']
