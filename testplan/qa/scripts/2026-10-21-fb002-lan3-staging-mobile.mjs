// FB-002 LAN 3 (card 211026034109) — staging repro, PART 5: MOBILE 390px.
// The card's reporter is a phone user; TimeInput switches to the mobile
// overlay/sheet under 640px. Probes the no-date guard flow past the FIRST
// Enter (second Enter, then typing the date), plus the basic type+Enter:
//   M1 (mobile, no-date lot): click giờ, "1430", Enter, Enter — value kept? wiped?
//   M2 (mobile, with-date lot): click giờ, "1430", Enter — saves?
// Usage: node testplan/qa/scripts/2026-10-21-fb002-lan3-staging-mobile.mjs
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-21-fb002-lan3');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => { results.push({ id, pass, detail }); if (!pass) exitCode = 1; log('RESULT', { id, pass, detail }); };
const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  if (!res.ok) throw new Error(`login -> ${res.status}`);
  return (await res.json()).token;
};
const api = (token) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIALOG_TITLE = 'Chỉnh sửa Lịch trình';

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const token = await login('tiepvv');
  const call = api(token);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mutations = [];
  page.on('request', (req) => {
    if (/\/api\/shipments\/\d+/.test(req.url()) && !['GET', 'OPTIONS'].includes(req.method())) {
      mutations.push({ method: req.method(), url: req.url(), body: req.postData() ?? null });
      log('mutation', { method: req.method(), url: req.url(), body: (req.postData() ?? '').slice(0, 240) });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // reuse the lots from part 1: withDate 963 (page 2), noDate 463 (page 1)
  const snapshot = async (id) => {
    const d = await call('GET', `/shipments/cus-workspace/${id}`);
    const s = d.body?.summary ?? {};
    return { version: s.version, closingAt: s.closingAt ?? null, plannedReturnAt: s.plannedReturnAt ?? null, transportDate: s.transportDate ?? null };
  };
  const openDialogOn = async (lotId, pageNr) => {
    await page.goto(`${BASE}/shipments?page=${pageNr}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector(`#cus-inline-schedule-${lotId}`, { timeout: 20000 });
    await page.evaluate((id) => document.getElementById(`cus-inline-schedule-${id}`)?.scrollIntoView({ block: 'center' }), `cus-inline-schedule-${lotId}`);
    await sleep(200);
    await page.evaluate((id) => document.getElementById(id)?.click(), `cus-inline-schedule-${lotId}`);
    await page.waitForFunction((title) => Array.from(document.querySelectorAll('.modal__title')).some((el) => (el.textContent || '').trim() === title), { timeout: 10000 }, DIALOG_TITLE);
    await sleep(400);
  };
  const dialogState = () => page.evaluate((title) => {
    const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).find((m) => (m.querySelector('.modal__title')?.textContent || '').trim() === title) ?? null;
    const a = document.activeElement;
    return {
      dialogOpen: Boolean(dlg),
      activeLabel: a?.getAttribute('aria-label') ?? null, activeSeg: a?.getAttribute('data-seg') ?? null,
      timeValue: dlg?.querySelector('.time-input input')?.value ?? null,
      dayValue: dlg?.querySelector('[data-seg="dd"]')?.value ?? null,
      sheetOpen: Boolean(document.querySelector('.time-picker__sheet, .time-picker__overlay, [data-time-picker-overlay]')),
      alertText: Array.from(dlg?.querySelectorAll('[role="alert"]') ?? []).map((e) => e.textContent?.trim()).join('|') || null,
      noticeText: document.querySelector('.app-notices, [role="status"]')?.textContent?.trim() ?? null,
    };
  }, DIALOG_TITLE);
  const closeDialog = async () => {
    await page.evaluate((title) => {
      const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).find((m) => (m.querySelector('.modal__title')?.textContent || '').trim() === title);
      Array.from(dlg?.querySelectorAll('button') ?? []).find((b) => (b.textContent || '').trim() === 'Hủy')?.click();
    }, DIALOG_TITLE);
    await sleep(400);
  };

  // ══ M1: no-date lot 463, mobile: giờ "1430" + Enter ×2 ═══════════════════
  await openDialogOn(463, 1);
  let st = await dialogState();
  log('M1_dialog_open', st);
  await page.screenshot({ path: path.join(OUT, 'M1_dialog-open.png') });
  const t1 = await page.$(`[role="dialog"] .time-input input`);
  await t1.click();
  await sleep(450);
  st = await dialogState();
  log('M1_after_click', st);
  await page.keyboard.type('1430', { delay: 100 });
  await sleep(400);
  st = await dialogState();
  log('M1_after_typing_1430', st);
  await page.screenshot({ path: path.join(OUT, 'M1_after-typing-1430.png') });
  mutations.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1300);
  st = await dialogState();
  log('M1_after_enter1', { ...st, mutations: mutations.length });
  await page.keyboard.press('Enter');
  await sleep(1300);
  st = await dialogState();
  log('M1_after_enter2', { ...st, mutations: mutations.length });
  await page.screenshot({ path: path.join(OUT, 'M1_after-enter.png') });
  record('M1 mobile no-date lot: "14:30" + Enter×2 → guard alert visible, giờ value KEPT (no wipe), no PUT',
    mutations.length === 0 && st.dialogOpen && st.timeValue === '14:30' && Boolean(st.alertText && st.alertText.includes('Chọn ngày đóng/trả')),
    `mutations=${mutations.length} timeValue=${st.timeValue} alert=${st.alertText} notice=${st.noticeText}`);
  // M1b: now type the date and Enter — should save 14:30
  mutations.length = 0;
  await page.keyboard.type('25112026', { delay: 100 });
  await sleep(400);
  st = await dialogState();
  log('M1b_after_date', st);
  await page.keyboard.press('Enter');
  await sleep(1600);
  st = await dialogState();
  log('M1b_after_enter', { ...st, mutations: mutations.length });
  await page.screenshot({ path: path.join(OUT, 'M1b_after-enter.png') });
  record('M1b mobile: giờ + ngày rồi Enter → PUT fired, dialog closed (saved)',
    mutations.length > 0 && !st.dialogOpen,
    `mutations=${mutations.length} dialogOpen=${st.dialogOpen} timeValue=${st.timeValue} alert=${st.alertText}`);
  if (mutations.length > 0) {
    const now = await snapshot(463);
    await call('PUT', '/shipments/463', { expectedVersion: now.version, expectedDeliveryDate: null, closingAt: null, plannedReturnAt: null });
    log('M1b_restore', {});
  }
  if (st.dialogOpen) await closeDialog();

  // ══ M2: with-date lot 963, mobile: giờ "1430" + Enter ════════════════════
  const before963 = await snapshot(963);
  await openDialogOn(963, 2);
  st = await dialogState();
  log('M2_dialog_open', st);
  const t2 = await page.$(`[role="dialog"] .time-input input`);
  await t2.click();
  await sleep(450);
  await page.keyboard.type('1430', { delay: 100 });
  await sleep(400);
  st = await dialogState();
  log('M2_after_typing_1430', st);
  mutations.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1600);
  st = await dialogState();
  log('M2_after_enter', { ...st, mutations: mutations.length });
  await page.screenshot({ path: path.join(OUT, 'M2_after-enter.png') });
  const after963 = await snapshot(963);
  record('M2 mobile with-date lot: "14:30" + Enter → PUT fired + saved + closed',
    mutations.length > 0 && !st.dialogOpen && (after963.plannedReturnAt != null),
    `mutations=${mutations.length} dialogOpen=${st.dialogOpen} plannedReturnAt=${after963.plannedReturnAt}`);
  if (after963.plannedReturnAt !== before963.plannedReturnAt || after963.closingAt !== before963.closingAt || after963.transportDate !== before963.transportDate) {
    const r = await call('PUT', '/shipments/963', { expectedVersion: after963.version, expectedDeliveryDate: before963.transportDate, closingAt: before963.closingAt, plannedReturnAt: before963.plannedReturnAt });
    log('M2_restore', { status: r.status });
  }
  await page.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}
fs.writeFileSync(path.join(OUT, 'staging-mobile-driver.log'), JSON.stringify(LOG, null, 2));
fs.writeFileSync(path.join(OUT, 'staging-mobile-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
