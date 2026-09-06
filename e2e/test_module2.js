const { JSDOM } = require('jsdom');
const fs = require('fs');

const FRONTEND = '/home/claude/fullstack/frontend';
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
  const adminTok = await apiLogin('admin', 'admin123');

  // ── Log in as admin through the real UI flow ──
  $('uid').value = 'admin';
  $('upass').value = 'admin123';
  await w.doLogin();
  check('login as admin succeeds', w.__t.SESSION.user && w.__t.SESSION.user.role === 'admin');

  // ═══════════════════════════════════════════════════════════════════
  // T1 — Add Student WITH a 20% Merit scholarship + a single (full) fee
  // ═══════════════════════════════════════════════════════════════════
  w.openAddStu();
  $('sn').value = 'E2E ScholarStudent';
  $('sfn').value = 'E2E Father';
  $('sr').value = 'E2E-SCH-' + Date.now();
  $('sc').value = '0300-1112222';
  $('sadr').value = 'Test Address';
  $('sgender').value = 'Female';
  w.onStuGenderChange();
  $('ssec').value = 'A';
  $('sfa').value = '20000';
  $('s-schtype').value = 'Merit';
  $('s-schmode').value = 'percent';
  $('s-schval').value = '20';
  w.onStuScholarshipChange();
  $('s-ftype').value = 'full';
  const rollSch = $('sr').value;

  await w.saveStu();
  const stuSch = w.__t.D.students.find(s => s.roll === rollSch);
  check('T1 student created and present in D.students', !!stuSch, rollSch);
  check('T1 scholarship fields persisted (schType=Merit, schVal=20)', stuSch && stuSch.schType === 'Merit' && Number(stuSch.schVal) === 20, stuSch);

  const feeSch = w.__t.D.fees.find(f => f.roll === rollSch);
  check('T1 exactly one fee auto-created', !!feeSch);
  check('T1 net fee = 20000 * 0.8 = 16000 (20% scholarship applied)', feeSch && feeSch.amt === 16000, feeSch && feeSch.amt);
  check('T1 scholarshipAmt = 4000', feeSch && feeSch.scholarshipAmt === 4000, feeSch && feeSch.scholarshipAmt);
  check('T1 grossAmt = 20000', feeSch && feeSch.grossAmt === 20000, feeSch && feeSch.grossAmt);
  check('T1 status Pending (nothing paid, due date is future)', feeSch && feeSch.status === 'Pending', feeSch && feeSch.status);

  // Cross-check directly against the backend, independent of the frontend's own mapping
  const beFeeSch = await apiGet(`/finance/fees/?student=${stuSch._pk}`, adminTok);
  check('T1 backend independently confirms net amount 16000', beFeeSch.body.results[0] && Number(beFeeSch.body.results[0].amount) === 16000, beFeeSch.body);

  // ═══════════════════════════════════════════════════════════════════
  // T2 — Add Student with an INSTALMENT fee plan at admission (no scholarship)
  // ═══════════════════════════════════════════════════════════════════
  w.openAddStu();
  const rollInst = 'E2E-INST-' + Date.now();
  $('sn').value = 'E2E InstStudent';
  $('sfn').value = 'E2E Father2';
  $('sr').value = rollInst;
  $('sgender').value = 'Male';
  w.onStuGenderChange();
  $('ssec').value = 'A';
  $('sfa').value = '30000';
  $('s-ftype').value = 'instalment';
  w.onStuFeeTypeChange('instalment');
  $('s-finst-count').value = '3';

  await w.saveStu();
  const instFees = w.__t.D.fees.filter(f => f.roll === rollInst).sort((a, b) => a.instIdx - b.instIdx);
  check('T2 3 instalment fees created', instFees.length === 3, instFees.length);
  const instSum = instFees.reduce((s, f) => s + f.amt, 0);
  check('T2 instalments sum to gross (30000, no scholarship)', instSum === 30000, instSum);
  check('T2 all share the same planId', instFees.every(f => f.planId === instFees[0].planId));
  check('T2 instParts sequential (1/3, 2/3, 3/3)', instFees.map(f => f.instPart).join(',') === '1/3,2/3,3/3', instFees.map(f => f.instPart));
  check('T2 instTotal consistent across all rows', instFees.every(f => f.instTotal === 30000), instFees.map(f => f.instTotal));

  // ═══════════════════════════════════════════════════════════════════
  // T3 — Instalment order enforcement: pay #2 before #1 must be blocked
  // ═══════════════════════════════════════════════════════════════════
  const idx2 = w.__t.D.fees.findIndex(x => x._pk === instFees[1]._pk);
  w.openEditFee(idx2);
  $('fPayNow').value = '1000'; $('fpm').value = 'Cash'; $('frc').value = '';
  await w.saveFee();
  const stillUnpaid2 = w.__t.D.fees.find(f => f._pk === instFees[1]._pk);
  check('T3 instalment 2 payment blocked client-side before instalment 1 is paid', stillUnpaid2.paidAmt === 0, stillUnpaid2.paidAmt);
  // Also confirm directly against the backend (in case the client guard were ever bypassed)
  const be2 = await apiGet(`/finance/fees/${instFees[1]._pk}/`, adminTok);
  check('T3 backend also confirms instalment 2 has zero paid_amount', Number(be2.body.paid_amount) === 0, be2.body.paid_amount);

  // ═══════════════════════════════════════════════════════════════════
  // T4 — Partial payment on instalment 1, then complete it (multi-payment)
  // ═══════════════════════════════════════════════════════════════════
  const idx1 = w.__t.D.fees.findIndex(x => x._pk === instFees[0]._pk);
  const amt1 = instFees[0].amt;
  w.openEditFee(idx1);
  $('fPayNow').value = String(Math.floor(amt1 / 2));
  $('fpm').value = 'Cash'; $('frc').value = 'E2E-R1';
  await w.saveFee();
  let f1 = w.__t.D.fees.find(f => f._pk === instFees[0]._pk);
  check('T4 partial payment recorded (status Partial)', f1.status === 'Partial', f1.status);
  check('T4 paidAmt = half', f1.paidAmt === Math.floor(amt1 / 2), f1.paidAmt);

  w.openEditFee(w.__t.D.fees.findIndex(x => x._pk === f1._pk));
  $('fPayNow').value = String(amt1 - Math.floor(amt1 / 2));
  $('fpm').value = 'Online'; $('frc').value = 'E2E-R2';
  await w.saveFee();
  f1 = w.__t.D.fees.find(f => f._pk === instFees[0]._pk);
  check('T4 second payment completes it (status Paid)', f1.status === 'Paid', f1.status);
  const paymentsForF1 = w.__t.D.feePayments.filter(p => p.feeId === f1.feeId);
  check('T4 TWO payment history entries recorded', paymentsForF1.length === 2, paymentsForF1.length);

  // Now instalment 2 should be payable
  const idx2b = w.__t.D.fees.findIndex(x => x._pk === instFees[1]._pk);
  w.openEditFee(idx2b);
  $('fPayNow').value = String(instFees[1].amt);
  $('fpm').value = 'Cash'; $('frc').value = 'E2E-R3';
  await w.saveFee();
  const f2 = w.__t.D.fees.find(f => f._pk === instFees[1]._pk);
  check('T4 instalment 2 now payable and fully paid', f2.status === 'Paid', f2.status);

  // ═══════════════════════════════════════════════════════════════════
  // T5 — Overpayment rejected server-side (the safety net BEHIND the UI).
  // Note: the UI itself (saveFee) deliberately clamps an over-typed amount
  // down to the exact remaining balance before ever calling the API — see
  // saveFee()'s `payNow = Math.max(0, Math.min(payNow, f.amt - already))`.
  // That clamp is correct, expected UX (typing "too much" just pays what's
  // owed, it doesn't error). So a real overpayment attempt can only reach
  // the server's own guard via a direct call, e.g. a raw API request that
  // bypasses the UI entirely — which is exactly what this checks.
  // ═══════════════════════════════════════════════════════════════════
  const idx3 = w.__t.D.fees.findIndex(x => x._pk === instFees[2]._pk);
  const fee3 = w.__t.D.fees[idx3];
  const directOverpay = await fetch(API + `/finance/fees/${fee3._pk}/record-payment/`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + adminTok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: fee3.amt + 99999, date: '2026-09-05', method: 'Cash' }),
  });
  check('T5 direct overpayment beyond remaining balance rejected (400)', directOverpay.status === 400, directOverpay.status);
  const be3 = await apiGet(`/finance/fees/${fee3._pk}/`, adminTok);
  check('T5 paid_amount unchanged after rejected overpayment', Number(be3.body.paid_amount) === 0, be3.body.paid_amount);

  // Now pay instalment 3 for real (a normal, in-order, exact payment) so the
  // whole plan is fully settled before the T8 ledger check below.
  w.openEditFee(idx3);
  $('fPayNow').value = String(fee3.amt);
  $('fpm').value = 'Cash'; $('frc').value = 'E2E-R4';
  await w.saveFee();
  const fee3b = w.__t.D.fees.find(x => x._pk === fee3._pk);
  check('T5 instalment 3 fully paid via the normal UI flow', fee3b.status === 'Paid', fee3b.status);

  // ═══════════════════════════════════════════════════════════════════
  // T6 — Overdue status (past due date, unpaid) then Partial-Overdue
  // ═══════════════════════════════════════════════════════════════════
  w.openAddStu();
  const rollOverdue = 'E2E-OVERDUE-' + Date.now();
  $('sn').value = 'E2E OverdueStudent'; $('sr').value = rollOverdue;
  $('sgender').value = 'Male'; w.onStuGenderChange(); $('ssec').value = 'A';
  $('sfa').value = '5000';
  $('s-fdue').value = '2020-01-01'; // force overdue
  $('s-ftype').value = 'full';
  await w.saveStu();
  let feeOverdue = w.__t.D.fees.find(f => f.roll === rollOverdue);
  check('T6 status Overdue (past due date, nothing paid)', feeOverdue.status === 'Overdue', feeOverdue.status);

  const idxOD = w.__t.D.fees.findIndex(x => x._pk === feeOverdue._pk);
  w.openEditFee(idxOD);
  $('fst').value = 'Partial';
  $('fPayNow').value = '1000'; $('fpm').value = 'Cash'; $('frc').value = '';
  await w.saveFee();
  feeOverdue = w.__t.D.fees.find(f => f._pk === feeOverdue._pk);
  check('T6 partial payment on overdue fee -> Partial-Overdue', feeOverdue.status === 'Partial-Overdue', feeOverdue.status);

  // ═══════════════════════════════════════════════════════════════════
  // T7 — Custom (uneven) instalment plan via Fee Management + concession
  // ═══════════════════════════════════════════════════════════════════
  w.openAddStu();
  const rollCustom = 'E2E-CUSTOM-' + Date.now();
  $('sn').value = 'E2E CustomPlan'; $('sr').value = rollCustom;
  $('sgender').value = 'Female'; w.onStuGenderChange(); $('ssec').value = 'A';
  $('sfa').value = '10000'; $('s-ftype').value = 'full'; $('s-fdue').value = '2026-12-01';
  await w.saveStu();
  // Delete the auto-created single fee first, then build a custom plan in its place
  const autoFee = w.__t.D.fees.find(f => f.roll === rollCustom);
  const autoFeeIdx = w.__t.D.fees.findIndex(x => x._pk === autoFee._pk);
  await w.delFee(autoFeeIdx);
  check('T7 auto-created fee removed before custom plan', !w.__t.D.fees.some(f => f.roll === rollCustom));

  w.openAddFee();
  w.feeSelectStu(rollCustom);
  $('fa').value = '10000';
  $('fConc').value = '500';
  $('fConcReason').value = 'E2E sibling waiver';
  $('fsm').value = w.__t.D.students.find(s => s.roll === rollCustom).sem;
  $('fInstCount').value = '2';
  w.feeStep(3); // generates fInstAmt0/1 + fInstDate0/1 with equal-split defaults
  // Net payable = 10000 - 500 = 9500. Make it a CUSTOM uneven split: 6000 + 3500.
  $('fInstAmt0').value = '6000';
  $('fInstAmt1').value = '3500';
  $('fInstDate0').value = '2026-11-01';
  $('fInstDate1').value = '2027-01-01';
  await w.saveFeeInstalments();

  const customFees = w.__t.D.fees.filter(f => f.roll === rollCustom).sort((a, b) => a.instIdx - b.instIdx);
  check('T7 2 custom instalments created', customFees.length === 2, customFees.length);
  check('T7 uneven split preserved (6000 / 3500)', customFees[0] && customFees[0].amt === 6000 && customFees[1].amt === 3500, customFees.map(f => f.amt));
  check('T7 concession recorded on the plan', customFees[0] && customFees[0].concessionAmt + customFees[1].concessionAmt === 500, customFees.map(f => f.concessionAmt));

  // ═══════════════════════════════════════════════════════════════════
  // T8 — Student ledger / payment history via backend (feeLedgerData proxy)
  // ═══════════════════════════════════════════════════════════════════
  const ledgerResp = await apiGet(`/finance/fees/student-ledger/?student=${w.__t.D.students.find(s => s.roll === rollInst)._pk}`, adminTok);
  check('T8 student-ledger endpoint reachable', ledgerResp.status === 200, ledgerResp.status);
  check('T8 ledger paid_amount reflects all 3 completed instalments (30000)', Number(ledgerResp.body.summary.paid_amount) === 30000, ledgerResp.body.summary);

  // ═══════════════════════════════════════════════════════════════════
  // T9 — Delete fee record, then delete student (cascade)
  // ═══════════════════════════════════════════════════════════════════
  const delTargetFee = w.__t.D.fees.find(f => f.roll === rollOverdue);
  const delTargetFeeIdx = w.__t.D.fees.findIndex(x => x._pk === delTargetFee._pk);
  await w.delFee(delTargetFeeIdx);
  check('T9 fee removed from D.fees after delete', !w.__t.D.fees.some(f => f.roll === rollOverdue));
  const beFeeGone = await apiGet(`/finance/fees/${delTargetFee._pk}/`, adminTok);
  check('T9 fee gone server-side too (404)', beFeeGone.status === 404, beFeeGone.status);

  const delStudent = w.__t.D.students.find(s => s.roll === rollOverdue);
  const delStudentIdx = w.__t.D.students.findIndex(x => x._pk === delStudent._pk);
  await w.delStu(delStudentIdx);
  check('T9 student removed from D.students', !w.__t.D.students.some(s => s.roll === rollOverdue));

  // ═══════════════════════════════════════════════════════════════════
  // T10 — Permissions: Viewer blocked, Accountant can edit but not delete student
  // ═══════════════════════════════════════════════════════════════════
  $('uid').value = 'viewer'; $('upass').value = 'view123';
  await w.doLogin();
  const beforeCount = w.__t.D.students.length;
  w.openAddStu();
  $('sn').value = 'Hacker'; $('sr').value = 'HACK-E2E-' + Date.now(); $('sfa').value = '1000';
  await w.saveStu();
  check('T10 viewer blocked from creating student (client-side, no API call)', w.__t.D.students.length === beforeCount, [beforeCount, w.__t.D.students.length]);
  const vTok = await apiLogin('viewer', 'view123');
  const vAttempt = await fetch(API + '/academics/students/', { method: 'POST', headers: { Authorization: 'Bearer ' + vTok, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', roll_no: 'HACK-DIRECT-' + Date.now(), gender: 'Male', default_fee: 1 }) });
  check('T10 viewer blocked server-side too (403) even bypassing the UI', vAttempt.status === 403, vAttempt.status);

  $('uid').value = 'accountant'; $('upass').value = 'acc123';
  await w.doLogin();
  w.openAddStu();
  const rollAcc = 'E2E-ACC-' + Date.now();
  $('sn').value = 'E2E AccStudent'; $('sr').value = rollAcc; $('sgender').value = 'Male';
  w.onStuGenderChange(); $('ssec').value = 'A'; $('sfa').value = '5000'; $('s-ftype').value = 'full';
  await w.saveStu();
  const accStu = w.__t.D.students.find(s => s.roll === rollAcc);
  check('T10 accountant CAN create a student', !!accStu, rollAcc);
  const accStuIdx = w.__t.D.students.findIndex(x => x._pk === accStu._pk);
  await w.delStu(accStuIdx);
  check('T10 accountant CANNOT delete a student (still present)', w.__t.D.students.some(s => s.roll === rollAcc));

  // ═══════════════════════════════════════════════════════════════════
  // T11 — Dashboard / transaction totals reconcile with backend
  // ═══════════════════════════════════════════════════════════════════
  $('uid').value = 'admin'; $('upass').value = 'admin123';
  await w.doLogin();
  w.buildTx(); w.rDash();
  const dashResp = await apiGet('/finance/dashboard/', adminTok);
  const frontendTotalPaid = w.__t.D.fees.reduce((s, f) => s + (f.paidAmt || 0), 0)
    + w.__t.D.transportFees.reduce((s, f) => s + (f.paidAmt || 0), 0);
  check('T11 frontend total paid matches backend dashboard total_income',
    Math.abs(frontendTotalPaid - dashResp.body.total_income) < 1,
    { frontend: frontendTotalPaid, backend: dashResp.body.total_income });

  // ── Cleanup: remove E2E-created students so this suite is re-runnable ──
  try {
    const cleanupTok = await apiLogin('admin', 'admin123');
    const all = await apiGet('/academics/students/?search=E2E', cleanupTok);
    for (const s of (all.body.results || [])) {
      if (s.roll_no && s.roll_no.startsWith('E2E-')) {
        await fetch(API + `/academics/students/${s.id}/`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + cleanupTok } });
      }
    }
  } catch (e) { console.warn('cleanup failed (non-fatal):', e); }

  // ── Summary ──
  console.log('\n=== MODULE 2 RESULTS ===');
  console.log('PASS:', results.pass.length);
  results.pass.forEach(p => console.log('  ✅', p));
  console.log('FAIL:', results.fail.length);
  results.fail.forEach(f => console.log('  ❌', f));
  return results;
}

run().then(r => { process.exit(r && r.fail.length ? 1 : 0); }).catch(e => { console.error('FATAL', e); process.exit(1); });
