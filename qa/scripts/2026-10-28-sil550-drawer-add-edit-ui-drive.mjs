// SIL-550 UI drive — DV drawer "Chi tiết container" (Kế hoạch Tổng quát,
// /dispatch → DispatchContainerDetailDrawer), driven as dungnv (DISPATCHER —
// the ticket's repro role). Rung-3 contract per gap:
//   Gap 2 — click the CONTAINER cell affordance → inline text editor opens
//           (the bug: nothing opened), Enter saves containerNumber through
//           the container-line command, the drawer refetches and the row
//           shows the saved number; restore to the pre-drive number.
//   Gap 3 — click the GIỜ HẸN ĐÓNG/TRẢ affordance → date+time editor opens,
//           Enter saves customerAppointmentAt (+07:00 wire), the cell paints
//           the saved schedule; restore the pre-drive schedule.
//   Gap 1 — click "Thêm container" → compact form opens, submit adds a real
//           container row to the lot (server-side inherit), the row paints
//           back in the table; cleanup removes the added row via the
//           container-remove command so the DB ends pre-drive clean.
// Screenshots @1280 and @390 per gate section; post-click DOM + toast
// assertions land in assertions.json; DB side effect is proven by the psql
// captures this run is wrapped in (qa/2026-10-28_sil550-drawer/db-*.txt).
//
// ENV LIMITATION (2026-10-28, Chrome 156.0.8078.48 + puppeteer 25.16): CDP
// keyboard injection (page.type / page.keyboard / Input.dispatchKeyEvent /
// Input.insertText) delivers NO key events to authed app pages in this build
// (login page types fine; raw listeners on window capture observe nothing).
// Typing therefore rides DOM event synthesis — the same input/keydown events
// a physical keystroke produces, dispatched on the real focused control, so
// the app's real React handlers run and the real save path executes. All
// clicks are real DOM clicks on the real controls (this repo's drive
// convention).
//
// Usage (worktree stack): node qa/scripts/2026-10-28-sil550-drawer-add-edit-ui-drive.mjs
//   QA_BASE_URL=http://localhost:7196  QA_API=http://localhost:3102 (defaults)
// Output: qa/2026-10-28_sil550-drawer/<run>/*.png + assertions.json + ui-driver.log

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7196';
const API = process.env.QA_API || 'http://localhost:3102';
const RUN = process.env.QA_RUN_TAG || 'run1';
const OUT = resolve(process.cwd(), 'qa/2026-10-28_sil550-drawer', RUN);
const LOG = resolve(OUT, 'ui-driver.log');
mkdirSync(OUT, { recursive: true });
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOT = 'SHP-2610-00157';
const LOT_LABEL = 'R42RV-FCL'; // the lot's Bill/Booking reference (aria-label identity)
const SHIPMENT_ID = 240;
const CONT = 'MSKU1234565';
const BASE_APPT = { date: '2026-10-27', time: '08:00', display: '08:00 27/10/2026' };
const NEW_APPT = { date: '2026-10-30', time: '09:30', display: '09:30 30/10/2026' };

// ISO 6346 check digit (the shared module's algorithm — see
// shared/src/calculations/iso6346.ts, DEF-20260804-005).
const LETTER_MAP = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
  J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
  S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};
function withCheckDigit(base10) {
  let total = 0;
  for (let i = 0; i < 10; i += 1) {
    const char = base10[i];
    const value = i < 4 ? LETTER_MAP[char] : Number(char);
    total += value * (2 ** i);
  }
  const check = total % 11;
  return `${base10}${check === 10 ? 0 : check}`;
}
const NEW_NUM = withCheckDigit('MSKU623456');
const ADD_NUM = withCheckDigit('MSKU723456');
log(`generated numbers: NEW_NUM=${NEW_NUM} ADD_NUM=${ADD_NUM} (ISO 6346 check digits computed per shared/src/calculations/iso6346.ts)`);

