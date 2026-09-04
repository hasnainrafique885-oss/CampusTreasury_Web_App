from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AutoOverdueCheckView, BudgetViewSet, DashboardSummaryView, ExpenseCategoryViewSet,
    ExpenseViewSet, FeeViewSet, FineViewSet, InstitutionSettingsView, ManualTransactionViewSet,
    RouteViewSet, SalaryViewSet, TransactionLedgerView, TransportFeeViewSet,
)

router = DefaultRouter()
router.register('fees', FeeViewSet, basename='fee')
router.register('routes', RouteViewSet, basename='route')
router.register('transport-fees', TransportFeeViewSet, basename='transportfee')
router.register('fines', FineViewSet, basename='fine')
router.register('salaries', SalaryViewSet, basename='salary')
router.register('expense-categories', ExpenseCategoryViewSet, basename='expensecategory')
router.register('expenses', ExpenseViewSet, basename='expense')
router.register('budgets', BudgetViewSet, basename='budget')
router.register('manual-transactions', ManualTransactionViewSet, basename='manualtransaction')

urlpatterns = [
    path('settings/', InstitutionSettingsView.as_view(), name='institution-settings'),
    path('transactions/', TransactionLedgerView.as_view(), name='transaction-ledger'),
    path('dashboard/', DashboardSummaryView.as_view(), name='dashboard-summary'),
    path('overdue-check/', AutoOverdueCheckView.as_view(), name='overdue-check'),
] + router.urls
