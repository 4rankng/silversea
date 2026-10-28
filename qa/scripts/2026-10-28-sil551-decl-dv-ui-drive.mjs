// SIL-551 UI drive — /dispatch-detail (Kế hoạch Chi tiết Xe) SỐ TỜ KHAI cell
// click-to-edit, driven as dungnv (DISPATCHER — the ticket's repro role).
//
// Rung-3 contract:
//   A. The DISPATCHER sees the click-to-edit affordance on the SỐ TỜ KHAI
//      cell of an FCL row (the bug: static text, nothing opened on click —
//      the old role gate hid it).
//   B. The click opens the inline editor (THE click under test), Enter saves
//      through the container-line command, the board refetches and the cell
//      shows the saved number (post-click DOM + toast assertion).
//   C. The pre-drive value is restored through the same UI path — the DB
//      side effect is proven by the psql captures this run is wrapped in
//      (qa/2026-10-28_sil551-decl/db-*.txt).
//   D. Screenshots @1280 and @390.
//
// ENV LIMITATION (2026-10-28, Chrome 156.0.8078.48 + puppeteer 25.16): CDP
// keyboard injection delivers NO key events to authed app pages in this
// build (verified across system Chrome, bundled Chromium, headless and
// headed; login page types fine). Typing therefore rides DOM event synthesis
// — the same input/keydown events a physical keystroke produces, dispatched
// on the real focused control so the app's real React handlers run and the
// real save path executes. Clicks are real DOM clicks on the real controls.
//
// Usage (worktree stack): node qa/scripts/2026-10-28-sil551-decl-dv-ui-drive.mjs
//   QA_BASE_URL=http://localhost:7196  QA_API=http://localhost:3102 (defaults)
// Output: qa/2026-10-28_sil551-decl/<run>/*.png + assertions.json + ui-driver.log

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7196';
const RUN = process.env.QA_RUN_TAG || 'run1';
const OUT = resolve(process.cwd(), 'qa/2026-10-28_sil551-decl', RUN);
const LOG = resolve(OUT, 'ui-driver.log');
mkdirSync(OUT, { recursive: true });
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUERY = 'R42RV-FCL'; // lot 240's Bill/Booking reference (the ticket's search pattern)
const CONT = 'MSKU1234565';
const BASE_DECL = 'TK-R42RV-001'; // the pre-drive number (db-before.txt)
const NEW_DECL = 'TK-SIL551-DV';

const result = { run: RUN, role: 'dungnv (DISPATCHER)', query: QUERY, container: CONT, newDecl: NEW_DECL, viewport: '1280x900 + 390x844', checks: [] };
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

