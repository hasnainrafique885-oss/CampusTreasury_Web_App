/* ══════════════════════════════════════════════════════════════════
   CampusTreasury — Django REST API integration (Module 1)
   ══════════════════════════════════════════════════════════════════
   Scope of this file (see backend/README.md "Frontend integration
   status" for the full picture):
     ✅ Login / Logout / JWT session
     ✅ Users & Roles management (Users page)
     ✅ Change Password
     ✅ Full read-side data load from the database on login, so the
        Dashboard (and every other page, as a side-effect) shows real
        MySQL-backed numbers instead of the old hard-coded seed data.
     ✅ Role permissions are read from the backend's response
        (user.perms), not just the local ROLES table — so a change to
        a role's permissions on the server takes effect immediately.

   NOT yet in scope (still local-only / in-memory until their own
   integration pass — see README):
     ⏳ Students / Fees / Transport / Fines / Salaries / Expenses /
        Budget "Add / Edit / Delete" forms still only mutate the local
        D object in this pass. They are NOT persisted to the database
        yet. Refreshing the page will reload the real DB data and
        discard any such local-only change — exactly like the old
        localStorage version behaved before its own data was wiped,
        just now backed by a database rather than the browser.

   This file is loaded AFTER script.js. It works by re-declaring a
   handful of the same top-level `function name(){...}` names
   (doLogin, doLogout, doChangePassword, saveUser, delUser, ...) —
   in plain JavaScript the later script's function declaration simply
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
    _pk: s.id, // backend numeric primary key — kept for future write calls
  };
}

function apiFeeToD(f, rollByPk) {
  return {
    feeId: f.fee_id, student: f.student_name, roll: rollByPk[f.student] || '',
    sem: f.semester, amt: Number(f.amount) || 0, paidAmt: Number(f.paid_amount) || 0,
    date: f.paid_date || '-', method: f.method || '-', receipt: f.receipt_no || '-',
    status: f.status, dueDate: f.due_date || '', category: f.category,
    _pk: f.id,
  };
}

function apiFeePaymentsToD(fee, feeId, roll) {
  return (fee.payments || []).map(p => ({
    feeId, roll, date: p.date, amount: Number(p.amount) || 0,
  }));
}

function apiTransportFeeToD(t, rollByPk) {
  return {
    tfId: t.tf_id, student: t.student_name, roll: rollByPk[t.student] || '',
    route: t.route_name || '', routeId: t.route,
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
    year: '2024-25', _pk: e.id,
  };
}

function apiBudgetToD(b, catNameById) {
  return {
    dept: b.department, allocated: Number(b.allocated) || 0, spent: Number(b.spent) || 0,
    expCats: (b.expense_categories || []).map(id => catNameById[id]).filter(Boolean),
    year: '2024-25', _pk: b.id,
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
  const [studentsRaw, employeesRaw, classesRaw, routesRaw, catsRaw, settingsRaw] = await Promise.all([
    fetchAllPages('/academics/students/'),
    fetchAllPages('/hr/employees/'),
    fetchAllPages('/academics/classes/'),
    fetchAllPages('/finance/routes/'),
    fetchAllPages('/finance/expense-categories/'),
    apiFetch('/finance/settings/'),
  ]);

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

  const fees = feesRaw.map(f => apiFeeToD(f, rollByStudentPk));
  const feePayments = [];
  feesRaw.forEach((f, i) => { feePayments.push(...apiFeePaymentsToD(f, fees[i].feeId, fees[i].roll)); });

  D.students = students;
  D.employees = employeesRaw.map(apiEmployeeToD);
  D.classes = classesRaw.map(apiClassToD);
  D.departments = [...new Set(D.employees.map(e => e.dept).filter(Boolean))];
  D.fees = fees;
  D.feePayments = feePayments;
  D.transportFees = tfRaw.map(t => apiTransportFeeToD(t, rollByStudentPk));
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
