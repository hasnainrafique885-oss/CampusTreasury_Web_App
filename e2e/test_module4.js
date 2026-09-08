const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

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
  window.confirm = () => true;
  window.print = () => {};

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

  async function apiLogin(u, p) {
    const r = await fetch(API + '/auth/login/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
    return (await r.json()).access;
  }
  async function apiGet(p2, token) {
    const r = await fetch(API + p2, { headers: { Authorization: 'Bearer ' + token } });
    return { status: r.status, body: await r.json() };
  }
  async function apiPost(p2, body, token, method = 'POST') {
    const r = await fetch(API + p2, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, body: json };
  }
  const adminTok = await apiLogin('admin', 'admin123');
  const stamp = Date.now();

  // ── Log in as admin through the real UI flow ──
  $('uid').value = 'admin';
  $('upass').value = 'admin123';
  await w.doLogin();
  check('login as admin succeeds', w.__t.SESSION.user && w.__t.SESSION.user.role === 'admin');

  // ═══════════════════════════════════════════════════════════════════
  // T1 — Manual Transaction (Income): add, confirm it feeds D.tx via
  // buildTx(), confirm on the backend too, then delete
  // ═══════════════════════════════════════════════════════════════════
  const incDesc = 'E2E Donation ' + stamp;
  w.openAddTx();
  $('mtd').value = incDesc;
  $('mtt').value = 'Income';
  $('mta').value = '5000';
  $('mtdt').value = '2026-03-01';
  $('mtc').value = 'Donation';
  await w.saveManualTx();
  let m = w.__t.D.manualTx.find(x => x.desc === incDesc);
  check('T1 manual transaction created', !!m, incDesc);
  check('T1 id auto-generated (MAN-*)', m && /^MAN-/.test(m.id), m && m.id);
  check('T1 type Income, amount 5000, category Donation', m && m.type === 'Income' && Number(m.amt) === 5000 && m.cat === 'Donation', m);

  const beM = await apiGet(`/finance/manual-transactions/${m._pk}/`, adminTok);
  check('T1 backend independently confirms the record', beM.status === 200 && Number(beM.body.amount) === 5000 && beM.body.type === 'Income', beM.body);

  check('T1 shows up in D.tx (buildTx merged it)', w.__t.D.tx.some(t => t.id === m.id && t.desc === incDesc), w.__t.D.tx.find(t => t.desc === incDesc));

  await w.deleteManualTx(m.id);
  check('T1 removed from D.manualTx after delete', !w.__t.D.manualTx.some(x => x._pk === m._pk));
  check('T1 removed from D.tx too', !w.__t.D.tx.some(t => t.desc === incDesc));
  const beMGone = await apiGet(`/finance/manual-transactions/${m._pk}/`, adminTok);
  check('T1 gone server-side too (404)', beMGone.status === 404, beMGone.status);

  // ═══════════════════════════════════════════════════════════════════
  // T2 — Manual Transaction (Expense), default category when left blank
  // ═══════════════════════════════════════════════════════════════════
  const expDesc = 'E2E Bank Correction ' + stamp;
  w.openAddTx();
  $('mtd').value = expDesc;
  $('mtt').value = 'Expense';
  $('mta').value = '1200';
  $('mtdt').value = '2026-03-02';
  $('mtc').value = ''; // left blank on purpose
  await w.saveManualTx();
  let m2 = w.__t.D.manualTx.find(x => x.desc === expDesc);
  check('T2 expense transaction created', !!m2, expDesc);
  check('T2 default category applied ("Other")', m2 && m2.cat === 'Other', m2 && m2.cat);
  check('T2 type Expense, amount 1200', m2 && m2.type === 'Expense' && Number(m2.amt) === 1200, m2);

  // ═══════════════════════════════════════════════════════════════════
  // T3 — Validation: empty description/amount blocked client-side, no
  // API call made
  // ═══════════════════════════════════════════════════════════════════
  const countBefore = w.__t.D.manualTx.length;
  w.openAddTx();
  $('mtd').value = '';
  $('mta').value = '500';
  await w.saveManualTx();
  check('T3 empty description blocked, nothing created', w.__t.D.manualTx.length === countBefore, [countBefore, w.__t.D.manualTx.length]);

  w.openAddTx();
  $('mtd').value = 'No amount';
  $('mta').value = '0';
  await w.saveManualTx();
  check('T3 zero amount blocked, nothing created', w.__t.D.manualTx.length === countBefore, [countBefore, w.__t.D.manualTx.length]);

  await w.deleteManualTx(m2.id);
  check('T2 cleanup: expense transaction removed', !w.__t.D.manualTx.some(x => x._pk === m2._pk));

  // ═══════════════════════════════════════════════════════════════════
  // T4 — Permissions: Viewer blocked from both add and delete (client +
  // server side); Accountant can add AND delete (deleteManualTx uses
  // 'canDelete', which Accountant lacks — should be BLOCKED, unlike the
  // canEdit-gated deletes in Module 3)
  // ═══════════════════════════════════════════════════════════════════
  $('uid').value = 'viewer'; $('upass').value = 'view123';
  await w.doLogin();
  const countBeforeViewer = w.__t.D.manualTx.length;
  w.openAddTx();
  $('mtd').value = 'Hacker Entry'; $('mta').value = '999';
  await w.saveManualTx();
  check('T4 viewer blocked from creating (client-side, no API call)', w.__t.D.manualTx.length === countBeforeViewer, [countBeforeViewer, w.__t.D.manualTx.length]);
  const vTok = await apiLogin('viewer', 'view123');
  const vDirect = await apiPost('/finance/manual-transactions/', { description: 'Direct Hack', type: 'Income', amount: 999, date: '2026-03-01', category: '' }, vTok);
  check('T4 viewer blocked server-side too (403)', vDirect.status === 403, vDirect.status);

  $('uid').value = 'accountant'; $('upass').value = 'acc123';
  await w.doLogin();
  w.openAddTx();
  const acctDesc = 'E2E Acct Entry ' + stamp;
  $('mtd').value = acctDesc; $('mtt').value = 'Income'; $('mta').value = '3000'; $('mtdt').value = '2026-03-03';
  await w.saveManualTx();
  const acctM = w.__t.D.manualTx.find(x => x.desc === acctDesc);
  check('T4 accountant CAN create a manual transaction', !!acctM, acctM);

  await w.deleteManualTx(acctM.id);
  check('T4 accountant CANNOT delete a manual transaction (still present, requires canDelete)', w.__t.D.manualTx.some(x => x._pk === acctM._pk));

  // ── Cleanup as admin ──
  $('uid').value = 'admin'; $('upass').value = 'admin123';
  await w.doLogin();
  try {
    for (const x of w.__t.D.manualTx.filter(t => (t.desc || '').startsWith('E2E'))) {
      await fetch(API + `/finance/manual-transactions/${x._pk}/`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + adminTok } });
    }
  } catch (e) { console.warn('cleanup failed (non-fatal):', e); }

  console.log('\n=== MODULE 4 (MANUAL TRANSACTIONS) RESULTS ===');
  console.log('PASS:', results.pass.length);
  results.pass.forEach(p => console.log('  ✅', p));
  console.log('FAIL:', results.fail.length);
  results.fail.forEach(f => console.log('  ❌', f));
  return results;
}

run().then(r => { process.exit(r && r.fail.length ? 1 : 0); }).catch(e => { console.error('FATAL', e); process.exit(1); });
