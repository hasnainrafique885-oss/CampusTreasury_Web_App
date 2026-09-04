from django.db import models

from academics.models import AcademicYear, Student
from hr.models import Employee


class FeeStatus(models.TextChoices):
    PAID = 'Paid', 'Paid'
    PENDING = 'Pending', 'Pending'
    OVERDUE = 'Overdue', 'Overdue'
    PARTIAL = 'Partial', 'Partial'
    PARTIAL_OVERDUE = 'Partial-Overdue', 'Partial-Overdue'


class PaymentMethod(models.TextChoices):
    CASH = 'Cash', 'Cash'
    ONLINE = 'Online', 'Online'
    BANK = 'Bank', 'Bank'
    JAZZCASH = 'JazzCash', 'JazzCash'
    EASYPAISA = 'EasyPaisa', 'EasyPaisa'
    CHEQUE = 'Cheque', 'Cheque'


class Fee(models.Model):
    """A tuition/admission/other fee instalment owed by a student.
    `paid_amount` is the running total received against it (supports
    partial payments); `status` is normally recomputed by
    finance.services.recompute_fee_status()."""

    class Category(models.TextChoices):
        TUITION = 'Tuition', 'Tuition'
        ADMISSION = 'Admission', 'Admission'
        TRANSPORT = 'Transport', 'Transport'
        OTHER = 'Other', 'Other'

    fee_id = models.CharField(max_length=30, unique=True, blank=True)  # e.g. F-001
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='fees')
    semester = models.CharField(max_length=30, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.TUITION)
    method = models.CharField(max_length=20, choices=PaymentMethod.choices, blank=True)
    receipt_no = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=20, choices=FeeStatus.choices, default=FeeStatus.PENDING)
    due_date = models.DateField(null=True, blank=True)
    paid_date = models.DateField(null=True, blank=True)
    is_installment = models.BooleanField(default=False)
    installment_part = models.PositiveIntegerField(null=True, blank=True)
    installment_total = models.PositiveIntegerField(null=True, blank=True)
    plan_id = models.CharField(max_length=40, blank=True)
    academic_year = models.ForeignKey(AcademicYear, null=True, blank=True, on_delete=models.SET_NULL, related_name='fees')
    tx_seq = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-due_date', '-created_at']

    def __str__(self):
        return f'{self.fee_id or self.pk} · {self.student} · {self.amount}'

    @property
    def balance(self):
        return max(self.amount - self.paid_amount, 0)


class FeePayment(models.Model):
    """One line per actual payment received against a Fee — never
    overwritten, only appended to, so partial payments keep full history."""
    fee = models.ForeignKey(Fee, on_delete=models.CASCADE, related_name='payments')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    method = models.CharField(max_length=20, choices=PaymentMethod.choices, blank=True)
    receipt_no = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['date']

    def __str__(self):
        return f'{self.fee} · {self.amount} on {self.date}'


class Route(models.Model):
    """Transport route/vehicle master — a fixed van route with its own
    monthly fee, used by TransportFee instead of retyping route+amount."""

    class Status(models.TextChoices):
        ACTIVE = 'Active', 'Active'
        INACTIVE = 'Inactive', 'Inactive'

    route_id = models.CharField(max_length=20, unique=True, blank=True)  # RT-1
    name = models.CharField(max_length=150)
    vehicle_no = models.CharField(max_length=30, blank=True)
    driver_name = models.CharField(max_length=150, blank=True)
    driver_phone = models.CharField(max_length=30, blank=True)
    capacity = models.PositiveIntegerField(default=0)
    monthly_fee = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    fitness_expiry = models.DateField(null=True, blank=True)
    insurance_expiry = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['route_id']

    def __str__(self):
        return f'{self.route_id} · {self.name}'


class TransportFee(models.Model):
    tf_id = models.CharField(max_length=20, unique=True, blank=True)  # TF-1
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='transport_fees')
    route = models.ForeignKey(Route, on_delete=models.SET_NULL, null=True, related_name='transport_fees')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    method = models.CharField(max_length=20, choices=PaymentMethod.choices, blank=True)
    receipt_no = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=20, choices=FeeStatus.choices, default=FeeStatus.PENDING)
    due_date = models.DateField(null=True, blank=True)
    paid_date = models.DateField(null=True, blank=True)
    academic_year = models.ForeignKey(AcademicYear, null=True, blank=True, on_delete=models.SET_NULL, related_name='transport_fees')
    tx_seq = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-due_date']

    def __str__(self):
        return f'{self.tf_id or self.pk} · {self.student}'

    @property
    def balance(self):
        return max(self.amount - self.paid_amount, 0)


class TransportFeePayment(models.Model):
    transport_fee = models.ForeignKey(TransportFee, on_delete=models.CASCADE, related_name='payments')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    method = models.CharField(max_length=20, choices=PaymentMethod.choices, blank=True)
    receipt_no = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['date']


