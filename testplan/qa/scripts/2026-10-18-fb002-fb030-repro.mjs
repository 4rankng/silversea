// FB-002 + FB-030/075 — segmented date/time input regression repro (LOCAL dev).
// Tickets: 181026000027-fb002 (typed time + Enter does not save), 171026215500-fb030-075
// (typing '14' in the hour segment does not auto-advance; /shipments "Từ ngày" date
// segment the same).
// Usage: node testplan/qa/scripts/2026-10-18-fb002-fb030-repro.mjs
// Phases:
//   A (admin) /shipments filter "Từ ngày": click day segment, type '17', expect focus on month.
//   B (cus)   /shipments drawer appointment popover: click hour, type '14' (expect minute focus),
//             '30' (expect date focus), full date, Enter → expect popover closed + appointment saved.
// The appointment probe snapshots and restores the original value via the API.
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-18_fb002-fb030_repro');
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

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash });
if (!health.buildHash) { console.error('no buildHash — abort'); process.exit(2); }

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

const segState = (page) => page.evaluate(() => {
  const active = document.activeElement;
  return {
    activeSeg: active?.getAttribute('data-seg') ?? null,
    activeLabel: active?.getAttribute('aria-label') ?? null,
    activeTag: active?.tagName ?? null,
    hour: document.querySelector('[data-seg-part="time"] [data-seg="hh"]')?.value ?? null,
    minute: document.querySelector('[data-seg-part="time"] [data-seg="mm"]')?.value ?? null,
    day: document.querySelector('[data-seg-part="date"] [data-seg="dd"]')?.value ?? null,
    month: document.querySelector('[data-seg-part="date"] [data-seg="mm2"]')?.value ?? null,
    year: document.querySelector('[data-seg-part="date"] [data-seg="yyyy"]')?.value ?? null,
  };
});

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });

// ── Phase A: admin /shipments "Từ ngày" date auto-advance (FB-030/075) ─────
try {
  const token = await login('admin');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.date-range-fields__from [data-seg="dd"]', { timeout: 20000 });

  const day = await page.$('.date-range-fields__from [data-seg="dd"]');
  await day.click();
  await page.keyboard.type('17', { delay: 80 });
  await new Promise((r) => setTimeout(r, 250));
  const after = await segState(page);
  log('phaseA_after_typing_17', after);
  await page.screenshot({ path: path.join(OUT, 'phaseA_tu-ngay_after-17.png') });

  record(
    'FB-030/075-A: /shipments "Từ ngày" day "17" → focus moves to month',
    after.activeSeg === 'mm2' && after.day === '17',
    `activeSeg=${after.activeSeg} day=${after.day} month=${after.month}`,
  );

  // Continue typing the month to confirm the chain keeps advancing.
  await page.keyboard.type('10', { delay: 80 });
  await new Promise((r) => setTimeout(r, 250));
  const afterMonth = await segState(page);
  log('phaseA_after_typing_10', afterMonth);
  record(
    'FB-030/075-A2: month "10" → focus moves to year',
    afterMonth.activeSeg === 'yyyy' && afterMonth.month === '10',
    `activeSeg=${afterMonth.activeSeg} month=${afterMonth.month}`,
  );
  await page.close();
  // ── Phase A2: prefilled "Từ ngày" (URL param) — type-over path ────────────
  {
    const token2 = await login('admin');
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1440, height: 900 });
    await page2.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token2);
    await page2.goto(`${BASE}/shipments?transportDateFrom=2026-10-15&transportDateTo=2026-10-17`, { waitUntil: 'networkidle2', timeout: 45000 });
    await page2.waitForSelector('.date-range-fields__from [data-seg="dd"]', { timeout: 20000 });
    const day2 = await page2.$('.date-range-fields__from [data-seg="dd"]');
    await day2.click();
    await page2.keyboard.type('17', { delay: 80 });
    await new Promise((r) => setTimeout(r, 250));
    const pre = await segState(page2);
    log('phaseA2_prefilled_after_17', pre);
    await page2.screenshot({ path: path.join(OUT, 'phaseA2_prefilled-after-17.png') });
    record(
      'FB-030/075-A2-prefilled: prefilled day typed over with "17" → focus moves to month',
      pre.activeSeg === 'mm2' && pre.day === '17',
      `activeSeg=${pre.activeSeg} day=${pre.day}`,
    );
    await page2.close();
  }
} catch (error) {
  record('phaseA', false, String(error));
}

