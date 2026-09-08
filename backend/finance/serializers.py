from decimal import Decimal

from rest_framework import serializers

from academics.models import AcademicYear, Student
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
    student_roll_no = serializers.CharField(source='student.roll_no', read_only=True)

    class Meta:
        model = Fee
        fields = [
            'id', 'fee_id', 'student', 'student_name', 'student_roll_no', 'semester', 'amount',
            'paid_amount', 'balance', 'category', 'method', 'receipt_no', 'status', 'due_date',
            'paid_date', 'is_installment', 'installment_part', 'installment_total', 'plan_id',
            'gross_amount', 'scholarship_amount', 'scholarship_label', 'concession_amount',
            'discount_reason', 'academic_year', 'payments', 'created_at', 'updated_at',
        ]
        # amount/gross_amount/scholarship_*/concession_* are ALL server-computed (see
        # finance.services.compute_fee_discount) — never accepted directly from a client
        # write; creation goes through FeeViewSet.create()'s CreateFeeSerializer instead.
        read_only_fields = [
            'id', 'fee_id', 'status', 'paid_amount', 'amount', 'gross_amount',
            'scholarship_amount', 'scholarship_label', 'concession_amount',
            'created_at', 'updated_at',
        ]


class RecordPaymentSerializer(serializers.Serializer):
    """Shared shape for the 'record-payment' action on Fee and TransportFee."""
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    date = serializers.DateField()
    method = serializers.CharField(required=False, allow_blank=True)
    receipt_no = serializers.CharField(required=False, allow_blank=True)


class CreateFeeSerializer(serializers.Serializer):
    """Input shape for FeeViewSet.create() — a single non-instalment fee.
    The client supplies the GROSS amount; net/scholarship/concession are
    computed server-side (see finance.services.compute_fee_discount)."""
    student = serializers.PrimaryKeyRelatedField(queryset=Student.objects.all())
    gross_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    concession_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"), required=False, default=0)
    discount_reason = serializers.CharField(required=False, allow_blank=True, default='')
    due_date = serializers.DateField(required=False, allow_null=True)
    category = serializers.ChoiceField(choices=Fee.Category.choices, required=False, default=Fee.Category.TUITION)
    semester = serializers.CharField(required=False, allow_blank=True, default='')
    academic_year = serializers.PrimaryKeyRelatedField(queryset=AcademicYear.objects.all(), required=False, allow_null=True)

    def validate(self, attrs):
        # Mirrors saveFee()'s guard: a concession with no stated reason is
        # rejected outright, not silently stored with a blank reason.
        if attrs.get('concession_amount') and not (attrs.get('discount_reason') or '').strip():
            raise serializers.ValidationError({'discount_reason': 'Please write the reason for the concession'})
        return attrs


class InstallmentInputSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    due_date = serializers.DateField()


class InstallmentPlanSerializer(serializers.Serializer):
    """Input shape for FeeViewSet.create_installment_plan() — see the two
    modes documented on that view."""
    mode = serializers.ChoiceField(choices=['auto', 'custom'], default='auto')
    student = serializers.PrimaryKeyRelatedField(queryset=Student.objects.all())
    gross_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    concession_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"), required=False, default=0)
    discount_reason = serializers.CharField(required=False, allow_blank=True, default='')
    category = serializers.ChoiceField(choices=Fee.Category.choices, required=False, default=Fee.Category.TUITION)
    semester = serializers.CharField(required=False, allow_blank=True, default='')
    academic_year = serializers.PrimaryKeyRelatedField(queryset=AcademicYear.objects.all(), required=False, allow_null=True)
    # auto mode
    due_date = serializers.DateField(required=False, allow_null=True)
    inst_count = serializers.IntegerField(required=False, min_value=2, max_value=24)
    interval_months = serializers.IntegerField(required=False, min_value=1, max_value=12)
    # custom mode
    installments = InstallmentInputSerializer(many=True, required=False)

    def validate(self, attrs):
        if attrs.get('concession_amount') and not (attrs.get('discount_reason') or '').strip():
            raise serializers.ValidationError({'discount_reason': 'Please write the reason for the concession'})
        if attrs.get('mode') == 'custom':
            if not attrs.get('installments'):
                raise serializers.ValidationError({'installments': 'Required when mode="custom"'})
        else:
            if not attrs.get('due_date') or not attrs.get('inst_count') or not attrs.get('interval_months'):
                raise serializers.ValidationError('due_date, inst_count and interval_months are required when mode="auto"')
        return attrs


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
    # Exposes the human-readable label (e.g. '2024-25') alongside the FK id —
    # the frontend's D.expenses[].year needs the label, not the pk, to match
    # against D.activeYear (see activeExpenses() in script.js).
    academic_year_label = serializers.CharField(source='academic_year.label', read_only=True, default=None)

    class Meta:
        model = Expense
        fields = [
            'id', 'description', 'category', 'category_name', 'amount', 'date',
            'vendor', 'approver', 'status', 'academic_year', 'academic_year_label', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class BudgetSerializer(serializers.ModelSerializer):
    spent = serializers.SerializerMethodField()
    remaining = serializers.SerializerMethodField()
    # Same reasoning as ExpenseSerializer.academic_year_label above — Budget's
    # academic_year is mandatory, so this is never actually null, but stays
    # consistent with the Expense field name.
    academic_year_label = serializers.CharField(source='academic_year.label', read_only=True, default=None)

    class Meta:
        model = Budget
        fields = ['id', 'department', 'allocated', 'expense_categories', 'academic_year', 'academic_year_label', 'spent', 'remaining']

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
