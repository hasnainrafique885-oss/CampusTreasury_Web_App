from rest_framework import viewsets

from accounts.permissions import RolePermission
from .models import Employee, Increment, Leave
from .serializers import EmployeeSerializer, IncrementSerializer, LeaveSerializer


class EmployeeViewSet(viewsets.ModelViewSet):
    queryset = Employee.objects.all()
    serializer_class = EmployeeSerializer
    permission_classes = [RolePermission]
    filterset_fields = ['status', 'department']
    search_fields = ['name', 'employee_id', 'designation', 'department', 'contact', 'email']
    ordering_fields = ['name', 'employee_id', 'salary']


class IncrementViewSet(viewsets.ModelViewSet):
    queryset = Increment.objects.all().select_related('employee')
    serializer_class = IncrementSerializer
    permission_classes = [RolePermission]
    filterset_fields = ['employee']


class LeaveViewSet(viewsets.ModelViewSet):
    queryset = Leave.objects.all().select_related('employee')
    serializer_class = LeaveSerializer
    permission_classes = [RolePermission]
    filterset_fields = ['employee', 'status']
