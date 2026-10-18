// FB-002 re-investigation — the REAL QA surface: /shipments quick-edit dialog
// "Chỉnh sửa Lịch trình" (ShipmentsPage modal; Giờ = design-system TimeInput,
// Ngày = BufferedUuiDateInput — NOT SplitDateTimeField that 5ef5ace7 fixed).
// Tickets: 181026000027-fb002 (typed giờ + Enter does not save),
// 171026215500-fb030-075 (segment auto-advance). Probes the "Từ ngày" filter.
// Usage: node testplan/qa/scripts/2026-10-18-fb002-schedule-dialog-repro.mjs
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7179';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-18_fb002-reinvestigate_repro');
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  const { token } = await res.json();
  return token;
};

const api = (token) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, body: parsed };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });

try {
  const token = await login('cus');
  const call = api(token);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const mutations = [];
  page.on('request', (req) => {
    if (/\/api\/shipments/.test(req.url()) && !['GET', 'OPTIONS'].includes(req.method())) {
      mutations.push({ method: req.method(), url: req.url(), body: req.postData() ?? null });
      log('mutation', { method: req.method(), url: req.url(), body: (req.postData() ?? '').slice(0, 300) });
    }
  });
  page.on('response', (res) => {
    if (/\/api\/shipments/.test(res.url()) && !['GET', 'OPTIONS'].includes(res.request().method())) {
      log('mutation_status', { status: res.status, url: res.url() });
    }
  });

  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });

  // ── P5 (FB-030 filter surface): "Từ ngày" day → month auto-advance ──────
  try {
    await page.waitForSelector('.date-range-fields__from [data-seg="dd"]', { timeout: 20000 });
    const day = await page.$('.date-range-fields__from [data-seg="dd"]');
    await day.click();
    await page.keyboard.type('17', { delay: 90 });
    await sleep(300);
    const seg = await page.evaluate(() => {
      const a = document.activeElement;
      return { seg: a?.getAttribute('data-seg') ?? null, label: a?.getAttribute('aria-label') ?? null };
    });
    await page.screenshot({ path: path.join(OUT, 'P5_filter-tu-ngay-after-17.png') });
    record('P5 filter "Từ ngày": day "17" → focus month', seg.seg === 'mm2', JSON.stringify(seg));
  } catch (e) {
    record('P5 filter "Từ ngày"', false, String(e));
  }

  // ── Find an enabled LCL schedule trigger by paging ──────────────────────
  let target = null;
  for (let p = 1; p <= 12 && !target; p += 1) {
    await page.goto(`${BASE}/shipments?page=${p}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table', { timeout: 20000 });
    target = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button[aria-label^="Sửa ô lịch trình lô hàng"]'));
      const enabled = buttons.find((b) => !b.disabled);
      return enabled ? { label: enabled.getAttribute('aria-label'), id: enabled.id } : null;
    });
    if (target) log('schedule_trigger', { page: p, ...target });
  }
  if (!target) throw new Error('no enabled "Sửa ô lịch trình" trigger on pages 1..12');
  const shipmentId = Number(target.id.replace('cus-inline-schedule-', ''));

  const snapshot = async () => {
    const d = await call('GET', `/shipments/cus-workspace/${shipmentId}`);
    const s = d.body?.summary ?? {};
    return {
      version: s.version, direction: s.direction ?? null, closingAt: s.closingAt ?? null,
      plannedReturnAt: s.plannedReturnAt ?? null, transportDate: s.transportDate ?? null,
    };
  };
  const before = await snapshot();
  log('lot_snapshot', { shipmentId, ...before });

  const DIALOG_TITLE = 'Chỉnh sửa Lịch trình';
  const openDialog = async () => {
    await page.evaluate((id) => document.getElementById(id)?.scrollIntoView({ block: 'center' }), target.id);
    await sleep(150);
    const btn = await page.$(`#${target.id}`);
    await btn.click({ timeout: 5000 }).catch(async () => btn.evaluate((el) => el.click()));
    await page.waitForFunction(
      (title) => Array.from(document.querySelectorAll('.modal__title')).some((el) => (el.textContent || '').trim() === title),
      { timeout: 10000 }, DIALOG_TITLE,
    );
    await sleep(300);
    return dialogState();
  };
  const dialogState = () => page.evaluate((title) => {
    const dlg = Array.from(document.querySelectorAll('[role="dialog"]'))
      .find((m) => (m.querySelector('.modal__title')?.textContent || '').trim() === title) ?? null;
    const a = document.activeElement;
    return {
      dialogOpen: Boolean(dlg),
      activeTag: a?.tagName ?? null,
      activeLabel: a?.getAttribute('aria-label') ?? null,
      activeSeg: a?.getAttribute('data-seg') ?? null,
      timeValue: dlg?.querySelector('.time-input input')?.value ?? null,
      dayValue: dlg?.querySelector('[data-seg="dd"]')?.value ?? null,
      popupOpen: Boolean(document.querySelector('.time-picker__popup')),
      alertText: Array.from(dlg?.querySelectorAll('[role="alert"]') ?? []).map((e) => e.textContent?.trim()).join('|') || null,
      noticeText: document.querySelector('.app-notices, [role="status"]')?.textContent?.trim() ?? null,
    };
  }, DIALOG_TITLE);
  const closeDialog = async () => {
    await page.evaluate((title) => {
      const dlg = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((m) => (m.querySelector('.modal__title')?.textContent || '').trim() === title);
      Array.from(dlg?.querySelectorAll('button') ?? []).find((b) => (b.textContent || '').trim() === 'Hủy')?.click();
    }, DIALOG_TITLE);
    await sleep(400);
  };

  // ── P1 (FB-002, scenario A — lot WITHOUT date): click giờ, type, Enter ──
  let st = await openDialog();
  log('P1_dialog_open', st);
  await page.screenshot({ path: path.join(OUT, 'P1_dialog-open.png') });
  let timeInput = await page.$(`[role="dialog"] .time-input input`);
  await timeInput.click({ clickCount: 3 });
  await page.keyboard.type('1430', { delay: 90 });
  await sleep(250);
  st = await dialogState();
  log('P1_after_typing_1430', st);
  mutations.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1400);
  st = await dialogState();
  log('P1_after_enter', { ...st, mutations: mutations.length });
  await page.screenshot({ path: path.join(OUT, 'P1_after-enter.png') });
  record(
    'P1 no-date lot: typed "14:30" + Enter → save attempt ran and the date-guard error is VISIBLE (no silent dead key)',
    Boolean(st.alertText && st.alertText.includes('Chọn ngày đóng/trả trước khi nhập giờ')),
    `mutations=${mutations.length} dialogOpen=${st.dialogOpen} timeValue=${st.timeValue} alert=${st.alertText}`,
  );
  if (st.dialogOpen) await closeDialog();

  // ── P3 (FB-030): click giờ, type "14" — focus/popup state ───────────────
  st = await openDialog();
  timeInput = await page.$(`[role="dialog"] .time-input input`);
  await timeInput.click();
  await sleep(350);
  st = await dialogState();
  log('P3_after_click', st);
  await page.keyboard.type('14', { delay: 90 });
  await sleep(350);
  st = await dialogState();
  log('P3_after_typing_14', st);
  await page.screenshot({ path: path.join(OUT, 'P3_after-typing-14.png') });
  record('P3 giờ "14" typed — state captured (probe)', true, JSON.stringify(st));
  await closeDialog();

  // ── P4 (FB-030): dialog date segment dd → mm2 ───────────────────────────
  st = await openDialog();
  const dd = await page.$(`[role="dialog"] [data-seg="dd"]`);
  if (dd) {
    await dd.click();
    await page.keyboard.type('18', { delay: 90 });
    await sleep(350);
    st = await dialogState();
    log('P4_after_typing_18', st);
    await page.screenshot({ path: path.join(OUT, 'P4_after-typing-18.png') });
    record('P4 dialog "Ngày đóng/trả" day "18" → focus month', st.activeSeg === 'mm2', JSON.stringify(st));
  } else {
    record('P4 dialog date segment', false, 'no [data-seg="dd"] in dialog');
  }
  await closeDialog();

  // ── Fixture: give the lot a date + closing time via API (restored later) ─
  const setFixture = await call('PUT', `/shipments/${shipmentId}`, {
    expectedVersion: (await snapshot()).version,
    expectedDeliveryDate: '2026-10-20',
    closingAt: '2026-10-20T07:30:00.000Z',
  });
  log('fixture_patch', { status: setFixture.status });
  // The fixture changed transportDate, which re-sorts the list — find the
  // trigger again by paging instead of assuming the same page.
  for (let p = 1; p <= 12; p += 1) {
    await page.goto(`${BASE}/shipments?page=${p}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table', { timeout: 20000 });
    const found = await page.evaluate((id) => {
      const b = document.getElementById(id);
      return Boolean(b && !b.disabled);
    }, target.id);
    if (found) break;
  }
  await page.waitForSelector(`#${target.id}`, { timeout: 20000 });

  // ── P2 (FB-002, scenario B — lot WITH date): click giờ, type-over, Enter ─
  st = await openDialog();
  log('P2_dialog_open', st);
  await page.screenshot({ path: path.join(OUT, 'P2_dialog-open.png') });
  timeInput = await page.$(`[role="dialog"] .time-input input`);
  await timeInput.click({ clickCount: 3 });
  await page.keyboard.type('1430', { delay: 90 });
  await sleep(250);
  st = await dialogState();
  log('P2_after_typing_1430', st);
  mutations.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1600);
  st = await dialogState();
  log('P2_after_enter', { ...st, mutations: mutations.length });
  await page.screenshot({ path: path.join(OUT, 'P2_after-enter.png') });
  record(
    'P2 with-date lot: typed "14:30" + Enter (clicked input) → dialog saved (PUT fired + closed)',
    mutations.length > 0 && !st.dialogOpen,
    `mutations=${mutations.length} dialogOpen=${st.dialogOpen} timeValue=${st.timeValue} alert=${st.alertText}`,
  );

  // ── P2b: same, but WITHOUT clicking first (autoFocus + Cmd+A type-over) ──
  if (st.dialogOpen) await closeDialog();
  st = await openDialog();
  await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta');
  await page.keyboard.type('1630', { delay: 90 });
  await sleep(250);
  st = await dialogState();
  log('P2b_after_typing_1630', st);
  mutations.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1600);
  st = await dialogState();
  log('P2b_after_enter', { ...st, mutations: mutations.length });
  await page.screenshot({ path: path.join(OUT, 'P2b_after-enter.png') });
  record(
    'P2b with-date lot: typed "16:30" + Enter (no click, picker closed) → saved',
    mutations.length > 0 && !st.dialogOpen,
    `mutations=${mutations.length} dialogOpen=${st.dialogOpen} timeValue=${st.timeValue} alert=${st.alertText}`,
  );
  if (st.dialogOpen) await closeDialog();

  // ── Restore ──────────────────────────────────────────────────────────────
  const now = await snapshot();
  const restored = await call('PUT', `/shipments/${shipmentId}`, {
    expectedVersion: now.version,
    expectedDeliveryDate: before.transportDate,
    closingAt: before.closingAt,
    plannedReturnAt: before.plannedReturnAt,
  });
  const check = await snapshot();
  const ok = check.transportDate === before.transportDate && check.closingAt === before.closingAt && check.plannedReturnAt === before.plannedReturnAt;
  log('restore', { patchStatus: restored.status, before, after: check, ok });
  record('restore: lot 130022 fields back to original', ok, JSON.stringify({ before, after: check }));

  await page.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}

fs.writeFileSync(path.join(OUT, 'repro-driver.log'), JSON.stringify(LOG, null, 2));
fs.writeFileSync(path.join(OUT, 'repro-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
