from django.db import models


class Employee(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'Active', 'Active'
        INACTIVE = 'Inactive', 'Inactive'
        ON_LEAVE = 'On Leave', 'On Leave'

    employee_id = models.CharField(max_length=30, unique=True)  # e.g. EMP-2024-001
    name = models.CharField(max_length=150)
    designation = models.CharField(max_length=100, blank=True)
    department = models.CharField(max_length=150, blank=True)
    salary = models.DecimalField(max_digits=12, decimal_places=2, default=0)  # basic
    allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    contact = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['employee_id']

    def __str__(self):
        return f'{self.employee_id} · {self.name}'

    @property
    def gross_pay(self):
        return self.salary + self.allowance


class Increment(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='increments')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    effective_date = models.DateField()
    reason = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-effective_date']

    def __str__(self):
        return f'{self.employee} · +{self.amount} on {self.effective_date}'


class Leave(models.Model):
    class Status(models.TextChoices):
        PENDING = 'Pending', 'Pending'
        APPROVED = 'Approved', 'Approved'
        REJECTED = 'Rejected', 'Rejected'

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='leaves')
    from_date = models.DateField()
    to_date = models.DateField()
    reason = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-from_date']

    def __str__(self):
        return f'{self.employee} · {self.from_date} to {self.to_date}'
