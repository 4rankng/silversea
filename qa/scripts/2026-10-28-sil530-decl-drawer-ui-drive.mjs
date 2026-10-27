// SIL-530 UI drive — SỐ TỜ KHAI column on the master-plan "Chi tiết container"
// drawer (Kế hoạch tổng quát), per-cont SIL-521 model.
//
// Contract (rung 3 — real click on the real control):
//   A. The drawer table carries the SỐ TỜ KHAI column (header + per-row cells).
//   B. ADMIN (writer law 261013200312) — click opens the inline editor, Enter
//      saves through the container-line command, the drawer refetches and the
//      cell shows the saved number (post-click DOM assertion). The DB side
//      effect is proven separately by the psql capture in the same qa/ dir.
//   C. DISPATCHER (dungnv) — static text, no edit affordance.
//   D. 390px — the drawer's card layout keeps the column (data-label band).
//
// The driver writes QA_DECL (default TK-SIL593-DRAWER) onto container
// MSKU1234565 of lot SHP-2610-00157 and then restores QA_BASE (the value the
// lot carried before the drive, TK-R42RV-001) unless QA_KEEP=1 — so run 1
// proves the write server-side and run 2 proves it again while restoring.
//
// Usage: cd frontend && QA_BASE_URL=http://localhost:7196 \
//   [QA_DECL=TK-SIL593-DRAWER] [QA_KEEP=1] \
//   node ../qa/scripts/2026-10-28-sil530-decl-drawer-ui-drive.mjs
// Output: qa/2026-10-28_sil530-decl-drawer/<run-tag>/*.png + assertions.json.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7196';
const DECL = process.env.QA_DECL || 'TK-SIL593-DRAWER';
const BASE = process.env.QA_BASE || 'TK-R42RV-001';
const KEEP = process.env.QA_KEEP === '1';
const RUN = process.env.QA_RUN_TAG || (KEEP ? 'set' : 'restore');
const OUT = resolve(process.cwd(), '../qa/2026-10-28_sil530-decl-drawer', RUN);
const LOG = resolve(OUT, 'ui-driver.log');
mkdirSync(OUT, { recursive: true });
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOT = 'SHP-2610-00157';
const CONT = 'MSKU1234565';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
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
  // Narrow to the lot under test (q matches Số Bill/Booking/shipment code).
  await page.type('input[aria-label="Tìm kiếm lô hàng"]', LOT);
  await sleep(1800); // 300ms debounce + fetch + paint
  const trigger = await page.$('button[aria-label^="Xem chi tiết container"]');
  if (!trigger) throw new Error(`no "Chi tiết container" trigger for lot ${LOT}`);
  await trigger.evaluate((el) => el.click());
  await page.waitForSelector('.dispatch-container-detail__table', { timeout: 20000 });
  await sleep(600);
}

const result = { run: RUN, decl: DECL, base: BASE, viewport: '1440x900', checks: [] };
const check = (name, pass, detail) => { result.checks.push({ name, pass, detail }); if (!pass) result.failed = true; };

// ── A+B: ADMIN drives the click-to-edit cell ──────────────────────────────
const admin = await login('admin', 'Abc123');
log('login ok user=admin (ADMIN — declaration writer per card 261013200312)');
await openDrawer(admin);

const before = await admin.evaluate((cont) => {
  const drawer = document.querySelector('.dispatch-container-detail');
  const headers = [...drawer.querySelectorAll('thead th')].map((th) => th.textContent.replace(/\s+/g, ' ').trim());
  const cell = [...drawer.querySelectorAll('td[data-label="Số tờ khai"]')]
    .find((td) => td.closest('tr')?.textContent.includes(cont)) ?? drawer.querySelector('td[data-label="Số tờ khai"]');
  return {
    headers,
    hasColumn: headers.some((h) => /SỐ TỜ KHAI/i.test(h)),
    cellText: cell?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    editButton: cell?.querySelector('button[aria-label^="Sửa số tờ khai"]')?.getAttribute('aria-label') ?? null,
  };
}, CONT);
check('drawer carries the SỐ TỜ KHAI column', before.hasColumn, before.headers);
check('cell shows the pre-drive value', (before.cellText ?? '').length > 0, before.cellText);
check('ADMIN sees the click-to-edit affordance', before.editButton != null, before.editButton);
log(`before: cell="${before.cellText}" button="${before.editButton}"`);

await admin.evaluate((cont) => {
  const drawer = document.querySelector('.dispatch-container-detail');
  const cell = [...drawer.querySelectorAll('td[data-label="Số tờ khai"]')]
    .find((td) => td.closest('tr')?.textContent.includes(cont)) ?? drawer.querySelector('td[data-label="Số tờ khai"]');
  cell.querySelector('button[aria-label^="Sửa số tờ khai"]').click();
}, CONT);
await admin.waitForSelector('td[data-label="Số tờ khai"] input[aria-label="Số tờ khai"]', { timeout: 5000 });
log('inline editor opened (THE click under test)');
await admin.type('td[data-label="Số tờ khai"] input[aria-label="Số tờ khai"]', DECL);
await admin.keyboard.press('Enter');
// The save refetches the drawer detail — wait until the editor closes and the
// persisted value paints back.
await admin.waitForFunction((decl) => {
  const cell = document.querySelector('td[data-label="Số tờ khai"]');
  return cell && !cell.querySelector('input') && cell.textContent.includes(decl);
}, { timeout: 20000 }, DECL).catch(() => {});
await sleep(900);

