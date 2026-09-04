from django.contrib import admin
from .models import (
    Budget, Expense, ExpenseCategory, Fee, FeePayment, Fine,
    InstitutionSettings, ManualTransaction, Route, Salary,
    TransportFee, TransportFeePayment,
)


class FeePaymentInline(admin.TabularInline):
    model = FeePayment
    extra = 0


@admin.register(Fee)
class FeeAdmin(admin.ModelAdmin):
    list_display = ('fee_id', 'student', 'amount', 'paid_amount', 'status', 'due_date')
    list_filter = ('status', 'category')
    search_fields = ('fee_id', 'student__name', 'student__roll_no')
    inlines = [FeePaymentInline]


class TransportFeePaymentInline(admin.TabularInline):
    model = TransportFeePayment
    extra = 0


@admin.register(TransportFee)
class TransportFeeAdmin(admin.ModelAdmin):
    list_display = ('tf_id', 'student', 'route', 'amount', 'paid_amount', 'status')
    inlines = [TransportFeePaymentInline]


admin.site.register(Route)
admin.site.register(Fine)
admin.site.register(Salary)
admin.site.register(ExpenseCategory)
admin.site.register(Expense)
admin.site.register(Budget)
admin.site.register(ManualTransaction)
admin.site.register(InstitutionSettings)
