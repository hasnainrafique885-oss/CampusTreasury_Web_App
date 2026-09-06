from django.db import transaction
from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework import status as http_status

from accounts.permissions import RolePermission
from finance.services import create_single_fee, generate_installment_plan_auto
from .models import AcademicYear, Department, SchoolClass, Section, Student, TransportStatus
from .serializers import (
    AcademicYearSerializer, DepartmentSerializer, SchoolClassSerializer,
    SectionSerializer, StudentCreateSerializer, StudentSerializer, TransportStatusSerializer,
)


def _gen_student_id():
    """'STU-2024-010' — mirrors genStuId() in script.js: highest existing
    sequence number for the CURRENT calendar year, plus one, zero-padded to
    3 digits. Looking at the max of the *whole table* (not just this year)
    would be wrong once a new year starts and the counter should reset."""
    import datetime
    year = datetime.date.today().year
    prefix = f'STU-{year}-'
    existing = Student.objects.filter(student_id__startswith=prefix).values_list('student_id', flat=True)
    max_n = 0
    for sid in existing:
        tail = sid[len(prefix):]
        if tail.isdigit():
            max_n = max(max_n, int(tail))
    return f'{prefix}{str(max_n + 1).zfill(3)}'


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

    def create(self, request, *args, **kwargs):
        """Mirrors saveStu()'s NEW-student branch: creates the Student, and
        — if a `fee_plan` block is supplied — the Tuition Fee that comes
        with admission (single record, or an N-part instalment plan),
        atomically. Editing an existing student never touches fees (exactly
        like the original: 'Add Student always creates the Tuition fee
        record' but editing does not)."""
        serializer = StudentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fee_plan = serializer.validated_data.pop('fee_plan', None)

        with transaction.atomic():
            student = serializer.save(student_id=_gen_student_id())

            if fee_plan:
                gross = fee_plan['gross_amount']
                due_date = fee_plan.get('due_date')
                category = fee_plan.get('category', 'Tuition')
                if fee_plan.get('fee_type') == 'instalment':
                    inst_count = fee_plan.get('inst_count') or 2
                    # getInstInterval() in script.js: round(12 / count), min 1.
                    interval = fee_plan.get('interval_months') or max(1, round(12 / inst_count))
                    generate_installment_plan_auto(
                        student=student, gross_amount=gross, due_date=due_date or student.created_at.date(),
                        inst_count=inst_count, interval_months=interval,
                        category=category, semester=student.semester, academic_year=student.academic_year,
                    )
                else:
                    create_single_fee(
                        student=student, gross_amount=gross, concession_amount=0, discount_reason='',
                        due_date=due_date, category=category, semester=student.semester,
                        academic_year=student.academic_year,
                    )
                student.refresh_from_db()

        return Response(StudentSerializer(student).data, status=http_status.HTTP_201_CREATED)


class TransportStatusViewSet(viewsets.ModelViewSet):
    queryset = TransportStatus.objects.all().select_related('student')
    serializer_class = TransportStatusSerializer
    permission_classes = [RolePermission]
