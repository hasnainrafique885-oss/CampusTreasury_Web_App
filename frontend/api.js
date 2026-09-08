/* ══════════════════════════════════════════════════════════════════
   CampusTreasury — Django REST API integration (Modules 1, 2 & 3)
   ══════════════════════════════════════════════════════════════════
   Module 1 — Auth, Roles, Users, initial data load:
     ✅ Login / Logout / JWT session
     ✅ Users & Roles management (Users page)
     ✅ Change Password
     ✅ Full read-side data load from the database on login
     ✅ Role permissions are read from the backend's response

   Module 2 — Students + Fees + Payments:
     ✅ Students: Add / Edit / Delete — persisted to the database
     ✅ Fees: scholarship / concession / discount math is computed and
        ENFORCED server-side (finance/services.py) — a client can
        never write a fake net-payable figure
     ✅ Instalment plans (equal-split at admission, or custom
        per-instalment amounts from Fee Management) — created
        atomically server-side
     ✅ Partial payments, multiple payments, full payment history —
        paid/remaining amounts and status (Paid/Partial/Pending/
        Overdue/Partial-Overdue) are always DERIVED server-side, never
        trusted from the client
     ✅ Instalments must be collected in order and can never be
        overpaid — enforced by the API (409 / 400), not just the UI
     ✅ Fee ledger, receipts and vouchers keep working unmodified —
        they read D.fees/D.feePayments, which are now database-backed
     ⏳ A Fee record linked to a Disciplinary Fine stays LOCAL-ONLY —
        the Fines module itself isn't migrated yet, and 'Fine' isn't a
        valid category on the backend Fee model. See the Module 2
        section below for the exact boundary.

   Module 3 — Transport Fee + Route Master, Disciplinary Fines,
   Salaries, Expenses (+ categories) and Budget:
     ✅ Route Master — Add / Edit / Delete persisted to the database
     ✅ Transport Fee — assign / edit / delete / collect (partial)
        payment, all persisted; paid/remaining/status are DERIVED
        server-side exactly like Module 2's Fee module
     ✅ Disciplinary Fines — Add / Edit / Delete / Mark Paid persisted
     ✅ Salaries — process / edit / delete / mark paid persisted
     ✅ Expense Categories + Expenses — Add / Delete persisted
     ✅ Budget — Add / Edit / Delete persisted, `spent`/`remaining`
        computed server-side from real Expense records (never stored,
        so it can't drift)
     ⏳ Two deliberate scope boundaries, called out explicitly rather
        than silently degraded:
        1. A Fine's auto-merge into a student's next Fee payment
           (syncFeeForFine / checkPendingFines) stays LOCAL-ONLY —
           same as Module 2's boundary: 'Fine' still isn't a valid
           Fee.category on the backend. The Fine record itself (and
           Mark Paid / Delete) IS persisted; only the auto-generated
           "Paid via fee" Fee row is local-only.
        2. A Transport Fee's route must be picked from Route Master —
           the backend has no free-text "custom route name" field on
           TransportFee (only a Route foreign key), so the old
           type-your-own-route option is no longer available once a
           record is meant to be saved to the database.

   NOT yet in scope (still local-only / in-memory):
     ⏳ Manual ledger transactions (the "+ Add Transaction" button on
        the Transactions page) — a `/finance/manual-transactions/`
        endpoint exists on the backend but wasn't part of this pass;
        every other module above is fully wired.

   This file is loaded AFTER script.js. It works by re-declaring a
   handful of the same top-level `function name(){...}` names — in
   plain JavaScript the later script's function declaration simply
   replaces the earlier one, so nothing in script.js needs to change
   and no other function in that file is touched.
   ══════════════════════════════════════════════════════════════════ */

/* ── Configuration ───────────────────────────────────────────────── */
// Override by setting `window.CT_API_BASE = '...'` in a <script> tag
// BEFORE this file loads, if the backend isn't on the default port.
const API_BASE = window.CT_API_BASE || 'http://127.0.0.1:8000/api';

/* ── Token storage ────────────────────────────────────────────────
   sessionStorage (not localStorage): tokens should not silently
   persist forever across browser restarts, and clearing them is not
   the "replace localStorage with real data" concern the task is
   about — this is auth-session plumbing, not app data.            */
const TOKS = {
  get access()  { return sessionStorage.getItem('ct_access')  || null; },
  set access(v) { v ? sessionStorage.setItem('ct_access', v)  : sessionStorage.removeItem('ct_access'); },
  get refresh() { return sessionStorage.getItem('ct_refresh') || null; },
  set refresh(v){ v ? sessionStorage.setItem('ct_refresh', v) : sessionStorage.removeItem('ct_refresh'); },
  clear() { this.access = null; this.refresh = null; },
};

/* ── Core fetch wrapper: adds the Bearer token, retries once after a
   transparent refresh on 401. Throws an Error with a readable
   .message and, when available, .status / .data for callers that
   want to branch on the exact failure (e.g. 423 = account locked). */
async function apiFetch(path, options = {}) {
  const doFetch = () => fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKS.access ? { Authorization: 'Bearer ' + TOKS.access } : {}),
      ...(options.headers || {}),
    },
  });

  let res = await doFetch();

  if (res.status === 401 && TOKS.refresh && !options._retried) {
    const r = await fetch(API_BASE + '/auth/refresh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: TOKS.refresh }),
    });
    if (r.ok) {
      const data = await r.json();
      TOKS.access = data.access;
      res = await doFetch();
    }
  }

  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch (e) { /* no JSON body */ }
    const msg = (data && (data.detail || JSON.stringify(data))) || res.statusText;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

/* Follows DRF's {count, next, previous, results} pagination until
   every page has been collected — so a list larger than PAGE_SIZE
   (50) never silently loses records. */
async function fetchAllPages(path) {
  let url = path;
  let all = [];
  while (url) {
    const data = await apiFetch(url);
    if (Array.isArray(data)) return data; // unpaginated endpoint
    all = all.concat(data.results || []);
    if (!data.next) break;
    // `next` is an absolute URL from DRF — strip back down to a path
    // relative to API_BASE so it goes through the same apiFetch base.
    url = data.next.replace(API_BASE, '');
  }
  return all;
}

/* ══════════════════════════════════════════════════════════════════
   MAPPERS — backend JSON shape → the exact D.* shape script.js's
   existing render functions (rDash, rStudents, rFees, ...) expect.
   Kept in one place so every field name discrepancy is visible here
   rather than scattered through the loading logic below.
   ══════════════════════════════════════════════════════════════════ */

function apiStudentToD(s) {
  return {
    id: s.student_id, name: s.name, father: s.father_name, roll: s.roll_no,
    gender: s.gender, dept: s.department, cls: s.school_class_code || '',
    section: s.section, sem: s.semester, fee: Number(s.default_fee) || 0,
    status: s.status, contact: s.contact, address: s.address,
    schType: s.sch_type || 'None', schMode: s.sch_mode || 'percent',
    schVal: Number(s.sch_val) || 0, schNote: s.sch_note || '',
    _pk: s.id, // backend numeric primary key — kept for future write calls
  };
}

function apiFeeToD(f, rollByPk) {
  const instPart = f.is_installment ? (f.installment_part + '/' + f.installment_total) : '';
  return {
    feeId: f.fee_id, student: f.student_name, roll: rollByPk[f.student] || '',
    sem: f.semester, amt: Number(f.amount) || 0, paidAmt: Number(f.paid_amount) || 0,
    date: f.paid_date || '-', method: f.method || '-', receipt: f.receipt_no || '-',
    status: f.status, dueDate: f.due_date || '', category: f.category,
    // Discount breakdown (Module 2) — server-computed, never client-guessed.
    grossAmt: Number(f.gross_amount) || Number(f.amount) || 0,
    scholarshipAmt: Number(f.scholarship_amount) || 0, scholarshipLabel: f.scholarship_label || '',
    concessionAmt: Number(f.concession_amount) || 0, discountReason: f.discount_reason || '',
    // Instalment plan fields. instTotal (the plan's total NET payable) is
    // filled in by buildFeesAndPayments() below, once every row in the plan
    // is known — a single Fee record on its own can't know the plan's sum.
    isInstalment: !!f.is_installment, planId: f.plan_id || '',
    instIdx: f.is_installment ? (f.installment_part - 1) : undefined,
    instPart, instTotal: undefined,
    _pk: f.id,
  };
}

/* Groups mapped fee rows by planId and stamps each instalment row with
   instTotal = the plan's total NET payable (sum of every part's `amt`) —
   mirrors instPlanSummary()'s own "Σ amt can never disagree with the rows"
   rule, just computed once here instead of recomputed on every render. */
function buildFeesAndPayments(feesRaw, rollByPk) {
  const fees = feesRaw.map(f => apiFeeToD(f, rollByPk));
  const planTotals = {};
  fees.forEach(f => { if (f.isInstalment && f.planId) planTotals[f.planId] = (planTotals[f.planId] || 0) + f.amt; });
  fees.forEach(f => { if (f.isInstalment && f.planId) f.instTotal = planTotals[f.planId]; });
  const feePayments = [];
  feesRaw.forEach((f, i) => {
    feePayments.push(...apiFeePaymentsToD(f, fees[i].feeId, fees[i].roll, fees[i].planId, fees[i].instPart));
  });
  return { fees, feePayments };
}

