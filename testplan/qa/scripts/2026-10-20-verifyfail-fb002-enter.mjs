// Ticket 201026092400 (FB-002) — staging re-verify on the CURRENT build:
// in the "Chỉnh sửa Lịch trình" quick-edit dialog, CLICK the Giờ field (picker
// opens), hand-type a new time over the prefilled value, press Enter → the
// schedule must SAVE (PUT fires, dialog closes, closingAt persists). Fix
// 2e1a762b (typedSinceOpen superset). The original verify-fail was a stale
// staging build, so the build gate is HARD. Restores the original schedule.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = process.env.OUT_DIR || path.resolve(import.meta.dirname, '../../../qa/2026-10-20-verifyfail');
const EXPECT_BUILD = process.env.EXPECT_BUILD || 'c7d305ce';
const LOT = Number(process.env.LOT || 179);
const BUCKET = process.env.BUCKET || "NEW";
const TYPE_TIME = process.env.TYPE_TIME || '1630'; // → 16:30 (+07) → 09:30Z
const IDENTIFIER = process.env.IDENTIFIER || 'cus';
const PASSWORD = 'Abc123';
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, p, body, token) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === 'PUT' ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* raw */ }
  return { status: res.status, body: parsed };
};

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash, expected: EXPECT_BUILD, ok: health.buildHash === EXPECT_BUILD });
if (health.buildHash !== EXPECT_BUILD) {
  fs.writeFileSync(path.join(OUT, '201026092400_build-gate.json'), JSON.stringify(health, null, 2));
  console.error('BLOCKED: staging build is not the current build');
  process.exit(2);
}

const login = await api('POST', '/auth/login', { identifier: IDENTIFIER, password: PASSWORD });
if (login.status !== 200) { console.error(`BLOCKED: login -> ${login.status}`); process.exit(2); }
const token = login.body.token;
log('login', { user: login.body.user?.username ?? IDENTIFIER, role: login.body.user?.role });

const detail = await api('GET', `/shipments/cus-workspace/${LOT}`, undefined, token);
if (detail.status !== 200) { console.error(`BLOCKED: lot ${LOT} -> ${detail.status}`); process.exit(2); }
const s = detail.body.summary ?? {};
if (!s.transportDate) { console.error(`BLOCKED: lot ${LOT} must carry a transportDate (the dialog's Ngày)`); process.exit(2); }
const original = { transportDate: s.transportDate, closingAt: s.closingAt, plannedReturnAt: s.plannedReturnAt ?? null, version: s.version };
log('lot_pin', { id: LOT, billOrBook: s.billOrBookNumber, ...original, note: 'original schedule captured for restore' });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const puts = [];
page.on('request', (req) => {
  if (new RegExp(`/api/shipments/${LOT}(\\?|$)`).test(req.url()) && req.method() === 'PUT') {
    puts.push(req.postData() ?? '');
    log('put_sent', { body: (req.postData() ?? '').slice(0, 260) });
  }
});
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

