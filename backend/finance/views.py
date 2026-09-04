from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import RolePermission
from .models import (
    Budget, Expense, ExpenseCategory, Fee, FeePayment, Fine,
    InstitutionSettings, ManualTransaction, Route, Salary,
    TransportFee, TransportFeePayment,
)
from .serializers import (
    BudgetSerializer, ExpenseCategorySerializer, ExpenseSerializer, FeePaymentSerializer,
    FeeSerializer, FineSerializer, InstitutionSettingsSerializer, ManualTransactionSerializer,
    RecordPaymentSerializer, RouteSerializer, SalarySerializer, TransactionLedgerEntrySerializer,
    TransportFeePaymentSerializer, TransportFeeSerializer,
)
from .services import (
    build_transaction_ledger, dashboard_summary, next_id,
    recompute_fee_status, recompute_transport_fee_status, run_auto_overdue_check,
)


class FeeViewSet(viewsets.ModelViewSet):
    queryset = Fee.objects.select_related('student', 'academic_year').prefetch_related('payments')
    serializer_class = FeeSerializer
    permission_classes = [RolePermission]
    filterset_fields = ['status', 'category', 'student', 'academic_year']
    search_fields = ['student__name', 'student__roll_no', 'fee_id', 'receipt_no']
    ordering_fields = ['due_date', 'amount', 'created_at']

    def perform_create(self, serializer):
        fee_id = next_id(Fee.objects.all(), 'fee_id', 'F', pad=3)
        fee = serializer.save(fee_id=fee_id)
        recompute_fee_status(fee)

    @action(detail=True, methods=['post'], url_path='record-payment')
    def record_payment(self, request, pk=None):
        """Records one payment against this fee instalment, updates the
        running paid_amount, and recomputes status — supports partial
        payments the same way the frontend's Fee module does."""
        fee = self.get_object()
        serializer = RecordPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            FeePayment.objects.create(
                fee=fee, amount=data['amount'], date=data['date'],
                method=data.get('method', ''), receipt_no=data.get('receipt_no', ''),
            )
            fee.paid_amount = (fee.paid_amount or 0) + data['amount']
            if data.get('method'):
                fee.method = data['method']
            if data.get('receipt_no'):
                fee.receipt_no = data['receipt_no']
            fee.paid_date = data['date']
            fee.save()
            recompute_fee_status(fee)

        return Response(FeeSerializer(fee).data, status=status.HTTP_200_OK)


class RouteViewSet(viewsets.ModelViewSet):
    queryset = Route.objects.all()
    serializer_class = RouteSerializer
    permission_classes = [RolePermission]
    filterset_fields = ['status']

    def perform_create(self, serializer):
        route_id = next_id(Route.objects.all(), 'route_id', 'RT')
        serializer.save(route_id=route_id)


class TransportFeeViewSet(viewsets.ModelViewSet):
    queryset = TransportFee.objects.select_related('student', 'route', 'academic_year').prefetch_related('payments')
    serializer_class = TransportFeeSerializer
    permission_classes = [RolePermission]
    filterset_fields = ['status', 'student', 'route', 'academic_year']
    search_fields = ['student__name', 'student__roll_no', 'tf_id']

    def perform_create(self, serializer):
        tf_id = next_id(TransportFee.objects.all(), 'tf_id', 'TF')
        tf = serializer.save(tf_id=tf_id)
        recompute_transport_fee_status(tf)

    @action(detail=True, methods=['post'], url_path='record-payment')
    def record_payment(self, request, pk=None):
        tf = self.get_object()
        serializer = RecordPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            TransportFeePayment.objects.create(
                transport_fee=tf, amount=data['amount'], date=data['date'],
                method=data.get('method', ''), receipt_no=data.get('receipt_no', ''),
            )
            tf.paid_amount = (tf.paid_amount or 0) + data['amount']
            if data.get('method'):
                tf.method = data['method']
            if data.get('receipt_no'):
                tf.receipt_no = data['receipt_no']
            tf.paid_date = data['date']
            tf.save()
            recompute_transport_fee_status(tf)

        return Response(TransportFeeSerializer(tf).data, status=status.HTTP_200_OK)


