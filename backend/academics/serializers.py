from rest_framework import serializers

from .models import AcademicYear, Department, SchoolClass, Section, Student, TransportStatus


class AcademicYearSerializer(serializers.ModelSerializer):
    class Meta:
        model = AcademicYear
        fields = ['id', 'label', 'is_active']


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ['id', 'name']


class SectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Section
        fields = ['id', 'school_class', 'name']


class SchoolClassSerializer(serializers.ModelSerializer):
    sections = SectionSerializer(many=True, read_only=True)

    class Meta:
        model = SchoolClass
        fields = ['id', 'name', 'code', 'gender', 'default_fee', 'sections']


class TransportStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransportStatus
        fields = ['id', 'student', 'status', 'from_label', 'until_label', 'reason', 'set_on']


class StudentSerializer(serializers.ModelSerializer):
    school_class_name = serializers.CharField(source='school_class.name', read_only=True, default=None)
    school_class_code = serializers.CharField(source='school_class.code', read_only=True, default=None)
    transport_status = TransportStatusSerializer(read_only=True)
    outstanding_balance = serializers.SerializerMethodField()
    scholarship_label = serializers.SerializerMethodField()

    class Meta:
        model = Student
        fields = [
            'id', 'student_id', 'name', 'father_name', 'roll_no', 'gender',
            'department', 'school_class', 'school_class_name', 'school_class_code',
            'section', 'semester', 'default_fee', 'status', 'contact', 'address',
            'academic_year', 'sch_type', 'sch_mode', 'sch_val', 'sch_note', 'scholarship_label',
            'transport_status', 'outstanding_balance', 'created_at', 'updated_at',
        ]
        # `status` is server-authoritative — rolled up from the student's Fee
        # records by finance.services.update_student_overall_status, never
        # set directly by the client.
        read_only_fields = ['id', 'status', 'student_id', 'created_at', 'updated_at']

    def get_outstanding_balance(self, obj):
        from finance.services import student_outstanding_balance
        return student_outstanding_balance(obj)

    def get_scholarship_label(self, obj):
        from finance.services import scholarship_label, student_scholarship
        return scholarship_label(student_scholarship(obj))


class FeePlanInputSerializer(serializers.Serializer):
    """Optional nested block accepted by StudentViewSet.create() — mirrors
    saveStu() auto-creating a Tuition Fee (single or instalment) at the
    moment a new student is admitted."""
    gross_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    due_date = serializers.DateField(required=False, allow_null=True)
    fee_type = serializers.ChoiceField(choices=['full', 'instalment'], default='full')
    category = serializers.CharField(required=False, default='Tuition')
    inst_count = serializers.IntegerField(required=False, min_value=2, max_value=24)
    interval_months = serializers.IntegerField(required=False, min_value=1, max_value=12)


class StudentCreateSerializer(StudentSerializer):
    """Same fields as StudentSerializer, plus an optional `fee_plan` block.
    Used only for create() — see StudentViewSet.create() for the
    transactional Student+Fee(s) orchestration."""
    fee_plan = FeePlanInputSerializer(required=False, write_only=True)

    class Meta(StudentSerializer.Meta):
        fields = StudentSerializer.Meta.fields + ['fee_plan']
