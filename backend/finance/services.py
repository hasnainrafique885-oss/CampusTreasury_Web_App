"""
Business logic ported from the frontend (script.js): fee/transport-fee
status derivation, the auto-overdue checker, the unified transaction
ledger builder, and dashboard aggregation. Kept out of models.py/views.py
so it can be unit-tested and reused (e.g. from a management command or a
Celery task) independently of the request/response cycle.
"""
from datetime import date

from django.db.models import Sum

from .models import Expense, Fee, FeeStatus, ManualTransaction, Salary, TransportFee


def next_id(queryset, field_name: str, prefix: str, pad: int = 0, sep: str = '-') -> str:
    """Generates the next human-readable ID such as 'F-007', 'RT-3', 'FIN-12'
    by looking at the highest existing numeric suffix for `prefix` — mirrors
    the D.seq counters in the frontend, just derived from the DB instead of
    an in-memory counter."""
    existing = queryset.filter(**{f'{field_name}__startswith': f'{prefix}{sep}'}).values_list(field_name, flat=True)
    max_n = 0
    for value in existing:
        tail = value[len(prefix) + len(sep):]
        if tail.isdigit():
            max_n = max(max_n, int(tail))
    n = max_n + 1
    return f'{prefix}{sep}{str(n).zfill(pad) if pad else n}'


# ── Status derivation ────────────────────────────────────────────────────

def compute_fee_status(fee: Fee) -> str:
    """Mirrors feeComputeStatus() in script.js: derive status from money
    actually received + due date, rather than trusting a possibly-stale
    stored status."""
    paid = fee.paid_amount or 0
    amount = fee.amount or 0
    is_overdue = bool(fee.due_date and fee.due_date < date.today())

    if paid >= amount and amount > 0:
        return FeeStatus.PAID
    if paid > 0:
        return FeeStatus.PARTIAL_OVERDUE if is_overdue else FeeStatus.PARTIAL
    return FeeStatus.OVERDUE if is_overdue else FeeStatus.PENDING


def compute_transport_fee_status(tf: TransportFee) -> str:
    paid = tf.paid_amount or 0
    amount = tf.amount or 0
    is_overdue = bool(tf.due_date and tf.due_date < date.today())

    if paid >= amount and amount > 0:
        return FeeStatus.PAID
    if paid > 0:
        return FeeStatus.PARTIAL_OVERDUE if is_overdue else FeeStatus.PARTIAL
    return FeeStatus.OVERDUE if is_overdue else FeeStatus.PENDING


def recompute_fee_status(fee: Fee, save: bool = True) -> str:
    status = compute_fee_status(fee)
    if status != fee.status:
        fee.status = status
        if save:
            fee.save(update_fields=['status'])
    return status


def recompute_transport_fee_status(tf: TransportFee, save: bool = True) -> str:
    status = compute_transport_fee_status(tf)
    if status != tf.status:
        tf.status = status
        if save:
            tf.save(update_fields=['status'])
    return status


def run_auto_overdue_check():
    """Equivalent of autoCheckOverdue() — call from a scheduled task
    (cron / Celery beat) instead of the frontend's 60-second setInterval."""
    changed = 0
    for fee in Fee.objects.exclude(status=FeeStatus.PAID):
        before = fee.status
        recompute_fee_status(fee)
        if fee.status != before:
            changed += 1
    for tf in TransportFee.objects.exclude(status=FeeStatus.PAID):
        before = tf.status
        recompute_transport_fee_status(tf)
        if tf.status != before:
            changed += 1
    return changed


def student_outstanding_balance(student):
    fee_bal = Fee.objects.filter(student=student).aggregate(
        total=Sum('amount'), paid=Sum('paid_amount')
    )
    tf_bal = TransportFee.objects.filter(student=student).aggregate(
        total=Sum('amount'), paid=Sum('paid_amount')
    )
    total = (fee_bal['total'] or 0) + (tf_bal['total'] or 0)
    paid = (fee_bal['paid'] or 0) + (tf_bal['paid'] or 0)
    return float(total - paid)


# ── Unified transaction ledger ──────────────────────────────────────────