class FineViewSet(viewsets.ModelViewSet):
    queryset = Fine.objects.select_related('student')
    serializer_class = FineSerializer
    permission_classes = [RolePermission]
    filterset_fields = ['status', 'student']

    def perform_create(self, serializer):
        fine_id = next_id(Fine.objects.all(), 'fine_id', 'FIN')
        serializer.save(fine_id=fine_id)


class SalaryViewSet(viewsets.ModelViewSet):
    queryset = Salary.objects.select_related('employee')
    serializer_class = SalarySerializer
    permission_classes = [RolePermission]
    filterset_fields = ['status', 'employee', 'month']
    search_fields = ['employee__name', 'sal_id', 'month']

    def perform_create(self, serializer):
        sal_id = next_id(Salary.objects.all(), 'sal_id', 'SAL', pad=3)
        serializer.save(sal_id=sal_id)

    @action(detail=True, methods=['post'], url_path='mark-paid')
    def mark_paid(self, request, pk=None):
        salary = self.get_object()
        salary.status = Salary.Status.PAID
        salary.paid_date = request.data.get('paid_date') or timezone.localdate()
        salary.save(update_fields=['status', 'paid_date'])
        return Response(SalarySerializer(salary).data)


class ExpenseCategoryViewSet(viewsets.ModelViewSet):
    queryset = ExpenseCategory.objects.all()
    serializer_class = ExpenseCategorySerializer
    permission_classes = [RolePermission]


class ExpenseViewSet(viewsets.ModelViewSet):
    queryset = Expense.objects.select_related('category', 'academic_year')
    serializer_class = ExpenseSerializer
    permission_classes = [RolePermission]
    filterset_fields = ['category', 'status', 'academic_year']
    search_fields = ['description', 'vendor', 'approver']
    ordering_fields = ['date', 'amount']


class BudgetViewSet(viewsets.ModelViewSet):
    queryset = Budget.objects.prefetch_related('expense_categories').select_related('academic_year')
    serializer_class = BudgetSerializer
    permission_classes = [RolePermission]
    filterset_fields = ['academic_year']


class ManualTransactionViewSet(viewsets.ModelViewSet):
    queryset = ManualTransaction.objects.all()
    serializer_class = ManualTransactionSerializer
    permission_classes = [RolePermission]
    filterset_fields = ['type']


class InstitutionSettingsView(APIView):
    """Singleton settings endpoint — GET returns it (creating defaults on
    first access), PATCH/PUT updates it. Only Admin/Accountant can write,
    matching canEdit; Viewer can still GET."""
    permission_classes = [RolePermission]

    def get(self, request):
        return Response(InstitutionSettingsSerializer(InstitutionSettings.load()).data)

    def patch(self, request):
        instance = InstitutionSettings.load()
        serializer = InstitutionSettingsSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    put = patch


class TransactionLedgerView(APIView):
    """Read-only, computed on the fly — equivalent of buildTx(). Optional
    ?academic_year=<id> query param scopes it to one session."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        year_id = request.query_params.get('academic_year')
        ledger = build_transaction_ledger(academic_year=year_id)
        return Response(TransactionLedgerEntrySerializer(ledger, many=True).data)


class DashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        year_id = request.query_params.get('academic_year')
        return Response(dashboard_summary(academic_year=year_id))


class AutoOverdueCheckView(APIView):
    """POST to manually trigger the overdue sweep (equivalent of the
    frontend's 60s setInterval autoCheckOverdue()) — wire this to a cron
    job / Celery beat schedule for automatic periodic runs in production."""
    permission_classes = [RolePermission]

    def post(self, request):
        changed = run_auto_overdue_check()
        return Response({'changed': changed})