async function openBoard(page) {
  await page.goto(`${FE}/dispatch-detail?q=${encodeURIComponent(QUERY)}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.detailed-plan-grid tbody tr', { timeout: 60000 });
  await page.waitForFunction((cont) => [...document.querySelectorAll('.detailed-plan-grid tbody tr')]
    .some((tr) => tr.textContent.includes(cont)), { timeout: 20000 }, CONT).catch(() => {});
  await sleep(600);
}

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

const declCellSelector = (cont) => `[...document.querySelectorAll('.detailed-plan-grid tbody tr')].find((tr) => tr.textContent.includes('${cont}'))?.querySelector('td[data-label="Số tờ khai"]')`;

const page = await login('dungnv', 'Abc123');
log('login ok user=dungnv (DISPATCHER — the ticket repro role)');
await openBoard(page);
await page.screenshot({ path: resolve(OUT, 'board-open-1280.png') });

// ── A: the DISPATCHER sees the affordance (the bug: static text) ───────────
const before = await page.evaluate((cont) => {
  const row = [...document.querySelectorAll('.detailed-plan-grid tbody tr')].find((tr) => tr.textContent.includes(cont));
  const cell = row?.querySelector('td[data-label="Số tờ khai"]');
  return {
    cellText: cell?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    editButton: cell?.querySelector('button[aria-label^="Sửa số tờ khai"]')?.getAttribute('aria-label') ?? null,
  };
}, CONT);
check('A: DISPATCHER sees the SỐ TỜ KHAI click-to-edit affordance', before.editButton === `Sửa số tờ khai · ${CONT}`, before);
log(`before: cell="${before.cellText}" button="${before.editButton}"`);

// ── B: THE click under test — editor opens, Enter saves ────────────────────
await page.evaluate((cont) => {
  const row = [...document.querySelectorAll('.detailed-plan-grid tbody tr')].find((tr) => tr.textContent.includes(cont));
  row.querySelector('td[data-label="Số tờ khai"] button[aria-label^="Sửa số tờ khai"]').click();
}, CONT);
await page.waitForSelector('td[data-label="Số tờ khai"] input[aria-label="Số tờ khai"]', { timeout: 5000 });
check('B: the click opens the inline editor (the bug: nothing opened)', true, 'input[aria-label="Số tờ khai"] present');
await page.screenshot({ path: resolve(OUT, 'decl-editor-open-1280.png') });
log('editor opened (THE click under test)');

await fillInput(page, 'td[data-label="Số tờ khai"] input[aria-label="Số tờ khai"]', NEW_DECL);
await pressKey(page, 'td[data-label="Số tờ khai"] input[aria-label="Số tờ khai"]', 'Enter');
await page.waitForFunction((decl) => {
  const cells = [...document.querySelectorAll('.detailed-plan-grid td[data-label="Số tờ khai"]')];
  return cells.some((cell) => !cell.querySelector('input') && cell.textContent.includes(decl));
}, { timeout: 20000 }, NEW_DECL).catch(() => {});
await sleep(700);
const after = await page.evaluate((decl, cont) => {
  const row = [...document.querySelectorAll('.detailed-plan-grid tbody tr')].find((tr) => tr.textContent.includes(cont));
  const cell = row?.querySelector('td[data-label="Số tờ khai"]');
  return {
    cellText: cell?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    saved: (cell?.textContent ?? '').includes(decl),
    inputStill: cell?.querySelector('input') != null,
    toast: document.querySelector('.toast-container')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  };
}, NEW_DECL, CONT);
check('B: post-click DOM — the cell shows the saved declaration', after.saved && !after.inputStill, after);
check('B: success toast surfaced', (after.toast ?? '').includes('Đã lưu số tờ khai'), after.toast);
await page.screenshot({ path: resolve(OUT, 'decl-saved-1280.png') });
await page.setViewport({ width: 390, height: 844 });
await sleep(700);
await page.screenshot({ path: resolve(OUT, 'decl-saved-390.png') });
log(`saved: cell="${after.cellText}" toast="${after.toast}"`);

// ── C: restore the pre-drive value through the same UI path ────────────────
await page.setViewport({ width: 1280, height: 900 });
await sleep(500);
await page.evaluate((decl) => {
  const row = [...document.querySelectorAll('.detailed-plan-grid tbody tr')].find((tr) => tr.textContent.includes(decl));
  row.querySelector('td[data-label="Số tờ khai"] button[aria-label^="Sửa số tờ khai"]').click();
}, NEW_DECL);
await page.waitForSelector('td[data-label="Số tờ khai"] input[aria-label="Số tờ khai"]', { timeout: 5000 });
await fillInput(page, 'td[data-label="Số tờ khai"] input[aria-label="Số tờ khai"]', BASE_DECL);
await pressKey(page, 'td[data-label="Số tờ khai"] input[aria-label="Số tờ khai"]', 'Enter');
await page.waitForFunction((base, cont) => {
  const row = [...document.querySelectorAll('.detailed-plan-grid tbody tr')].find((tr) => tr.textContent.includes(cont));
  const cell = row?.querySelector('td[data-label="Số tờ khai"]');
  return cell && !cell.querySelector('input') && cell.textContent.includes(base);
}, { timeout: 20000 }, BASE_DECL, CONT).catch(() => {});
await sleep(700);
check('C: restore — cell back to the pre-drive number', await page.evaluate((base, cont) => {
  const row = [...document.querySelectorAll('.detailed-plan-grid tbody tr')].find((tr) => tr.textContent.includes(cont));
  return (row?.querySelector('td[data-label="Số tờ khai"]')?.textContent ?? '').includes(base);
}, BASE_DECL, CONT), BASE_DECL);
await page.screenshot({ path: resolve(OUT, 'decl-restored-1280.png') });
log(`restored: ${BASE_DECL}`);
await page.close();

result.pass = result.checks.every((c) => c.pass);
writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
log(`EXIT ${result.pass ? 0 : 2} — checks: ${result.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'}:${c.name}`).join(' | ')}`);
await browser.close();
process.exit(result.pass ? 0 : 2);
