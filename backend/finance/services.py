"""
Business logic ported from the frontend (script.js): fee/transport-fee
status derivation, the auto-overdue checker, the unified transaction
ledger builder, and dashboard aggregation. Kept out of models.py/views.py
so it can be unit-tested and reused (e.g. from a management command or a
Celery task) independently of the request/response cycle.
"""
from datetime import date, timedelta

from django.db.models import Sum

from .models import Expense, Fee, FeePayment, FeeStatus, ManualTransaction, Salary, TransportFee


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


# ══════════════════════════════════════════════════════════════════════
# SCHOLARSHIP / DISCOUNT / CONCESSION — ported from script.js's
# buildFeeDiscount()/studentScholarship()/scholarshipReliefOn(). This is
# the SINGLE authoritative entry point for turning a gross fee into the
# net payable amount — the frontend must never compute this itself.
# ══════════════════════════════════════════════════════════════════════

def student_scholarship(student):
    """Returns the student's standing scholarship as a dict, or None if
    they have none — mirrors studentScholarship() in script.js."""
    sch_type = student.sch_type or 'None'
    val = float(student.sch_val or 0)
    if sch_type == 'None' or val <= 0:
        return None
    return {'type': sch_type, 'mode': student.sch_mode or 'percent', 'val': val, 'note': student.sch_note or ''}


def scholarship_label(sch):
    if not sch:
        return ''
    amount_str = f"{sch['val']:g}%" if sch['mode'] == 'percent' else f"Rs {sch['val']:,.0f}"
    return f"{sch['type']} ({amount_str})"


def scholarship_relief_on(sch, gross):
    """Relief this scholarship grants against `gross` — never more than
    `gross`, and always a whole rupee (matches Math.round in script.js)."""
    gross = max(0.0, float(gross or 0))
    if not sch or not gross:
        return 0.0
    raw = gross * sch['val'] / 100 if sch['mode'] == 'percent' else sch['val']
    return max(0.0, min(gross, round(raw)))


def compute_fee_discount(student, gross, concession_amount=0, discount_reason=''):
    """THE single entry point for every fee-creation path (ported 1:1 from
    buildFeeDiscount() in script.js). Returns the exact fields to stamp on
    a Fee row. Relief can never exceed the gross, so `amount` can never go
    negative — concession is clamped to what's left after the scholarship."""
    gross = max(0.0, float(gross or 0))
    sch = student_scholarship(student)
    sch_amt = scholarship_relief_on(sch, gross)
    conc = max(0.0, min(gross - sch_amt, round(float(concession_amount or 0))))
    return {
        'gross_amount': gross,
        'scholarship_amount': sch_amt,
        'scholarship_label': scholarship_label(sch) if sch_amt > 0 else '',
        'concession_amount': conc,
        'discount_reason': str(discount_reason or '').strip() if conc > 0 else '',
        'amount': max(0.0, gross - sch_amt - conc),
    }


# ══════════════════════════════════════════════════════════════════════
# INSTALMENT PLANS — ported from saveStu()'s auto-split branch and
# saveFeeInstalments()'s custom-amounts branch.
# ══════════════════════════════════════════════════════════════════════

def _split_relief_proportionally(total, part_net_amounts, net_total):
    """Spreads a relief `total` (scholarship or concession) across parts in
    proportion to each part's NET amount, with the last part absorbing the
    rounding remainder — ported from splitRelief() in script.js, so
    Σ gross_amount always equals the plan's gross exactly."""
    n = len(part_net_amounts)
    out = [0.0] * n
    if not (total and total > 0) or not net_total:
        return out
    used = 0.0
    for i in range(n - 1):
        out[i] = int((total * part_net_amounts[i]) / net_total)
        used += out[i]
    out[n - 1] = total - used
    return out


