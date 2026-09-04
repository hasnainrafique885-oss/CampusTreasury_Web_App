from django.db import models


class AcademicYear(models.Model):
    """e.g. '2024-25'. One is flagged active — mirrors D.activeYear /
    D.years in the frontend, used to scope Expenses/Budget/Fees per session."""
    label = models.CharField(max_length=20, unique=True)
    is_active = models.BooleanField(default=False)

    class Meta:
        ordering = ['-label']

    def __str__(self):
        return self.label

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.is_active:
            AcademicYear.objects.exclude(pk=self.pk).update(is_active=False)


class Department(models.Model):
    name = models.CharField(max_length=100, unique=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class SchoolClass(models.Model):
    """A class/programme offering, e.g. 'ICS' for Boys with fee 15000.
    `code` matches the frontend's cls code (e.g. 'Inter-ICS')."""

    class Gender(models.TextChoices):
        BOYS = 'Boys', 'Boys'
        GIRLS = 'Girls', 'Girls'
        MIXED = 'Mixed', 'Mixed'

    name = models.CharField(max_length=100)
    code = models.CharField(max_length=50)
    gender = models.CharField(max_length=10, choices=Gender.choices, default=Gender.MIXED)
    default_fee = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        unique_together = ('code', 'gender')
        ordering = ['name', 'gender']

    def __str__(self):
        return f'{self.name} ({self.gender})'


class Section(models.Model):
    school_class = models.ForeignKey(SchoolClass, related_name='sections', on_delete=models.CASCADE)
    name = models.CharField(max_length=10)

    class Meta:
        unique_together = ('school_class', 'name')
        ordering = ['school_class', 'name']

    def __str__(self):
        return f'{self.school_class} - {self.name}'


class Student(models.Model):
    class Gender(models.TextChoices):
        MALE = 'Male', 'Male'
        FEMALE = 'Female', 'Female'

    class FeeStatus(models.TextChoices):
        PAID = 'Paid', 'Paid'
        PENDING = 'Pending', 'Pending'
        OVERDUE = 'Overdue', 'Overdue'
        PARTIAL = 'Partial', 'Partial'
        PARTIAL_OVERDUE = 'Partial-Overdue', 'Partial-Overdue'

    student_id = models.CharField(max_length=30, unique=True)  # e.g. STU-2024-010
    name = models.CharField(max_length=150)
    father_name = models.CharField(max_length=150, blank=True)
    roll_no = models.CharField(max_length=40, unique=True)
    gender = models.CharField(max_length=10, choices=Gender.choices)
    department = models.CharField(max_length=150, blank=True)  # display label, e.g. 'ICS (Boys)'
    school_class = models.ForeignKey(SchoolClass, null=True, blank=True, on_delete=models.SET_NULL, related_name='students')
    section = models.CharField(max_length=10, blank=True)
    semester = models.CharField(max_length=30, blank=True)  # e.g. '1st Year'
    default_fee = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=FeeStatus.choices, default=FeeStatus.PENDING)
    contact = models.CharField(max_length=30, blank=True)
    address = models.CharField(max_length=255, blank=True)
    academic_year = models.ForeignKey(AcademicYear, null=True, blank=True, on_delete=models.SET_NULL, related_name='students')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['roll_no']

    def __str__(self):
        return f'{self.student_id} · {self.name}'


class TransportStatus(models.Model):
    """Paused/Stopped flag for a student's van usage — kept separate from
    TransportFee records so pausing never touches issued vouchers/history."""

    class Status(models.TextChoices):
        PAUSED = 'Paused', 'Paused'
        STOPPED = 'Stopped', 'Stopped'

    student = models.OneToOneField(Student, on_delete=models.CASCADE, related_name='transport_status')
    status = models.CharField(max_length=10, choices=Status.choices)
    from_label = models.CharField(max_length=40, blank=True)
    until_label = models.CharField(max_length=40, blank=True)
    reason = models.CharField(max_length=255, blank=True)
    set_on = models.DateField(auto_now_add=True)

    def __str__(self):
        return f'{self.student} · {self.status}'