function apiFeePaymentsToD(fee, feeId, roll, planId, instPart) {
  return (fee.payments || []).map(p => ({
    feeId, roll, planId: planId || '', instPart: instPart || '', voucherRef: fee.receipt_no || '-',
    amount: Number(p.amount) || 0, date: p.date, method: p.method || '-',
    reference: p.receipt_no || '-', receivedBy: '-', status: 'Success',
  }));
}

function apiTransportFeeToD(t, rollByPk, routeIdByPk) {
  return {
    tfId: t.tf_id, student: t.student_name, roll: rollByPk[t.student] || '',
    // t.route is the Route's numeric pk (the FK); Route Master itself is
    // keyed by the human route_id string ('RT-3'), which is what
    // script.js's own route-matching logic (openEditTransportFee,
    // fillTfRouteDropdown selection, etc.) expects in `.routeId` — so this
    // resolves pk -> route_id via the lookup map, rather than leaking the
    // raw pk under a field named like the string code.
    route: t.route_name || '', routeId: (routeIdByPk && routeIdByPk[t.route]) || '',
    amt: Number(t.amount) || 0, paidAmt: Number(t.paid_amount) || 0,
    date: t.paid_date || '-', method: t.method || '-', receipt: t.receipt_no || '-',
    status: t.status, dueDate: t.due_date || '',
    payments: (t.payments || []).map(p => ({ amount: Number(p.amount) || 0, date: p.date })),
    _pk: t.id,
  };
}

function apiEmployeeToD(e) {
  return {
    id: e.employee_id, name: e.name, desig: e.designation, dept: e.department,
    salary: Number(e.salary) || 0, allow: Number(e.allowance) || 0,
    contact: e.contact, email: e.email, address: e.address, status: e.status,
    _pk: e.id,
  };
}

function apiSalaryToD(s) {
  return {
    salId: s.sal_id, name: s.employee_name, desig: '', basic: Number(s.basic) || 0,
    allow: Number(s.allowance) || 0, deduct: Number(s.deduction) || 0,
    month: s.month, status: s.status, _pk: s.id,
  };
}

function apiExpenseCategoryToD(c) {
  return { name: c.name, icon: c.icon || '📦', color: c.color || '#6b7280', budget: Number(c.budget) || 0, _pk: c.id };
}

function apiExpenseToD(e) {
  return {
    desc: e.description, cat: e.category_name, amt: Number(e.amount) || 0,
    date: e.date, vendor: e.vendor, approver: e.approver, status: e.status,
    // Module 3 — was hard-coded '2024-25' while Expenses were still local-only.
    // Now reads the real linked AcademicYear's label so activeExpenses()'s
    // `e.year===D.activeYear` filter keeps working once more than one year exists.
    year: e.academic_year_label || D.activeYear, _pk: e.id,
  };
}

function apiBudgetToD(b, catNameById) {
  return {
    dept: b.department, allocated: Number(b.allocated) || 0, spent: Number(b.spent) || 0,
    expCats: (b.expense_categories || []).map(id => catNameById[id]).filter(Boolean),
    // Same reasoning as apiExpenseToD.year above.
    year: b.academic_year_label || D.activeYear, _pk: b.id,
  };
}

function apiFineToD(f, rollByPk) {
  return {
    fineId: f.fine_id, student: f.student_name, roll: rollByPk[f.student] || '',
    reason: f.reason, amt: Number(f.amount) || 0, date: f.date, status: f.status, _pk: f.id,
  };
}

function apiRouteToD(r) {
  return {
    routeId: r.route_id, name: r.name, vehicleNo: r.vehicle_no, driverName: r.driver_name,
    driverPhone: r.driver_phone, capacity: r.capacity, monthlyFee: Number(r.monthly_fee) || 0,
    status: r.status, fitnessExpiry: r.fitness_expiry, insuranceExpiry: r.insurance_expiry,
    _pk: r.id,
  };
}

function apiClassToD(c) {
  return {
    id: 'CLS-' + c.id, name: c.name, code: c.code, gender: c.gender,
    fee: Number(c.default_fee) || 0, sections: (c.sections || []).map(s => s.name),
    _pk: c.id,
  };
}

function apiSettingsToD(s) {
  return {
    instName: s.inst_name, city: s.city, academicYear: s.academic_year_label,
    adminEmail: s.admin_email, contact: s.contact, address: s.address,
    lateFeePct: Number(s.late_fee_pct) || 0, feeDueDay: s.fee_due_day,
    sessionTimeoutMin: s.session_timeout_min,
    bankName: s.bank_name, bankBranch: s.bank_branch, bankAccountTitle: s.bank_account_title,
    bankAccountNo: s.bank_account_no, bankIBAN: s.bank_iban,
    bankJazzCash: s.bank_jazzcash, bankEasyPaisa: s.bank_easypaisa,
    accountsPhone: s.accounts_phone, officeHours: s.office_hours,
    customerCode: s.customer_code, voucherPrefix: s.voucher_prefix,
    voucherInstructions: s.voucher_instructions || [],
  };
}

function apiUserToFrontend(u) {
  return {
    id: u.username, name: u.full_name || u.username, role: u.role,
    active: u.is_active, lastLogin: u.last_login, pass: null, _pk: u.id,
  };
}

/* ══════════════════════════════════════════════════════════════════
   FULL DATA LOAD — replaces D's seed arrays with real database
   records. Called once right after a successful login.
   ══════════════════════════════════════════════════════════════════ */
async function loadAllDataFromAPI() {
  const [studentsRaw, employeesRaw, classesRaw, routesRaw, catsRaw, settingsRaw, yearsRaw] = await Promise.all([
    fetchAllPages('/academics/students/'),
    fetchAllPages('/hr/employees/'),
    fetchAllPages('/academics/classes/'),
    fetchAllPages('/finance/routes/'),
    fetchAllPages('/finance/expense-categories/'),
    apiFetch('/finance/settings/'),
    fetchAllPages('/academics/academic-years/'),
  ]);
  // Warm the label -> pk cache used by ensureAcademicYearPk() (Module 3 —
  // Expenses/Budget need a real AcademicYear pk on write, D.activeYear is
  // only ever the display label).
  yearsRaw.forEach(y => { _ayCache[y.label] = y.id; });

  const students = studentsRaw.map(apiStudentToD);
  const rollByStudentPk = {};
  studentsRaw.forEach(s => { rollByStudentPk[s.id] = s.roll_no; });

  const [feesRaw, tfRaw, salariesRaw, expensesRaw, budgetsRaw, finesRaw] = await Promise.all([
    fetchAllPages('/finance/fees/'),
    fetchAllPages('/finance/transport-fees/'),
    fetchAllPages('/finance/salaries/'),
    fetchAllPages('/finance/expenses/'),
    fetchAllPages('/finance/budgets/'),
    fetchAllPages('/finance/fines/'),
  ]);

  const catNameById = {};
  catsRaw.forEach(c => { catNameById[c.id] = c.name; });
  const routeIdByPk = {};
  routesRaw.forEach(r => { routeIdByPk[r.id] = r.route_id; });

  const fees_and_payments = buildFeesAndPayments(feesRaw, rollByStudentPk);
  const fees = fees_and_payments.fees;
  const feePayments = fees_and_payments.feePayments;

  D.students = students;
  D.employees = employeesRaw.map(apiEmployeeToD);
  D.classes = classesRaw.map(apiClassToD);
  D.departments = [...new Set(D.employees.map(e => e.dept).filter(Boolean))];
  D.fees = fees;
  D.feePayments = feePayments;
  D.transportFees = tfRaw.map(t => apiTransportFeeToD(t, rollByStudentPk, routeIdByPk));
  D.salaries = salariesRaw.map(apiSalaryToD);
  D.expCategories = catsRaw.map(apiExpenseCategoryToD);
  D.expenses = expensesRaw.map(apiExpenseToD);
  D.budget = budgetsRaw.map(b => apiBudgetToD(b, catNameById));
  D.fines = finesRaw.map(f => apiFineToD(f, rollByStudentPk));
  D.routes = routesRaw.map(apiRouteToD);
  D.settings = Object.assign({}, D.settings, apiSettingsToD(settingsRaw));

  try { buildTx(); } catch (e) { console.warn('buildTx after API load failed:', e); }
}

async function loadUsersFromAPI() {
  const usersRaw = await fetchAllPages('/users/');
  USERS.length = 0;
  usersRaw.forEach(u => USERS.push(apiUserToFrontend(u)));
}

async function loadAuditLogFromAPI() {
  try {
    const rows = await fetchAllPages('/audit-log/');
    const typeMap = { login: 'login', login_failed: 'fail', logout: 'logout' };
    AUDIT = rows.map(a => ({
      time: new Date(a.timestamp),
      username: a.username_snapshot,
      name: a.username_snapshot,
      role: '-',
      type: typeMap[a.action] || 'action',
      action: (a.action === 'create' || a.action === 'update' || a.action === 'delete')
        ? `${a.action.toUpperCase()} ${a.model_name} (${a.method} ${a.path})`
        : a.object_repr || a.action,
    }));
  } catch (e) {
    console.warn('Audit log fetch failed (non-fatal):', e);
  }
}

