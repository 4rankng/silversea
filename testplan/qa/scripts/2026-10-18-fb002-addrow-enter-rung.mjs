// FB-002 fix — rung 3: Enter in the segmented datetime of the CUS add-container
// row submits the row (the no-onCommit host that used to swallow the key).
// Lot 85901 (QA residue, searchSuffix=rmkkyl): add container QAFB002ADD via
// typed datetime + Enter, prove the API row, then remove it.
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-18_fb002-fb030_fix');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
let exitCode = 0;
const record = (id, pass, detail) => {
  if (!pass) exitCode = 1;
  log('RESULT', { id, pass, detail });
};

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash });

const token = await login('cus');
const call = api(token);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });

try {
  const page0 = await browser.newPage();
  page0.on('request', (req) => { if (req.url().includes('/api/') && req.method() !== 'GET') log('req', { method: req.method(), url: req.url().replace('http://localhost:3002/api', '') }); });
  page0.on('response', async (res) => {
    if (res.url().includes('/api/') && res.request().method() !== 'GET') log('res', { status: res.status, url: res.url().replace('http://localhost:3002/api', ''), body: (await res.text().catch(() => '')).slice(0, 200) });
  });
  await page0.setViewport({ width: 1440, height: 900 });
  await page0.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page0.goto(`${BASE}/shipments?searchSuffix=rmkkyl`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page0.waitForSelector('button[aria-label^="Mở chi tiết lô hàng"]', { timeout: 20000 });
  const btns0 = await page0.$$('button[aria-label^="Mở chi tiết lô hàng"]');
  await btns0[btns0.length - 1].click();
  await page0.waitForSelector('[id^="cus-detail-drawer-"]', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  const shipmentId = await page0.evaluate(() => Number(document.querySelector('[id^="cus-detail-drawer-"]').id.replace('cus-detail-drawer-', '')));
  const before = await call('GET', `/shipments/cus-workspace/${shipmentId}`);
  const beforeCount = (before.body?.containers ?? []).length;
  log('snapshot', { shipmentId, containersBefore: beforeCount, version: before.body?.summary?.version });
  const page = page0;

  await new Promise((r) => setTimeout(r, 400));

  const addBtn = await page.waitForSelector('button.cus-container-ledger__add, button', { timeout: 5000 }).catch(() => null);
  // The add affordance is the "Thêm container" button seen in the ledger footer.
  const addContainer = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[id^="cus-detail-drawer-"] button'));
    const el = els.find((b) => (b.textContent || '').trim() === 'Thêm container');
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  });
  log('add_row_opened', { addContainer });
  if (!addContainer) throw new Error('no "Thêm container" button');

  await page.waitForSelector('.cus-container-ledger__add-row input[aria-label="Số container"]', { timeout: 10000 });
  await page.type('.cus-container-ledger__add-row input[aria-label="Số container"]', 'QAFB2000009');
  await page.screenshot({ path: path.join(OUT, '01-add-row-filled.png') });

  // Type the datetime by hand in the add row's segmented field.
  const hour = await page.$('.cus-container-ledger__add-row [data-seg-part="time"] [data-seg="hh"]');
  await hour.click();
  await page.keyboard.type('14', { delay: 80 });
  await new Promise((r) => setTimeout(r, 200));
  const afterHour = await page.evaluate(() => ({
    activeSeg: document.activeElement?.getAttribute('data-seg') ?? null,
    hour: (document.querySelector('.cus-container-ledger__add-row [data-seg="hh"]'))?.value ?? null,
  }));
  log('addrow_after_hour_14', afterHour);
  record('FB-030/075 add-row: hour "14" auto-advances to minute', afterHour.activeSeg === 'mm' && afterHour.hour === '14', JSON.stringify(afterHour));

  await page.keyboard.type('30', { delay: 80 });
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.type('18102026', { delay: 70 });
  await new Promise((r) => setTimeout(r, 300));
  const segState = await page.evaluate(() => ({
    activeSeg: document.activeElement?.getAttribute('data-seg') ?? null,
    hour: (document.querySelector('.cus-container-ledger__add-row [data-seg="hh"]'))?.value ?? null,
    minute: (document.querySelector('.cus-container-ledger__add-row [data-seg="mm"]'))?.value ?? null,
    day: (document.querySelector('.cus-container-ledger__add-row [data-seg-part="date"] [data-seg="dd"]'))?.value ?? null,
  }));
  log('addrow_segments', segState);
  await page.screenshot({ path: path.join(OUT, '02-add-row-datetime-typed.png') });

  // THE FIX: Enter inside the segmented datetime must submit the add row.
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 2000));
  const rowGone = await page.evaluate(() => !document.querySelector('.cus-container-ledger__add-row'));
  const bodyHasAdding = await page.evaluate(() => document.body.innerText.includes('Đang thêm'));
  log('addrow_after_enter', { rowGone, bodyHasAdding });
  await page.screenshot({ path: path.join(OUT, '03-add-row-after-enter.png') });
  record('FB-002 add-row: typed datetime + Enter submits the row', rowGone, `rowGone=${rowGone} adding=${bodyHasAdding}`);

  // API proof: the container exists with the typed appointment.
  await new Promise((r) => setTimeout(r, 1000));
  const after = await call('GET', `/shipments/cus-workspace/${shipmentId}`);
  const containers = after.body?.containers ?? [];
  const added = containers.find((c) => c.containerNumber === 'QAFB2000009') ?? null;
  log('api_after', { containersAfter: containers.length, added: added ? { id: added.id, appt: added.customerAppointmentAt } : null });
  record(
    'FB-002 add-row API: container QAFB2000009 persisted with appointment 14:30',
    Boolean(added) && added.customerAppointmentAt === '2026-10-18T07:30:00.000Z',
    `added=${added ? `${added.id}:${added.customerAppointmentAt}` : 'none'}`,
  );

  // Cleanup: remove the QA container (API remove route).
  if (added) {
    const version = after.body?.summary?.version ?? 1;
    const rm = await call('POST', `/shipments/cus-workspace/${shipmentId}/containers/${added.id}/remove`, { expectedShipmentVersion: version });
    log('cleanup_remove', { status: rm.status });
  }
  const final = await call('GET', `/shipments/cus-workspace/${shipmentId}`);
  log('final_state', { containers: (final.body?.containers ?? []).length, version: final.body?.summary?.version });
  await page.close();
} catch (error) {
  record('driver', false, String(error));
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'driver_log.json'), JSON.stringify(LOG, null, 2));
console.log(`exit=${exitCode}`);
process.exit(exitCode);
