// FB-103 (ticket 171026215600) — rung-3 driver: chế độ lương PER_TRIP/FLAT_MONTHLY
// chọn được qua UI ở những chỗ QA R21 đã tìm: dialog "Sửa lương cứng" (/salary),
// dialog sửa lái xe (/fleet/drivers), và modal "Mở bảng chấm công" (/timesheet)
// khởi tạo từ chế độ của lái xe. Salary table render theo chế độ đã có test
// riêng (TimesheetReconciliationPage/MonthlyReport) — ở đây chốt DB side-effect.
//
// Usage (từ repo root, chống lại stack của worktree này):
//   BASE_URL=http://localhost:7275 API_URL=http://localhost:3092/api \
//   node testplan/qa/scripts/171026215600-fb103-salary-mode-dialog.mjs
// Artifacts -> qa/2026-10-17_fb103-salary-mode_*
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const FRONT = process.env.BASE_URL || 'http://localhost:7175';
const API = process.env.API_URL || 'http://localhost:3002/api';
const PASS = process.env.QA_PASS || 'Abc123';
const OUT_PREFIX = 'qa/2026-10-17_fb103-salary-mode';
const LOG = `${OUT_PREFIX}_ui-driver.log`;
const ASSERT = `${OUT_PREFIX}_assertions.json`;

const results = { steps: [], apiProof: {}, errors: [] };
let shotCounter = 0;

function log(line) {
  fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  console.log(line);
}

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASS }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.token || body.accessToken || body.data?.token;
}

