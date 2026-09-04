const { JSDOM } = require('jsdom');
const fs = require('fs');

const FRONTEND = '/home/claude/fullstack/frontend';
const html = fs.readFileSync(FRONTEND + '/index.html', 'utf8');
const scriptJs = fs.readFileSync(FRONTEND + '/script.js', 'utf8');
const apiJs = fs.readFileSync(FRONTEND + '/api.js', 'utf8');

// Chart.js is loaded from a CDN in index.html <head> — stub it out since
// jsdom has no network/canvas; mkChart() in script.js just calls `new Chart(...)`.
global.fetch = fetch; // Node 22 has a global fetch already, but be explicit inside jsdom realm too.

async function run() {
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:8099/',
    runScripts: 'outside-only',
    resources: undefined,
    pretendToBeVisual: false,
  });
  const { window } = dom;
  window.CT_API_BASE = 'http://127.0.0.1:8020/api';
  window.Chart = function () { return { destroy(){}, update(){} }; }; // minimal stub
  window.fetch = fetch;
  window.sessionStorage.clear();

  const log = [];
  window.console.log = (...a) => log.push(a.join(' '));
  window.console.warn = (...a) => log.push('WARN: ' + a.join(' '));
  window.console.error = (...a) => log.push('ERROR: ' + a.join(' '));

  const results = { pass: [], fail: [] };
  const check = (name, cond, detail) => {
    if (cond) results.pass.push(name);
    else results.fail.push(name + (detail ? ' :: ' + detail : ''));
  };

  try {
    dom.window.eval(
      scriptJs + '\n;\n' + apiJs +
      "\n;\nwindow.__t = { get SESSION(){return SESSION;}, get D(){return D;}, get USERS(){return USERS;}, get AUDIT(){return AUDIT;} };\n"
    );
  } catch (e) {
    check('script.js + api.js load without throwing', false, e.stack);
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  check('script.js + api.js load without throwing', true);

  const w = dom.window;

  // ── TEST 1: bad login shows error, does not open app ──
  w.document.getElementById('uid').value = 'admin';
  w.document.getElementById('upass').value = 'WRONGPASS';
  await w.doLogin();
  check('T1 wrong password shows loginErr', w.document.getElementById('loginErr').style.display === 'flex');
  check('T1 app stays hidden on failed login', w.document.getElementById('app').style.display !== 'flex');

  // ── TEST 2: correct admin login ──
  w.document.getElementById('uid').value = 'admin';
  w.document.getElementById('upass').value = 'admin123';
  await w.doLogin();
  check('T2 app visible after correct login', w.document.getElementById('app').style.display === 'flex');
  check('T2 SESSION.user set', w.__t.SESSION.user && w.__t.SESSION.user.id === 'admin');
  check('T2 SESSION.user.role is admin', w.__t.SESSION.user.role === 'admin');
  check('T2 perms.canManageUsers true for admin', w.__t.SESSION.user.perms.canManageUsers === true);
  check('T2 access token stored', !!w.sessionStorage.getItem('ct_access'));

  // ── TEST 3: real DB data loaded into D (not the old hardcoded seed) ──
  check('T3 D.students loaded from API (8 seeded)', w.__t.D.students.length === 8, 'got ' + w.__t.D.students.length);
  check('T3 a known seeded student present', w.__t.D.students.some(s => s.name === 'Noman Arshad'));
  check('T3 D.fees loaded (10 seeded)', w.__t.D.fees.length === 10, 'got ' + w.__t.D.fees.length);
  check('T3 D.employees loaded (5 seeded)', w.__t.D.employees.length === 5, 'got ' + w.__t.D.employees.length);
  check('T3 D.settings.instName from DB', w.__t.D.settings.instName === 'Superior College');
  check('T3 fee has real fee_id from backend', w.__t.D.fees[0].feeId && w.__t.D.fees[0].feeId.startsWith('F-'));

  // ── TEST 4: dashboard renders using the loaded data, numbers reconcile with backend ──
  w.rDash();
  const dbTotEl = w.document.getElementById('db-s');
  check('T4 dashboard student count matches D.students', dbTotEl && dbTotEl.textContent === String(w.__t.D.students.length));

  // Cross-check against the backend's OWN authoritative dashboard endpoint.
  const backendDash = await (await fetch('http://127.0.0.1:8020/api/finance/dashboard/', {
    headers: { Authorization: 'Bearer ' + w.sessionStorage.getItem('ct_access') },
  })).json();
  // Frontend fPaid = fee paid amounts + transport fee paid amounts (all-time)
  const feePaid = w.__t.D.fees.reduce((a, f) => a + w.feePaidAmt(f), 0) + w.__t.D.transportFees.reduce((a, t) => a + w.tfPaidAmt(t), 0);
  check(
    'T4 frontend total collected matches backend dashboard total_income',
    Math.abs(feePaid - backendDash.total_income) < 0.01,
    `frontend=${feePaid} backend=${backendDash.total_income}`
  );

  // ── TEST 5: Users page — real users loaded from DB, role-based UI ──
  w.rUsers();
  check('T5 USERS loaded from API (3 seed accounts present)',
    ['admin', 'accountant', 'viewer'].every(id => w.__t.USERS.some(u => u.id === id)),
    'got ids: ' + w.__t.USERS.map(u => u.id).join(','));
  check('T5 admin can manage users (UI)', w.hasPerm('canManageUsers') === true);
  const usersListHtml = w.document.getElementById('users-list').innerHTML;
  check('T5 users list renders accountant', usersListHtml.includes('Razia Sultana'));

  // ── TEST 6: create a new user via the real API, verify it round-trips ──
  w.document.getElementById('editUserIdx').value = '-1';
  w.document.getElementById('u-username').value = 'testclerk';
  w.document.getElementById('u-fullname').value = 'Test Clerk';
  w.document.getElementById('u-pass').value = 'TestPass123';
  // populateRoleSelect() builds <option> from ROLES; u-role select needs a value
  w.populateRoleSelect('viewer');
  w.document.getElementById('u-role').value = 'viewer';
  await w.saveUser();
  check('T6 new user appears in USERS after save', w.__t.USERS.some(u => u.id === 'testclerk'));

  // Verify it actually landed in the database (not just local state) by
  // fetching /api/users/ fresh with a brand-new request.
  const usersFromDb = await (await fetch('http://127.0.0.1:8020/api/users/', {
    headers: { Authorization: 'Bearer ' + w.sessionStorage.getItem('ct_access') },
  })).json();
  check('T6 new user persisted server-side', usersFromDb.results.some(u => u.username === 'testclerk'));

  // ── TEST 7: log out, then log back in as viewer — role restrictions enforced server-side ──
  await w.doLogout();
  check('T7 loginPage visible after logout', w.document.getElementById('loginPage').style.display === 'flex');
  check('T7 tokens cleared after logout', !w.sessionStorage.getItem('ct_access'));

  // Verify the logout event actually landed in the DB, using a throwaway
  // direct admin login (NOT via w.doLogin(), so it doesn't disturb SESSION/
  // AUDIT state) — Viewer is *correctly* forbidden from GET /audit-log/
  // (can_view_audit=false), so this must be checked before switching roles,
  // not after, or a 403-and-not-refetch is indistinguishable from a bug.
  {
    const adminRelogin = await (await fetch('http://127.0.0.1:8020/api/auth/login/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })).json();
    const auditAsAdmin = await (await fetch('http://127.0.0.1:8020/api/audit-log/?action=logout', {
      headers: { Authorization: 'Bearer ' + adminRelogin.access },
    })).json();
    check('T7b logout event persisted server-side (checked as admin)', auditAsAdmin.count > 0, 'count=' + auditAsAdmin.count);
  }

  w.document.getElementById('uid').value = 'viewer';
  w.document.getElementById('upass').value = 'view123';
  await w.doLogin();
  check('T7 viewer login succeeds', w.__t.SESSION.user && w.__t.SESSION.user.role === 'viewer');
  check('T7 viewer has canEdit=false (server authoritative)', w.__t.SESSION.user.perms.canEdit === false);
  check('T7 hasPerm canEdit false for viewer', w.hasPerm('canEdit') === false);

  // Viewer must NOT be able to manage users even if the button were clicked —
  // requirePerm() should block it client-side, AND the server must also 403 it.
  const viewerToast = [];
  const origToast = w.toast;
  w.toast = (msg) => viewerToast.push(msg);
  w.openAddUser(); // requirePerm('canManageUsers', ...) should block this
  check('T7 viewer blocked from opening Add User (client-side)', viewerToast.some(m => m.includes('🔒')));
  w.toast = origToast;

  let viewerServerBlocked = false;
  try {
    await fetch('http://127.0.0.1:8020/api/users/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + w.sessionStorage.getItem('ct_access') },
      body: JSON.stringify({ username: 'hacker', full_name: 'x', role: 'admin', password: 'Whatever123' }),
    }).then(r => { viewerServerBlocked = r.status === 403; });
  } catch (e) {}
  check('T7 viewer blocked from creating user (server-side, 403)', viewerServerBlocked === true);

  // ── TEST 8: audit log reflects real login/logout/user-mgmt events from DB ──
  // Switch to accountant (can_view_audit=true) — Viewer correctly cannot see
  // this page at all, so it can't be used to check the log's contents.
  await w.doLogout();
  w.document.getElementById('uid').value = 'accountant';
  w.document.getElementById('upass').value = 'acc123';
  await w.doLogin();
  check('T8 accountant login succeeds', w.__t.SESSION.user && w.__t.SESSION.user.role === 'accountant');
  await w.loadAuditLogFromAPI();
  check('T8 audit log has entries', w.__t.AUDIT.length > 0, 'got ' + w.__t.AUDIT.length);
  check('T8 audit log contains a login event', w.__t.AUDIT.some(a => a.type === 'login'));
  check('T8 audit log contains a logout event', w.__t.AUDIT.some(a => a.type === 'logout'));

  // ── Cleanup: remove the test user this run created, so re-running this
  // suite against the same persistent database stays repeatable. ──
  try {
    const adminRelogin2 = await (await fetch('http://127.0.0.1:8020/api/auth/login/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })).json();
    const usersNow = await (await fetch('http://127.0.0.1:8020/api/users/', {
      headers: { Authorization: 'Bearer ' + adminRelogin2.access },
    })).json();
    const clerk = usersNow.results.find(u => u.username === 'testclerk');
    if (clerk) {
      await fetch('http://127.0.0.1:8020/api/users/' + clerk.id + '/', {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + adminRelogin2.access },
      });
    }
  } catch (e) { console.warn('cleanup failed (non-fatal):', e); }

  // ── Summary ──
  console.log('\n=== RESULTS ===');
  console.log('PASS:', results.pass.length);
  results.pass.forEach(p => console.log('  ✅', p));
  console.log('FAIL:', results.fail.length);
  results.fail.forEach(p => console.log('  ❌', p));

  if (results.fail.length > 0) process.exitCode = 1;
}

run().catch(e => { console.error('FATAL', e); process.exitCode = 1; });
