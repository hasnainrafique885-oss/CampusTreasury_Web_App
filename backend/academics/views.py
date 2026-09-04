from rest_framework import viewsets

from accounts.permissions import RolePermission
from .models import AcademicYear, Department, SchoolClass, Section, Student, TransportStatus
from .serializers import (
    AcademicYearSerializer, DepartmentSerializer, SchoolClassSerializer,
    SectionSerializer, StudentSerializer, TransportStatusSerializer,
)


class AcademicYearViewSet(viewsets.ModelViewSet):
    queryset = AcademicYear.objects.all()
    serializer_class = AcademicYearSerializer
    permission_classes = [RolePermission]


class DepartmentViewSet(viewsets.ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [RolePermission]


class SchoolClassViewSet(viewsets.ModelViewSet):
    queryset = SchoolClass.objects.all().prefetch_related('sections')
    serializer_class = SchoolClassSerializer
    permission_classes = [RolePermission]


class SectionViewSet(viewsets.ModelViewSet):
    queryset = Section.objects.all()
    serializer_class = SectionSerializer
    permission_classes = [RolePermission]


class StudentViewSet(viewsets.ModelViewSet):
    queryset = Student.objects.all().select_related('school_class', 'academic_year', 'transport_status')
    serializer_class = StudentSerializer
    permission_classes = [RolePermission]
    filterset_fields = ['status', 'gender', 'school_class', 'section', 'academic_year']
    search_fields = ['name', 'roll_no', 'student_id', 'father_name', 'contact']
    ordering_fields = ['name', 'roll_no', 'created_at']


class TransportStatusViewSet(viewsets.ModelViewSet):
    queryset = TransportStatus.objects.all().select_related('student')
    serializer_class = TransportStatusSerializer
    permission_classes = [RolePermission]