// ── Phase B: cus /shipments drawer appointment popover (FB-030 time + FB-002 Enter) ──
try {
  const token = await login('cus');
  const call = api(token);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  // QA-residue family with an appointment-editable container on lot 85901
  // (container 40449, appointment currently null — restore = set back to null).
  await page.goto(`${BASE}/shipments?searchSuffix=rmkkyl`, { waitUntil: 'networkidle2', timeout: 45000 });

  // The drawer opens from the row's "Chi tiết" action (not the raw row click).
  await page.waitForSelector('button[aria-label^="Mở chi tiết lô hàng"]', { timeout: 20000 });
  const detailButtons = await page.$$('button[aria-label^="Mở chi tiết lô hàng"]');
  log('phaseB_rows', { buttons: detailButtons.length });
  await detailButtons[detailButtons.length - 1].click();
  await page.waitForSelector('[id^="cus-detail-drawer-"]', { timeout: 20000 });
  const shipmentId = await page.evaluate(() => {
    const el = document.querySelector('[id^="cus-detail-drawer-"]');
    return Number(el.id.replace('cus-detail-drawer-', ''));
  });
  log('phaseB_drawer', { shipmentId });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(OUT, 'phaseB_drawer-open.png') });
  const drawerButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[id^="cus-detail-drawer-"] button'))
      .slice(0, 25)
      .map((b) => ({ cls: b.className.slice?.(0, 60) ?? '', text: (b.textContent || '').trim().slice(0, 40) })),
  );
  log('phaseB_drawer_buttons', { buttons: drawerButtons });

  // Snapshot the appointment of the first appointment-editable container for restore.
  const detailBefore = await call('GET', `/shipments/cus-workspace/${shipmentId}`);
  const containers = detailBefore.body?.containers ?? [];
  const target = containers.find((c) => c.permissions?.customerAppointmentEditable) ?? null;
  log('phaseB_snapshot', {
    shipmentId,
    containerId: target?.id ?? null,
    customerAppointmentAt: target?.customerAppointmentAt ?? null,
    version: detailBefore.body?.summary?.version ?? null,
  });
  if (!target) throw new Error('no appointment-editable container in the drawer lot');

  // The ledger mounts with editing=true (useState(true)) — the appointment
  // trigger is usually already there. Only click "Chỉnh sửa" (by TEXT: the
  // same class also names "Hoàn tất" which would LEAVE edit mode) when no
  // trigger is present.
  let hasTrigger = await page.evaluate(() => Boolean(document.querySelector('button.cus-appointment-trigger')));
  if (!hasTrigger) {
    const editBtn = await page.waitForSelector('button.cus-container-edit-action', { timeout: 4000 }).catch(() => null);
    if (editBtn) {
      const label = await editBtn.evaluate((el) => (el.textContent || '').trim());
      log('phaseB_edit_button', { label });
      if (label === 'Chỉnh sửa') {
        await editBtn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await editBtn.click({ timeout: 5000 }).catch(async () => {
          await editBtn.evaluate((el) => el.click());
        });
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
  hasTrigger = await page.evaluate(() => Boolean(document.querySelector('button.cus-appointment-trigger')));
  log('phaseB_edit_state', { hasTrigger });

  const trigger = await page.waitForSelector('button.cus-appointment-trigger', { timeout: 10000 });
  await trigger.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 300));
  await trigger.click({ timeout: 5000 }).catch(async () => {
    await trigger.evaluate((el) => el.click());
  });
  await page.waitForSelector('[data-seg-part="time"] [data-seg="hh"]', { timeout: 10000 });
  await page.screenshot({ path: path.join(OUT, 'phaseB_popover-open.png') });

  // FB-030 time half: type '14' into the hour, expect auto-advance to minute.
  const hour = await page.$('[data-seg-part="time"] [data-seg="hh"]');
  await hour.click();
  await page.keyboard.type('14', { delay: 80 });
  await new Promise((r) => setTimeout(r, 250));
  const afterHour = await segState(page);
  log('phaseB_after_hour_14', afterHour);
  record(
    'FB-030/075-B: hour "14" → focus moves to minute',
    afterHour.activeSeg === 'mm' && afterHour.hour === '14',
    `activeSeg=${afterHour.activeSeg} hour=${afterHour.hour} minute=${afterHour.minute}`,
  );

  // Minute completes → hands off to the date day.
  await page.keyboard.type('30', { delay: 80 });
  await new Promise((r) => setTimeout(r, 250));
  const afterMinute = await segState(page);
  log('phaseB_after_minute_30', afterMinute);
  record(
    'FB-030/075-B2: minute "30" → focus hands off to date day',
    afterMinute.activeSeg === 'dd' && afterMinute.minute === '30',
    `activeSeg=${afterMinute.activeSeg} minute=${afterMinute.minute} day=${afterMinute.day}`,
  );

  // Complete the date: 18/10/2026.
  await page.keyboard.type('18102026', { delay: 70 });
  await new Promise((r) => setTimeout(r, 250));
  const afterDate = await segState(page);
  log('phaseB_after_date', afterDate);
  await page.screenshot({ path: path.join(OUT, 'phaseB_before-enter.png') });

  // FB-002: Enter must commit (save) the appointment and close the popover.
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1500));
  const popoverGone = await page.evaluate(() => !document.querySelector('[data-seg-part="time"]'));
  const triggerText = await page.evaluate(() => document.querySelector('button.cus-appointment-trigger')?.textContent?.trim() ?? null);
  const toastText = await page.evaluate(() => document.body.innerText.match(/Đã lưu giờ hẹn\./)?.[0] ?? null);
  log('phaseB_after_enter', { popoverGone, triggerText, toastText });
  await page.screenshot({ path: path.join(OUT, 'phaseB_after-enter.png') });
  record(
    'FB-002: typed time + Enter → popover commits and closes',
    popoverGone,
    `popoverGone=${popoverGone} triggerText=${triggerText} toast=${toastText}`,
  );

  // API side effect: the container line must carry the new appointment.
  const detailAfter = await call('GET', `/shipments/cus-workspace/${shipmentId}`);
  const lineAfter = (detailAfter.body?.containers ?? []).find((c) => c.id === target.id);
  const savedAt = lineAfter?.customerAppointmentAt ?? null;
  log('phaseB_api_after', { containerId: target.id, savedAt, before: target.customerAppointmentAt });
  record(
    'FB-002 API: container line persisted the typed appointment',
    Boolean(savedAt) && savedAt !== target.customerAppointmentAt,
    `savedAt=${savedAt} before=${target.customerAppointmentAt}`,
  );

  // Restore the original appointment (and clear the popover's UI state) via the
  // same container-line API, on the version the save returned.
  if (savedAt !== target.customerAppointmentAt) {
    const versionNow = detailAfter.body?.summary?.version ?? detailBefore.body?.summary?.version ?? 1;
    const restoreRes = await call('POST', `/shipments/cus-workspace/${shipmentId}/containers/${target.id}`, {
      expectedShipmentVersion: versionNow,
      customerAppointmentAt: target.customerAppointmentAt ?? null,
    });
    log('phaseB_restore', { status: restoreRes.status, body: restoreRes.body });
  }

  // ── Phase B2: PREFILLED appointment — the type-over path ──────────────────
  // QA's likely flow: field already shows a value; the user clicks the hour and
  // retypes it. Set an appointment first, reopen, type over '14'+'30', Enter.
  const versionAfterRestore = (await call('GET', `/shipments/cus-workspace/${shipmentId}`)).body?.summary?.version ?? 1;
  const seed = await call('POST', `/shipments/cus-workspace/${shipmentId}/containers/${target.id}`, {
    expectedShipmentVersion: versionAfterRestore,
    customerAppointmentAt: '2026-10-15T01:00:00.000Z', // 08:00 local (+07)
  });
  log('phaseB2_seed', { status: seed.status });
  await page.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('button[aria-label^="Mở chi tiết lô hàng"]', { timeout: 20000 });
  const buttons2 = await page.$$('button[aria-label^="Mở chi tiết lô hàng"]');
  await buttons2[buttons2.length - 1].click();
  await page.waitForSelector('button.cus-appointment-trigger', { timeout: 20000 });
  const trigger2 = await page.$('button.cus-appointment-trigger');
  await trigger2.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 300));
  await trigger2.click({ timeout: 5000 }).catch(async () => {
    await trigger2.evaluate((el) => el.click());
  });
  await page.waitForSelector('[data-seg-part="time"] [data-seg="hh"]', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 300));
  const prefillState = await segState(page);
  log('phaseB2_popover_prefill', prefillState);
  await page.screenshot({ path: path.join(OUT, 'phaseB2_popover-prefilled.png') });

  const hour2 = await page.$('[data-seg-part="time"] [data-seg="hh"]');
  await hour2.click();
  await page.keyboard.type('14', { delay: 80 });
  await new Promise((r) => setTimeout(r, 250));
  const overHour = await segState(page);
  log('phaseB2_after_hour_14', overHour);
  record(
    'FB-030/075-B2-typeover: prefilled hour typed over with "14" → focus moves to minute',
    overHour.activeSeg === 'mm' && overHour.hour === '14',
    `activeSeg=${overHour.activeSeg} hour=${overHour.hour}`,
  );

  await page.keyboard.type('30', { delay: 80 });
  await new Promise((r) => setTimeout(r, 250));
  const overMinute = await segState(page);
  log('phaseB2_after_minute_30', overMinute);

  // Date is still the prefilled 15/10/2026 — Enter should commit immediately.
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1500));
  const gone2 = await page.evaluate(() => !document.querySelector('[data-seg-part="time"]'));
  const toast2 = await page.evaluate(() => document.body.innerText.match(/Đã lưu giờ hẹn\./)?.[0] ?? null);
  log('phaseB2_after_enter', { gone2, toast2 });
  await page.screenshot({ path: path.join(OUT, 'phaseB2_after-enter.png') });
  record(
    'FB-002-B2: typed-over time + Enter (prefilled date) → commits',
    gone2,
    `popoverGone=${gone2} toast=${toast2}`,
  );
  const detailB2 = await call('GET', `/shipments/cus-workspace/${shipmentId}`);
  const lineB2 = (detailB2.body?.containers ?? []).find((c) => c.id === target.id);
  log('phaseB2_api_after', { savedAt: lineB2?.customerAppointmentAt ?? null });
  record(
    'FB-002-B2 API: appointment now 14:30 local',
    lineB2?.customerAppointmentAt === '2026-10-15T07:30:00.000Z',
    `savedAt=${lineB2?.customerAppointmentAt ?? null}`,
  );
  // Final restore to the original null.
  const versionB2 = detailB2.body?.summary?.version ?? 1;
  const restore2 = await call('POST', `/shipments/cus-workspace/${shipmentId}/containers/${target.id}`, {
    expectedShipmentVersion: versionB2,
    customerAppointmentAt: null,
  });
  log('phaseB2_restore', { status: restore2.status });
  await page.close();
} catch (error) {
  record('phaseB', false, String(error));
}

