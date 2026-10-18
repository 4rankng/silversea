// FB-002 rung-3 fix proof — WITH-date lot: typed giờ + Enter must SAVE.
// Lot 130022 carries a fixture date (set by the repro driver; restored to
// its original all-null schedule at the end of this script).
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7179';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-18_fb002-reinvestigate_fix');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  const { token } = await res.json();
  return token;
};
const api = (token) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* raw */ }
  return { status: res.status, body: parsed };
};

const token = await login('cus');
const call = api(token);
const SHIPMENT = 130022;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const puts = [];
page.on('request', (req) => {
  if (/\/api\/shipments\/130022/.test(req.url()) && req.method() === 'PUT') {
    puts.push(req.postData() ?? '');
    log('put_sent', { url: req.url(), body: (req.postData() ?? '').slice(0, 300) });
  }
});
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/shipments?transportDateFrom=2026-10-20&transportDateTo=2026-10-20`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('#cus-inline-schedule-130022', { timeout: 20000 });
log('trigger_visible');

await page.evaluate(() => document.getElementById('cus-inline-schedule-130022')?.scrollIntoView({ block: 'center' }));
await sleep(150);
const btn = await page.$('#cus-inline-schedule-130022');
await btn.click();
await page.waitForFunction(() => Array.from(document.querySelectorAll('.modal__title')).some((el) => (el.textContent || '').trim() === 'Chỉnh sửa Lịch trình'), { timeout: 10000 });
await sleep(300);
await page.screenshot({ path: path.join(OUT, '01_dialog-open.png') });

// QA flow: CLICK the Giờ field (opens the picker), hand-type over, Enter.
const timeInput = await page.$('[role="dialog"] .time-input input');
await timeInput.click({ clickCount: 3 });
await sleep(250);
const st1 = await page.evaluate(() => ({
  popupOpen: Boolean(document.querySelector('.time-picker__popup')),
  value: document.querySelector('[role="dialog"] .time-input input')?.value ?? null,
}));
log('after_click', st1);
await page.keyboard.type('1545', { delay: 90 });
await sleep(350);
const st2 = await page.evaluate(() => ({
  activeSeg: document.activeElement?.getAttribute('data-seg') ?? null,
  value: document.querySelector('[role="dialog"] .time-input input')?.value ?? null,
}));
log('after_typing_1545', st2); // FB-030 hand-off: focus should be on the date dd segment
await page.screenshot({ path: path.join(OUT, '02_after-typing-1545.png') });
await page.keyboard.press('Enter');
await sleep(1800);

const st3 = await page.evaluate(() => ({
  dialogOpen: Boolean(Array.from(document.querySelectorAll('[role="dialog"] .modal__title')).some((el) => (el.textContent || '').trim() === 'Chỉnh sửa Lịch trình')),
  notice: Array.from(document.querySelectorAll('[role="status"], .app-notices, .toast')).map((e) => e.textContent?.trim()).join('|') || null,
  alert: document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.trim() ?? null,
}));
log('after_enter', { ...st3, puts: puts.length });
await page.screenshot({ path: path.join(OUT, '03_after-enter.png'), fullPage: false });

// DB side-effect proof: closingAt must now carry 15:45 (+07:00 → 08:45Z).
const after = await call('GET', `/shipments/cus-workspace/${SHIPMENT}`);
const s = after.body?.summary ?? {};
log('db_after', { transportDate: s.transportDate, closingAt: s.closingAt, version: s.version });
fs.appendFileSync(path.join(OUT, 'db-side-effect.txt'), JSON.stringify({ transportDate: s.transportDate, closingAt: s.closingAt, version: s.version, puts }, null, 2));

// Restore the lot to its ORIGINAL pre-fixture schedule (all null, version bump).
const restore = await call('PUT', `/shipments/${SHIPMENT}`, {
  expectedVersion: s.version,
  expectedDeliveryDate: null,
  closingAt: null,
  plannedReturnAt: null,
});
const verify = await call('GET', `/shipments/cus-workspace/${SHIPMENT}`);
const v = verify.body?.summary ?? {};
log('restore', { status: restore.status, transportDate: v.transportDate, closingAt: v.closingAt, plannedReturnAt: v.plannedReturnAt });
fs.appendFileSync(path.join(OUT, 'db-side-effect.txt'), JSON.stringify({ restored: { transportDate: v.transportDate, closingAt: v.closingAt, plannedReturnAt: v.plannedReturnAt, status: restore.status } }, null, 2));

const pass = puts.length > 0 && !st3.dialogOpen && v.closingAt == null && v.transportDate == null;
log('VERDICT', { pass, savedClosingAt: s.closingAt, dialogClosed: !st3.dialogOpen, restored: v.closingAt == null && v.transportDate == null });
fs.writeFileSync(path.join(OUT, 'ui-driver.log'), JSON.stringify(LOG, null, 2));
console.log(pass ? 'RUNG3 PASS' : 'RUNG3 FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