def build_transaction_ledger(academic_year=None):
    """Equivalent of buildTx(): assembles one unified, chronological list of
    every money movement — fee/transport-fee income (itemised per payment),
    salary + expense outflow, and manual entries — the same ledger the
    Transactions page and Dashboard totals are built from.
    Returns a list of dicts (JSON-serialisable), newest first.
    """
    tx = []

    fees_qs = Fee.objects.select_related('student').prefetch_related('payments')
    if academic_year:
        fees_qs = fees_qs.filter(academic_year=academic_year)
    for fee in fees_qs:
        payments = list(fee.payments.all())
        if payments:
            for i, p in enumerate(payments, start=1):
                tx.append({
                    'id': f'TXN-{fee.tx_seq or fee.id}-{i}',
                    'desc': f'Fee - {fee.student.name}' + (f' (Inst {fee.installment_part})' if fee.is_installment and fee.installment_part else ''),
                    'type': 'Income', 'amount': float(p.amount), 'date': p.date,
                    'category': 'Fees', 'source_type': 'fee', 'source_id': fee.id,
                })
        elif fee.paid_amount and fee.paid_amount > 0:
            tx.append({
                'id': f'TXN-{fee.tx_seq or fee.id}',
                'desc': f'Fee - {fee.student.name}',
                'type': 'Income', 'amount': float(fee.paid_amount), 'date': fee.paid_date or fee.due_date,
                'category': 'Fees', 'source_type': 'fee', 'source_id': fee.id,
            })

    tf_qs = TransportFee.objects.select_related('student').prefetch_related('payments')
    if academic_year:
        tf_qs = tf_qs.filter(academic_year=academic_year)
    for tf in tf_qs:
        payments = list(tf.payments.all())
        if payments:
            for i, p in enumerate(payments, start=1):
                tx.append({
                    'id': f'TFTXN-{tf.tx_seq or tf.id}-{i}',
                    'desc': f'Transport Fee - {tf.student.name}',
                    'type': 'Income', 'amount': float(p.amount), 'date': p.date,
                    'category': 'Transport', 'source_type': 'transport_fee', 'source_id': tf.id,
                })
        elif tf.paid_amount and tf.paid_amount > 0:
            tx.append({
                'id': f'TFTXN-{tf.tx_seq or tf.id}',
                'desc': f'Transport Fee - {tf.student.name}',
                'type': 'Income', 'amount': float(tf.paid_amount), 'date': tf.paid_date or tf.due_date,
                'category': 'Transport', 'source_type': 'transport_fee', 'source_id': tf.id,
            })

    sal_qs = Salary.objects.select_related('employee').filter(status=Salary.Status.PAID)
    for sal in sal_qs:
        tx.append({
            'id': f'SAL-{sal.tx_seq or sal.id}',
            'desc': f'Salary - {sal.employee.name}',
            'type': 'Expense', 'amount': float(sal.net_pay), 'date': sal.paid_date,
            'category': 'Salaries', 'source_type': 'salary', 'source_id': sal.id,
        })

    exp_qs = Expense.objects.select_related('category')
    if academic_year:
        exp_qs = exp_qs.filter(academic_year=academic_year)
    for exp in exp_qs:
        tx.append({
            'id': f'EXP-{exp.tx_seq or exp.id}',
            'desc': exp.description,
            'type': 'Expense', 'amount': float(exp.amount), 'date': exp.date,
            'category': exp.category.name, 'source_type': 'expense', 'source_id': exp.id,
        })

    for m in ManualTransaction.objects.all():
        tx.append({
            'id': f'MAN-{m.id}', 'desc': m.description, 'type': m.type,
            'amount': float(m.amount), 'date': m.date, 'category': m.category or 'Other',
            'source_type': 'manual', 'source_id': m.id,
        })

    tx.sort(key=lambda r: r['date'] or date.min, reverse=True)
    return tx


# ── Dashboard aggregation ────────────────────────────────────────────────

def dashboard_summary(academic_year=None):
    ledger = build_transaction_ledger(academic_year)
    total_income = sum(r['amount'] for r in ledger if r['type'] == 'Income')
    total_expense = sum(r['amount'] for r in ledger if r['type'] == 'Expense')

    fees_qs = Fee.objects.all()
    tf_qs = TransportFee.objects.all()
    if academic_year:
        fees_qs = fees_qs.filter(academic_year=academic_year)
        tf_qs = tf_qs.filter(academic_year=academic_year)

    return {
        'total_income': total_income,
        'total_expense': total_expense,
        'net_balance': total_income - total_expense,
        'fees_pending': fees_qs.filter(status=FeeStatus.PENDING).count(),
        'fees_overdue': fees_qs.filter(status__in=[FeeStatus.OVERDUE, FeeStatus.PARTIAL_OVERDUE]).count(),
        'fees_paid': fees_qs.filter(status=FeeStatus.PAID).count(),
        'transport_fees_overdue': tf_qs.filter(status__in=[FeeStatus.OVERDUE, FeeStatus.PARTIAL_OVERDUE]).count(),
        'transaction_count': len(ledger),
    }
