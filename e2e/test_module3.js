const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Resolved relative to this file (not hard-coded to a sandbox path) so this
// test can actually be run wherever the project was cloned/extracted.
const FRONTEND = path.join(__dirname, '..', 'frontend');
const html = fs.readFileSync(FRONTEND + '/index.html', 'utf8');
const scriptJs = fs.readFileSync(FRONTEND + '/script.js', 'utf8');
const apiJs = fs.readFileSync(FRONTEND + '/api.js', 'utf8');

global.fetch = fetch;
const API = 'http://127.0.0.1:8020/api';

async function run() {
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:8099/',
    runScripts: 'outside-only',
    resources: undefined,
    pretendToBeVisual: false,
  });
  const { window } = dom;
  window.CT_API_BASE = API;
  window.Chart = function () { return { destroy(){}, update(){} }; };
  window.fetch = fetch;
  window.sessionStorage.clear();
  window.confirm = () => true; // auto-confirm delete dialogs
  window.print = () => {}; // printReceipt/printVoucher call window.print()

  const log = [];
  window.console.log = (...a) => log.push(a.join(' '));
  window.console.warn = (...a) => log.push('WARN: ' + a.join(' '));
  window.console.error = (...a) => log.push('ERROR: ' + a.join(' '));

  const results = { pass: [], fail: [] };
  const check = (name, cond, detail) => {
    if (cond) results.pass.push(name);
    else results.fail.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
  };

  try {
    dom.window.eval(
      scriptJs + '\n;\n' + apiJs +
      "\n;\nwindow.__t = { get SESSION(){return SESSION;}, get D(){return D;} };\n"
    );
  } catch (e) {
    check('script.js + api.js load without throwing', false, e.stack);
    console.log(JSON.stringify(results, null, 2));
    return results;
  }
  check('script.js + api.js load without throwing', true);

  const w = dom.window;
  const doc = w.document;
  const $ = (id) => doc.getElementById(id);

  // ── Direct backend helpers, for cross-checking independent of the UI ──
  async function apiLogin(u, p) {
    const r = await fetch(API + '/auth/login/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    return (await r.json()).access;
  }
  async function apiGet(path, token) {
    const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
    return { status: r.status, body: await r.json() };
  }
  async function apiPost(path, body, token, method = 'POST') {
    const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, body: json };
  }
  const adminTok = await apiLogin('admin', 'admin123');

  // ── Log in as admin through the real UI flow ──
  $('uid').value = 'admin';
  $('upass').value = 'admin123';
  await w.doLogin();
  check('login as admin succeeds', w.__t.SESSION.user && w.__t.SESSION.user.role === 'admin');

  const stamp = Date.now();

  // ═══════════════════════════════════════════════════════════════════
  // T1 — Route Master: add, edit, and confirm it feeds the Transport Fee
  // route dropdown
  // ═══════════════════════════════════════════════════════════════════
  w.openAddRoute();
  const routeName = 'E2E Route ' + stamp;
  $('rt-name').value = routeName;
  $('rt-vehicle').value = 'LEA-' + stamp;
  $('rt-driver').value = 'E2E Driver';
  $('rt-phone').value = '0300-0000000';
  $('rt-capacity').value = '35';
  $('rt-fee').value = '2500';
  $('rt-status').value = 'Active';
  await w.saveRoute();
  const route = w.__t.D.routes.find(r => r.name === routeName);
  check('T1 route created and present in D.routes', !!route, routeName);
  check('T1 route_id auto-generated (RT-*)', route && /^RT-/.test(route.routeId), route && route.routeId);

  const routeIdxForEdit = w.__t.D.routes.findIndex(r => r._pk === route._pk);
  w.openEditRoute(routeIdxForEdit);
  $('rt-fee').value = '3000';
  await w.saveRoute();
  const routeEdited = w.__t.D.routes.find(r => r._pk === route._pk);
  check('T1 route edit persisted (monthlyFee=3000)', routeEdited && Number(routeEdited.monthlyFee) === 3000, routeEdited);
  const beRoute = await apiGet(`/finance/routes/${route._pk}/`, adminTok);
  check('T1 backend independently confirms monthly_fee=3000', Number(beRoute.body.monthly_fee) === 3000, beRoute.body);

  // ═══════════════════════════════════════════════════════════════════
  // T2 — Transport Fee: assign from Route Master, partial payment, then
  // fully paid, matching the Fee module's own partial-payment UX
  // ═══════════════════════════════════════════════════════════════════
  const stu = w.__t.D.students[0];
  w.openAddTransportFee();
  w.transportSelectStu(stu.roll);
  w.fillTfRouteDropdown();
  $('tf-route').value = route.routeId;
  w.tfRouteSelected(route.routeId);
  $('tf-due').value = '2026-12-15';
  $('tf-status').value = 'Pending';
  await w.saveTransportFee();
  let tf = w.__t.D.transportFees.find(t => t.roll === stu.roll && t.routeId === route.routeId);
  check('T2 transport fee created', !!tf, stu.roll);
  check('T2 tf_id auto-generated (TF-*)', tf && /^TF-/.test(tf.tfId), tf && tf.tfId);
  check('T2 amount picked up route\'s monthly fee (3000)', tf && Number(tf.amt) === 3000, tf && tf.amt);
  check('T2 status Pending (nothing paid, due date is future)', tf && tf.status === 'Pending', tf && tf.status);

  const tfIdx = w.__t.D.transportFees.findIndex(t => t._pk === tf._pk);
  w.openCollectTransportFee(tfIdx);
  $('ctf-amt').value = '1000';
  $('ctf-method').value = 'Cash';
  $('ctf-date').value = '2026-09-06';
  await w.saveCollectTransportFee();
  tf = w.__t.D.transportFees.find(t => t._pk === tf._pk);
  check('T2 partial payment recorded (status Partial)', tf.status === 'Partial', tf.status);
  check('T2 paidAmt = 1000', Number(tf.paidAmt) === 1000, tf.paidAmt);

  const tfIdx2 = w.__t.D.transportFees.findIndex(t => t._pk === tf._pk);
  w.openCollectTransportFee(tfIdx2);
  $('ctf-amt').value = '2000';
  $('ctf-date').value = '2026-09-06';
  await w.saveCollectTransportFee();
  tf = w.__t.D.transportFees.find(t => t._pk === tf._pk);
  check('T2 second payment completes it (status Paid)', tf.status === 'Paid', tf.status);
  check('T2 TWO payment history entries recorded', Array.isArray(tf.payments) && tf.payments.length === 2, tf.payments);

  // ═══════════════════════════════════════════════════════════════════
  // T3 — Boundary #2: a free-typed custom route (not from Route Master)
  // must be BLOCKED now that Transport Fee is database-backed, since the
  // backend has no free-text route field.
  // ═══════════════════════════════════════════════════════════════════
  const tfCountBefore = w.__t.D.transportFees.length;
  w.openAddTransportFee();
  w.transportSelectStu(stu.roll);
  $('tf-route').value = '__custom__';
  w.tfRouteSelected('__custom__');
  $('tf-route-custom').value = 'Some Custom Van';
  $('tf-amt').value = '1500';
  $('tf-due').value = '2026-12-15';
  await w.saveTransportFee();
  check('T3 custom (non-Route-Master) route is blocked, nothing created', w.__t.D.transportFees.length === tfCountBefore, w.__t.D.transportFees.length);

  // Clean up the transport fee record created in T2 before deleting its route.
  await w.delTransportFee(w.__t.D.transportFees.findIndex(t => t._pk === tf._pk));
  check('T2/T3 cleanup: transport fee removed', !w.__t.D.transportFees.some(t => t._pk === tf._pk));
  await w.delRoute(w.__t.D.routes.findIndex(r => r._pk === route._pk));
  check('T1 cleanup: route removed', !w.__t.D.routes.some(r => r._pk === route._pk));

  // ═══════════════════════════════════════════════════════════════════
  // T4 — Disciplinary Fines: add (Pending), mark Paid (local Fee auto-sync
  // boundary), then delete
  // ═══════════════════════════════════════════════════════════════════
  const stu2 = w.__t.D.students[1];
  w.openAddFine();
  w.fineSelectStu(stu2.roll);
  $('fn-reason').value = 'Uniform Violation';
  w.fineReasonChange('Uniform Violation');
  $('fn-amt').value = '750';
  $('fn-date').value = '2026-02-01';
  $('fn-status').value = 'Pending';
  await w.saveFine();
  let fine = w.__t.D.fines.find(f => f.roll === stu2.roll && f.amt === 750);
  check('T4 fine created', !!fine, stu2.roll);
  check('T4 fine_id auto-generated (FIN-*)', fine && /^FIN-/.test(fine.fineId), fine && fine.fineId);
  const beFine = await apiGet(`/finance/fines/?student=${stu2._pk}`, adminTok);
  check('T4 backend independently confirms the fine (Rs 750, Pending)', beFine.body.results.some(f => Number(f.amount) === 750 && f.status === 'Pending'), beFine.body);

  const fineIdx = w.__t.D.fines.findIndex(f => f._pk === fine._pk);
  await w.markFinePaid(fineIdx);
  fine = w.__t.D.fines.find(f => f._pk === fine._pk);
  check('T4 fine marked Paid', fine.status === 'Paid', fine.status);
  const beFine2 = await apiGet(`/finance/fines/${fine._pk}/`, adminTok);
  check('T4 backend confirms Paid too', beFine2.body.status === 'Paid', beFine2.body.status);
  // Boundary #1 — the auto-generated "Paid via fine" Fee row is LOCAL-ONLY.
  const linkedFee = w.__t.D.fees.find(f => f.linkedFineId === fine.fineId);
  check('T4 local Fee auto-created for the paid fine (documented local-only boundary)', !!linkedFee && linkedFee.status === 'Paid', linkedFee);

  await w.delFine(w.__t.D.fines.findIndex(f => f._pk === fine._pk));
  check('T4 fine removed from D.fines after delete', !w.__t.D.fines.some(f => f._pk === fine._pk));
  const beFineGone = await apiGet(`/finance/fines/${fine._pk}/`, adminTok);
  check('T4 fine gone server-side too (404)', beFineGone.status === 404, beFineGone.status);

  // ═══════════════════════════════════════════════════════════════════
  // T5 — Salaries: process, mark paid, duplicate (employee, month) rejected,
  // delete
  // ═══════════════════════════════════════════════════════════════════
  const emp = w.__t.D.employees[0];
  const salMonth = 'E2E Month ' + stamp;
  w.openAddSal();
  $('sln-sel').value = emp.name;
  w.salEmpSelected(emp.name);
  $('slb').value = '70000';
  $('sla').value = '10000';
  $('sld2').value = '5000';
  $('slm').value = salMonth;
  $('slst').value = 'Pending';
  await w.saveSal();
  let sal = w.__t.D.salaries.find(s => s.name === emp.name && s.month === salMonth);
  check('T5 salary created', !!sal, salMonth);
  check('T5 sal_id auto-generated (SAL-*)', sal && /^SAL-/.test(sal.salId), sal && sal.salId);
  check('T5 net pay = 70000+10000-5000 = 75000', sal && (Number(sal.basic) + Number(sal.allow) - Number(sal.deduct)) === 75000, sal);

  const salIdx = w.__t.D.salaries.findIndex(s => s._pk === sal._pk);
  await w.markSalPaid(salIdx);
  sal = w.__t.D.salaries.find(s => s._pk === sal._pk);
  check('T5 salary marked Paid', sal.status === 'Paid', sal.status);

  // Re-processing the same employee + month must be rejected server-side —
  // exercised directly since saveSal() has no client-side duplicate guard.
  const dupAttempt = await apiPost('/finance/salaries/', {
    employee: emp._pk, month: salMonth, basic: 1, allowance: 0, deduction: 0, status: 'Pending',
  }, adminTok);
  check('T5 duplicate (employee, month) rejected by backend (400)', dupAttempt.status === 400, dupAttempt.status);

  await w.delSal(w.__t.D.salaries.findIndex(s => s._pk === sal._pk));
  check('T5 salary removed from D.salaries after delete', !w.__t.D.salaries.some(s => s._pk === sal._pk));

  // ═══════════════════════════════════════════════════════════════════
  // T6 — Expense Categories + Expenses: add category, add expense, the
  // category-in-use delete guard, then real delete
  // ═══════════════════════════════════════════════════════════════════
  const catName = 'E2E Category ' + stamp;
  $('nc-name').value = catName;
  $('nc-icon').value = '🧪';
  await w.addExpCat();
  const cat = w.__t.D.expCategories.find(c => c.name === catName);
  check('T6 expense category created', !!cat, catName);

  w._syncCatDropdowns();
  $('xd').value = 'E2E Expense ' + stamp;
  $('xc').value = catName;
  $('xa').value = '4500';
  $('xv').value = 'E2E Vendor';
  $('xp').value = 'E2E Approver';
  $('xs').value = 'Approved';
  await w.saveExp();
  const exp = w.__t.D.expenses.find(e => e.desc === 'E2E Expense ' + stamp);
  check('T6 expense created', !!exp, exp);
  check('T6 expense linked to the right category', exp && exp.cat === catName, exp && exp.cat);
  check('T6 expense year matches D.activeYear (not hard-coded)', exp && exp.year === w.__t.D.activeYear, [exp && exp.year, w.__t.D.activeYear]);
  const beExp = await apiGet(`/finance/expenses/${exp._pk}/`, adminTok);
  check('T6 backend confirms academic_year_label matches', beExp.body.academic_year_label === w.__t.D.activeYear, beExp.body.academic_year_label);

  const catIdxInUse = w.__t.D.expCategories.findIndex(c => c._pk === cat._pk);
  await w.delExpCat(catIdxInUse);
  check('T6 category-in-use delete is blocked (still present)', w.__t.D.expCategories.some(c => c._pk === cat._pk));

  await w.delExp(w.__t.D.expenses.findIndex(e => e._pk === exp._pk));
  check('T6 expense removed after delete', !w.__t.D.expenses.some(e => e._pk === exp._pk));
  await w.delExpCat(w.__t.D.expCategories.findIndex(c => c._pk === cat._pk));
  check('T6 category removable once no longer in use', !w.__t.D.expCategories.some(c => c._pk === cat._pk));

  // ═══════════════════════════════════════════════════════════════════
  // T7 — Budget: add linked to a category, `spent` derives from a real
  // Expense in that category (never stored, can't drift), edit, delete
  // ═══════════════════════════════════════════════════════════════════
  const cat2Name = 'E2E BudCat ' + stamp;
  $('nc-name').value = cat2Name;
  $('nc-icon').value = '💰';
  await w.addExpCat();
  const cat2 = w.__t.D.expCategories.find(c => c.name === cat2Name);

  w._syncCatDropdowns();
  $('xd').value = 'E2E BudExpense ' + stamp;
  $('xc').value = cat2Name;
  $('xa').value = '8000';
  $('xv').value = '';
  $('xp').value = '';
  $('xs').value = 'Approved';
  await w.saveExp();
  const bexp = w.__t.D.expenses.find(e => e.desc === 'E2E BudExpense ' + stamp);
  check('T7 supporting expense created (Rs 8000)', !!bexp, bexp);

  const deptName = 'E2E Dept ' + stamp;
  w.openAddBud();
  $('bud-dept-input').value = deptName;
  $('bda').value = '50000';
  w.buildBudCatDropdown('');
  $('bud-cat-select').value = cat2Name;
  await w.saveBud();
  let bud = w.__t.D.budget.find(b => b.dept === deptName);
  check('T7 budget created', !!bud, deptName);
  check('T7 budget linked to the right category', bud && bud.expCats.includes(cat2Name), bud && bud.expCats);
  check('T7 spent derived from the linked expense (Rs 8000)', bud && Number(bud.spent) === 8000, bud && bud.spent);
  check('T7 budget year matches D.activeYear (not hard-coded)', bud && bud.year === w.__t.D.activeYear, [bud && bud.year, w.__t.D.activeYear]);

  const budIdx = w.__t.D.budget.findIndex(b => b._pk === bud._pk);
  w.editBud(budIdx);
  $('bda').value = '60000';
  await w.saveBud();
  bud = w.__t.D.budget.find(b => b._pk === bud._pk);
  check('T7 budget edit persisted (allocated=60000)', bud && Number(bud.allocated) === 60000, bud);

  await w.confirmDelBud(w.__t.D.budget.findIndex(b => b._pk === bud._pk));
  await $('delBud-confirm-btn').onclick(); // confirmDelBud only opens the confirm modal — this fires the actual delete
  check('T7 budget removed after delete', !w.__t.D.budget.some(b => b._pk === bud._pk));
  await w.delExp(w.__t.D.expenses.findIndex(e => e._pk === bexp._pk));
  await w.delExpCat(w.__t.D.expCategories.findIndex(c => c._pk === cat2._pk));
  check('T7 cleanup: supporting expense + category removed', !w.__t.D.expenses.some(e => e._pk === bexp._pk) && !w.__t.D.expCategories.some(c => c._pk === cat2._pk));

  // ═══════════════════════════════════════════════════════════════════
  // T8 — Permissions: Viewer blocked everywhere (client-side, no API call);
  // Accountant can create/edit/delete these five (all guard on 'canEdit'
  // in script.js, confirmed against the EditRolePermission fix server-side)
  // but NOT delete a Salary (that one really needs 'canDelete').
  // ═══════════════════════════════════════════════════════════════════
  $('uid').value = 'viewer'; $('upass').value = 'view123';
  await w.doLogin();
  const routeCountBeforeViewer = w.__t.D.routes.length;
  w.openAddRoute();
  $('rt-name').value = 'Hacker Route'; $('rt-fee').value = '1000';
  await w.saveRoute();
  check('T8 viewer blocked from creating a route (client-side, no API call)', w.__t.D.routes.length === routeCountBeforeViewer, [routeCountBeforeViewer, w.__t.D.routes.length]);
  const vTok = await apiLogin('viewer', 'view123');
  const vDirect = await apiPost('/finance/routes/', { name: 'Direct Hack Route', monthly_fee: 1000, status: 'Active' }, vTok);
  check('T8 viewer blocked server-side too (403) even bypassing the UI', vDirect.status === 403, vDirect.status);

  $('uid').value = 'accountant'; $('upass').value = 'acc123';
  await w.doLogin();

  w.openAddRoute();
  $('rt-name').value = 'E2E Acct Route ' + stamp; $('rt-fee').value = '1200';
  await w.saveRoute();
  const acctRoute = w.__t.D.routes.find(r => r.name === 'E2E Acct Route ' + stamp);
  check('T8 accountant CAN create a route', !!acctRoute, acctRoute);
  await w.delRoute(w.__t.D.routes.findIndex(r => r._pk === acctRoute._pk));
  check('T8 accountant CAN delete a route (canEdit, not canDelete)', !w.__t.D.routes.some(r => r._pk === acctRoute._pk));

  w.openAddSal();
  $('sln-sel').value = emp.name; w.salEmpSelected(emp.name);
  $('slb').value = '40000'; $('sla').value = '0'; $('sld2').value = '0';
  $('slm').value = 'E2E Acct Month ' + stamp; $('slst').value = 'Pending';
  await w.saveSal();
  const acctSal = w.__t.D.salaries.find(s => s.month === 'E2E Acct Month ' + stamp);
  check('T8 accountant CAN create a salary', !!acctSal, acctSal);
  const acctSalIdx = w.__t.D.salaries.findIndex(s => s._pk === acctSal._pk);
  await w.delSal(acctSalIdx);
  check('T8 accountant CANNOT delete a salary (still present, requires canDelete)', w.__t.D.salaries.some(s => s._pk === acctSal._pk));

  // ── Cleanup: remove anything E2E-created that survived (admin has full rights) ──
  $('uid').value = 'admin'; $('upass').value = 'admin123';
  await w.doLogin();
  try {
    const cleanupTok = await apiLogin('admin', 'admin123');
    for (const s of w.__t.D.salaries.filter(x => (x.month || '').startsWith('E2E'))) {
      await fetch(API + `/finance/salaries/${s._pk}/`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + cleanupTok } });
    }
    for (const r of w.__t.D.routes.filter(x => (x.name || '').startsWith('E2E'))) {
      await fetch(API + `/finance/routes/${r._pk}/`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + cleanupTok } });
    }
  } catch (e) { console.warn('cleanup failed (non-fatal):', e); }

  // ── Summary ──
  console.log('\n=== MODULE 3 RESULTS ===');
  console.log('PASS:', results.pass.length);
  results.pass.forEach(p => console.log('  ✅', p));
  console.log('FAIL:', results.fail.length);
  results.fail.forEach(f => console.log('  ❌', f));
  return results;
}

run().then(r => { process.exit(r && r.fail.length ? 1 : 0); }).catch(e => { console.error('FATAL', e); process.exit(1); });
