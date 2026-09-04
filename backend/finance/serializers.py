from rest_framework import serializers

from .models import (
    Budget, Expense, ExpenseCategory, Fee, FeePayment, Fine,
    InstitutionSettings, ManualTransaction, Route, Salary,
    TransportFee, TransportFeePayment,
)


class FeePaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeePayment
        fields = ['id', 'fee', 'amount', 'date', 'method', 'receipt_no', 'created_at']
        read_only_fields = ['id', 'created_at']


class FeeSerializer(serializers.ModelSerializer):
    payments = FeePaymentSerializer(many=True, read_only=True)
    balance = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    student_name = serializers.CharField(source='student.name', read_only=True)

    class Meta:
        model = Fee
        fields = [
            'id', 'fee_id', 'student', 'student_name', 'semester', 'amount', 'paid_amount',
            'balance', 'category', 'method', 'receipt_no', 'status', 'due_date', 'paid_date',
            'is_installment', 'installment_part', 'installment_total', 'plan_id',
            'academic_year', 'payments', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'fee_id', 'status', 'paid_amount', 'created_at', 'updated_at']


class RecordPaymentSerializer(serializers.Serializer):
    """Shared shape for the 'record-payment' action on Fee and TransportFee."""
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    date = serializers.DateField()
    method = serializers.CharField(required=False, allow_blank=True)
    receipt_no = serializers.CharField(required=False, allow_blank=True)


class RouteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Route
        fields = [
            'id', 'route_id', 'name', 'vehicle_no', 'driver_name', 'driver_phone',
            'capacity', 'monthly_fee', 'status', 'fitness_expiry', 'insurance_expiry',
        ]
        read_only_fields = ['id', 'route_id']


class TransportFeePaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransportFeePayment
        fields = ['id', 'transport_fee', 'amount', 'date', 'method', 'receipt_no', 'created_at']
        read_only_fields = ['id', 'created_at']


class TransportFeeSerializer(serializers.ModelSerializer):
    payments = TransportFeePaymentSerializer(many=True, read_only=True)
    balance = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    student_name = serializers.CharField(source='student.name', read_only=True)
    route_name = serializers.CharField(source='route.name', read_only=True, default=None)

    class Meta:
        model = TransportFee
        fields = [
            'id', 'tf_id', 'student', 'student_name', 'route', 'route_name', 'amount',
            'paid_amount', 'balance', 'method', 'receipt_no', 'status', 'due_date',
            'paid_date', 'academic_year', 'payments', 'created_at',
        ]
        read_only_fields = ['id', 'tf_id', 'status', 'paid_amount', 'created_at']


class FineSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.name', read_only=True)

    class Meta:
        model = Fine
        fields = ['id', 'fine_id', 'student', 'student_name', 'reason', 'amount', 'date', 'status']
        read_only_fields = ['id', 'fine_id']


class SalarySerializer(serializers.ModelSerializer):
    net_pay = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    employee_name = serializers.CharField(source='employee.name', read_only=True)

    class Meta:
        model = Salary
        fields = [
            'id', 'sal_id', 'employee', 'employee_name', 'month', 'basic', 'allowance',
            'deduction', 'net_pay', 'status', 'paid_date', 'created_at',
        ]
        read_only_fields = ['id', 'sal_id', 'created_at']


class ExpenseCategorySerializer(serializers.ModelSerializer):
    spent = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseCategory
        fields = ['id', 'name', 'icon', 'color', 'budget', 'spent']

    def get_spent(self, obj):
        from django.db.models import Sum
        return obj.expenses.aggregate(total=Sum('amount'))['total'] or 0


class ExpenseSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)

    class Meta:
        model = Expense
        fields = [
            'id', 'description', 'category', 'category_name', 'amount', 'date',
            'vendor', 'approver', 'status', 'academic_year', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class BudgetSerializer(serializers.ModelSerializer):
    spent = serializers.SerializerMethodField()
    remaining = serializers.SerializerMethodField()

    class Meta:
        model = Budget
        fields = ['id', 'department', 'allocated', 'expense_categories', 'academic_year', 'spent', 'remaining']

    def get_spent(self, obj):
        from django.db.models import Sum
        cat_ids = obj.expense_categories.values_list('id', flat=True)
        return Expense.objects.filter(category_id__in=cat_ids, academic_year=obj.academic_year).aggregate(
            total=Sum('amount')
        )['total'] or 0

    def get_remaining(self, obj):
        return float(obj.allocated) - float(self.get_spent(obj))


class ManualTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ManualTransaction
        fields = ['id', 'description', 'type', 'amount', 'date', 'category', 'created_at']
        read_only_fields = ['id', 'created_at']


class InstitutionSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = InstitutionSettings
        fields = [
            'inst_name', 'city', 'academic_year_label', 'admin_email', 'contact', 'address',
            'late_fee_pct', 'fee_due_day', 'session_timeout_min', 'bank_name', 'bank_branch',
            'bank_account_title', 'bank_account_no', 'bank_iban', 'bank_jazzcash',
            'bank_easypaisa', 'accounts_phone', 'office_hours', 'customer_code',
            'voucher_prefix', 'voucher_instructions',
        ]


class TransactionLedgerEntrySerializer(serializers.Serializer):
    """Read-only shape returned by /api/finance/transactions/ (built on the
    fly by finance.services.build_transaction_ledger — not a stored model)."""
    id = serializers.CharField()
    desc = serializers.CharField()
    type = serializers.CharField()
    amount = serializers.FloatField()
    date = serializers.DateField(allow_null=True)
    category = serializers.CharField()
    source_type = serializers.CharField()
    source_id = serializers.IntegerField()
