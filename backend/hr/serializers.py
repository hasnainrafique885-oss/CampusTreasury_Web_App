from rest_framework import serializers

from .models import Employee, Increment, Leave


class EmployeeSerializer(serializers.ModelSerializer):
    gross_pay = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Employee
        fields = [
            'id', 'employee_id', 'name', 'designation', 'department', 'salary',
            'allowance', 'gross_pay', 'contact', 'email', 'address', 'status',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class IncrementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Increment
        fields = ['id', 'employee', 'amount', 'effective_date', 'reason', 'created_at']


class LeaveSerializer(serializers.ModelSerializer):
    class Meta:
        model = Leave
        fields = ['id', 'employee', 'from_date', 'to_date', 'reason', 'status', 'created_at']