/* ══════════════════════════════════════════════════════════════════
   AUTH — overrides doLogin / doLogout / doChangePassword from
   script.js with real API-backed versions. UI element ids and the
   post-login page-render calls are copied from the original function
   so the on-screen behaviour is identical.
   ══════════════════════════════════════════════════════════════════ */

async function doLogin() {
  const uidEl = $('uid'), passEl = $('upass'), errEl = $('loginErr'), lockEl = $('loginLockErr');
  if (!uidEl || !passEl) { console.error('Login fields not found'); return; }

  const uid = uidEl.value.trim().toLowerCase();
  const pass = passEl.value.trim();
  if (errEl) errEl.style.display = 'none';
  if (lockEl) lockEl.style.display = 'none';

  if (!uid || !pass) {
    if (errEl) { errEl.textContent = '❌ User ID and Password are required'; errEl.style.display = 'flex'; }
    return;
  }

  let data;
  try {
    data = await apiFetch('/auth/login/', { method: 'POST', body: JSON.stringify({ username: uid, password: pass }) });
  } catch (e) {
    if (e.status === 423) {
      if (lockEl) lockEl.style.display = 'flex';
    } else {
      if (errEl) { errEl.textContent = '❌ Incorrect credentials — please try again'; errEl.style.display = 'flex'; }
      if (passEl) { passEl.value = ''; passEl.focus(); }
    }
    return;
  }

  TOKS.access = data.access;
  TOKS.refresh = data.refresh;

  const u = data.user;
  SESSION = {
    user: {
      id: u.username, name: u.full_name || u.username, role: u.role,
      active: u.is_active, lastLogin: u.last_login,
      // Authoritative permission flags come straight from the backend's
      // ROLE_PERMS table (see accounts/models.py), not just re-derived
      // from the local ROLES constant — a role's permissions can only
      // ever be as generous as what the server will actually allow.
      perms: {
        canEdit: !!u.perms.can_edit, canDelete: !!u.perms.can_delete,
        canManageUsers: !!u.perms.can_manage_users, canViewAudit: !!u.perms.can_view_audit,
      },
    },
    loginTime: new Date(), lastActive: Date.now(),
  };

  try { await loadAllDataFromAPI(); } catch (e) { console.error('Initial data load failed:', e); toast('⚠️ Could not load data from server: ' + e.message); }
  try { await loadUsersFromAPI(); } catch (e) { console.warn('Users load failed:', e); }
  try { await loadAuditLogFromAPI(); } catch (e) { /* non-fatal, already logged inside */ }

  const loginPage = $('loginPage'), appEl = $('app');
  if (loginPage) loginPage.style.display = 'none';
  if (appEl) { appEl.style.display = 'flex'; appEl.style.flexDirection = 'column'; appEl.style.minHeight = '100vh'; }
  updateSessionUI();
  applyRoleRestrictions();
  startSessionTimer();
  try { autoCheckOverdue(); } catch (e) { console.warn(e); }
  try { rDash(); } catch (e) { console.warn('rDash error:', e); }
  try { rClasses(); } catch (e) { console.warn('rClasses error:', e); }
  try { rFines(); } catch (e) { console.warn('rFines error:', e); }
  try { rTransportFee(); } catch (e) { console.warn('rTransportFee error:', e); }
  try { initYearSwitcher(); } catch (e) { console.warn('year switcher error:', e); }
}

async function doLogout() {
  try { await apiFetch('/auth/logout/', { method: 'POST', body: JSON.stringify({ refresh: TOKS.refresh }) }); }
  catch (e) { /* best-effort — proceed with local logout regardless */ }
  TOKS.clear();
  stopSessionTimer();
  SESSION = { user: null, loginTime: null, lastActive: null };
  $('lockScreen').style.display = 'none';
  $('app').style.display = 'none';
  $('loginPage').style.display = 'flex';
  document.querySelectorAll('.ps').forEach(p => p.classList.remove('on'));
  const d = $('pg-dashboard'); if (d) d.classList.add('on');
}

async function doChangePassword() {
  const oldp = $('cp-old').value.trim(), newp = $('cp-new').value.trim(), conf = $('cp-conf').value.trim();
  const err = $('cp-err');
  err.style.display = 'none';
  if (!SESSION.user) return;
  const pwErr = passwordPolicyError(newp);
  if (pwErr) { err.textContent = '❌ ' + pwErr; err.style.display = 'block'; return; }
  if (newp !== conf) { err.textContent = '❌ Passwords do not match'; err.style.display = 'block'; return; }

  try {
    await apiFetch('/auth/change-password/', {
      method: 'POST', body: JSON.stringify({ old_password: oldp, new_password: newp }),
    });
  } catch (e) {
    err.textContent = '❌ ' + (e.data && e.data.old_password ? e.data.old_password : e.message);
    err.style.display = 'block';
    return;
  }
  closeMo('chgPass');
  toast('✅ Password changed successfully!');
  $('cp-old').value = ''; $('cp-new').value = ''; $('cp-conf').value = '';
}

/* hasPerm() now checks the permission flags the server handed back at
   login (SESSION.user.perms), instead of re-deriving them from the
   local PERMS table — the frontend's ROLES/PERMS constants are only
   used for display now (labels, icons, colours). */
function hasPerm(perm) {
  if (!SESSION.user || !SESSION.user.perms) return false;
  return !!SESSION.user.perms[perm];
}

/* ══════════════════════════════════════════════════════════════════
   USERS MANAGEMENT — overrides saveUser / delUser / toggleUserActive /
   unlockUserLogin to call the real /api/users/ endpoints. rUsers()
   itself is untouched (it only reads the USERS array, which these
   functions now keep in sync with the database).
   ══════════════════════════════════════════════════════════════════ */

