// FB-002 LAN 3 (card 211026034109): "enter ở ô giờ không lưu, mất trắng input"
// Staging repro on build 9d60f507 — https://vantai.tingting.vip, CUS tiepvv.
//
// Surfaces: /shipments dialog "Chỉnh sửa Lịch trình" (LCL row, Tổng quan).
// Probes isolate WHERE Enter dies and whether typed input is wiped:
//   R1 autoFocus + Cmd+A type-over "1630" + Enter        (picker closed path)
//   R2 CLICK giờ (picker opens) + "1430" (onComplete advance) + Enter
//      → Enter lands in the DATE field after auto-advance — save?
//   R3 CLICK giờ + "14:30" typed with colon + Enter      (2e1a762b verified)
//   R4 no-date lot: CLICK giờ + "1430" + Enter → date-guard alert, value kept?
//   R5 R2 + second Enter (user retries)
// Usage: node testplan/qa/scripts/2026-10-21-fb002-lan3-staging-repro.mjs
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

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });

try {
  const token = await login('tiepvv');
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

  // ── Collect enabled LCL schedule triggers + lot facts by paging ─────────
  const candidates = [];
  for (let p = 1; p <= 15; p += 1) {
    await page.goto(`${BASE}/shipments?page=${p}`, { waitUntil: 'networkidle2', timeout: 60000 });
    try { await page.waitForSelector('table', { timeout: 15000 }); } catch { break; }
    const found = await page.evaluate(() => Array.from(document.querySelectorAll('button[aria-label^="Sửa ô lịch trình lô hàng"]'))
      .filter((b) => !b.disabled)
      .map((b) => ({ label: b.getAttribute('aria-label'), id: b.id })));
    for (const f of found) candidates.push({ page: p, ...f });
    if (candidates.length >= 8) break;
  }
  log('triggers', { count: candidates.length });

  // Classify: with-date vs no-date (schedule save needs a date to pass the guard)
  let withDate = null;
  let noDate = null;
  for (const c of candidates) {
    const id = Number(c.id.replace('cus-inline-schedule-', ''));
    const d = await call('GET', `/shipments/cus-workspace/${id}`);
    const s = d.body?.summary ?? {};
    const lot = { ...c, shipmentId: id, version: s.version, closingAt: s.closingAt ?? null, plannedReturnAt: s.plannedReturnAt ?? null, transportDate: s.transportDate ?? null, cargoMode: s.cargoMode ?? null };
    log('candidate', lot);
    if (!withDate && lot.transportDate) withDate = lot;
    if (!noDate && !lot.transportDate) noDate = lot;
    if (withDate && noDate) break;
  }
  if (!withDate) throw new Error('no enabled with-date LCL schedule lot found on pages 1..15');
  log('targets', { withDate: withDate.shipmentId, noDate: noDate?.shipmentId ?? null });

  const snapshot = async (lot) => {
    const d = await call('GET', `/shipments/cus-workspace/${lot.shipmentId}`);
    const s = d.body?.summary ?? {};
    return { version: s.version, closingAt: s.closingAt ?? null, plannedReturnAt: s.plannedReturnAt ?? null, transportDate: s.transportDate ?? null };
  };
  const restore = async (lot, before) => {
    const now = await snapshot(lot);
    if (now.transportDate === before.transportDate && now.closingAt === before.closingAt && now.plannedReturnAt === before.plannedReturnAt) return true;
    const r = await call('PUT', `/shipments/${lot.shipmentId}`, {
      expectedVersion: now.version,
      expectedDeliveryDate: before.transportDate,
      closingAt: before.closingAt,
      plannedReturnAt: before.plannedReturnAt,
    });
    log('restore', { shipmentId: lot.shipmentId, status: r.status });
    const check = await snapshot(lot);
    return check.transportDate === before.transportDate && check.closingAt === before.closingAt && check.plannedReturnAt === before.plannedReturnAt;
  };

  const DIALOG_TITLE = 'Chỉnh sửa Lịch trình';
  const gotoLotPage = async (lot) => {
    await page.goto(`${BASE}/shipments?page=${lot.page}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector(`#${lot.id}`, { timeout: 20000 });
  };
  const openDialog = async (lot) => {
    await page.evaluate((id) => document.getElementById(id)?.scrollIntoView({ block: 'center' }), lot.id);
    await sleep(150);
    const btn = await page.$(`#${lot.id}`);
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
      activeClass: a?.className ?? null,
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

  // ══ R1: autoFocus + Cmd+A type-over + Enter (picker closed) ═════════════
  await gotoLotPage(withDate);
  const before1 = await snapshot(withDate);
  let st = await openDialog(withDate);
  log('R1_dialog_open', st);
  await page.screenshot({ path: path.join(OUT, 'R1_dialog-open.png') });
  await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta');
  await page.keyboard.type('1630', { delay: 90 });
  await sleep(250);
  st = await dialogState();
  log('R1_after_typing_1630', st);
  mutations.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1600);
  st = await dialogState();
  log('R1_after_enter', { ...st, mutations: mutations.length });
  await page.screenshot({ path: path.join(OUT, 'R1_after-enter.png') });
  const r1Saved = mutations.length > 0 && !st.dialogOpen;
  record('R1 autoFocus type-over "16:30" + Enter → PUT fired + dialog saved',
    r1Saved, `mutations=${mutations.length} dialogOpen=${st.dialogOpen} timeValue=${st.timeValue} notice=${st.noticeText} alert=${st.alertText}`);
  await restore(withDate, before1);
  if (await dialogState().then((s) => s.dialogOpen)) await closeDialog();

  // ══ R2: CLICK giờ (picker opens) + "1430" (auto-advance) + Enter ════════
  await gotoLotPage(withDate);
  const before2 = await snapshot(withDate);
  st = await openDialog(withDate);
  const timeInput = await page.$(`[role="dialog"] .time-input input`);
  await timeInput.click();
  await sleep(350);
  st = await dialogState();
  log('R2_after_click', st);
  await page.keyboard.type('1430', { delay: 90 });
  await sleep(350);
  st = await dialogState();
  log('R2_after_typing_1430', st);
  await page.screenshot({ path: path.join(OUT, 'R2_after-typing-1430.png') });
  mutations.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1600);
  st = await dialogState();
  log('R2_after_enter', { ...st, mutations: mutations.length });
  await page.screenshot({ path: path.join(OUT, 'R2_after-enter.png') });
  record('R2 click giờ + "1430" (advance) + Enter → PUT fired + saved',
    mutations.length > 0 && !st.dialogOpen,
    `mutations=${mutations.length} dialogOpen=${st.dialogOpen} focus=${st.activeLabel ?? st.activeSeg} timeValue=${st.timeValue} notice=${st.noticeText} alert=${st.alertText}`);
  if (mutations.length > 0) await restore(withDate, before2);

  // ══ R5: R2 + second Enter (user retries after dead first Enter) ═════════
  if (st.dialogOpen) {
    mutations.length = 0;
    await page.keyboard.press('Enter');
    await sleep(1600);
    st = await dialogState();
    log('R5_after_second_enter', { ...st, mutations: mutations.length });
    await page.screenshot({ path: path.join(OUT, 'R5_after-second-enter.png') });
    record('R5 second Enter after advance-dead first → saved?',
      mutations.length > 0 && !st.dialogOpen,
      `mutations=${mutations.length} dialogOpen=${st.dialogOpen} timeValue=${st.timeValue}`);
    if (mutations.length > 0) await restore(withDate, before2);
    if (st.dialogOpen) await closeDialog();
  }

  // ══ R3: CLICK giờ + "14:30" with colon + Enter (2e1a762b path) ══════════
  await gotoLotPage(withDate);
  const before3 = await snapshot(withDate);
  st = await openDialog(withDate);
  const timeInput3 = await page.$(`[role="dialog"] .time-input input`);
  await timeInput3.click({ clickCount: 3 });
  await sleep(200);
  await page.keyboard.type('14:30', { delay: 90 });
  await sleep(250);
  st = await dialogState();
  log('R3_after_typing_1430colon', st);
  mutations.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1600);
  st = await dialogState();
  log('R3_after_enter', { ...st, mutations: mutations.length });
  await page.screenshot({ path: path.join(OUT, 'R3_after-enter.png') });
  record('R3 click giờ + "14:30" colon-typed + Enter → PUT fired + saved',
    mutations.length > 0 && !st.dialogOpen,
    `mutations=${mutations.length} dialogOpen=${st.dialogOpen} timeValue=${st.timeValue} notice=${st.noticeText} alert=${st.alertText}`);
  if (mutations.length > 0) await restore(withDate, before3);
  if (st.dialogOpen) await closeDialog();

  // ══ R4: no-date lot — guard must show error AND keep typed value ════════
  if (noDate) {
    await gotoLotPage(noDate);
    st = await openDialog(noDate);
    const timeInput4 = await page.$(`[role="dialog"] .time-input input`);
    await timeInput4.click();
    await sleep(300);
    await page.keyboard.type('1430', { delay: 90 });
    await sleep(300);
    st = await dialogState();
    log('R4_after_typing_1430', st);
    mutations.length = 0;
    await page.keyboard.press('Enter');
    await sleep(1400);
    st = await dialogState();
    log('R4_after_enter', { ...st, mutations: mutations.length });
    await page.screenshot({ path: path.join(OUT, 'R4_after-enter.png') });
    record('R4 no-date lot: "14:30" + Enter → date-guard alert visible, time value KEPT (no wipe)',
      Boolean(st.alertText && st.alertText.includes('Chọn ngày đóng/trả')) && st.timeValue === '14:30',
      `mutations=${mutations.length} dialogOpen=${st.dialogOpen} timeValue=${st.timeValue} alert=${st.alertText}`);
    if (st.dialogOpen) await closeDialog();
  }

  await page.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}

fs.writeFileSync(path.join(OUT, 'staging-repro-driver.log'), JSON.stringify(LOG, null, 2));
fs.writeFileSync(path.join(OUT, 'staging-repro-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
