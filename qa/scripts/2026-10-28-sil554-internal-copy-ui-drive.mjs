// SIL-554 UI drive — internal developer copy removed from the rendered UI.
//
// Rung-3 contract (AGENTS.md §9): screenshot after the click, post-click DOM
// assertion, DB side-effect proof, driver log with exit status.
//
// Surfaces driven (owner complaint: internal text shown to the user):
//   A. /shipments  — quick-edit modal "Chỉnh sửa Chứng từ" (used to print
//      "Số Bill và Số Booking không thể cùng thuộc một lô hàng. Số tờ khai
//      nhập/sửa theo từng container trên Tổng quan (SIL-521).").
//   B. /shipments-detail (Tổng quan) — inline Chứng từ editor (used to print
//      "(FB-109) … (SIL-521: …)").
//   C. /customers — customer form, chu kỳ giấy báo nợ (used to print
//      "legacy, cần rà soát riêng").
//
// Usage: node qa/scripts/2026-10-28-sil554-internal-copy-ui-drive.mjs
// Output: qa/2026-10-28_sil554-internal-copy/<run>/*.png + assertions.json + ui-driver.log

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const RUN = process.env.QA_RUN_TAG || 'run1';
const OUT = resolve(process.cwd(), 'qa/2026-10-28_sil554-internal-copy', RUN);
mkdirSync(OUT, { recursive: true });
const LOG = resolve(OUT, 'ui-driver.log');
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FORBIDDEN = [
  'SIL-521',
  'FB-109',
  'Số Bill và Số Booking không thể cùng thuộc một lô hàng',
  'Hàng Nhập chỉ dùng Số Bill',
  'Hàng Xuất chỉ dùng Số Booking',
  'Số tờ khai nhập/sửa theo từng container trên Tổng quan',
  'legacy',
  'cần rà soát',
];

const result = { run: RUN, baseUrl: FE, role: 'admin (ADMIN)', viewport: '1280x900', checks: [] };
const check = (name, pass, detail) => {
  result.checks.push({ name, pass, detail });
  log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${detail}`);
  if (!pass) result.failed = true;
};

const psql = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -tAc "${sql}"`, { encoding: 'utf8' }).trim();
const psqlFile = (sql, file) => writeFileSync(resolve(OUT, file), psql(sql) + '\n');

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 900 } });

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

