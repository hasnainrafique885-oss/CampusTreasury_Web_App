from django.contrib import admin
from .models import Employee, Increment, Leave


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ('employee_id', 'name', 'designation', 'department', 'salary', 'status')
    search_fields = ('name', 'employee_id')
    list_filter = ('status', 'department')


admin.site.register(Increment)
admin.site.register(Leave)
