from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import AuditLog, ROLE_PERMS, User


class RolePermsSerializer(serializers.Serializer):
    can_edit = serializers.BooleanField()
    can_delete = serializers.BooleanField()
    can_manage_users = serializers.BooleanField()
    can_view_audit = serializers.BooleanField()


class UserSerializer(serializers.ModelSerializer):
    perms = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'full_name', 'role', 'is_active',
            'last_login', 'date_joined', 'perms',
        ]
        read_only_fields = ['id', 'last_login', 'date_joined']

    def get_perms(self, obj):
        return ROLE_PERMS.get(obj.role, ROLE_PERMS['viewer'])


class UserCreateUpdateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'full_name', 'role', 'is_active', 'password']

    def validate_password(self, value):
        if value:
            try:
                password_validation.validate_password(value)
            except DjangoValidationError as exc:
                raise serializers.ValidationError(list(exc.messages))
        return value

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        user = User(**validated_data)
        user.set_password(password or User.objects.make_random_password())
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        password_validation.validate_password(value)
        return value


class MyTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds role/perms/full_name into the JWT payload and login response,
    so the frontend can render the correct role UI immediately without a
    second round-trip."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['role'] = user.role
        token['full_name'] = user.full_name or user.username
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data['user'] = UserSerializer(self.user).data
        return data


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = [
            'id', 'username_snapshot', 'action', 'model_name',
            'object_repr', 'path', 'method', 'ip_address', 'details', 'timestamp',
        ]