await page.goto(`${BASE}/shipments?bucket=${BUCKET}&transportDateFrom=${original.transportDate}&transportDateTo=${original.transportDate}`, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForSelector(`#cus-inline-schedule-${LOT}`, { timeout: 30000 });
log('trigger_visible');
await page.evaluate((id) => document.getElementById(`cus-inline-schedule-${id}`)?.scrollIntoView({ block: 'center' }), LOT);
await sleep(200);
await page.click(`#cus-inline-schedule-${LOT}`);
await page.waitForFunction(() => Array.from(document.querySelectorAll('.modal__title')).some((el) => (el.textContent || '').trim() === 'Chỉnh sửa Lịch trình'), { timeout: 15000 });
await sleep(400);
const st0 = await page.evaluate(() => ({
  value: document.querySelector('[role="dialog"] .time-input input')?.value ?? null,
}));
log('dialog_open', st0);
await page.screenshot({ path: path.join(OUT, '201026092400_ui-01-dialog-open.png') });

// QA repro flow: CLICK the Giờ field (opens the picker), hand-type over the
// prefilled value (type-over restart), then Enter.
const timeInput = await page.$('[role="dialog"] .time-input input');
await timeInput.click({ clickCount: 3 });
await sleep(300);
await page.keyboard.type(TYPE_TIME, { delay: 90 });
await sleep(400);
const st1 = await page.evaluate(() => ({
  value: document.querySelector('[role="dialog"] .time-input input')?.value ?? null,
  activeSeg: document.activeElement?.getAttribute('data-seg') ?? null,
  popupOpen: Boolean(document.querySelector('.time-picker__popup')),
}));
log('after_typing', { ...st1, typed: TYPE_TIME });
await page.screenshot({ path: path.join(OUT, '201026092400_ui-02-after-typing.png') });
await page.keyboard.press('Enter');
await sleep(2200);

const st2 = await page.evaluate(() => ({
  dialogOpen: Array.from(document.querySelectorAll('.modal__title')).some((el) => (el.textContent || '').trim() === 'Chỉnh sửa Lịch trình'),
  notice: Array.from(document.querySelectorAll('[role="status"], .app-notices, .toast')).map((e) => (e.textContent || '').trim()).join('|') || null,
  alert: document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.trim() ?? null,
}));
log('after_enter', { ...st2, puts: puts.length });
await page.screenshot({ path: path.join(OUT, '201026092400_ui-03-after-enter.png') });

// DB side-effect proof: closingAt must carry the typed time (+07).
const after = await api('GET', `/shipments/cus-workspace/${LOT}`, undefined, token);
const saved = after.body?.summary ?? {};
log('db_after', { transportDate: saved.transportDate, closingAt: saved.closingAt, plannedReturnAt: saved.plannedReturnAt, version: saved.version });

// Restore the ORIGINAL schedule (version bump respected).
const restore = await api('PUT', `/shipments/${LOT}`, {
  expectedVersion: saved.version,
  expectedDeliveryDate: original.transportDate,
  closingAt: original.closingAt,
  plannedReturnAt: original.plannedReturnAt,
}, token);
const verify = await api('GET', `/shipments/cus-workspace/${LOT}`, undefined, token);
const v = verify.body?.summary ?? {};
log('restore', { status: restore.status, body: typeof restore.body === 'object' ? JSON.stringify(restore.body).slice(0, 200) : restore.body, closingAt: v.closingAt, version: v.version });
fs.appendFileSync(path.join(OUT, '201026092400_db-side-effect.txt'), JSON.stringify({ original, saved: { transportDate: saved.transportDate, closingAt: saved.closingAt, version: saved.version }, puts, restored: { status: restore.status, closingAt: v.closingAt, version: v.version } }, null, 2));
await browser.close();

// The LCL schedule dialog maps: Ngày → expectedDeliveryDate, typed Giờ →
// plannedReturnAt (the PUT in the FB-002 fix doc carries the typed time on
// that field). Expected persisted instant = transportDate + typed +07 time,
// UTC (day-roll safe). closingAt must stay untouched (no collateral).
const base = new Date(`${original.transportDate}T00:00:00Z`);
base.setUTCHours(Number(TYPE_TIME.slice(0, 2)) - 7, Number(TYPE_TIME.slice(2)), 0, 0);
const expectPlannedReturnZ = base.toISOString();
const checks = [
  { name: 'dialog opened with the Giờ TimeInput present', ok: st0.value !== null && st0.value !== undefined },
  { name: 'typed entry accepted (type-over restart, value set)', ok: st1.value === `${TYPE_TIME.slice(0, 2)}:${TYPE_TIME.slice(2)}` },
  { name: 'Enter reached the save path (PUT fired — 2e1a762b live)', ok: puts.length > 0 },
  { name: 'dialog closed after Enter', ok: st2.dialogOpen === false },
  { name: `typed giờ persisted on plannedReturnAt (${expectPlannedReturnZ})`, ok: saved.plannedReturnAt === expectPlannedReturnZ },
  { name: 'no collateral: closingAt + transportDate unchanged', ok: saved.closingAt === original.closingAt && saved.transportDate === original.transportDate },
  { name: 'schedule restored to original', ok: restore.status === 200 && v.closingAt === original.closingAt && (v.plannedReturnAt ?? null) === original.plannedReturnAt },
  { name: 'no console/page errors', ok: errors.length === 0 },
];
const failed = checks.filter((c) => !c.ok);
for (const c of checks) log('check', { name: c.name, ok: c.ok });
fs.writeFileSync(path.join(OUT, '201026092400_ui-driver.log'), JSON.stringify(LOG, null, 2));
console.log(failed.length === 0 ? 'RUNG3_DRIVE_PASS' : 'RUNG3_DRIVE_FAIL');
process.exit(failed.length === 0 ? 0 : 1);