async function saveUser() {
  const idx = parseInt($('editUserIdx').value);
  const uid = $('u-username').value.trim().toLowerCase();
  const name = $('u-fullname').value.trim();
  const role = $('u-role').value;
  const passRaw = $('u-pass').value.trim();
  const errEl = $('adduser-err');
  errEl.style.display = 'none';

  if (!uid || !name) { errEl.textContent = '❌ Username and Full Name are required'; errEl.style.display = 'block'; return; }
  if (idx < 0 && !passRaw) { errEl.textContent = '❌ Password is required for new users'; errEl.style.display = 'block'; return; }
  if (passRaw) {
    const pwErr = passwordPolicyError(passRaw);
    if (pwErr) { errEl.textContent = '❌ ' + pwErr; errEl.style.display = 'block'; return; }
  }

  const payload = { username: uid, full_name: name, role };
  if (passRaw) payload.password = passRaw;

  try {
    if (idx < 0) {
      await apiFetch('/users/', { method: 'POST', body: JSON.stringify(payload) });
      toast('✅ User added: ' + name);
    } else {
      const pk = USERS[idx]._pk;
      await apiFetch(`/users/${pk}/`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('✅ User updated: ' + name);
    }
  } catch (e) {
    errEl.textContent = '❌ ' + (e.data && e.data.username ? e.data.username : e.message);
    errEl.style.display = 'block';
    return;
  }

  await loadUsersFromAPI();
  closeMo('addUser');
  rUsers();
}

async function delUser(idx) {
  if (!requirePerm('canManageUsers', 'delete user')) return;
  const u = USERS[idx];
  if (u.id === SESSION.user?.id) { toast('❌ Cannot delete your own account'); return; }
  if (!confirm('Delete user: ' + u.name + '?')) return;
  try {
    await apiFetch(`/users/${u._pk}/`, { method: 'DELETE' });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }
  await loadUsersFromAPI();
  rUsers();
  toast('User deleted');
}

async function toggleUserActive(idx) {
  if (!requirePerm('canManageUsers', 'toggle user')) return;
  const u = USERS[idx];
  if (u.id === SESSION.user?.id) { toast('❌ Cannot deactivate your own account'); return; }
  try {
    await apiFetch(`/users/${u._pk}/`, { method: 'PATCH', body: JSON.stringify({ is_active: !u.active }) });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }
  await loadUsersFromAPI();
  rUsers();
  toast(!u.active ? '✅ User activated' : '⚠️ User deactivated');
}

async function unlockUserLogin(uid) {
  if (!requirePerm('canManageUsers', 'unlock user')) return;
  const u = USERS.find(x => x.id === uid);
  if (!u) return;
  try {
    await apiFetch(`/users/${u._pk}/unlock/`, { method: 'POST' });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }
  delete _loginAttempts[uid]; // also clears the client-side lock UI immediately
  rUsers();
  toast('🔓 Login unlocked for ' + uid);
}

/* ══════════════════════════════════════════════════════════════════
   MODULE 2 — Students + Fees + Payments (scholarship, concession,
   instalment plans, partial payments, fee ledger, receipts) now
   persist to the real database. All financial math (scholarship
   relief, net payable, paid/remaining, status) is RECOMPUTED and
   ENFORCED server-side — see backend finance/services.py — so a
   tampered client request can never write a fake net amount, skip an
   earlier unpaid instalment, or overpay a fee.

   NOT in this pass: a Fee record linked to a Disciplinary Fine
   (f.linkedFineId / category 'Fine') is left LOCAL-ONLY, exactly as
   before — the Fines module itself isn't wired to the API yet, and
   'Fine' is not a valid Fee.category on the backend, so persisting a
   fine-linked fee here would either be rejected or silently strip the
   link. This is called out explicitly rather than silently degraded.
   ══════════════════════════════════════════════════════════════════ */

/* Refetches Students + Fees (+ their nested payment history) from the
   database and replaces D's copies — the single source of truth after
   any Students/Fees mutation, so a bug in this file's own bookkeeping
   can never leave the UI showing something the database disagrees
   with (refresh always wins). */
async function refreshStudentsAndFees() {
  const [studentsRaw, feesRaw] = await Promise.all([
    fetchAllPages('/academics/students/'),
    fetchAllPages('/finance/fees/'),
  ]);
  const rollByStudentPk = {};
  studentsRaw.forEach(s => { rollByStudentPk[s.id] = s.roll_no; });
  D.students = studentsRaw.map(apiStudentToD);
  const built = buildFeesAndPayments(feesRaw, rollByStudentPk);
  D.fees = built.fees;
  D.feePayments = built.feePayments;
}

function pkForRoll(roll) {
  const s = D.students.find(x => x.roll === roll);
  return s ? s._pk : null;
}

/* ── Students ─────────────────────────────────────────────────────── */

async function saveStu() {
  if (!requirePerm('canEdit', 'save student')) return;
  clearStuErr();
  const editIdx = parseInt($('stuIdx').value);
  const isEdit = editIdx >= 0;
  const nameVal = $('sn').value.trim();
  const rollVal = $('sr').value.trim();
  const feeVal = $('sfa').value.trim();
  let hasErr = false;

  if (!nameVal) { setFieldErr('sn', 'Full Name is required'); hasErr = true; }
  if (!rollVal) { setFieldErr('sr', 'Roll Number is required'); hasErr = true; }
  if (!feeVal || isNaN(parseInt(feeVal))) { setFieldErr('sfa', 'Valid fee amount is required'); hasErr = true; }
  else if (parseInt(feeVal) < 0) { setFieldErr('sfa', 'Fee amount cannot be negative'); hasErr = true; }
  if (rollVal) {
    const dup = D.students.findIndex(s => s.roll.toLowerCase() === rollVal.toLowerCase());
    if (dup >= 0 && dup !== editIdx) {
      setFieldErr('sr', `Roll No "${rollVal}" already used by ${D.students[dup].name}`);
      hasErr = true;
    }
  }
  const schForm = stuFormScholarship();
  if (schForm.schType !== 'None') {
    if (!(schForm.schVal > 0)) { setFieldErr('s-schval', 'Enter the relief amount for this scholarship'); hasErr = true; }
    else if (schForm.schMode === 'percent' && schForm.schVal > 100) { setFieldErr('s-schval', 'A percentage relief cannot be more than 100%'); hasErr = true; }
  }
  if (hasErr) return;

  const feeAmt = parseInt(feeVal) || 25000;
  const dueDate = ($('s-fdue') || {}).value || '';
  const feeType = ($('s-ftype') || {}).value || 'full';
  const feeCat = 'Tuition';
  const instCount = parseInt(($('s-finst-count') || {}).value) || 2;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDt = dueDate ? parseDate(dueDate) : null;
  if (dueDt) dueDt.setHours(0, 0, 0, 0);
  const isOverdue = dueDt && dueDt < today;
  const autoStatus = isOverdue ? 'Overdue' : 'Pending';

  const clsCode = ($('scls') || {}).value || '';
  const gender = ($('sgender') || {}).value || 'Male';
  const genderKey = gender === 'Male' ? 'Boys' : 'Girls';
  const clsObj = (D.classes || []).find(c => c.code === clsCode && (c.gender === genderKey || c.gender === 'Both'));
  const deptVal = clsObj ? `${clsObj.name} (${clsObj.gender})` : clsCode;

  const payload = {
    name: nameVal, father_name: $('sfn').value.trim() || '-', roll_no: rollVal,
    contact: $('sc').value.trim() || '-', address: $('sadr').value.trim() || '-',
    gender: gender, department: deptVal, school_class: clsObj ? clsObj._pk : null,
    section: ($('ssec') || {}).value || 'A', semester: ($('ssm') || {}).value || '1st Year',
    default_fee: feeAmt, status: autoStatus,
    sch_type: schForm.schType, sch_mode: schForm.schMode,
    sch_val: schForm.schType === 'None' ? 0 : schForm.schVal, sch_note: schForm.schNote,
  };

  try {
    if (isEdit) {
      const pk = D.students[editIdx]._pk;
      await apiFetch(`/academics/students/${pk}/`, { method: 'PATCH', body: JSON.stringify(payload) });
      auditLog('action', 'Student updated: ' + nameVal);
      toast('Student updated: ' + nameVal);
    } else {
      payload.fee_plan = feeType === 'instalment'
        ? { gross_amount: feeAmt, due_date: dueDate || null, fee_type: 'instalment', category: feeCat, inst_count: instCount }
        : { gross_amount: feeAmt, due_date: dueDate || null, fee_type: 'full', category: feeCat };
      const created = await apiFetch('/academics/students/', { method: 'POST', body: JSON.stringify(payload) });
      auditLog('action', 'Student added: ' + nameVal + ' (' + created.student_id + ')');
      toast(feeType === 'instalment'
        ? '✅ Student added with ' + instCount + ' instalment plan (every ' + Math.max(1, Math.round(12 / instCount)) + ' month(s))! ID: ' + created.student_id
        : 'Student added! ID: ' + created.student_id + (isOverdue ? ' ⚠️ Fee is Overdue' : ''));
    }
  } catch (e) {
    toast('❌ ' + (e.data ? JSON.stringify(e.data) : e.message));
    return;
  }

  await refreshStudentsAndFees();
  buildTx(); rStudents(); rFees(); rTx(); rDash(); closeMo('addStu');
}

async function delStu(i) {
  if (!requirePerm('canDelete', 'delete student')) return;
  const stu = D.students[i];
  if (!confirm('Delete student: ' + stu.name + '?')) return;
  try {
    await apiFetch(`/academics/students/${stu._pk}/`, { method: 'DELETE' });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }
  auditLog('action', 'Student deleted: ' + stu.name);
  await refreshStudentsAndFees();
  buildTx(); rStudents(); rFees(); rDash(); toast('Student deleted');
}

/* ── Fees ─────────────────────────────────────────────────────────── */

async function saveFee() {
  if (!requirePerm('canEdit', 'save fee')) return;
  const editIdx = parseInt($('feeEditIdx').value);
  const isEdit = editIdx >= 0;
  const stuRoll = ($('fr') || {}).value || '';
  const stuName = ($('fn') || {}).value || '';
  const fa = $('fa').value.trim();
  if (!stuName || !stuRoll || !fa) { toast('Student and Amount are required'); return; }
  if (parseInt(fa) < 0) { toast('❌ Fee amount cannot be negative'); return; }
  if (parseInt(($('fConc') || {}).value) < 0) { toast('❌ Concession cannot be negative'); return; }

  const studentPk = pkForRoll(stuRoll);
  if (!studentPk) { toast('❌ Student not found — please re-select the student'); return; }

  // ── INSTALMENT RECORD: partial-payment path ─────────────────────
  // (collecting money against an EXISTING instalment row — creating a
  // brand-new plan is handled by saveFeeInstalments() below).
  if (isEdit && D.fees[editIdx] && D.fees[editIdx].isInstalment) {
    const f = D.fees[editIdx];
    const earlierUnpaidSave = instPlanRows(f).find(r => (r.instIdx ?? 0) < (f.instIdx ?? 0) && feeComputeStatus(r) !== 'Paid');
    if (earlierUnpaidSave) { toast('⚠️ Collect Instalment ' + earlierUnpaidSave.instPart + ' first — instalments must be paid in order'); return; }
    const already = feePaidAmt(f);
    let payNow = parseInt(($('fPayNow') || {}).value) || 0;
    payNow = Math.max(0, Math.min(payNow, f.amt - already));
    if (payNow <= 0) { toast('Enter an amount greater than 0 to record a payment'); return; }
    const receipt = ($('frc').value.trim() || '');
    const method = $('fpm').value;
    // NOTE: todayStr() returns a display string ('6 Sep 2026') for the UI —
    // the API needs ISO YYYY-MM-DD, hence ymd(new Date()) here instead.
    const payDate = ymd(new Date());

    let updated;
    try {
      updated = await apiFetch(`/finance/fees/${f._pk}/record-payment/`, {
        method: 'POST',
        body: JSON.stringify({ amount: payNow, date: payDate, method, receipt_no: receipt }),
      });
    } catch (e) {
      // Surfaces the server's own guards verbatim — e.g. the 409 "collect
      // instalment N first" or a 400 overpayment rejection, in case the
      // client-side checks above were ever bypassed or went stale.
      toast('❌ ' + e.message);
      return;
    }

    auditLog('action', `Instalment payment recorded: ${stuName} — Rs ${payNow.toLocaleString()} (Inst ${f.instPart}) — new status ${feeStatusLabel(updated.status)}`);

    await refreshStudentsAndFees();
    const newIdx = D.fees.findIndex(x => x._pk === f._pk);

    buildTx(); rFees(); rFines(); rTx(); rDash(); rStudents();
    closeMo('addFee');
    _feeSelectedStu = null;
    toast(`✅ Payment recorded — Rs ${payNow.toLocaleString()} · Instalment now ${feeStatusLabel(updated.status)}`);
    setTimeout(() => { if (newIdx >= 0) printReceipt(newIdx, payNow); }, 600);
    return;
  }

  // ── ORDINARY (NON-INSTALMENT) RECORD ────────────────────────────
  const chosen = $('fst').value;
  const prev = (isEdit && D.fees[editIdx]) ? D.fees[editIdx] : null;
  const already = prev ? feePaidAmt(prev) : 0;
  let grossVal = parseInt(fa) || 0;
  let fineSum = feeModalFineSum();
  if (chosen !== 'Paid' && _feeIncludedFineIds.length) {
    const backedOutSum = _feeIncludedFineIds.reduce((sum, fid) => {
      const fine = D.fines.find(x => x.fineId === fid);
      return fine && fine.status !== 'Paid' ? sum + fine.amt : sum;
    }, 0);
    grossVal = Math.max(0, grossVal - backedOutSum);
    fineSum = Math.max(0, fineSum - backedOutSum);
    _feeIncludedFineIds = [];
    const fnote = $('fee-fine-note'); if (fnote) fnote.style.display = 'none';
    if (backedOutSum > 0) toast('ℹ️ Rs ' + fmt(backedOutSum) + ' of pending fines was left out — fines are only folded in when the fee is collected in full');
  }
  const disc = feeModalDiscountFor(grossVal, fineSum);
  const amtVal = disc.amt;
  if (disc.concessionAmt > 0 && !disc.discountReason) { toast('❌ Please write the reason for the concession'); return; }
  if (amtVal < already) { toast('❌ Rs ' + fmt(already) + ' has already been received on this fee — the payable amount cannot be reduced to Rs ' + fmt(amtVal)); return; }
  let payNow = 0;
  if (chosen === 'Paid') {
    payNow = Math.max(0, amtVal - already);
  } else if (chosen === 'Partial') {
    payNow = Math.max(0, Math.min(parseInt(($('fPayNow') || {}).value) || 0, amtVal - already));
    if (payNow <= 0) { toast('Enter an amount greater than 0 to record a partial payment'); return; }
  }
  const dueVal = $('fdd').value || (prev && prev.dueDate) || '';
  const method = $('fpm').value;
  const receiptNo = ($('frc').value.trim() || '');
  const category = (prev && prev.category) ? prev.category : 'Tuition';
  const semester = $('fsm').value;

  let savedFee;
  try {
    if (isEdit) {
      savedFee = await apiFetch(`/finance/fees/${prev._pk}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          gross_amount: disc.grossAmt, concession_amount: disc.concessionAmt,
          discount_reason: disc.discountReason, due_date: dueVal || null,
          semester, category,
        }),
      });
      auditLog('action', 'Fee updated: ' + stuName);
    } else {
      savedFee = await apiFetch('/finance/fees/', {
        method: 'POST',
        body: JSON.stringify({
          student: studentPk, gross_amount: disc.grossAmt, concession_amount: disc.concessionAmt,
          discount_reason: disc.discountReason, due_date: dueVal || null,
          semester, category,
        }),
      });
      auditLog('action', 'Fee recorded: ' + stuName + ' Rs ' + savedFee.amount +
        (disc.scholarshipAmt + disc.concessionAmt > 0 ? ' (after Rs ' + (disc.scholarshipAmt + disc.concessionAmt) + ' relief on Rs ' + disc.grossAmt + ')' : ''));
    }

    if (payNow > 0) {
      savedFee = await apiFetch(`/finance/fees/${savedFee.id}/record-payment/`, {
        method: 'POST',
        body: JSON.stringify({ amount: payNow, date: ymd(new Date()), method, receipt_no: receiptNo }),
      });
      auditLog('action', (savedFee.status === 'Paid' ? 'Fee payment received: ' : 'Partial fee payment received: ') + stuName + ' — Rs ' + fmt(payNow) + ' — ' + feeStatusLabel(savedFee.status));
    }
  } catch (e) {
    toast('❌ ' + (e.data ? JSON.stringify(e.data) : e.message));
    return;
  }

  const isPaid = savedFee.status === 'Paid';

  // Fine auto-settlement stays LOCAL-ONLY for this pass — the Fines module
  // itself isn't wired to the API yet (see file header comment). The visual
  // behaviour (fines flip to Paid in the UI) is preserved; the change is
  // just not yet persisted to the database until Fines is migrated.
  if (isPaid && _feeIncludedFineIds.length) {
    _feeIncludedFineIds.forEach(fid => {
      const fine = D.fines.find(x => x.fineId === fid);
      if (fine && fine.status !== 'Paid') {
        fine.status = 'Paid';
        auditLog('action', 'Fine settled via fee payment: ' + fine.student + ' — ' + fine.reason + ' (Rs ' + fine.amt + ')');
      }
    });
    _feeIncludedFineIds = [];
    const fnote = $('fee-fine-note'); if (fnote) fnote.style.display = 'none';
  }

  await refreshStudentsAndFees();
  const newIdx = D.fees.findIndex(x => x._pk === savedFee.id);

  buildTx(); rFees(); rFines(); rTx(); rDash(); rStudents();
  closeMo('addFee');
  _feeSelectedStu = null;
  if (payNow > 0 && newIdx >= 0) {
    const remaining = Math.max(0, amtVal - Number(savedFee.paid_amount || 0));
    toast(isPaid
      ? '✅ Payment saved — printing receipt…'
      : '✅ Partial payment of Rs ' + fmt(payNow) + ' recorded — ' + feeStatusLabel(savedFee.status) + '. Remaining Rs ' + fmt(remaining) + ' — printing receipt…');
    setTimeout(() => { if (D.fees[newIdx]) printReceipt(newIdx, payNow); }, 600);
  } else {
    toast('Fee record saved!');
  }
}

async function delFee(i) {
  if (!requirePerm('canEdit', 'delete fee')) return;
  const fee = D.fees[i];
  if (!fee) { toast('Record not found'); return; }
  if (!confirm('Delete fee record for ' + fee.student + '?')) return;
  try {
    await apiFetch(`/finance/fees/${fee._pk}/`, { method: 'DELETE' });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }
  auditLog('action', 'Fee deleted: ' + fee.student + ' Rs ' + fee.amt);
  await refreshStudentsAndFees();
  buildTx(); rFees(); rTx(); rDash(); rStudents();
  toast('Fee record deleted');
}

async function saveFeeInstalments() {
  if (!requirePerm('canEdit', 'save fee instalments')) return;
  const stuName = ($('fn') || {}).value || '';
  const stuRoll = ($('fr') || {}).value || '';
  const grossVal = parseInt($('fa').value) || 0;
  const sem = $('fsm').value;
  if (!stuName || !stuRoll || !grossVal) { toast('Student and Amount are required'); return; }

  const studentPk = pkForRoll(stuRoll);
  if (!studentPk) { toast('❌ Student not found — please re-select the student'); return; }

  if (_feeIncludedFineIds.length) {
    const fineSum = feeModalFineSum();
    _feeIncludedFineIds = [];
    const fnote = $('fee-fine-note'); if (fnote) fnote.style.display = 'none';
    if (fineSum > 0) {
      $('fa').value = Math.max(0, grossVal - fineSum);
      feeDiscountChange();
      toast('ℹ️ Rs ' + fineSum.toLocaleString() + ' of pending fines was removed from the total — fines are collected separately, not through an instalment plan. Please review the amounts and save again.');
      return;
    }
  }

  const disc = feeModalDiscountFor(grossVal, 0);
  const fa = disc.amt;
  if (disc.concessionAmt > 0 && !disc.discountReason) { toast('❌ Please write the reason for the concession'); return; }
  if (fa <= 0) { toast('❌ The relief cancels out the whole fee — there is nothing left to split into instalments'); return; }

  const editIdx = parseInt(($('feeEditIdx') || {}).value);
  const editing = (editIdx >= 0) ? D.fees[editIdx] : null;
  if (editing && editing.isInstalment) {
    toast('❌ This record is already part of an instalment plan — edit the instalments themselves instead of creating a new plan');
    return;
  }
  if (editing && feePaidAmt(editing) > 0) {
    toast('❌ A payment is already recorded on this fee — it cannot be converted into an instalment plan');
    return;
  }

  const count = feeGetInstCount();
  const amounts = Array.from({ length: count }, (_, i) => parseInt(($('fInstAmt' + i) || {}).value) || 0);
  const dueDates = Array.from({ length: count }, (_, i) => ($('fInstDate' + i) || {}).value || '');
  const sum = amounts.reduce((a, b) => a + b, 0);
  if (amounts.some(a => a <= 0)) { toast(`❌ Each of the ${count} instalments must have an amount greater than 0`); return; }
  if (dueDates.some(d => !d)) { toast(`❌ Each of the ${count} instalments needs a due date`); return; }
  if (sum !== fa) { toast(`❌ Instalments (Rs ${sum.toLocaleString()}) must add up to the Total Fee (Rs ${fa.toLocaleString()})`); return; }

  const category = (editing && editing.category) ? editing.category : 'Tuition';

  try {
    // Converting a single (non-instalment) record into a plan REPLACES it —
    // delete it server-side first so the student is never billed twice.
    if (editing && !editing.isInstalment) {
      await apiFetch(`/finance/fees/${editing._pk}/`, { method: 'DELETE' });
      auditLog('action', 'Fee record converted into a ' + count + '-part instalment plan: ' + stuName + ' — Rs ' + fa);
    }

    await apiFetch('/finance/fees/create-installment-plan/', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'custom', student: studentPk, gross_amount: disc.grossAmt,
        concession_amount: disc.concessionAmt, discount_reason: disc.discountReason,
        category, semester: sem,
        installments: amounts.map((amt, i) => ({ amount: amt, due_date: dueDates[i] })),
      }),
    });
  } catch (e) {
    toast('❌ ' + (e.data ? JSON.stringify(e.data) : e.message));
    return;
  }

  auditLog('action', count + '-part fee structure created: ' + stuName + ' — Total Rs ' + fa + ' (' + amounts.map(a => 'Rs ' + a.toLocaleString()).join(' + ') + ')' +
    (disc.scholarshipAmt + disc.concessionAmt > 0 ? ' after Rs ' + (disc.scholarshipAmt + disc.concessionAmt) + ' relief on Rs ' + disc.grossAmt : ''));

  await refreshStudentsAndFees();
  buildTx(); rFees(); rTx(); rDash(); rStudents();
  closeMo('addFee');
  toast(`✅ Fee structure saved — ${count} instalments created!`);
  _feeSelectedStu = null;
}

/* ══════════════════════════════════════════════════════════════════
   MODULE 3 — Transport Fee + Route Master, Disciplinary Fines,
   Salaries, Expenses (+ categories) and Budget. See the file header
   for the two deliberate scope boundaries (Fine↔Fee auto-merge, and
   Transport Fee's route-must-come-from-Route-Master rule).
   ══════════════════════════════════════════════════════════════════ */

/* label -> AcademicYear pk, warmed by loadAllDataFromAPI(). Expenses
   and Budget both need a real pk on write; D.activeYear is only ever
   the display label ('2024-25'), never the pk. */
let _ayCache = {};

async function ensureAcademicYearPk(label) {
  if (!label) return null;
  if (_ayCache[label]) return _ayCache[label];
  try {
    const years = await fetchAllPages('/academics/academic-years/');
    years.forEach(y => { _ayCache[y.label] = y.id; });
  } catch (e) { /* fall through to the create attempt below */ }
  if (_ayCache[label]) return _ayCache[label];
  // No such year on the server yet (e.g. addYear() only ever pushed to the
  // local D.years array before) — create it so the write below has
  // something real to point at.
  const created = await apiFetch('/academics/academic-years/', {
    method: 'POST', body: JSON.stringify({ label, is_active: false }),
  });
  _ayCache[label] = created.id;
  return created.id;
}

function pkForEmployeeName(name) {
  const e = D.employees.find(x => x.name === name);
  return e ? e._pk : null;
}
function pkForRouteId(routeId) {
  if (!routeId) return null;
  const r = D.routes.find(x => x.routeId === routeId);
  return r ? r._pk : null;
}
function pkForExpCategoryName(name) {
  const c = D.expCategories.find(x => x.name === name);
  return c ? c._pk : null;
}

/* Re-fetches every Module 3 finance list from the database and replaces
   D's copies, then rebuilds the unified ledger — the single source of
   truth after any of this section's mutations, same philosophy as
   Module 2's refreshStudentsAndFees(). D.students is NOT re-fetched here
   (nothing in this section writes to Students) — the roll lookup below
   reads whatever D.students already holds. */
async function refreshModule3Finance() {
  const [routesRaw, tfRaw, finesRaw, salariesRaw, catsRaw, expensesRaw, budgetsRaw] = await Promise.all([
    fetchAllPages('/finance/routes/'),
    fetchAllPages('/finance/transport-fees/'),
    fetchAllPages('/finance/fines/'),
    fetchAllPages('/finance/salaries/'),
    fetchAllPages('/finance/expense-categories/'),
    fetchAllPages('/finance/expenses/'),
    fetchAllPages('/finance/budgets/'),
  ]);
  const rollByStudentPk = {};
  D.students.forEach(s => { rollByStudentPk[s._pk] = s.roll; });
  const catNameById = {};
  catsRaw.forEach(c => { catNameById[c.id] = c.name; });
  const routeIdByPk = {};
  routesRaw.forEach(r => { routeIdByPk[r.id] = r.route_id; });

  D.routes = routesRaw.map(apiRouteToD);
  D.transportFees = tfRaw.map(t => apiTransportFeeToD(t, rollByStudentPk, routeIdByPk));
  D.fines = finesRaw.map(f => apiFineToD(f, rollByStudentPk));
  D.salaries = salariesRaw.map(apiSalaryToD);
  D.expCategories = catsRaw.map(apiExpenseCategoryToD);
  D.expenses = expensesRaw.map(apiExpenseToD);
  D.budget = budgetsRaw.map(b => apiBudgetToD(b, catNameById));

  try { buildTx(); } catch (e) { console.warn('buildTx after Module 3 refresh failed:', e); }
}

/* ── Route Master ─────────────────────────────────────────────────── */

async function saveRoute() {
  if (!requirePerm('canEdit', 'save route')) return;
  const editIdx = parseInt($('rt-editIdx').value);
  const isEdit = editIdx >= 0;
  const name = $('rt-name').value.trim();
  if (!name) { toast('❌ Route name is required'); return; }
  const vehicleNo = $('rt-vehicle').value.trim();
  const driverName = $('rt-driver').value.trim();
  const driverPhone = $('rt-phone').value.trim();
  const capacity = parseInt($('rt-capacity').value) || 0;
  const monthlyFee = parseInt($('rt-fee').value) || 0;
  if (!monthlyFee || monthlyFee < 0) { toast('❌ Valid monthly fee is required'); return; }
  const status = $('rt-status').value || 'Active';
  const fitnessExpiry = ($('rt-fitness') || {}).value || '';
  const insuranceExpiry = ($('rt-insurance') || {}).value || '';

  const payload = {
    name, vehicle_no: vehicleNo, driver_name: driverName, driver_phone: driverPhone,
    capacity, monthly_fee: monthlyFee, status,
    fitness_expiry: fitnessExpiry || null, insurance_expiry: insuranceExpiry || null,
  };

  try {
    if (isEdit) {
      const pk = D.routes[editIdx]._pk;
      await apiFetch(`/finance/routes/${pk}/`, { method: 'PATCH', body: JSON.stringify(payload) });
      auditLog('action', 'Route updated: ' + name);
    } else {
      await apiFetch('/finance/routes/', { method: 'POST', body: JSON.stringify(payload) });
      auditLog('action', 'Route added: ' + name);
    }
  } catch (e) {
    toast('❌ ' + (e.data ? JSON.stringify(e.data) : e.message));
    return;
  }

  await refreshModule3Finance();
  closeMo('addRoute');
  rRouteMaster();
  rTransportFee();
  toast(isEdit ? '✅ Route updated' : '✅ Route "' + name + '" added');
}

async function delRoute(idx) {
  if (!requirePerm('canEdit', 'delete route')) return;
  const r = D.routes[idx];
  if (!r) return;
  const cnt = routeUsageCount(r.routeId);
  if (!confirm('Delete route "' + r.name + '"?' + (cnt ? ' It is currently used by ' + cnt + ' transport fee record(s) — deleting it will unlink those records\' route (their fee amount is unaffected).' : ''))) return;
  try {
    await apiFetch(`/finance/routes/${r._pk}/`, { method: 'DELETE' });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }
  auditLog('action', 'Route deleted: ' + r.name);
  await refreshModule3Finance();
  rRouteMaster();
  rTransportFee();
  toast('Route deleted');
}

/* ── Transport Fee ────────────────────────────────────────────────── */

async function saveTransportFee() {
  if (!requirePerm('canEdit', 'save transport fee')) return;
  const editIdx = parseInt($('tf-editIdx').value);
  const isEdit = editIdx >= 0;
  const stuName = $('tf-name').value || '';
  const stuRoll = $('tf-roll').value || '';
  if (!stuName || !stuRoll) { toast('❌ Please select a student'); return; }
  const routeSel = $('tf-route').value;
  const selectedRoute = routeSel && routeSel !== '__custom__' ? D.routes.find(r => r.routeId === routeSel) : null;
  if (!selectedRoute) {
    toast('❌ Please pick a route from Route Master — now that Transport Fee is connected to the database, a free-typed custom route name can no longer be saved. Add the route in Route Master first, then select it here.');
    return;
  }
  const amt = parseInt($('tf-amt').value) || 0;
  if (!amt || amt < 0) { toast('❌ Valid amount is required'); return; }
  const due = $('tf-due').value;
  if (!due) { toast('❌ Due date is required'); return; }
  const statusSel = $('tf-status').value;

  const studentPk = pkForRoll(stuRoll);
  if (!studentPk) { toast('❌ Student not found — please re-select the student'); return; }

  const payload = { student: studentPk, route: selectedRoute._pk, amount: amt, due_date: due };

  let saved;
  try {
    if (isEdit) {
      const pk = D.transportFees[editIdx]._pk;
      saved = await apiFetch(`/finance/transport-fees/${pk}/`, { method: 'PATCH', body: JSON.stringify(payload) });
      // Mirrors the old "flip the dropdown straight to Paid" convenience —
      // one full-amount payment if nothing's been collected yet.
      if (statusSel === 'Paid' && saved.status !== 'Paid') {
        const remaining = amt - Number(saved.paid_amount || 0);
        if (remaining > 0) {
          saved = await apiFetch(`/finance/transport-fees/${pk}/record-payment/`, {
            method: 'POST', body: JSON.stringify({ amount: remaining, date: ymd(new Date()), method: 'Cash' }),
          });
        }
      }
      auditLog('action', 'Transport fee updated: ' + stuName);
    } else {
      saved = await apiFetch('/finance/transport-fees/', { method: 'POST', body: JSON.stringify(payload) });
      if (statusSel === 'Paid') {
        saved = await apiFetch(`/finance/transport-fees/${saved.id}/record-payment/`, {
          method: 'POST', body: JSON.stringify({ amount: amt, date: ymd(new Date()), method: 'Cash' }),
        });
      }
      auditLog('action', 'Transport fee assigned: ' + stuName + ' — Rs ' + amt);
    }
  } catch (e) {
    toast('❌ ' + (e.data ? JSON.stringify(e.data) : e.message));
    return;
  }

  await refreshModule3Finance();
  rTransportFee(); rDash(); rStudents();
  closeMo('addTransportFee');
  transportDeselectStu();
  toast(isEdit ? '✅ Transport fee updated' : '✅ Transport fee of Rs ' + fmt(amt) + ' assigned to ' + stuName);
}

async function saveCollectTransportFee() {
  if (!requirePerm('canEdit', 'collect transport fee')) return;
  const t = D.transportFees[_tfCollectIdx];
  if (!t) { toast('Transport fee record not found'); closeMo('collectTf'); return; }
  const remaining = tfRemainingAmt(t);
  const amt = parseInt($('ctf-amt').value) || 0;
  if (!amt || amt <= 0) { toast('❌ Valid amount is required'); return; }
  if (amt > remaining) { toast('❌ Amount can\'t exceed the remaining balance of Rs ' + fmt(remaining)); return; }
  const method = $('ctf-method').value || 'Cash';
  const date = $('ctf-date').value || ymd(new Date()); // date input is already ISO

  let saved;
  try {
    saved = await apiFetch(`/finance/transport-fees/${t._pk}/record-payment/`, {
      method: 'POST', body: JSON.stringify({ amount: amt, date, method }),
    });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }

  const fullyPaid = saved.status === 'Paid';
  auditLog('action', 'Transport fee payment collected: ' + t.student + ' — Rs ' + amt + (fullyPaid ? ' (fully paid)' : ' (partial)'));
  await refreshModule3Finance();
  rTransportFee(); rDash(); rStudents();
  closeMo('collectTf');
  const stillDue = Math.max(0, Number(saved.amount) - Number(saved.paid_amount || 0));
  toast('✅ Rs ' + fmt(amt) + ' collected from ' + t.student + (fullyPaid ? '' : ' · Rs ' + fmt(stillDue) + ' still due'));
}

async function delTransportFee(idx) {
  if (!requirePerm('canEdit', 'delete transport fee')) return;
  const t = D.transportFees[idx];
  if (!t) return;
  if (!confirm('Delete transport fee record for ' + t.student + '?')) return;
  try {
    await apiFetch(`/finance/transport-fees/${t._pk}/`, { method: 'DELETE' });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }
  auditLog('action', 'Transport fee deleted: ' + t.student);
  await refreshModule3Finance();
  rTransportFee(); rDash();
  toast('Transport fee record deleted');
}

/* ── Disciplinary Fines ───────────────────────────────────────────── */

async function saveFine() {
  if (!requirePerm('canEdit', 'save fine')) return;
  const editIdx = parseInt($('fineEditIdx').value);
  const isEdit = editIdx >= 0;
  const stuName = $('fn-name').value || '';
  const stuRoll = $('fn-roll').value || '';
  if (!stuName || !stuRoll) { toast('❌ Please select a student'); return; }
  const reasonSel = $('fn-reason').value;
  const reason = reasonSel === 'Other' ? ($('fn-reason-other').value.trim() || 'Other') : reasonSel;
  const amt = parseInt($('fn-amt').value) || 0;
  if (!amt || amt < 0) { toast('❌ Valid fine amount is required'); return; }
  const date = $('fn-date').value || isoDate();
  const status = $('fn-status').value;

  const studentPk = pkForRoll(stuRoll);
  if (!studentPk) { toast('❌ Student not found — please re-select the student'); return; }

  const payload = { student: studentPk, reason, amount: amt, date, status };

  let saved;
  try {
    if (isEdit) {
      const pk = D.fines[editIdx]._pk;
      saved = await apiFetch(`/finance/fines/${pk}/`, { method: 'PATCH', body: JSON.stringify(payload) });
      auditLog('action', 'Fine updated: ' + stuName + ' — ' + reason);
    } else {
      saved = await apiFetch('/finance/fines/', { method: 'POST', body: JSON.stringify(payload) });
      auditLog('action', 'Fine issued: ' + stuName + ' — ' + reason + ' (Rs ' + amt + ')');
    }
  } catch (e) {
    toast('❌ ' + (e.data ? JSON.stringify(e.data) : e.message));
    return;
  }

  await refreshModule3Finance();
  // Fine ↔ Fee auto-merge stays LOCAL-ONLY — see file header boundary #1.
  syncFeeForFine({ fineId: saved.fine_id, student: stuName, roll: stuRoll, reason, amt, date, status: saved.status });
  buildTx(); rFines(); rFees(); rTx(); rDash();
  closeMo('addFine');
  fineDeselectStu();
  toast(isEdit ? '✅ Fine updated' : '✅ Fine of Rs ' + fmt(amt) + ' added for ' + stuName + (status === 'Pending' ? ' — will be added to their next fee payment automatically' : ''));
}

async function markFinePaid(idx) {
  if (!requirePerm('canEdit', 'mark fine paid')) return;
  const f = D.fines[idx];
  if (!f) return;
  try {
    await apiFetch(`/finance/fines/${f._pk}/`, { method: 'PATCH', body: JSON.stringify({ status: 'Paid' }) });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }
  await refreshModule3Finance();
  syncFeeForFine({ fineId: f.fineId, student: f.student, roll: f.roll, reason: f.reason, amt: f.amt, date: f.date, status: 'Paid' });
  auditLog('action', 'Fine marked Paid: ' + f.student + ' — ' + f.reason);
  buildTx(); rFines(); rFees(); rTx(); rDash();
  toast('✅ Fine marked as Paid');
}

async function delFine(idx) {
  if (!requirePerm('canEdit', 'delete fine')) return;
  const f = D.fines[idx];
  if (!f) return;
  if (!confirm('Delete this fine for ' + f.student + '?')) return;
  try {
    await apiFetch(`/finance/fines/${f._pk}/`, { method: 'DELETE' });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }
  // Local-only linked-fee cleanup — see saveFine()'s boundary note above.
  const linkedIdx = D.fees.findIndex(x => x.linkedFineId === f.fineId && feePaidAmt(x) === 0);
  if (linkedIdx >= 0) D.fees.splice(linkedIdx, 1);
  auditLog('action', 'Fine deleted: ' + f.student + ' — ' + f.reason);
  await refreshModule3Finance();
  buildTx(); rFines(); rFees(); rTx(); rDash();
  toast('Fine deleted');
}

/* ── Salaries ─────────────────────────────────────────────────────── */

async function saveSal() {
  if (!requirePerm('canEdit', 'save salary')) return;
  const editIdx = parseInt($('salEditIdx').value);
  const isEdit = editIdx >= 0;
  const n = $('sln-sel').value.trim();
  if (!n) { toast('Please select an employee'); return; }
  const linkedEmp = D.employees.find(e => e.name === n);
  if (!linkedEmp) { toast('❌ Employee not found — please re-select'); return; }
  const basicRaw = parseInt($('slb').value), allowRaw = parseInt($('sla').value), deductRaw = parseInt($('sld2').value);
  if (basicRaw < 0) { toast('❌ Basic salary cannot be negative'); return; }
  if (allowRaw < 0) { toast('❌ Allowances cannot be negative'); return; }
  if (deductRaw < 0) { toast('❌ Deductions cannot be negative'); return; }
  const basicVal = basicRaw || 60000;
  const allowVal = allowRaw || 10000;
  const grossVal = basicVal + allowVal;
  let deductVal = deductRaw || 0;
  let deductCapped = false;
  if (deductVal > grossVal) { deductVal = grossVal; deductCapped = true; }
  const month = $('slm').value || getCurrentMonthLabel();
  const status = $('slst').value || 'Paid';

  const payload = { employee: linkedEmp._pk, month, basic: basicVal, allowance: allowVal, deduction: deductVal, status };
  if (status === 'Paid') payload.paid_date = ymd(new Date());

  let saved;
  try {
    if (isEdit) {
      const pk = D.salaries[editIdx]._pk;
      saved = await apiFetch(`/finance/salaries/${pk}/`, { method: 'PATCH', body: JSON.stringify(payload) });
      auditLog('action', 'Salary updated: ' + n + ' (' + saved.sal_id + ')');
    } else {
      saved = await apiFetch('/finance/salaries/', { method: 'POST', body: JSON.stringify(payload) });
      auditLog('action', 'Salary added: ' + n + ' (' + saved.sal_id + ')');
    }
  } catch (e) {
    // Surfaces the backend's unique_together(employee, month) violation
    // verbatim, e.g. re-processing the same employee's same month twice.
    toast('❌ ' + (e.data ? JSON.stringify(e.data) : e.message));
    return;
  }

  if (deductCapped) toast('⚠️ Deduction exceeded gross salary — capped at Rs ' + fmt(grossVal) + ' (net pay set to Rs 0)');
  await refreshModule3Finance();
  rSalaries(); rTx(); rDash(); closeMo('addSal');
  toast(isEdit ? 'Salary record updated!' : 'Salary processed! ID: ' + saved.sal_id);
}

async function markSalPaid(i) {
  if (!requirePerm('canEdit', 'mark salary paid')) return;
  const s = D.salaries[i];
  if (!s) return;
  try {
    await apiFetch(`/finance/salaries/${s._pk}/mark-paid/`, { method: 'POST', body: JSON.stringify({}) });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }
  auditLog('action', 'Salary paid: ' + s.name);
  await refreshModule3Finance();
  rSalaries(); rTx(); rDash();
  toast('Salary marked as Paid');
}

async function delSal(i) {
  if (!requirePerm('canDelete', 'delete salary')) return;
  const s = D.salaries[i];
  if (!s) return;
  if (!confirm('Delete this salary record?')) return;
  try {
    await apiFetch(`/finance/salaries/${s._pk}/`, { method: 'DELETE' });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }
  auditLog('action', 'Salary deleted: ' + s.name);
  await refreshModule3Finance();
  rSalaries(); rDash();
  toast('Salary record deleted');
}

/* ── Expense Categories ───────────────────────────────────────────── */

async function addExpCat() {
  const name = ($('nc-name') || {}).value.trim();
  const icon = ($('nc-icon') || {}).value.trim() || '📌';
  if (!name) { toast('Please enter a category name'); return; }
  if (D.expCategories.find(c => c.name === name)) { toast('This category already exists'); return; }
  const colors = ['#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'];
  const color = colors[D.expCategories.length % colors.length];
  try {
    await apiFetch('/finance/expense-categories/', { method: 'POST', body: JSON.stringify({ name, icon, color, budget: 0 }) });
  } catch (e) {
    toast('❌ ' + (e.data ? JSON.stringify(e.data) : e.message));
    return;
  }
  $('nc-name').value = ''; $('nc-icon').value = '';
  await refreshModule3Finance();
  _renderCatList();
  _syncCatDropdowns();
  rExpenses();
  toast('✅ ' + name + ' added');
}

async function delExpCat(i) {
  const cat = D.expCategories[i];
  const inUse = D.expenses.some(e => e.cat === cat.name);
  if (inUse) { toast('⚠️ ' + cat.name + ' is used in ' + D.expenses.filter(e => e.cat === cat.name).length + ' expense(s) — remove those first'); return; }
  if (!confirm('Delete: ' + cat.name + '?')) return;
  try {
    await apiFetch(`/finance/expense-categories/${cat._pk}/`, { method: 'DELETE' });
  } catch (e) {
    toast('❌ ' + e.message);
    return;
  }
  await refreshModule3Finance();
  _renderCatList();
  _syncCatDropdowns();
  rExpenses();
  toast('Category deleted');
}

/* ── Expenses ─────────────────────────────────────────────────────── */

async function saveExp() {
  if (!requirePerm('canEdit', 'save expense')) return;
  const d = $('xd').value.trim(); const a = $('xa').value.trim();
  if (!d || !a) { toast('Description and Amount are required'); return; }
  if (isNaN(parseInt(a)) || parseInt(a) < 0) { toast('❌ Expense amount cannot be negative'); return; }
  const catName = $('xc').value;
  const catPk = pkForExpCategoryName(catName);
  if (!catPk) { toast('❌ Please pick a valid expense category'); return; }

  let ayPk;
  try { ayPk = await ensureAcademicYearPk(D.activeYear); }
  catch (e) { toast('❌ Could not resolve academic year: ' + e.message); return; }

  const payload = {
    description: d, category: catPk, amount: parseInt(a) || 5000, date: ymd(new Date()),
    vendor: ($('xv') || { value: '' }).value.trim() || '', approver: $('xp').value.trim() || 'Admin',
    status: ($('xs') || { value: 'Approved' }).value || 'Approved', academic_year: ayPk,
  };

  try {
    await apiFetch('/finance/expenses/', { method: 'POST', body: JSON.stringify(payload) });
  } catch (e) {
    toast('❌ ' + (e.data ? JSON.stringify(e.data) : e.message));
    return;
  }

  auditLog('action', 'Expense added: ' + d + ' (' + D.activeYear + ')');
  await refreshModule3Finance();
  rExpenses(); rTx(); rDash(); closeMo('addExp'); toast('✅ Expense added!');
  ['xd', 'xp', 'xv'].forEach(id => { const el = $(id); if (el) el.value = ''; });
}

async function delExp(i) {
  if (!requirePerm('canEdit', 'delete expense')) return;
  const e = D.expenses[i];
  if (!e) return;
  if (!confirm('Delete: ' + e.desc + '?')) return;
  try {
    await apiFetch(`/finance/expenses/${e._pk}/`, { method: 'DELETE' });
  } catch (err) {
    toast('❌ ' + err.message);
    return;
  }
  auditLog('action', 'Expense deleted: ' + e.desc);
  await refreshModule3Finance();
  rExpenses(); rTx(); rDash();
  toast('Expense deleted');
}

/* ── Budget ───────────────────────────────────────────────────────── */

async function saveBud() {
  if (!requirePerm('canEdit', 'save budget')) return;
  const deptInput = $('bud-dept-input');
  const d = deptInput ? deptInput.value.trim() : '';
  if (!d) { toast('Please enter a department name'); return; }

  const catSel = $('bud-cat-select');
  const catVal = catSel ? catSel.value : '';
  const catPk = catVal ? pkForExpCategoryName(catVal) : null;

  const editIdx = $('bud-edit-idx').value;
  const isEdit = editIdx !== '' && !isNaN(parseInt(editIdx));

  let ayPk;
  try { ayPk = await ensureAcademicYearPk(D.activeYear); }
  catch (e) { toast('❌ Could not resolve academic year: ' + e.message); return; }

  const payload = {
    department: d, allocated: parseInt($('bda').value) || 100000,
    expense_categories: catPk ? [catPk] : [], academic_year: ayPk,
  };

  try {
    if (isEdit) {
      const i = parseInt(editIdx);
      const pk = D.budget[i]._pk;
      const oldDept = D.budget[i].dept;
      await apiFetch(`/finance/budgets/${pk}/`, { method: 'PATCH', body: JSON.stringify(payload) });
      auditLog('action', 'Budget edited: ' + oldDept + ' → ' + d + ' (' + D.activeYear + ')');
    } else {
      await apiFetch('/finance/budgets/', { method: 'POST', body: JSON.stringify(payload) });
      auditLog('action', 'Budget added: ' + d + ' (' + D.activeYear + ')');
    }
  } catch (e) {
    toast('❌ ' + (e.data ? JSON.stringify(e.data) : e.message));
    return;
  }

  await refreshModule3Finance();
  rBudget(); closeMo('addBud');
  toast(isEdit ? '✅ Budget updated: ' + d : '✅ Department added for ' + D.activeYear);
  $('bda').value = 100000; $('bud-edit-idx').value = '';
}

async function confirmDelBud(i) {
  if (!requirePerm('canEdit', 'delete budget')) return;
  if (i < 0 || i >= D.budget.length) { toast('Error: budget item not found'); return; }
  $('delBud-name').textContent = D.budget[i].dept;
  const btn = $('delBud-confirm-btn');
  btn.onclick = async function () {
    const b = D.budget[i];
    try {
      await apiFetch(`/finance/budgets/${b._pk}/`, { method: 'DELETE' });
    } catch (e) {
      toast('❌ ' + e.message);
      return;
    }
    auditLog('action', 'Budget deleted: ' + b.dept);
    await refreshModule3Finance();
    rBudget();
    closeMo('delBud');
    toast('✅ Department deleted');
  };
  showMo('delBud');
}
function delBud(i) { confirmDelBud(i); }