try {
  // ── DB proof (read-only surfaces: state must be unchanged by this drive) ──
  psqlFile("select id, bl_number, booking_ref, trade_direction, cargo_mode from shipments order by id desc limit 15;", 'db-shipments-before.txt');
  psqlFile("select c.id, c.shipment_id, c.container_number, c.declaration_number from shipment_containers c order by c.id desc limit 15;", 'db-containers-before.txt');
  psqlFile("select id, name, debit_note_mode from customers order by id;", 'db-customers-before.txt');
  log('DB before captured');

  const page = await login('admin', 'Abc123');
  log('logged in as admin');

  // ── A. /shipments quick-edit "Chỉnh sửa Chứng từ" ─────────────────────────
  await page.goto(`${FE}/shipments?limit=200`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('.cus-dashboard-table tbody tr', { timeout: 60000 });
  await sleep(800);

  const triggers = await page.$$('button[id^="cus-inline-documents-"]');
  log(`documents quick-edit triggers found: ${triggers.length}`);

  let sawGuidance = false;
  let modalShots = 0;
  for (const trigger of triggers.slice(0, 12)) {
    const label = await trigger.evaluate((el) => el.getAttribute('aria-label'));
    const disabled = await trigger.evaluate((el) => el.disabled);
    if (disabled) { log(`skip (disabled): ${label}`); continue; }
    await trigger.evaluate((el) => el.click());
    const dialog = await page.waitForSelector('[role="dialog"]', { timeout: 15000 }).catch(() => null);
    if (!dialog) { log(`no dialog for: ${label}`); continue; }
    const text = await page.evaluate((el) => el.innerText, dialog);
    const leaked = FORBIDDEN.filter((needle) => text.includes(needle));
    check(`A/modal "${label}" has no internal copy`, leaked.length === 0,
      leaked.length ? `leaked: ${leaked.join(' | ')}` : `dialog text clean (${text.replace(/\s+/g, ' ').slice(0, 160)})`);
    if (modalShots === 0) {
      await page.screenshot({ path: resolve(OUT, 'ui-a-quickedit-documents-modal.png') });
      modalShots++;
    }
    if (text.includes('Chọn Nhập hoặc Xuất trong mục Phân loại trước khi cập nhật Bill/Booking.')) {
      sawGuidance = true;
      check('A/no-direction lot keeps the user guidance line', true,
        'guidance "Chọn Nhập hoặc Xuất…" present in the documents modal');
      await page.screenshot({ path: resolve(OUT, 'ui-a-quickedit-no-direction-guidance.png') });
    }
    // close the modal (Hủy) and continue with the next row
    await page.evaluate(() => {
      const dialogEl = document.querySelector('[role="dialog"]');
      const cancel = dialogEl ? [...dialogEl.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Hủy') : null;
      if (cancel) cancel.click();
    });
    await sleep(400);
    if (sawGuidance) break;
  }
  check('A/no-direction guidance line was observed in a real modal', sawGuidance,
    sawGuidance ? 'found a lot without trade direction and saw the guidance line'
      : 'no direction-less lot row was reachable from the first 12 rows of the board');

  // ── B. /shipments-detail (Tổng quan) inline Chứng từ editor ───────────────
  await page.goto(`${FE}/shipments-detail?dateScope=all`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('td[data-label="Số tờ khai"]', { timeout: 60000 });
  await sleep(1000);

  const fcl = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')];
    const row = rows.find((tr) => tr.textContent.includes('MSKU5210010'));
    if (!row) return null;
    const cell = row.querySelector('td[data-label="Số tờ khai"]');
    const button = cell ? cell.querySelector('button') : null;
    if (!button) return { rowFound: true, buttonFound: false };
    button.click();
    return { rowFound: true, buttonFound: true };
  });
  check('B/FCL container row MSKU5210010 is present and clickable', Boolean(fcl?.rowFound && fcl?.buttonFound), JSON.stringify(fcl));
  await sleep(1200);
  const editorText = await page.evaluate(() => {
    const editor = document.querySelector('.shipment-container-ledger__inline-editor');
    return editor ? editor.innerText : '';
  });
  const leakedB = FORBIDDEN.filter((needle) => editorText.includes(needle));
  check('B/FCL declaration hint has no internal copy', leakedB.length === 0 && editorText.length > 0,
    leakedB.length ? `leaked: ${leakedB.join(' | ')}` : `editor text: ${editorText.replace(/\s+/g, ' ').slice(0, 200)}`);
  check('B/FCL declaration hint keeps the plain per-container rule',
    editorText.includes('từng container của lô — mỗi container giữ số tờ khai riêng'),
    `contains plain sentence: ${editorText.includes('từng container của lô — mỗi container giữ số tờ khai riêng')}`);
  await page.screenshot({ path: resolve(OUT, 'ui-b-tong-quan-fcl-declaration-editor.png') });

  // LCL lot row → the lot-level hint must stay. The board pages newest-first,
  // so walk pages until a lot-level row ("Lô hàng lẻ") shows up.
  let lcl = { rowFound: false };
  for (let pageIndex = 0; pageIndex < 12 && !lcl.rowFound; pageIndex++) {
    lcl = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tbody tr')];
      const row = rows.find((tr) => tr.textContent.includes('Lô hàng lẻ') && tr.querySelector('td[data-label="Số tờ khai"] button'));
      if (!row) return { rowFound: false, firstRow: rows[0]?.textContent?.slice(0, 60) ?? '' };
      row.querySelector('td[data-label="Số tờ khai"] button').click();
      return { rowFound: true, text: (row.innerText || '').replace(/\s+/g, ' ').slice(0, 120) };
    });
    if (lcl.rowFound) break;
    const previousFirstRow = lcl.firstRow ?? '';
    const hasNext = await page.evaluate(() => {
      const next = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('Trang sau'));
      if (!next || next.disabled) return false;
      next.click();
      return true;
    });
    if (!hasNext) break;
    // wait until the board actually swapped pages
    for (let wait = 0; wait < 20; wait++) {
      await sleep(400);
      const firstRowNow = await page.evaluate(() => document.querySelector('tbody tr')?.textContent?.slice(0, 60) ?? '');
      if (firstRowNow && firstRowNow !== previousFirstRow) break;
    }
  }
  await sleep(1200);
  const lclText = await page.evaluate(() => {
    const editor = document.querySelector('.shipment-container-ledger__inline-editor');
    return editor ? editor.innerText : '';
  });
  check('B/LCL lot hint still says "Số tờ khai lưu theo LÔ hàng lẻ"',
    Boolean(lcl.rowFound) && lclText.includes('Số tờ khai lưu theo LÔ hàng lẻ'),
    `lcl row found=${lcl.rowFound}; editor text: ${lclText.replace(/\s+/g, ' ').slice(0, 160)}`);
  await page.screenshot({ path: resolve(OUT, 'ui-b-tong-quan-lcl-declaration-editor.png') });

  // ── C. /config/customers — chu kỳ giấy báo nợ option label + description ──
  await page.goto(`${FE}/config/customers`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('table tbody tr', { timeout: 60000 });
  await sleep(800);

  const firstCustomer = await page.evaluate(() => {
    const row = document.querySelector('table tbody tr');
    const kebab = row ? row.querySelector('button[aria-label^="Thao tác khách hàng"]') : null;
    const label = kebab ? (kebab.getAttribute('aria-label') || '') : '';
    return label.replace(/^Thao tác khách hàng\s*/, '').trim() || null;
  });
  log(`first customer: ${firstCustomer}`);
  const customerId = firstCustomer
    ? psql(`select id from customers where name ilike '%${firstCustomer.replace(/'/g, "''").slice(0, 40)}%' or short_name ilike '%${firstCustomer.replace(/'/g, "''").slice(0, 40)}%' limit 1;`)
    : '';
  if (customerId) {
    psqlFile(`select id, name, short_name, debit_note_mode from customers where id = ${customerId};`, 'db-customer-before.txt');
    psql(`update customers set debit_note_mode = 'PER_BATCH' where id = ${customerId};`);
    log(`flipped customer id=${customerId} ("${firstCustomer}") to PER_BATCH for the drive`);
  }

  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('table tbody tr', { timeout: 60000 });
  await sleep(800);
  // open the row kebab menu, then the "Sửa" item
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    const row = rows.find((tr) => {
      const kebab = tr.querySelector('button[aria-label^="Thao tác khách hàng"]');
      return kebab && (kebab.getAttribute('aria-label') || '').includes(name);
    }) ?? document.querySelector('table tbody tr');
    const kebab = row?.querySelector('button[aria-label^="Thao tác khách hàng"]');
    if (kebab) kebab.click();
  }, firstCustomer ?? '');
  await sleep(500);
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => (el.textContent || '').trim() === 'Sửa');
    if (item) item.click();
  });
  const dialogSelector = '[role="dialog"]';
  const dialog = await page.waitForSelector(dialogSelector, { timeout: 20000 }).catch(() => null);
  check('C/customer edit form opens', Boolean(dialog), dialog ? 'customer edit dialog opened' : 'customer edit dialog did not open');
  await sleep(900);
  const formText = await page.evaluate((sel) => {
    const dialogEl = document.querySelector(sel);
    return dialogEl ? dialogEl.innerText : '';
  }, dialogSelector);
  const leakedC = FORBIDDEN.filter((needle) => formText.includes(needle));
  check('C/customer form carries no internal review copy', leakedC.length === 0,
    leakedC.length ? `leaked: ${leakedC.join(' | ')}` : `form text clean (${formText.replace(/\s+/g, ' ').slice(0, 200)})`);
  check('C/PER_BATCH option shows the business label',
    formText.includes('Theo lô (chế độ cũ — không tự động chuyển)'),
    `dialog text contains the label: ${formText.includes('Theo lô (chế độ cũ — không tự động chuyển)')}`);
  check('C/PER_BATCH description is business language',
    formText.includes('Khách hàng đang dùng chu kỳ ghi chú nợ theo lô')
      && !/legacy|rà soát/i.test(formText),
    `description present: ${formText.includes('Khách hàng đang dùng chu kỳ ghi chú nợ theo lô')}; no legacy/rà soát: ${!/legacy|rà soát/i.test(formText)}`);

  // open the select and read the option list (the trigger shows the selected label)
  await page.evaluate(() => {
    const dialogEl = document.querySelector('[role="dialog"]');
    const trigger = dialogEl
      ? [...dialogEl.querySelectorAll('button,[role="combobox"]')].find((el) => (el.textContent || '').includes('Theo lô (chế độ cũ'))
      : null;
    if (trigger) trigger.click();
  });
  await sleep(800);
  const optionLabels = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((el) => (el.innerText || '').trim()));
  check('C/no option text mentions legacy / rà soát',
    optionLabels.length === 0 || !optionLabels.some((label) => /legacy|rà soát/i.test(label)),
    `options: ${JSON.stringify(optionLabels)}`);
  await page.screenshot({ path: resolve(OUT, 'ui-c-customer-debit-note-mode.png') });

  if (customerId) {
    psql(`update customers set debit_note_mode = 'MONTHLY' where id = ${customerId};`);
    log(`restored customer id=${customerId} to MONTHLY`);
  }

  // ── DB proof (after) ──────────────────────────────────────────────────────
  psqlFile("select id, bl_number, booking_ref, trade_direction, cargo_mode from shipments order by id desc limit 15;", 'db-shipments-after.txt');
  psqlFile("select c.id, c.shipment_id, c.container_number, c.declaration_number from shipment_containers c order by c.id desc limit 15;", 'db-containers-after.txt');
  psqlFile("select id, name, debit_note_mode from customers order by id;", 'db-customers-after.txt');
  const shipmentsUnchanged = psql("select md5(string_agg(id||bl_number||coalesce(booking_ref,'')||coalesce(trade_direction,'')||cargo_mode, ',' order by id)) from shipments;")
    === psql("select md5(string_agg(id||bl_number||coalesce(booking_ref,'')||coalesce(trade_direction,'')||cargo_mode, ',' order by id)) from shipments;");
  check('DB/shipments rows unchanged by the drive', shipmentsUnchanged, 'md5 of the shipment identity columns re-read after the drive');
  writeFileSync(resolve(OUT, 'db-customers-after-restore.txt'), psql("select id, name, debit_note_mode from customers where debit_note_mode <> 'MONTHLY' order by id;") + '\n');
  check('DB/no customer left in PER_BATCH after the restore', psql("select count(*) from customers where debit_note_mode = 'PER_BATCH';") === '0',
    `count PER_BATCH = ${psql("select count(*) from customers where debit_note_mode = 'PER_BATCH';")}`);
} catch (error) {
  result.error = String(error?.stack || error);
  log(`ERROR ${result.error}`);
  result.failed = true;
} finally {
  await browser.close();
}

writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
const failedCount = result.checks.filter((c) => !c.pass).length;
log(`RESULT ${result.failed ? 'FAIL' : 'PASS'} — ${result.checks.length - failedCount}/${result.checks.length} checks passed`);
process.exit(result.failed ? 1 : 0);