// ── Phase C: /shipments/new per-container appointment (combinedPicker host) ──
try {
  const token = await login('admin');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('[data-seg-part="time"] [data-seg="hh"]', { timeout: 20000 });
  const hourC = await page.$('[data-seg-part="time"] [data-seg="hh"]');
  await hourC.click();
  await new Promise((r) => setTimeout(r, 400));
  const pickerOpenAfterClick = await page.evaluate(() => Boolean(document.querySelector('[data-date-picker][role="dialog"], .combined-datetime__popup')));
  log('phaseC_click_state', { pickerOpenAfterClick });
  await page.keyboard.type('14', { delay: 80 });
  await new Promise((r) => setTimeout(r, 300));
  const afterHourC = await segState(page);
  const pickerOpenAfterDigit = await page.evaluate(() => Boolean(document.querySelector('[data-date-picker][role="dialog"], .combined-datetime__popup')));
  log('phaseC_after_hour_14', { ...afterHourC, pickerOpenAfterDigit });
  await page.screenshot({ path: path.join(OUT, 'phaseC_create-after-14.png') });
  record(
    'FB-030/075-C: create page (combinedPicker) hour "14" → focus moves to minute',
    afterHourC.activeSeg === 'mm' && afterHourC.hour === '14',
    `activeSeg=${afterHourC.activeSeg} hour=${afterHourC.hour} pickerOpenAfterClick=${pickerOpenAfterClick} pickerOpenAfterDigit=${pickerOpenAfterDigit}`,
  );
  await page.keyboard.type('30', { delay: 80 });
  await new Promise((r) => setTimeout(r, 300));
  const afterMinuteC = await segState(page);
  record(
    'FB-030/075-C2: create page minute "30" → focus hands off to date day',
    afterMinuteC.activeSeg === 'dd' && afterMinuteC.minute === '30',
    `activeSeg=${afterMinuteC.activeSeg} minute=${afterMinuteC.minute}`,
  );
  await page.close();
} catch (error) {
  record('phaseC', false, String(error));
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'repro_log.json'), JSON.stringify(LOG, null, 2));
console.log(`\nexit=${exitCode}`);
process.exit(exitCode);