class Fine(models.Model):
    class Status(models.TextChoices):
        PENDING = 'Pending', 'Pending'
        PAID = 'Paid', 'Paid'

    fine_id = models.CharField(max_length=20, unique=True, blank=True)  # FIN-1
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='fines')
    reason = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)

    class Meta:
        ordering = ['-date']

    def __str__(self):
        return f'{self.fine_id or self.pk} · {self.student} · {self.reason}'


class Salary(models.Model):
    class Status(models.TextChoices):
        PAID = 'Paid', 'Paid'
        PENDING = 'Pending', 'Pending'

    sal_id = models.CharField(max_length=20, unique=True, blank=True)  # SAL-2025-001
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='salaries')
    month = models.CharField(max_length=30)  # e.g. 'March 2025'
    basic = models.DecimalField(max_digits=12, decimal_places=2)
    allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    deduction = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    paid_date = models.DateField(null=True, blank=True)
    tx_seq = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        unique_together = ('employee', 'month')

    def __str__(self):
        return f'{self.sal_id or self.pk} · {self.employee} · {self.month}'

    @property
    def net_pay(self):
        # Clamp at 0: a deduction larger than gross can never go negative.
        return max((self.basic or 0) + (self.allowance or 0) - (self.deduction or 0), 0)


class ExpenseCategory(models.Model):
    name = models.CharField(max_length=100, unique=True)
    icon = models.CharField(max_length=10, blank=True)
    color = models.CharField(max_length=10, blank=True)
    budget = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        verbose_name_plural = 'Expense categories'
        ordering = ['name']

    def __str__(self):
        return self.name


class Expense(models.Model):
    class Status(models.TextChoices):
        APPROVED = 'Approved', 'Approved'
        PENDING = 'Pending', 'Pending'
        REJECTED = 'Rejected', 'Rejected'

    description = models.CharField(max_length=255)
    category = models.ForeignKey(ExpenseCategory, on_delete=models.PROTECT, related_name='expenses')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    vendor = models.CharField(max_length=150, blank=True)
    approver = models.CharField(max_length=150, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.APPROVED)
    academic_year = models.ForeignKey(AcademicYear, null=True, blank=True, on_delete=models.SET_NULL, related_name='expenses')
    tx_seq = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date']

    def __str__(self):
        return f'{self.description} · {self.amount}'


class Budget(models.Model):
    """Per-department budget allocation for an academic year. `spent` is
    derived on read from Expense records in the linked categories — not
    stored, so it can never drift out of sync."""
    department = models.CharField(max_length=150)
    allocated = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    expense_categories = models.ManyToManyField(ExpenseCategory, blank=True, related_name='budgets')
    academic_year = models.ForeignKey(AcademicYear, on_delete=models.CASCADE, related_name='budgets')

    class Meta:
        unique_together = ('department', 'academic_year')
        ordering = ['department']

    def __str__(self):
        return f'{self.department} · {self.academic_year}'


class ManualTransaction(models.Model):
    """Misc ledger entries not linked to a fee/salary/expense record —
    e.g. donations, refunds, bank corrections."""

    class Type(models.TextChoices):
        INCOME = 'Income', 'Income'
        EXPENSE = 'Expense', 'Expense'

    description = models.CharField(max_length=255)
    type = models.CharField(max_length=10, choices=Type.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    category = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date']

    def __str__(self):
        return f'{self.description} · {self.type} · {self.amount}'


class InstitutionSettings(models.Model):
    """Singleton — one row holds every institute-wide setting shown on the
    Settings page and printed on vouchers."""
    inst_name = models.CharField(max_length=200, default='Superior College')
    city = models.CharField(max_length=100, default='Lahore')
    academic_year_label = models.CharField(max_length=20, default='2024–25')
    admin_email = models.EmailField(blank=True)
    contact = models.CharField(max_length=30, blank=True)
    address = models.CharField(max_length=255, blank=True)
    late_fee_pct = models.DecimalField(max_digits=5, decimal_places=2, default=5)
    fee_due_day = models.PositiveIntegerField(default=25)
    session_timeout_min = models.PositiveIntegerField(default=15)
    bank_name = models.CharField(max_length=150, blank=True)
    bank_branch = models.CharField(max_length=150, blank=True)
    bank_account_title = models.CharField(max_length=150, blank=True)
    bank_account_no = models.CharField(max_length=50, blank=True)
    bank_iban = models.CharField(max_length=50, blank=True)
    bank_jazzcash = models.CharField(max_length=30, blank=True)
    bank_easypaisa = models.CharField(max_length=30, blank=True)
    accounts_phone = models.CharField(max_length=30, blank=True)
    office_hours = models.CharField(max_length=100, blank=True)
    customer_code = models.CharField(max_length=10, blank=True)
    voucher_prefix = models.CharField(max_length=10, default='FEE')
    voucher_instructions = models.JSONField(default=list, blank=True)

    class Meta:
        verbose_name = 'Institution settings'
        verbose_name_plural = 'Institution settings'

    def save(self, *args, **kwargs):
        self.pk = 1  # enforce singleton
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        pass  # singleton row is never deleted

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return self.inst_name
