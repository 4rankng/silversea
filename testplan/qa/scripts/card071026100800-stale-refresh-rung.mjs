import puppeteer from 'puppeteer';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_card071026100800-stale-refresh';
const BL = 'QA-STALE100800-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);
const LOG = [];
const log = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(API + '/health').then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: 'cc25e5ae' });
if (!String(health.buildHash || '').startsWith('cc25e5ae')) { log('build-currency-FAIL'); process.exit(2); }

const adminTok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) })).json()).token;
const ikey = () => crypto.randomUUID();
const api = async (tok, method, path, body) => {
  const res = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', 'Idempotency-Key': ikey() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

// Fixture: FCL lot for LONG MINH + two 40DC containers.
const created = await api(adminTok, 'POST', '/shipments', { customerId: 1, cargoMode: 'FCL', tradeDirection: 'IMPORT', blNumber: BL, shippingLineName: 'QA Line', routeId: 6, customerNotes: 'QAFIXTURE card 071026100800 stale-refresh rung. Xoa duoc sau QA.' });
if (![200, 201].includes(created.status)) { log('fixture-create-FAIL', created); process.exit(2); }
const sid = created.body.id;
log('fixture-created', { shipmentId: sid, bl: BL });
const cusTok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) })).json()).token;
const ws0 = await api(cusTok, 'GET', '/shipments/cus-workspace/' + sid);
const types = ws0.body?.selectors?.containerTypes ?? [];
const t40 = types.find((t) => /40DC/i.test(t.label || t.name || '')) ?? types[0];
log('container-type', { picked: t40?.label ?? t40?.name ?? t40?.id, total: types.length });
let ver = ws0.body?.summary?.version ?? created.body.version ?? 1;
for (const n of ['QATU1008005', 'QATU1008010']) {
  const add = await api(cusTok, 'POST', '/shipments/cus-workspace/' + sid + '/containers', { expectedShipmentVersion: ver, containerNumber: n, containerTypeId: t40?.id ?? null });
  log('container-added', { n, status: add.status, err: add.body?.error ?? null, details: add.body?.details ?? null, ver });
  if (add.status === 200 || add.status === 201) ver = add.body?.shipmentVersion ?? add.body?.summary?.version ?? (ver + 1);
}
const ws1 = await api(cusTok, 'GET', '/shipments/cus-workspace/' + sid);
log('fixture-state', { containers: (ws1.body?.containers ?? []).length, summary: ws1.body?.summary?.containerSummary ?? null });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  await p.evaluateOnNewDocument((t) => localStorage.setItem('token', t), cusTok);
  const tap = async (pt) => { await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.up(); };
  await p.goto(BASE + '/shipments', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);
  await p.evaluate(() => { const el = [...document.querySelectorAll('input')].find((i) => i.offsetParent !== null && /Bill, Cont/.test(i.placeholder || '')); if (el) el.focus(); });
  await p.keyboard.type(BL, { delay: 60 });
  await sleep(3000);
  const pick = await p.evaluate((want) => {
    const rows = [...document.querySelectorAll('tbody tr')].filter((x) => x.offsetParent !== null && (x.textContent || '').includes(want));
    if (!rows.length) return { error: 'ROW_NOT_FOUND' };
    const el = rows[0].querySelector('button.cus-dashboard-detail');
    if (!el) return { error: 'NO_BTN_IN_ROW' };
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { id: el.id, x: r.x + r.width / 2, y: r.y + r.height / 2, rowText: (rows[0].textContent || '').replace(/\s+/g, ' ').slice(0, 160) };
  }, BL);
  if (pick.error) { log('pick-FAIL', pick); process.exit(1); }
  log('row-before', { rowText: pick.rowText });
  await tap({ x: pick.x, y: pick.y });
  await p.waitForSelector('.cus-container-ledger', { timeout: 25000 });
  await sleep(1200);
  const before = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.cus-container-ledger tbody tr')].filter((x) => x.offsetParent !== null);
    return { drawerRows: rows.length };
  });
  log('drawer-before', before);
  await p.screenshot({ path: QA + '/' + SCOPE + '_before.png', fullPage: false });

  // SINGLE mutating tap on the named fixture row's Xóa (row QA100800A).
  const del = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.cus-container-ledger tbody tr')].find((x) => (x.textContent || '').includes('QATU1008005'));
    if (!row) return { error: 'ROW_GONE' };
    const btn = [...row.querySelectorAll('button')].find((b) => /^Xóa/.test((b.getAttribute('aria-label') || '')) || /^Xóa$/.test((b.textContent || '').trim()));
    if (!btn) return { error: 'NO_DELETE_BTN', labels: [...row.querySelectorAll('button')].map((x) => (x.textContent || '').trim() + '|aria=' + (x.getAttribute('aria-label') || '')) };
    btn.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, aria: btn.getAttribute('aria-label') };
  });
  if (del.error) { log('delete-btn-FAIL', del); process.exit(1); }
  log('delete-btn', { aria: del.aria });
  await tap({ x: del.x, y: del.y });
  await sleep(3500);
  const after = await p.evaluate((want) => {
    const rows = [...document.querySelectorAll('.cus-container-ledger tbody tr')].filter((x) => x.offsetParent !== null);
    const toast = [...document.querySelectorAll('[role="status"],[role="alert"],[class*="toast"]')].filter((x) => x.offsetParent !== null).map((x) => (x.textContent || '').trim()).filter((t) => t.includes('Đã xóa'))[0] ?? null;
    const ovRow = [...document.querySelectorAll('tbody tr')].filter((x) => x.offsetParent !== null && (x.textContent || '').includes(want));
    const nav = location.pathname;
    return { drawerRows: rows.length, stillHasA: rows.some((x) => (x.textContent || '').includes('QATU1008005')), toast, overviewRowText: ovRow.length ? (ovRow[0].textContent || '').replace(/\s+/g, ' ').slice(0, 160) : null, pathname: nav };
  }, BL);
  log('after-delete', after);
  await p.screenshot({ path: QA + '/' + SCOPE + '_after.png', fullPage: false });
  const ws2 = await api(cusTok, 'GET', '/shipments/cus-workspace/' + sid);
  log('db-verify', { containers: (ws2.body?.containers ?? []).length, summary: ws2.body?.summary?.containerSummary ?? null });
  const ok = before.drawerRows === 2 && after.drawerRows === 1 && after.stillHasA === false && Boolean(after.toast) && Boolean(after.overviewRowText) && (ws2.body?.containers ?? []).length === 1;
  log('verdict', { ok });
  if (!ok) exitCode = 1;
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  const fs = await import('node:fs');
  fs.writeFileSync(QA + '/' + SCOPE + '_ui-driver.log', LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
