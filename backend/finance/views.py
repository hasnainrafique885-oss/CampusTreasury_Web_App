from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from academics.models import Student
from accounts.permissions import EditRolePermission, RolePermission
from .models import (
    Budget, Expense, ExpenseCategory, Fee, FeePayment, Fine,
    InstitutionSettings, ManualTransaction, Route, Salary,
    TransportFee, TransportFeePayment,
)
from .serializers import (
    BudgetSerializer, CreateFeeSerializer, ExpenseCategorySerializer, ExpenseSerializer,
    FeePaymentSerializer, FeeSerializer, FineSerializer, InstallmentPlanSerializer,
    InstitutionSettingsSerializer, ManualTransactionSerializer, RecordPaymentSerializer,
    RouteSerializer, SalarySerializer, TransactionLedgerEntrySerializer,
    TransportFeePaymentSerializer, TransportFeeSerializer,
)
from .services import (
    build_transaction_ledger, compute_fee_discount, create_single_fee, dashboard_summary,
    earliest_unpaid_instalment_blocking, generate_installment_plan_auto,
    generate_installment_plan_custom, next_id, recompute_fee_status,
    recompute_transport_fee_status, run_auto_overdue_check, update_student_overall_status,
)


class FeeViewSet(viewsets.ModelViewSet):
    queryset = Fee.objects.select_related('student', 'academic_year').prefetch_related('payments')
    serializer_class = FeeSerializer
    # DELETE only needs canEdit here (accountant included) — see
    # EditRolePermission's docstring for why Fee differs from Student.
    permission_classes = [EditRolePermission]
    filterset_fields = ['status', 'category', 'student', 'academic_year']
    search_fields = ['student__name', 'student__roll_no', 'fee_id', 'receipt_no']
    ordering_fields = ['due_date', 'amount', 'created_at']

    def create(self, request, *args, **kwargs):
        """Creates a single (non-instalment) fee. The client sends the
        GROSS amount (+ optional concession); the NET `amount`, scholarship
        and concession fields are all computed server-side via
        finance.services.compute_fee_discount — the client can never dictate
        the net payable figure directly. Use /create-installment-plan/ for
        instalment plans instead."""
        serializer = CreateFeeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        student = d['student']
        fee = create_single_fee(
            student=student, gross_amount=d['gross_amount'],
            concession_amount=d.get('concession_amount', 0), discount_reason=d.get('discount_reason', ''),
            due_date=d.get('due_date'), category=d.get('category', Fee.Category.TUITION),
            semester=d.get('semester', ''), academic_year=d.get('academic_year'),
        )
        return Response(FeeSerializer(fee).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        """Mirrors delFee(): a straight delete (script.js doesn't block on
        payments already existing either), but the student's roll-up status
        must be recomputed afterwards — otherwise a student marked Overdue
        purely because of the now-deleted fee would incorrectly stay that
        way forever."""
        student = instance.student
        instance.delete()
        update_student_overall_status(student)

    @action(detail=False, methods=['post'], url_path='quote-discount')
    def quote_discount(self, request):
        """Live preview of the scholarship/concession math for the Add Fee /
        Add Student forms — same computation create() will actually apply,
        so the number shown to the clerk before saving can never drift from
        what gets billed."""
        try:
            student = Student.objects.get(pk=request.data.get('student'))
        except (Student.DoesNotExist, TypeError, ValueError):
            return Response({'detail': 'Valid student id required'}, status=400)
        gross = request.data.get('gross_amount', 0)
        concession = request.data.get('concession_amount', 0)
        reason = request.data.get('discount_reason', '')
        return Response(compute_fee_discount(student, gross, concession, reason))

    @action(detail=False, methods=['post'], url_path='create-installment-plan')
    def create_installment_plan(self, request):
        """Two modes, matching the two places script.js builds a plan:
        - 'auto'   (Add Student form): {student, gross_amount, due_date,
          inst_count, interval_months, category, semester, academic_year}
          — even split, scholarship applied per part.
        - 'custom' (Fees -> Assign Fee Structure): {student, gross_amount,
          category, semester, academic_year, installments:[{amount,due_date},...]}
          — admin-typed amounts that must sum to the net payable figure.
        """
        serializer = InstallmentPlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        student = d['student']
        try:
            if d['mode'] == 'custom':
                fees = generate_installment_plan_custom(
                    student=student, gross_amount=d['gross_amount'], installments=d['installments'],
                    category=d.get('category', Fee.Category.TUITION), semester=d.get('semester', ''),
                    academic_year=d.get('academic_year'), concession_amount=d.get('concession_amount', 0),
                    discount_reason=d.get('discount_reason', ''),
                )
            else:
                fees = generate_installment_plan_auto(
                    student=student, gross_amount=d['gross_amount'], due_date=d['due_date'],
                    inst_count=d['inst_count'], interval_months=d['interval_months'],
                    category=d.get('category', Fee.Category.TUITION), semester=d.get('semester', ''),
                    academic_year=d.get('academic_year'),
                )
        except ValueError as e:
            return Response({'detail': str(e)}, status=400)
        return Response(FeeSerializer(fees, many=True).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='record-payment')
    def record_payment(self, request, pk=None):
        """Records one payment against this fee instalment, updates the
        running paid_amount, and recomputes status — supports partial
        payments the same way the frontend's Fee module does. Instalments
        must be paid in order (server-enforced, not just a disabled UI
        field), and overpayment beyond the remaining balance is rejected."""
        fee = self.get_object()

        blocker = earliest_unpaid_instalment_blocking(fee)
        if blocker:
            return Response(
                {'detail': f'Collect Instalment {blocker.installment_part} first — instalments must be paid in order'},
                status=status.HTTP_409_CONFLICT,
            )

        serializer = RecordPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        remaining = fee.amount - (fee.paid_amount or 0)
        if data['amount'] > remaining:
            return Response(
                {'detail': f'Rs {remaining:,.0f} remaining on this fee — cannot pay Rs {data["amount"]:,.0f}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
            update_student_overall_status(fee.student)

        # `fee` was fetched via get_object() with prefetch_related('payments')
        # BEFORE the FeePayment row above was created, so its cached .payments
        # would otherwise still show the pre-payment list (Django does not
        # auto-invalidate prefetch caches on a related-object create()) —
        # re-fetch fresh so the response's payment history is never stale.
        fee = Fee.objects.select_related('student', 'academic_year').prefetch_related('payments').get(pk=fee.pk)
        return Response(FeeSerializer(fee).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='student-ledger')
    def student_ledger(self, request):
        """Full fee history for one student — every fee row (with its
        nested payments) plus a Gross->Relief->Net->Paid->Remaining summary.
        Mirrors feeLedgerData(roll) in script.js."""
        student_id = request.query_params.get('student')
        if not student_id:
            return Response({'detail': 'student query param required'}, status=400)
        fees = Fee.objects.filter(student_id=student_id).select_related('student').prefetch_related('payments').order_by('due_date')
        data = FeeSerializer(fees, many=True).data
        summary = {
            'gross_amount': sum(float(f.gross_amount or f.amount) for f in fees),
            'scholarship_amount': sum(float(f.scholarship_amount or 0) for f in fees),
            'concession_amount': sum(float(f.concession_amount or 0) for f in fees),
            'net_amount': sum(float(f.amount) for f in fees),
            'paid_amount': sum(float(f.paid_amount or 0) for f in fees),
            'remaining_amount': sum(float(f.amount - (f.paid_amount or 0)) for f in fees),
        }
        return Response({'fees': data, 'summary': summary})


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

        tf = TransportFee.objects.select_related('student', 'route', 'academic_year').prefetch_related('payments').get(pk=tf.pk)
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