async function apiGet(path, token) {
  const res = await fetch(`${API.replace(/\/$/, '')}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
}

async function shot(page, label) {
  shotCounter += 1;
  const file = `${OUT_PREFIX}_ui-${String(shotCounter).padStart(2, '0')}-${label}.png`;
  await page.screenshot({ path: file, fullPage: false });
  log(`shot ${file}`);
  return file;
}

async function openApp(token) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t, origin) => {
    if (location.origin === origin) localStorage.setItem('token', t);
  }, token, new URL(FRONT).origin);
  page.on('pageerror', (e) => results.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') results.errors.push(`console.error: ${m.text().slice(0, 200)}`); });
  return { browser, page };
}

async function settle(page, ms = 900) {
  await new Promise((r) => setTimeout(r, ms));
  try { await page.waitForNetworkIdle({ idleTime: 300, timeout: 3000 }); } catch (_) {}
}

/** Chờ text xuất hiện trong body (list 1400+ lái xe mất ~7s để tính). */
async function waitText(page, text, timeoutMs = 60000) {
  try {
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      { timeout: timeoutMs },
      text,
    );
    return true;
  } catch {
    return false;
  }
}

/** Click controlloid (button) theo accessible-ish name; React Aria listbox option theo text. */
async function clickByText(page, selector, text, { exact = false } = {}) {
  return page.evaluate(({ selector, text, exact }) => {
    const el = [...document.querySelectorAll(selector)].find((node) => {
      const t = (node.getAttribute('aria-label') || node.textContent || '').trim();
      return exact ? t === text : t.includes(text);
    });
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, { selector, text, exact });
}

/** Tìm trigger select "Hình thức lương" (UuiSelectField: span[data-label] + button). */
async function modeTriggerText(page, scope = 'body') {
  return page.evaluate((scope) => {
    const control = [...document.querySelectorAll(`${scope} .ds-uui-select__control`)]
      .find((c) => c.querySelector('span[data-label]')?.textContent?.trim() === 'Hình thức lương');
    return control?.querySelector('button')?.textContent?.trim() ?? null;
  }, scope);
}

/** Mở listbox "Hình thức lương" và click option theo text. */
async function pickModeOption(page, optionText, scope = 'body') {
  const opened = await page.evaluate((scope) => {
    const control = [...document.querySelectorAll(`${scope} .ds-uui-select__control`)]
      .find((c) => c.querySelector('span[data-label]')?.textContent?.trim() === 'Hình thức lương');
    const btn = control?.querySelector('button');
    if (!btn) return false;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return true;
  }, scope);
  if (!opened) return false;
  await settle(page, 600);
  return page.evaluate((optionText) => {
    const opt = [...document.querySelectorAll('[role="option"]')]
      .find((o) => o.textContent?.includes(optionText));
    if (!opt) return false;
    opt.click();
    return true;
  }, optionText);
}

async function assertStep(name, ok, detail) {
  results.steps.push({ name, ok, detail });
  log(`STEP ${ok ? 'PASS' : 'FAIL'} — ${name} :: ${JSON.stringify(detail)?.slice(0, 300)}`);
  if (!ok) throw new Error(`step failed: ${name}`);
}

// ────────────────────────────────────────────────────────────────────────────
// 0. Fixture: driver = items[0] của /salary list (cũng là driver mặc định cả
//    trang /salary lẫn lưới /timesheet đều chọn) + kỳ chấm công trống (2099).
const now = new Date();
const Y = now.getFullYear(), M = now.getMonth() + 1;
const ketoan = await login('ketoan');
const dieuvan = await login('dieuvan');
// Nút bút chì "Sửa lương cứng" chỉ render cho ADMIN/MANAGER
// (canReopenCompanyPeriod) — QA R21 nhìn thấy dialog với vai đó.
const giamdoc = await login('giamdoc');

const salaryList = await apiGet(`/salary?year=${Y}&month=${M}`, ketoan);
assertStep('salary list loads', salaryList.status === 200 && salaryList.body.items?.length > 0, { status: salaryList.status, count: salaryList.body.items?.length });
const driver = salaryList.body.items[0];
log(`target driver = #${driver.id} ${driver.name} (salaryMode=${driver.salaryMode})`);

const monthsProbe = await apiGet(`/timesheet/months?year=2099&month=12`, ketoan);
const taken = new Set((monthsProbe.body.items ?? monthsProbe.body ?? []).map?.((r) => r.driverId) ?? []);
const BOARD = taken.has(driver.id) ? { y: 2099, m: 11 } : { y: 2099, m: 12 };
log(`board fixture period = ${BOARD.m}/${BOARD.y}`);

// ── 1. /salary — QA probe #1: dialog "Sửa lương cứng" có select chế độ lương ──
{
  const { browser, page } = await openApp(giamdoc);
  await page.goto(`${FRONT}/salary?y=${Y}&m=${M}`, { waitUntil: 'networkidle2', timeout: 30000 });
  assertStep('trang /salary tải xong driver list', await waitText(page, driver.name), { driver: driver.name });
  // Card tổng kết + dòng "Hình thức lương" render sau khi getSalary trả về.
  assertStep('card tổng kết hiện dòng Hình thức lương', await waitText(page, 'Hình thức lương'), {});
  await shot(page, 'salary-page');

  const modeRow = await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('.salary-summary-dark__row')];
    const row = rows.find((r) => r.textContent?.includes('Hình thức lương'));
    return { present: !!row, text: row?.textContent?.trim() ?? null, hasDriver: document.body.innerText.includes(name) };
  }, driver.name);
  assertStep('summary card có dòng Hình thức lương', modeRow.present, modeRow);

  const clicked = await page.evaluate((name) => {
    const btn = document.querySelector(`button[aria-label="Sửa lương cứng ${name}"]`);
    if (!btn) return false;
    btn.click();
    return true;
  }, driver.name);
  await settle(page, 800);
  await shot(page, 'salary-edit-dialog-open');

  const dialogState = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"], .modal, [class*="modal"]');
    return {
      dialogVisible: !!dlg,
      title: dlg?.textContent?.slice(0, 80) ?? null,
      amountField: !!dlg?.textContent?.includes('Lương cứng (đ/tháng)'),
    };
  });
  const modeText = await modeTriggerText(page, '[role="dialog"]');
  assertStep('dialog Sửa lương cứng có select Hình thức lương', (modeText ?? '').length > 0, { ...dialogState, modeText });

  // Đổi sang FLAT_MONTHLY qua listbox React Aria
  const picked = await pickModeOption(page, 'Lương theo tháng (trốn vé)', '[role="dialog"]');
  assertStep('chọn option Lương theo tháng (trốn vé)', picked, {});
  await settle(page, 300);
  await shot(page, 'salary-edit-mode-picked');

  await clickByText(page, '[role="dialog"] button', 'Lưu', { exact: false });
  await settle(page, 1800);
  await shot(page, 'salary-edit-saved');

  const proof1 = await apiGet(`/drivers/${driver.id}`, ketoan);
  results.apiProof.afterSalaryEdit = { status: proof1.status, salaryMode: proof1.body?.salaryMode };
  assertStep('DB/API: drivers.salaryMode = FLAT_MONTHLY sau lưu', proof1.body?.salaryMode === 'FLAT_MONTHLY', { status: proof1.status, salaryMode: proof1.body?.salaryMode });

  // Reload — giá trị giữ đúng (kỳ vọng 5 của testplan)
  await page.reload({ waitUntil: 'networkidle2' });
  assertStep('reload xong', await waitText(page, 'Hình thức lương', 60000), {});
  await settle(page, 800);
  const reopened = await page.evaluate((name) => {
    const btn = document.querySelector(`button[aria-label="Sửa lương cứng ${name}"]`);
    if (btn) btn.click();
    return !!btn;
  }, driver.name);
  await settle(page, 800);
  const afterReload = await modeTriggerText(page, '[role="dialog"]');
  await shot(page, 'salary-edit-after-reload');
  assertStep('reload giữ FLAT_MONTHLY', (afterReload ?? '').includes('Lương theo tháng'), { afterReload });
  await browser.close();
}