const after = await admin.evaluate((decl) => {
  const drawer = document.querySelector('.dispatch-container-detail');
  const cell = drawer.querySelector('td[data-label="Số tờ khai"]');
  return {
    cellText: cell?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    toastText: document.querySelector('.toast, [role="status"], .toast-viewport')?.textContent ?? null,
    inputStill: cell?.querySelector('input') != null,
  };
}, DECL);
check('post-click DOM assertion: the cell shows the saved declaration', (after.cellText ?? '').includes(DECL), { cellText: after.cellText, expected: DECL });
check('editor closed after save', !after.inputStill, { inputStill: after.inputStill });
log(`after: cell="${after.cellText}" toast="${after.toastText}"`);
await admin.screenshot({ path: resolve(OUT, 'admin-saved-1440.png') });

// ── D: 390px — the drawer keeps the column in card layout ─────────────────
await admin.setViewport({ width: 390, height: 844 });
await sleep(700);
const mobile = await admin.evaluate(() => {
  const cell = document.querySelector('td[data-label="Số tờ khai"]');
  return { present: cell != null, label: cell?.getAttribute('data-label') ?? null, text: cell?.textContent.replace(/\s+/g, ' ').trim() ?? null };
});
check('390px card layout keeps the Số tờ khai cell', mobile.present && mobile.label === 'Số tờ khai', mobile);
await admin.screenshot({ path: resolve(OUT, 'admin-saved-390.png') });
await admin.setViewport({ width: 1440, height: 900 });

// Close the drawer before the restore so the second edit re-opens cleanly.
if (!KEEP) {
  // The re-edit rides the SAME drawer session on purpose: the cell instance
  // survives the post-save refetch (stable row keys), so this click is the
  // regression proof for the stale-saving dead-lock the reviewer caught —
  // with the bug, this click silently did nothing.
  const reopen = await admin.evaluate((cont) => {
    const drawer = document.querySelector('.dispatch-container-detail');
    const cell = [...drawer.querySelectorAll('td[data-label="Số tờ khai"]')]
      .find((td) => td.closest('tr')?.textContent.includes(cont)) ?? drawer.querySelector('td[data-label="Số tờ khai"]');
    const button = cell.querySelector('button[aria-label^="Sửa số tờ khai"]');
    button.click();
    return button != null;
  }, CONT);
  check('same cell re-opens its editor after a successful save (same drawer session)', reopen, { reopen });
  await admin.waitForSelector('td[data-label="Số tờ khai"] input[aria-label="Số tờ khai"]', { timeout: 5000 });
  log('re-edit editor opened in the SAME session (stale-saving regression proven fixed)');
  await admin.type('td[data-label="Số tờ khai"] input[aria-label="Số tờ khai"]', BASE);
  await admin.keyboard.press('Enter');
  await admin.waitForFunction((base) => {
    const cell = document.querySelector('td[data-label="Số tờ khai"]');
    return cell && !cell.querySelector('input') && cell.textContent.includes(base);
  }, { timeout: 20000 }, BASE).catch(() => {});
  await sleep(900);
  const restored = await admin.evaluate((base) => document
    .querySelector('td[data-label="Số tờ khai"]')?.textContent.replace(/\s+/g, ' ').trim(), BASE);
  check('restore: cell back to the pre-drive value', (restored ?? '').includes(BASE), restored);
  log(`restored: cell="${restored}"`);
  await admin.screenshot({ path: resolve(OUT, 'admin-restored-1440.png') });
}
await admin.close();

// ── C: DISPATCHER reads static text (no affordance the server would 403) ──
const dispatcher = await login('dungnv', 'Abc123');
log('login ok user=dungnv (DISPATCHER)');
await openDrawer(dispatcher);
const dispatcherView = await dispatcher.evaluate(() => {
  const drawer = document.querySelector('.dispatch-container-detail');
  const cell = drawer.querySelector('td[data-label="Số tờ khai"]');
  const button = cell?.querySelector('button');
  if (button) button.click();
  return {
    cellText: cell?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    hadButton: button != null,
    inputAfterClick: cell?.querySelector('input') != null,
  };
});
check('dispatcher cell renders static text', (dispatcherView.cellText ?? '').length > 0, dispatcherView.cellText);
check('dispatcher has NO edit affordance (403 law as no affordance)', !dispatcherView.hadButton && !dispatcherView.inputAfterClick, dispatcherView);
await dispatcher.screenshot({ path: resolve(OUT, 'dispatcher-readonly-1440.png') });
await dispatcher.close();

result.pass = result.checks.every((c) => c.pass);
writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
log(`EXIT ${result.pass ? 0 : 2} — checks: ${result.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'}:${c.name}`).join(' | ')}`);
await browser.close();
process.exit(result.pass ? 0 : 2);
