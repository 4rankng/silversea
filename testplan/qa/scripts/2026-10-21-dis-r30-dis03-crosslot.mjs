// dis-03 cross-lot kẹp UI driver — the QA R30 failing shape (two separate
// 1×20' lots, same tractor): issue H1 as Đơn, then plan+issue H2 as Kẹp.
// Before the fix both writes dead-ended on hard 409s with no confirm path.
// Usage: node (defaults :7175/:3002; QA_API/QA_BASE override — this evidence ran on 7186/3003) testplan/qa/scripts/2026-10-21-dis-r30-dis03-crosslot.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
const OUT = path.resolve('qa/2026-10-21-dis-r30');
fs.mkdirSync(OUT, { recursive: true });
const CONT_H1 = 'DSHK6789015';
const CONT_H2 = 'DSTK7890125';
const APPT = '2026-10-27T05:00:00.000Z';

const LOG = [];
const NET = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const net = (line) => NET.push(`${new Date().toISOString()} ${line}`);
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => { results.push({ id, pass, detail }); log('RESULT', { id, pass, detail }); if (!pass) exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const cus = await login('cus');
const token = await login('dieuvan');
const authed = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const rowState = async (cont) => fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&q=${cont.slice(0, 10)}`, { headers: authed(token) })
  .then((r) => r.json())
  .then((b) => (b.items ?? []).find((i) => i.container?.containerNumber === cont));

// ── fixtures: two fresh 1×20' lots, appointment 27/10, route/ports set ──
for (const [bl, cont] of [['DIS30-H1', CONT_H1], ['DIS30-H2', CONT_H2]]) {
  const existing = await rowState(cont);
  if (existing) { log('fixture_exists', { bl, ship: existing.shipmentId }); continue; }
  const res = await fetch(`${API}/shipments/quick`, {
    method: 'POST',
    headers: { ...authed(cus), 'Idempotency-Key': `dis30-${bl}` },
    body: JSON.stringify({
      customerId: 1, tradeDirection: 'IMPORT', blNumber: bl, cargoMode: 'FCL',
      containers: [{ containerTypeId: 1, containerNumber: cont, cargoWeightKg: 9000, customerAppointmentAt: APPT, routeId: 1, pickupPortId: 1, dropoffPortId: 2 }],
    }),
  });
  log('fixture_created', { bl, status: res.status });
  if (!res.ok) throw new Error(`create ${bl}: ${(await res.text()).slice(0, 200)}`);
}
await sleep(500);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('response', async (res) => {
    const url = res.url();
    if (/\/api\/(shipments\/dispatch-detail-plan-rows\/\d+\/plan|shipments\/\d+\/dispatch)/.test(url)) {
      net(`${res.request().method()} ${url.replace(API, '')} -> ${res.status} post=${res.request().postData()?.slice(0, 220) ?? ''}`);
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const openGridAt = async (cont) => {
    await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table.detailed-plan-grid', { timeout: 45000 });
    await sleep(1000);
    const search = await page.$('input[aria-label="Tìm nhanh"]');
    if (search) { await search.click({ clickCount: 3 }); await page.keyboard.type(cont, { delay: 30 }); await sleep(1400); }
  };
  const confirmIfWarn = async (label) => {
    await sleep(1400);
    const state = await page.evaluate(() => ({
      confirm: !!document.querySelector('.confirm-box'),
      message: document.querySelector('.confirm-message')?.textContent?.trim() ?? null,
    }));
    log(label, state);
    if (state.confirm) {
      await page.evaluate(() => { document.querySelector('.confirm-actions .btn--primary')?.click(); });
      await sleep(2200);
    }
    return state;
  };

  // ── H1: plan truck 1 (Đơn) + quick-issue in one tap ──
  const h1 = await rowState(CONT_H1);
  if (!h1?.dispatch?.assignedPlate) {
    await openGridAt(CONT_H1);
    await page.evaluate((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).find((r) => (r.textContent || '').includes(c));
      Array.from(row.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').startsWith('Sửa ô điều phối')).click();
    }, CONT_H1);
    await page.waitForSelector('.dispatch-assignment-dialog', { timeout: 15000 });
    await sleep(1400);
    await page.evaluate(() => {
      const vehicleBlock = document.querySelector('.dispatch-assignment-dialog__vehicle');
      vehicleBlock?.querySelector('button.searchable-select__trigger')?.click();
    });
    await sleep(900);
    await page.evaluate(() => { document.querySelector('.searchable-select__popover input[role="combobox"]')?.focus(); });
    await page.keyboard.type('60C-12345', { delay: 50 });
    await sleep(1100);
    await page.evaluate(() => {
      const pop = document.querySelector('.searchable-select__popover');
      const opt = Array.from((pop?.querySelectorAll('[role="listbox"] button, [role="option"]')) ?? []).find((el) => (el.textContent || '').includes('60C-12345'));
      (opt instanceof HTMLElement ? opt : null)?.click();
    });
    await sleep(500);
    await page.evaluate(() => {
      const save = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Lưu thay đổi') && b.offsetParent !== null);
      save?.click();
    });
    await sleep(2000);
    log('h1_planned', {});
  } else {
    log('h1_already_plated', { plate: h1.dispatch.assignedPlate });
  }
  const h1b = await rowState(CONT_H1);
  if (h1b?.taskStatus !== 'DISPATCHED') {
    await openGridAt(CONT_H1);
    await page.evaluate((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).find((r) => (r.textContent || '').includes(c));
      Array.from(row.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').startsWith('Phát lệnh'))?.click();
    }, CONT_H1);
    await confirmIfWarn('h1_issue_warn');
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, 'dis03-crosslot-01-h1-issued.png'), fullPage: false });
  }
  const h1c = await rowState(CONT_H1);
  record('dis-03 cross-lot: H1 (Đơn) plans + issues on 60C-12345', h1c?.taskStatus === 'DISPATCHED' && h1c?.dispatch?.tripId != null, JSON.stringify({ status: h1c?.taskStatus, trip: h1c?.dispatch?.tripId }));

  // ── H2: KẸP classification + same tractor — the old dead-end path ──
  const h2 = await rowState(CONT_H2);
  if (h2?.dispatch?.assignedPlate !== '60C-12345' || h2?.classification !== 'DOUBLE') {
    await openGridAt(CONT_H2);
    await page.evaluate((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).find((r) => (r.textContent || '').includes(c));
      Array.from(row.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').startsWith('Sửa ô điều phối')).click();
    }, CONT_H2);
    await page.waitForSelector('.dispatch-assignment-dialog', { timeout: 15000 });
    await sleep(1400);
    // Phân loại → Kẹp
    await page.evaluate(() => {
      const sel = Array.from(document.querySelectorAll('.dispatch-assignment-dialog select'));
      const cls = sel.find((s) => Array.from(s.options).some((o) => (o.textContent || '').includes('Kẹp')));
      if (cls instanceof HTMLSelectElement) {
        const opt = Array.from(cls.options).find((o) => (o.textContent || '').includes('Kẹp'));
        if (opt) { cls.value = opt.value; cls.dispatchEvent(new Event('change', { bubbles: true })); }
      }
    });
    await sleep(700);
    // vehicle → 60C-12345
    await page.evaluate(() => {
      const vehicleBlock = document.querySelector('.dispatch-assignment-dialog__vehicle');
      vehicleBlock?.querySelector('button.searchable-select__trigger')?.click();
    });
    await sleep(900);
    await page.evaluate(() => { document.querySelector('.searchable-select__popover input[role="combobox"]')?.focus(); });
    await page.keyboard.type('60C-12345', { delay: 50 });
    await sleep(1100);
    await page.evaluate(() => {
      const pop = document.querySelector('.searchable-select__popover');
      const opt = Array.from((pop?.querySelectorAll('[role="listbox"] button, [role="option"]')) ?? []).find((el) => (el.textContent || '').includes('60C-12345'));
      (opt instanceof HTMLElement ? opt : null)?.click();
    });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'dis03-crosslot-02-h2-editor.png'), fullPage: false });
    await page.evaluate(() => {
      const save = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Lưu thay đổi') && b.offsetParent !== null);
      save?.click();
    });
    const warnState = await confirmIfWarn('h2_plan_warn');
    record('dis-03 cross-lot: H2 (Kẹp) plan-save warns once (confirmable), not a dead-end', warnState.confirm === true, warnState.message ?? 'no confirm shown');
    await sleep(1000);
    await page.screenshot({ path: path.join(OUT, 'dis03-crosslot-03-h2-planned.png'), fullPage: false });
  }
  const h2b = await rowState(CONT_H2);
  record('dis-03 cross-lot: H2 carries plate + Kẹp classification after confirm', h2b?.dispatch?.assignedPlate === '60C-12345' && h2b?.classification === 'DOUBLE', JSON.stringify({ plate: h2b?.dispatch?.assignedPlate, cls: h2b?.classification }));

  // ── issue H2 — the old hard "Xe đầu kéo đã bị trùng lịch kế hoạch." ──
  if (h2b?.taskStatus !== 'DISPATCHED') {
    await openGridAt(CONT_H2);
    await page.evaluate((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).find((r) => (r.textContent || '').includes(c));
      Array.from(row.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').startsWith('Phát lệnh'))?.click();
    }, CONT_H2);
    const warnState = await confirmIfWarn('h2_issue_warn');
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, 'dis03-crosslot-04-h2-issued.png'), fullPage: false });
    const h2c = await rowState(CONT_H2);
    record('dis-03 cross-lot: H2 issues after confirm (no hard trùng đầu kéo dead-end)', h2c?.taskStatus === 'DISPATCHED' && h2c?.dispatch?.tripId != null, JSON.stringify({ warnShown: warnState.confirm, message: warnState.message, status: h2c?.taskStatus, trip: h2c?.dispatch?.tripId }));
  } else {
    record('dis-03 cross-lot: H2 issues after confirm (no hard trùng đầu kéo dead-end)', true, 'already dispatched');
  }
} catch (err) {
  log('driver_error', { message: String(err) });
  record('driver completed', false, String(err));
  exitCode = 1;
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(OUT, 'dis03-crosslot-ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
fs.writeFileSync(path.join(OUT, 'dis03-crosslot-net.log'), NET.join('\n'));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
process.exit(exitCode);
