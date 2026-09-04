from django.contrib import admin
from .models import AcademicYear, Department, SchoolClass, Section, Student, TransportStatus

admin.site.register(AcademicYear)
admin.site.register(Department)
admin.site.register(SchoolClass)
admin.site.register(Section)
admin.site.register(TransportStatus)


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ('student_id', 'name', 'roll_no', 'gender', 'status', 'department')
    search_fields = ('name', 'roll_no', 'student_id')
    list_filter = ('status', 'gender', 'department')
