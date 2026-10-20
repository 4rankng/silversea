// UI drive — FB-086 R29 remainder: "Sửa lô" (lot-INFO edit) at /shipments/:id.
//
// Reconciliation in scope (steer 21/10): TICKET-09 (card 171026182554) keeps
// container add/remove OFF the detail surface — the driver asserts that state
// STAYS (no "Thêm container" button) in BOTH modes. The FB-086 valid
// remainder is the "Sửa lô" header button → six-group picker → the shared
// quick-edit modal → PATCH /api/shipments/:id (booking/bl) with the DB row
// as the side-effect proof.
//
// Modes:
//   QA_MODE=before  — staging (or any build a079aaf5): asserts the header has
//                     NO "Sửa lô" and NO "Thêm container" (the state QA R29
//                     saw, correct per TICKET-09).
//   QA_MODE=after   — local build with the fix: full Sửa-lô happy path.
//
// Run: QA_BASE=<dev-frontend-origin> QA_MODE=after QA_LOT=<shipment-id> \
//      QA_USER=cus node testplan/qa/scripts/2026-10-20-fb086-sua-lo-ui-drive.mjs
// Ports come from the environment (dev-port contract); no hardcoded ports.
import { mkdirSync, appendFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.QA_BASE;
const MODE = process.env.QA_MODE ?? 'after';
const LOT = process.env.QA_LOT ?? '311587';
const GROUP = process.env.QA_GROUP ?? 'Chứng từ';
const USER = process.env.QA_USER ?? 'cus';
const PASS = process.env.QA_PASS ?? 'Abc123';
if (!BASE) {
  console.error('QA_BASE is required (dev-port contract: no hardcoded ports).');
  process.exit(2);
}
const DIR = `${process.cwd()}/qa/2026-10-20-fb086`;
mkdirSync(DIR, { recursive: true });
const logPath = `${DIR}/ui-driver-${MODE}.log`;
const log = (line) => {
  console.log(line);
  appendFileSync(logPath, `${line}\n`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});

const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim()).catch(() => null);
const buttonsIn = (page) => page.$$eval('main button', (bs) => bs.map((b) => b.textContent.trim().replace(/\s+/g, ' ')));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('response', (res) => {
    if (res.status() >= 400) log(`HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
  });

  // ── Login ────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 45_000 });
  await page.waitForSelector('#username-input', { timeout: 20_000 });
  // Native setter + input event (React 18 controlled inputs), then
  // requestSubmit — the submit path trusts live DOM values (card QA1-003).
  await page.evaluate((user, pass) => {
    const set = (sel, value) => {
      const el = document.querySelector(sel);
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('#username-input', user);
    set('#password-input', pass);
    document.querySelector('form').requestSubmit();
  }, USER, PASS);
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30_000 });
  log(`LOGIN OK as ${USER} → ${await page.evaluate(() => location.pathname)}`);

  // ── Lot detail ───────────────────────────────────────────────────────────
  await page.goto(`${BASE}/shipments/${LOT}`, { waitUntil: 'networkidle2', timeout: 45_000 });
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent?.trim().length > 0, { timeout: 30_000 });
  const heading = await text(page, 'main h1');
  log(`DETAIL heading=${heading} url=${page.url()}`);

  const buttons = await buttonsIn(page);
  const hasSuaLo = buttons.some((t) => t === 'Sửa lô');
  const hasThemContainer = buttons.some((t) => t.includes('Thêm container'));
  log(`HEADER buttons=${JSON.stringify(buttons.filter((t) => ['Sửa lô', 'Tạo lô mới', 'Xóa lô', 'Khai chi phí'].includes(t)))}`);
  log(`ASSERT surface: Sửa lô=${hasSuaLo} · Thêm container present=${hasThemContainer}`);

  if (MODE === 'before') {
    // QA R29 repro state on build a079aaf5 — and the TICKET-09-correct state:
    // no Sửa lô (FB-086 remainder not yet built), NO container composition.
    if (hasSuaLo || hasThemContainer) {
      log('FAIL BEFORE: unexpected affordance present (Sửa lô or Thêm container).');
      process.exitCode = 1;
    } else {
      log('PASS BEFORE: header lacks Sửa lô and Thêm container (TICKET-09 read-only containers, correct state).');
    }
    const alias = await page.goto(`${BASE}/shipments/${LOT}/edit`, { waitUntil: 'networkidle2', timeout: 45_000 });
    await page.waitForFunction(() => document.querySelector('main h1')?.textContent?.trim().length > 0, { timeout: 30_000 });
    log(`ALIAS /edit lands on: ${alias.url()} (heading=${await text(page, 'main h1')})`);
    await page.screenshot({ path: `${DIR}/before-staging-detail.png`, fullPage: false });
    log('SCREENSHOT before-staging-detail.png');
  } else {
    // ── AFTER: the fix's happy path ────────────────────────────────────────
    if (!hasSuaLo) { log('FAIL AFTER: Sửa lô button missing.'); process.exitCode = 1; }
    if (hasThemContainer) { log('FAIL AFTER: TICKET-09 regression — Thêm container must stay absent.'); process.exitCode = 1; }

    // Order pin: Sửa lô sits directly before Tạo lô mới (which sits before Xóa lô).
    const order = await page.evaluate(() => {
      const find = (label) => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === label);
      const sua = find('Sửa lô'); const tao = find('Tạo lô mới'); const xoa = find('Xóa lô');
      return sua && tao && xoa
        ? { adjacency: sua.nextElementSibling === tao && tao.nextElementSibling === xoa, sameParent: sua.parentElement === tao.parentElement && tao.parentElement === xoa.parentElement }
        : null;
    });
    log(`ORDER Sửa lô → Tạo lô mới → Xóa lô: ${JSON.stringify(order)}`);
    if (!order?.adjacency || !order?.sameParent) { log('FAIL AFTER: header action order broken.'); process.exitCode = 1; }

    await page.screenshot({ path: `${DIR}/after-detail-header.png` });
    log('SCREENSHOT after-detail-header.png');

    // ── Picker ─────────────────────────────────────────────────────────────
    await page.evaluate(() => {
      [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Sửa lô').click();
    });
    await page.waitForFunction(() => document.body.textContent.includes('Sửa thông tin lô'), { timeout: 20_000 });
    await page.waitForFunction(() => {
      const groups = ['Khách hàng & nhà máy', 'Chứng từ', 'Phân loại & hãng tàu', 'Tổng quan hàng hóa', 'Lịch trình', 'Ghi chú'];
      return groups.every((g) => [...document.querySelectorAll('.modal__content button, [role="dialog"] button')].some((b) => b.textContent.trim() === g));
    }, { timeout: 20_000 });
    const scheduleGate = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Lịch trình');
      return { disabled: btn.disabled, title: btn.getAttribute('title') };
    });
    log(`PICKER groups visible; Lịch trình disabled=${scheduleGate.disabled} title="${scheduleGate.title}"`);
    if (!scheduleGate.disabled) { log('FAIL AFTER: FCL schedule group must be disabled (per-container law).'); process.exitCode = 1; }
    await page.screenshot({ path: `${DIR}/after-picker.png` });
    log('SCREENSHOT after-picker.png');

    // ── Documents group → shared quick-edit modal ──────────────────────────
    await page.evaluate((group) => {
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === group).click();
    }, GROUP);
    await page.waitForFunction((g) => document.body.textContent.includes(`Chỉnh sửa ${g}`), { timeout: 20_000 }, GROUP);
    const fieldLabels = await page.evaluate(() => {
      return [...document.querySelectorAll('.cus-quick-edit-modal__fields label span')].map((s) => s.textContent.trim());
    });
    log(`EDIT modal (group=${GROUP}) fields=${JSON.stringify(fieldLabels)}`);
    const currentInputs = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('.cus-quick-edit-modal__fields input')];
      return inputs.map((i) => ({ value: i.value, disabled: i.disabled, label: i.closest('label')?.querySelector('span')?.textContent.trim() ?? null }));
    });
    log(`EDIT current=${JSON.stringify(currentInputs)}`);
    await page.screenshot({ path: `${DIR}/after-documents-edit.png` });
    log('SCREENSHOT after-documents-edit.png');

    // Change the first writable text input to a QA marker value.
    const newValue = `QA-FB086-${Date.now()}`;
    const typed = await page.evaluate((value) => {
      const inputs = [...document.querySelectorAll('.cus-quick-edit-modal__fields input')].filter((i) => !i.disabled && i.type !== 'hidden');
      const el = inputs[0];
      if (!el) return { typed: false };
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { typed: true, label: el.closest('label')?.querySelector('span')?.textContent.trim() ?? null };
    }, newValue);
    if (!typed.typed) { log('FAIL AFTER: no writable input in the edit modal.'); process.exitCode = 1; }
    log(`EDIT typed=${newValue} into=${JSON.stringify(typed.label)}`);

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s+/g, ' ').trim().includes('Lưu thay đổi'));
      btn.click();
    });
    // Success = the save toast fired AND the refetched header carries the
    // marker. The 409 self-heal (drop draft + reload) means the edit was
    // REJECTED — that is a FAIL for the happy path.
    const toast = await page.waitForFunction(
      () => (document.body.textContent.match(/Đã lưu ô dữ liệu lô hàng|Đã cập nhật chứng từ lô hàng|Dữ liệu hoặc quyền chỉnh sửa vừa thay đổi/) ?? [null])[0],
      { timeout: 15_000 },
    ).then((h) => h.jsonValue()).catch(() => null);
    log(`SAVE toast=${JSON.stringify(toast)}`);
    const markerShown = await page.waitForFunction((v) => document.body.textContent.includes(v), { timeout: 20_000 }, newValue)
      .then(() => true).catch(() => false);
    if (!markerShown) { log(`FAIL AFTER: marker ${newValue} never appeared in the refetched detail (save rejected or not applied).`); process.exitCode = 1; }
    await page.screenshot({ path: `${DIR}/after-saved-header.png` });
    log(`SCREENSHOT after-saved-header.png · header now shows ${newValue}`);
    log(`RESULT marker=${newValue}`);
  }

  if (pageErrors.length > 0) {
    log(`PAGE ERRORS: ${JSON.stringify(pageErrors)}`);
    process.exitCode = process.exitCode || 1;
  } else {
    log('PAGE ERRORS: none');
  }
} finally {
  await browser.close();
}
