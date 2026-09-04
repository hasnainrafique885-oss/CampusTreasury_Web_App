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

    class Meta:
        model = Student
        fields = [
            'id', 'student_id', 'name', 'father_name', 'roll_no', 'gender',
            'department', 'school_class', 'school_class_name', 'school_class_code',
            'section', 'semester', 'default_fee', 'status', 'contact', 'address',
            'academic_year', 'transport_status', 'outstanding_balance', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_outstanding_balance(self, obj):
        from finance.services import student_outstanding_balance
        return student_outstanding_balance(obj)