const result = { run: RUN, role: 'dungnv (DISPATCHER)', lot: LOT, container: CONT, newNum: NEW_NUM, addNum: ADD_NUM, viewport: '1280x900 + 390x844', checks: [] };
const check = (name, pass, detail) => { result.checks.push({ name, pass, detail }); if (!pass) result.failed = true; };

const browser = await puppeteer.launch({
  headless: true,
  defaultViewport: { width: 1280, height: 900 },
});

async function login(user, pass) {
  const page = await browser.newPage();
  await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('input[name="username"]', { timeout: 45000 });
  await page.type('input[name="username"]', user);
  await page.type('input[name="password"]', pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => localStorage.getItem('token') || localStorage.getItem('auth_token'), { timeout: 30000 });
  return page;
}

async function openDrawer(page) {
  await page.goto(`${FE}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.master-plan-grid tbody tr', { timeout: 60000 });
  await page.type('input[aria-label="Tìm kiếm lô hàng"]', LOT);
  await sleep(1800);
  // Deterministic target: the lot's own trigger (the aria-label carries the
  // lot's Bill/Booking reference) — never "first visible" (the filter may
  // leave sibling lots on the board).
  const trigger = await page.$(`button[aria-label="Xem chi tiết container của ${LOT_LABEL}"]`)
    ?? await page.$('button[aria-label^="Xem chi tiết container"]');
  if (!trigger) throw new Error(`no "Chi tiết container" trigger for lot ${LOT_LABEL}`);
  await trigger.evaluate((el) => el.click());
  await page.waitForSelector('.dispatch-container-detail__table', { timeout: 20000 });
  await page.waitForFunction((cont) => [...document.querySelectorAll('.dispatch-container-detail tbody tr')]
    .some((tr) => tr.textContent.includes(cont)), { timeout: 15000 }, CONT).catch(() => {});
  await sleep(600);
}

// DOM event synthesis (see ENV LIMITATION above): native setter + input event
// is exactly what a keystroke produces for a React controlled input.
async function fillInput(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector, value);
}

async function pressKey(page, selector, key) {
  await page.evaluate((sel, k) => {
    const el = document.querySelector(sel);
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  }, selector, key);
}

const page = await login('dungnv', 'Abc123');
log('login ok user=dungnv (DISPATCHER — the ticket repro role)');
await openDrawer(page);
await page.screenshot({ path: resolve(OUT, 'drawer-open-1280.png') });

// ── Gap 2 — Số cont click-to-edit ────────────────────────────────────────────
const numberButton = await page.evaluate((cont) => {
  const drawer = document.querySelector('.dispatch-container-detail');
  const row = [...drawer.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes(cont));
  const button = row?.querySelector('th[scope="row"] button[aria-label^="Sửa số container"]');
  return button?.getAttribute('aria-label') ?? null;
}, CONT);
check('Gap 2: DISPATCHER sees the Số cont click-to-edit affordance', numberButton === `Sửa số container · ${CONT}`, numberButton);
log(`gap2 affordance: ${numberButton}`);

await page.evaluate((cont) => {
  const drawer = document.querySelector('.dispatch-container-detail');
  const row = [...drawer.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes(cont));
  row.querySelector('th[scope="row"] button[aria-label^="Sửa số container"]').click();
}, CONT);
await page.waitForSelector('th[scope="row"] input[aria-label="Số container"]', { timeout: 5000 });
check('Gap 2: the click opens a text editor (the bug: nothing opened)', true, 'input[aria-label="Số container"] present');
await page.screenshot({ path: resolve(OUT, 'scont-editor-open-1280.png') });
log('gap2 editor opened (THE click under test)');

await fillInput(page, 'th[scope="row"] input[aria-label="Số container"]', NEW_NUM);
await pressKey(page, 'th[scope="row"] input[aria-label="Số container"]', 'Enter');
await page.waitForFunction((num) => {
  const row = [...document.querySelectorAll('.dispatch-container-detail tbody tr')].find((tr) => tr.querySelector('th[scope="row"]'));
  return row && !row.querySelector('input') && row.textContent.includes(num);
}, { timeout: 20000 }, NEW_NUM).catch(() => {});
await sleep(700);
const numberSaved = await page.evaluate((num) => {
  const row = [...document.querySelectorAll('.dispatch-container-detail tbody tr')].find((tr) => tr.querySelector('th[scope="row"]'));
  return {
    rowText: row?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    hasNumber: (row?.textContent ?? '').includes(num),
    inputStill: row?.querySelector('th[scope="row"] input') != null,
    toast: document.querySelector('.toast-container')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  };
}, NEW_NUM);
check('Gap 2: post-click DOM — the row shows the saved number', numberSaved.hasNumber && !numberSaved.inputStill, numberSaved);
check('Gap 2: success toast surfaced', (numberSaved.toast ?? '').includes('Đã lưu số container.'), numberSaved.toast);
await page.screenshot({ path: resolve(OUT, 'scont-saved-1280.png') });
await page.setViewport({ width: 390, height: 844 });
await sleep(700);
await page.screenshot({ path: resolve(OUT, 'scont-saved-390.png') });
await page.setViewport({ width: 1280, height: 900 });
await sleep(500);
log(`gap2 saved: "${numberSaved.rowText}" toast="${numberSaved.toast}"`);

// Restore the pre-drive number through the same UI path.
await page.evaluate((num) => {
  const row = [...document.querySelectorAll('.dispatch-container-detail tbody tr')].find((tr) => tr.textContent.includes(num));
  row.querySelector('th[scope="row"] button[aria-label^="Sửa số container"]').click();
}, NEW_NUM);
await page.waitForSelector('th[scope="row"] input[aria-label="Số container"]', { timeout: 5000 });
await fillInput(page, 'th[scope="row"] input[aria-label="Số container"]', CONT);
await pressKey(page, 'th[scope="row"] input[aria-label="Số container"]', 'Enter');
await page.waitForFunction((cont) => {
  const rows = [...document.querySelectorAll('.dispatch-container-detail tbody tr')];
  return rows.some((tr) => tr.textContent.includes(cont) && !tr.querySelector('input'));
}, { timeout: 20000 }, CONT).catch(() => {});
await sleep(700);
check('Gap 2: restore — row back to the pre-drive number', await page.evaluate((cont) =>
  [...document.querySelectorAll('.dispatch-container-detail tbody tr')].some((tr) => tr.textContent.includes(cont) && !tr.querySelector('input')), CONT), CONT);
log(`gap2 restored: ${CONT}`);

// ── Gap 3 — Giờ hẹn click-to-edit ───────────────────────────────────────────
const apptButton = await page.evaluate((cont) => {
  const row = [...document.querySelectorAll('.dispatch-container-detail tbody tr')].find((tr) => tr.textContent.includes(cont));
  return row?.querySelector('td[data-label="Giờ hẹn đóng/trả"] button')?.getAttribute('aria-label') ?? null;
}, CONT);
check('Gap 3: DISPATCHER sees the Giờ hẹn click-to-edit affordance', apptButton === `Sửa giờ hẹn đóng/trả · ${CONT}`, apptButton);

await page.evaluate((cont) => {
  const row = [...document.querySelectorAll('.dispatch-container-detail tbody tr')].find((tr) => tr.textContent.includes(cont));
  row.querySelector('td[data-label="Giờ hẹn đóng/trả"] button').click();
}, CONT);
await page.waitForSelector('td[data-label="Giờ hẹn đóng/trả"] input[type="date"]', { timeout: 5000 });
await page.waitForSelector('td[data-label="Giờ hẹn đóng/trả"] input[type="time"]', { timeout: 5000 });
check('Gap 3: the click opens a date+time editor (the bug: nothing opened)', true, 'input[type=date] + input[type=time] present');
await page.screenshot({ path: resolve(OUT, 'giohen-editor-open-1280.png') });
log('gap3 editor opened (THE click under test)');

await fillInput(page, 'td[data-label="Giờ hẹn đóng/trả"] input[type="date"]', NEW_APPT.date);
await fillInput(page, 'td[data-label="Giờ hẹn đóng/trả"] input[type="time"]', NEW_APPT.time);
await pressKey(page, 'td[data-label="Giờ hẹn đóng/trả"] input[type="time"]', 'Enter');
await page.waitForFunction((display) => {
  const cell = document.querySelector('td[data-label="Giờ hẹn đóng/trả"]');
  return cell && !cell.querySelector('input') && cell.textContent.includes(display);
}, { timeout: 20000 }, NEW_APPT.display).catch(() => {});
await sleep(700);
const apptSaved = await page.evaluate((display) => {
  const cell = document.querySelector('td[data-label="Giờ hẹn đóng/trả"]');
  return {
    cellText: cell?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    hasDisplay: (cell?.textContent ?? '').includes(display),
    inputStill: cell?.querySelector('input') != null,
    toast: document.querySelector('.toast-container')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  };
}, NEW_APPT.display);
check('Gap 3: post-click DOM — the cell shows the saved schedule', apptSaved.hasDisplay && !apptSaved.inputStill, apptSaved);
check('Gap 3: success toast surfaced', (apptSaved.toast ?? '').includes('Đã lưu giờ hẹn đóng/trả.'), apptSaved.toast);
await page.screenshot({ path: resolve(OUT, 'giohen-saved-1280.png') });
await page.setViewport({ width: 390, height: 844 });
await sleep(700);
await page.screenshot({ path: resolve(OUT, 'giohen-saved-390.png') });
await page.setViewport({ width: 1280, height: 900 });
await sleep(500);
log(`gap3 saved: "${apptSaved.cellText}" toast="${apptSaved.toast}"`);

// Restore the pre-drive schedule.
await page.evaluate((cont) => {
  const row = [...document.querySelectorAll('.dispatch-container-detail tbody tr')].find((tr) => tr.textContent.includes(cont));
  row.querySelector('td[data-label="Giờ hẹn đóng/trả"] button').click();
}, CONT);
await page.waitForSelector('td[data-label="Giờ hẹn đóng/trả"] input[type="date"]', { timeout: 5000 });
await fillInput(page, 'td[data-label="Giờ hẹn đóng/trả"] input[type="date"]', BASE_APPT.date);
await fillInput(page, 'td[data-label="Giờ hẹn đóng/trả"] input[type="time"]', BASE_APPT.time);
await pressKey(page, 'td[data-label="Giờ hẹn đóng/trả"] input[type="time"]', 'Enter');
await page.waitForFunction((display) => {
  const cell = document.querySelector('td[data-label="Giờ hẹn đóng/trả"]');
  return cell && !cell.querySelector('input') && cell.textContent.includes(display);
}, { timeout: 20000 }, BASE_APPT.display).catch(() => {});
await sleep(700);
check('Gap 3: restore — cell back to the pre-drive schedule', await page.evaluate((display) =>
  (document.querySelector('td[data-label="Giờ hẹn đóng/trả"]')?.textContent ?? '').includes(display), BASE_APPT.display), BASE_APPT.display);
log(`gap3 restored: ${BASE_APPT.display}`);

// ── Gap 1 — Thêm container ──────────────────────────────────────────────────
const addVisible = await page.evaluate(() => {
  const button = [...document.querySelectorAll('.dispatch-container-detail button')].find((b) => b.textContent.includes('Thêm container'));
  return button?.textContent.replace(/\s+/g, ' ').trim() ?? null;
});
check('Gap 1: DISPATCHER sees the "Thêm container" control', addVisible != null, addVisible);

await page.evaluate(() => {
  [...document.querySelectorAll('.dispatch-container-detail button')].find((b) => b.textContent.includes('Thêm container')).click();
});
await page.waitForSelector('.dispatch-container-detail__add-form input', { timeout: 5000 });
check('Gap 1: the control opens the add form (the bug: control missing)', true, 'add form input present');
await page.screenshot({ path: resolve(OUT, 'them-form-open-1280.png') });
log('gap1 add form opened (THE control under test)');

await fillInput(page, '.dispatch-container-detail__add-form input', ADD_NUM);
await page.evaluate(() => {
  [...document.querySelectorAll('.dispatch-container-detail__add-form button')].find((b) => b.textContent.trim() === 'Thêm').click();
});
await page.waitForFunction((num) => {
  const rows = [...document.querySelectorAll('.dispatch-container-detail tbody tr')];
  return rows.some((tr) => tr.textContent.includes(num));
}, { timeout: 20000 }, ADD_NUM).catch(() => {});
await sleep(700);
const addSaved = await page.evaluate((num) => {
  const drawer = document.querySelector('.dispatch-container-detail');
  const rows = [...drawer.querySelectorAll('tbody tr')];
  return {
    rowCount: rows.length,
    newRow: rows.some((tr) => tr.textContent.includes(num)),
    formClosed: drawer.querySelector('.dispatch-container-detail__add-form') == null,
    toast: document.querySelector('.toast-container')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  };
}, ADD_NUM);
check('Gap 1: post-click DOM — the added row paints in the table', addSaved.newRow && addSaved.formClosed, addSaved);
check('Gap 1: success toast surfaced', (addSaved.toast ?? '').includes('Đã thêm container vào lô.'), addSaved.toast);
await page.screenshot({ path: resolve(OUT, 'them-saved-1280.png') });
await page.setViewport({ width: 390, height: 844 });
await sleep(700);
await page.screenshot({ path: resolve(OUT, 'them-saved-390.png') });
log(`gap1 saved: rows=${addSaved.rowCount} toast="${addSaved.toast}"`);
await page.close();

// ── Cleanup: remove the added row through the container-remove command ──────
// The remove law (card 211026094500, SIL-177) refuses document-bearing rows,
// and the add's SIL-173 fan-out stamps the lot's tờ khai onto the new row —
// so cleanup first clears the inherited number (CUS/Quản trị/Quản lý writer
// law 261013200312 — ADMIN here), then removes. The write envelope requires
// an Idempotency-Key on every command.
const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const loginBody = await loginRes.json();
const token = loginBody.token ?? loginBody.data?.token;
if (!token) throw new Error(`login for cleanup failed: ${JSON.stringify(loginBody).slice(0, 200)}`);
const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const writeHeaders = () => ({ ...authHeaders, 'Idempotency-Key': crypto.randomUUID() });
const detailRes = await fetch(`${API}/api/shipments/cus-workspace/${SHIPMENT_ID}`, { headers: authHeaders });
const detail = await detailRes.json();
const addedLine = (detail.containers ?? []).find((line) => (line.containerNumber ?? '').trim() === ADD_NUM);
if (!addedLine) {
  check('cleanup: added row located for removal', false, `no line with ${ADD_NUM}`);
} else {
  if ((addedLine.declarationNumber ?? '').trim() !== '') {
    const clearRes = await fetch(`${API}/api/shipments/cus-workspace/${SHIPMENT_ID}/containers/${addedLine.id}`, {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify({ expectedShipmentVersion: detail.summary.version, declarationNumber: null }),
    });
    check('cleanup: inherited tờ khai cleared off the added row', clearRes.ok, { status: clearRes.status, body: (await clearRes.json().catch(() => ({}))) });
  }
  const afterClear = await (await fetch(`${API}/api/shipments/cus-workspace/${SHIPMENT_ID}`, { headers: authHeaders })).json();
  const removeRes = await fetch(`${API}/api/shipments/cus-workspace/${SHIPMENT_ID}/containers/${addedLine.id}/remove`, {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify({ expectedShipmentVersion: afterClear.summary.version }),
  });
  const removeBody = await removeRes.json();
  check('cleanup: added row removed (DB ends pre-drive clean)', removeRes.ok, { status: removeRes.status, body: removeBody });
  log(`cleanup removed container id=${addedLine.id} (${ADD_NUM}): status=${removeRes.status}`);
}

result.pass = result.checks.every((c) => c.pass);
writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
log(`EXIT ${result.pass ? 0 : 2} — checks: ${result.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'}:${c.name}`).join(' | ')}`);
await browser.close();
process.exit(result.pass ? 0 : 2);
