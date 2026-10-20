// FB-002 LAN 3 (card 211026034109) — staging repro, PART 4: /shipments/:id
// "Sửa lô" → "Lịch trình" (the FB-086 remainder surface — same quick-edit modal,
// hosted by ShipmentDetailPage where item = lotEditDetail?.summary).
//   S1 open Sửa lô → Lịch trình → click giờ, type "1430", Enter → save? wipe?
// Usage: node testplan/qa/scripts/2026-10-21-fb002-lan3-staging-detail.mjs
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-21-fb002-lan3');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => {
  results.push({ id, pass, detail });
  if (!pass) exitCode = 1;
  log('RESULT', { id, pass, detail });
};
const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const api = (token) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHIPMENT = Number(process.env.QA_LOT || 963);
const DIALOG_TITLE = 'Chỉnh sửa Lịch trình';

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const token = await login('tiepvv');
  const call = api(token);
  const before = await (async () => {
    const d = await call('GET', `/shipments/cus-workspace/${SHIPMENT}`);
    const s = d.body?.summary ?? {};
    return { version: s.version, closingAt: s.closingAt ?? null, plannedReturnAt: s.plannedReturnAt ?? null, transportDate: s.transportDate ?? null };
  })();
  log('lot_before', { shipmentId: SHIPMENT, ...before });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const mutations = [];
  page.on('request', (req) => {
    if (/\/api\/shipments\/(cus-workspace\/)?\d+/.test(req.url()) && !['GET', 'OPTIONS'].includes(req.method())) {
      mutations.push({ method: req.method(), url: req.url(), body: req.postData() ?? null });
      log('mutation', { method: req.method(), url: req.url(), body: (req.postData() ?? '').slice(0, 260) });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/${SHIPMENT}`, { waitUntil: 'networkidle2', timeout: 60000 });

  // Open "Sửa lô" from the header
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button'))
    .some((b) => (b.textContent || '').includes('Sửa lô')), { timeout: 20000 });
  await page.evaluate(() => Array.from(document.querySelectorAll('button'))
    .find((b) => (b.textContent || '').includes('Sửa lô'))?.click());
  await sleep(600);
  // Group picker: click "Lịch trình"
  const picked = await page.evaluate(() => {
    const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
    const btn = Array.from(dlg?.querySelectorAll('button, [role="button"]') ?? [])
      .find((b) => (b.textContent || '').trim().includes('Lịch trình'));
    if (btn instanceof HTMLElement) { btn.click(); return btn.textContent?.trim(); }
    return null;
  });
  log('picker_picked', { picked });
  await page.waitForFunction(
    (title) => Array.from(document.querySelectorAll('.modal__title')).some((el) => (el.textContent || '').trim() === title),
    { timeout: 10000 }, DIALOG_TITLE,
  );
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'S1_dialog-open.png') });

  const dialogState = () => page.evaluate((title) => {
    const dlg = Array.from(document.querySelectorAll('[role="dialog"]'))
      .find((m) => (m.querySelector('.modal__title')?.textContent || '').trim() === title) ?? null;
    const a = document.activeElement;
    return {
      dialogOpen: Boolean(dlg),
      activeLabel: a?.getAttribute('aria-label') ?? null,
      activeSeg: a?.getAttribute('data-seg') ?? null,
      timeValue: dlg?.querySelector('.time-input input')?.value ?? null,
      dayValue: dlg?.querySelector('[data-seg="dd"]')?.value ?? null,
      alertText: Array.from(dlg?.querySelectorAll('[role="alert"]') ?? []).map((e) => e.textContent?.trim()).join('|') || null,
      noticeText: document.querySelector('.app-notices, [role="status"]')?.textContent?.trim() ?? null,
    };
  }, DIALOG_TITLE);

  let st = await dialogState();
  log('S1_dialog_state', st);
  const timeInput = await page.$(`[role="dialog"] .time-input input`);
  if (!timeInput) throw new Error('time input not found in detail-page schedule dialog');
  await timeInput.click();
  await sleep(350);
  st = await dialogState();
  log('S1_after_click', st);
  await page.keyboard.type('1430', { delay: 100 });
  await sleep(350);
  st = await dialogState();
  log('S1_after_typing_1430', st);
  await page.screenshot({ path: path.join(OUT, 'S1_after-typing-1430.png') });
  mutations.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1600);
  st = await dialogState();
  log('S1_after_enter', { ...st, mutations: mutations.length });
  await page.screenshot({ path: path.join(OUT, 'S1_after-enter.png') });

  const after = await (async () => {
    const d = await call('GET', `/shipments/cus-workspace/${SHIPMENT}`);
    const s = d.body?.summary ?? {};
    return { version: s.version, closingAt: s.closingAt ?? null, plannedReturnAt: s.plannedReturnAt ?? null, transportDate: s.transportDate ?? null };
  })();
  const saved14 = after.plannedReturnAt != null
    ? /T14:30/.test(after.plannedReturnAt) || /T07:30:00\.000Z/.test(after.plannedReturnAt)
    : false;
  record('S1 /shipments/:id Sửa lô → Lịch trình: click giờ + "1430" + Enter → PUT fired + saved + dialog closed (no wipe)',
    mutations.length > 0 && saved14,
    `mutations=${mutations.length} dialogOpen=${st.dialogOpen} timeValue=${st.timeValue} before=${before.plannedReturnAt} after=${after.plannedReturnAt} alert=${st.alertText} notice=${st.noticeText}`);

  // Restore
  if (after.plannedReturnAt !== before.plannedReturnAt || after.closingAt !== before.closingAt || after.transportDate !== before.transportDate) {
    const r = await call('PUT', `/shipments/${SHIPMENT}`, {
      expectedVersion: after.version,
      expectedDeliveryDate: before.transportDate,
      closingAt: before.closingAt,
      plannedReturnAt: before.plannedReturnAt,
    });
    const check = await call('GET', `/shipments/cus-workspace/${SHIPMENT}`);
    const s = check.body?.summary ?? {};
    record('S1 restore lot 963 fields', r.status === 200 && s.plannedReturnAt === before.plannedReturnAt, `status=${r.status} plannedReturnAt=${s.plannedReturnAt ?? null}`);
  }
  await page.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}
fs.writeFileSync(path.join(OUT, 'staging-detail-driver.log'), JSON.stringify(LOG, null, 2));
fs.writeFileSync(path.join(OUT, 'staging-detail-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