def _add_months(d: date, months: int) -> date:
    """Calendar month addition without external deps (dateutil not in
    requirements) — clamps the day if the target month is shorter."""
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    import calendar
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def generate_installment_plan_auto(student, gross_amount, due_date, inst_count, interval_months,
                                    category, semester, academic_year=None):
    """Even/auto split — mirrors saveStu()'s instalment branch: the GROSS
    fee is split first (floor, last part absorbs the remainder), THEN the
    scholarship is applied to each part independently, so every row is
    internally consistent (amount = gross_amount − relief)."""
    import uuid
    gross_amount = float(gross_amount or 0)
    per_gross = int(gross_amount // inst_count)
    gross_rem = gross_amount - (per_gross * inst_count)
    plan_id = f"{student.roll_no}-{uuid.uuid4().hex[:12]}"
    today = date.today()

    fees = []
    for i in range(inst_count):
        part_gross = per_gross + gross_rem if i == inst_count - 1 else per_gross
        disc = compute_fee_discount(student, part_gross, 0, '')
        inst_due = _add_months(due_date, i * interval_months)
        status = FeeStatus.OVERDUE if inst_due < today else FeeStatus.PENDING
        fee = Fee.objects.create(
            fee_id=next_id(Fee.objects.all(), 'fee_id', 'F', pad=3),
            student=student, semester=semester, amount=disc['amount'],
            gross_amount=disc['gross_amount'], scholarship_amount=disc['scholarship_amount'],
            scholarship_label=disc['scholarship_label'], concession_amount=disc['concession_amount'],
            discount_reason=disc['discount_reason'], category=category, status=status,
            due_date=inst_due, is_installment=True, installment_part=i + 1,
            installment_total=inst_count, plan_id=plan_id, academic_year=academic_year,
        )
        fees.append(fee)
    update_student_overall_status(student)
    return fees


def generate_installment_plan_custom(student, gross_amount, installments, category, semester,
                                      academic_year=None, concession_amount=0, discount_reason=''):
    """Custom/manual split — mirrors saveFeeInstalments(): the admin types
    N (amount, due_date) pairs that must sum to the NET payable figure;
    relief is then spread proportionally across the parts for display."""
    import uuid
    gross_amount = float(gross_amount or 0)
    disc = compute_fee_discount(student, gross_amount, concession_amount, discount_reason)
    net_total = disc['amount']
    amounts = [float(i['amount']) for i in installments]
    if any(a <= 0 for a in amounts):
        raise ValueError('Each instalment amount must be greater than 0')
    if round(sum(amounts)) != round(net_total):
        raise ValueError(
            f"Instalments (Rs {sum(amounts):,.0f}) must add up to the Total Fee (Rs {net_total:,.0f})"
        )

    sch_parts = _split_relief_proportionally(disc['scholarship_amount'], amounts, net_total)
    conc_parts = _split_relief_proportionally(disc['concession_amount'], amounts, net_total)
    plan_id = f"{student.roll_no}-{uuid.uuid4().hex[:12]}"
    today = date.today()
    count = len(installments)

    fees = []
    for i, inst in enumerate(installments):
        due = inst['due_date']
        status = FeeStatus.OVERDUE if due < today else FeeStatus.PENDING
        fee = Fee.objects.create(
            fee_id=next_id(Fee.objects.all(), 'fee_id', 'F', pad=3),
            student=student, semester=semester, amount=amounts[i],
            gross_amount=amounts[i] + sch_parts[i] + conc_parts[i], scholarship_amount=sch_parts[i],
            scholarship_label=disc['scholarship_label'], concession_amount=conc_parts[i],
            discount_reason=disc['discount_reason'], category=category, status=status,
            due_date=due, is_installment=True, installment_part=i + 1,
            installment_total=count, plan_id=plan_id, academic_year=academic_year,
        )
        fees.append(fee)
    update_student_overall_status(student)
    return fees


def create_single_fee(student, gross_amount, concession_amount, discount_reason, due_date,
                       category, semester, academic_year=None):
    """Non-instalment fee — mirrors saveStu()'s single-record branch /
    saveFee()'s new-record branch."""
    disc = compute_fee_discount(student, gross_amount, concession_amount, discount_reason)
    today = date.today()
    status = FeeStatus.OVERDUE if (due_date and due_date < today) else FeeStatus.PENDING
    fee = Fee.objects.create(
        fee_id=next_id(Fee.objects.all(), 'fee_id', 'F', pad=3),
        student=student, semester=semester, amount=disc['amount'],
        gross_amount=disc['gross_amount'], scholarship_amount=disc['scholarship_amount'],
        scholarship_label=disc['scholarship_label'], concession_amount=disc['concession_amount'],
        discount_reason=disc['discount_reason'], category=category, status=status,
        due_date=due_date, academic_year=academic_year,
    )
    update_student_overall_status(student)
    return fee


# ══════════════════════════════════════════════════════════════════════
# PAYMENT RECORDING — instalment-order enforcement + student roll-up
# ══════════════════════════════════════════════════════════════════════

def earliest_unpaid_instalment_blocking(fee):
    """Instalments must be collected IN ORDER — mirrors the guard in
    quickCollect()/saveFee() in script.js, now enforced server-side so it
    can't be bypassed by calling the API directly. Returns the blocking
    Fee row, or None if this fee is clear to pay."""
    if not fee.is_installment or not fee.plan_id:
        return None
    earlier = (
        Fee.objects.filter(plan_id=fee.plan_id, is_installment=True)
        .filter(installment_part__lt=fee.installment_part)
        .exclude(status=FeeStatus.PAID)
        .order_by('installment_part')
        .first()
    )
    return earlier


def update_student_overall_status(student):
    """Rolls every fee a student holds up into their single `status` field
    — mirrors the 'Overall student status' block at the end of saveFee()
    in script.js: Paid only if EVERY fee is Paid, Overdue if any is
    overdue, else Pending. If the student has no fee records at all
    (e.g. their only fee was just deleted), resets to Pending rather than
    leaving a stale status behind — script.js has no equivalent cleanup
    for this case, so this is a deliberate small improvement over it."""
    fees = list(Fee.objects.filter(student=student))
    if not fees:
        student.status = FeeStatus.PENDING
        student.save(update_fields=['status'])
        return
    all_paid = all(f.status == FeeStatus.PAID for f in fees)
    any_overdue = any('Overdue' in f.status for f in fees)
    student.status = FeeStatus.PAID if all_paid else (FeeStatus.OVERDUE if any_overdue else FeeStatus.PENDING)
    student.save(update_fields=['status'])