// ── 2. /timesheet — mở bảng chấm công khởi tạo từ chế độ lái xe ──
{
  const { browser, page } = await openApp(ketoan);
  await page.goto(`${FRONT}/timesheet?y=${BOARD.y}&m=${BOARD.m}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await settle(page, 1200);
  const hasOpen = await clickByText(page, 'button', 'Mở bảng chấm công');
  assertStep('nút Mở bảng chấm công hiện (tháng chưa mở)', hasOpen, {});
  await settle(page, 600);
  const seeded = await modeTriggerText(page, '[role="dialog"]');
  await shot(page, 'timesheet-open-board-seeded');
  assertStep('modal mở bảng seed FLAT_MONTHLY từ lái xe', (seeded ?? '').includes('Lương theo tháng'), { seeded });

  await clickByText(page, '[role="dialog"] button', 'Mở bảng', { exact: true });
  await settle(page, 2000);
  await shot(page, 'timesheet-board-opened');
  const monthsAfter = await apiGet(`/timesheet/months?year=${BOARD.y}&month=${BOARD.m}`, ketoan);
  const rows = monthsAfter.body.items ?? monthsAfter.body ?? [];
  const mine = Array.isArray(rows) ? rows.find((r) => r.driverId === driver.id) : null;
  results.apiProof.afterBoardOpen = { salaryMode: mine?.salaryMode ?? null, monthId: mine?.id ?? null };
  assertStep('bảng mới nhận salaryMode FLAT_MONTHLY', mine?.salaryMode === 'FLAT_MONTHLY', { monthId: mine?.id, salaryMode: mine?.salaryMode });
  await browser.close();
}

// ── 3. /fleet/drivers — QA probe #2: dialog sửa lái xe có select, đổi lại PER_TRIP ──
{
  const { browser, page } = await openApp(dieuvan);
  await page.goto(`${FRONT}/fleet/drivers`, { waitUntil: 'networkidle2', timeout: 30000 });
  assertStep('trang danh mục tài xế tải xong', await waitText(page, driver.name), { driver: driver.name });
  await shot(page, 'fleet-drivers-page');
  const colHeader = await page.evaluate(() => [...document.querySelectorAll('th')].some((t) => t.textContent?.trim() === 'Hình thức lương'));
  // Ô cột của CHÍNH dòng lái xe đích (dòng đầu bảng là lái xe khác).
  const colText = await page.evaluate((name) => {
    const row = [...document.querySelectorAll('tr')].find((r) => r.textContent?.includes(name));
    return row?.querySelector('td[data-label="Hình thức lương"]')?.textContent?.trim() ?? null;
  }, driver.name);
  assertStep('cột Hình thức lương render nhãn enum', colHeader && (colText ?? '').includes('Lương theo tháng'), { colHeader, colText });

  const editOpened = await page.evaluate((name) => {
    const btn = document.querySelector(`button[aria-label="Chỉnh sửa tài xế ${name}"]`);
    if (!btn) return false;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return true;
  }, driver.name);
  assertStep('mở dialog sửa lái xe', editOpened, {});
  await settle(page, 800);
  await shot(page, 'driver-form-open');
  const dlgMode = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"], .modal, [class*="modal"]');
    const freeTextInput = [...(dlg?.querySelectorAll('input') ?? [])].find((i) => i.placeholder?.includes('LUONG'));
    return { noFreeText: !freeTextInput };
  });
  const driverFormMode = await modeTriggerText(page, '[role="dialog"]');
  assertStep('dialog lái xe: select enum + hết ô text tự do', (driverFormMode ?? '').includes('Lương theo tháng') && dlgMode.noFreeText, { ...dlgMode, driverFormMode });

  const backToPerTrip = await pickModeOption(page, 'Lương theo chuyến (không trốn vé)', '[role="dialog"]');
  assertStep('chọn lại Lương theo chuyến', backToPerTrip, {});
  await settle(page, 300);
  await clickByText(page, '[role="dialog"] button[type="submit"], [role="dialog"] button', 'Cập nhật');
  await settle(page, 2000);
  await shot(page, 'driver-form-saved');
  const proof3 = await apiGet(`/drivers/${driver.id}`, ketoan);
  results.apiProof.afterDriverForm = { status: proof3.status, salaryMode: proof3.body?.salaryMode };
  assertStep('khôi phục PER_TRIP qua dialog lái xe', proof3.body?.salaryMode === 'PER_TRIP', { salaryMode: proof3.body?.salaryMode });
  await browser.close();
}

fs.writeFileSync(ASSERT, JSON.stringify(results, null, 2));
log(`DONE — ${results.steps.length} steps, errors=${results.errors.length}`);
console.log(JSON.stringify(results.apiProof, null, 2));
process.exit(results.steps.every((s) => s.ok) ? 0 : 1);
