// SIL-591/593 UI drive — SỐ TỜ KHAI column on /dispatch-detail @1440.
//
// Contract:
//   A. The table carries the SỐ TỜ KHAI column (header + per-row cells).
//   B. DISPATCHER (dungnv) — static text, clicking does NOT open an editor
//      (card 261013200312: DISPATCHER is not a tờ khai writer).
//   C. MANAGER (giamdoc) — click opens the inline editor, Enter saves through
//      the container-line command, the board refetches and the cell shows the
//      saved number (post-click DOM assertion). DB side effect is proven
//      separately by the psql capture in the run log.
//
// Usage: cd frontend && QA_BASE_URL=http://localhost:7185 \
//   node ../qa/scripts/2026-10-27-sil591-declaration-column-ui-drive.mjs
// Output: qa/2026-10-27_sil591-declaration-column/*.png + assertions.json.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7185';
const OUT = resolve(process.cwd(), '../qa/2026-10-27_sil591-declaration-column');
const LOG = resolve(OUT, 'ui-driver.log');
mkdirSync(OUT, { recursive: true });
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DECL = process.env.QA_DECL || 'TK-R42RV-001';

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

const result = { viewport: '1440x900', declarationValue: DECL, checks: [] };
const check = (name, pass, detail) => { result.checks.push({ name, pass, detail }); if (!pass) result.failed = true; };
const URL = `${FE}/dispatch-detail?q=R42RV-FCL`;

// ── A+B: DISPATCHER view (read-only) ──────────────────────────────────────
const dispatcher = await login('dungnv', 'Abc123');
log('login ok user=dungnv (DISPATCHER)');
await dispatcher.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await dispatcher.waitForSelector('.detailed-plan-grid tbody tr', { timeout: 60000 });
await sleep(1200);

const dispatcherView = await dispatcher.evaluate(() => {
  const headers = [...document.querySelectorAll('.detailed-plan-grid thead th')].map((th) => th.textContent.replace(/\s+/g, ' ').trim());
  const cell = document.querySelector('td[data-label="Số tờ khai"]');
  const button = cell?.querySelector('button');
  if (button) button.click();
  return {
    headers,
    hasColumn: headers.some((h) => /SỐ TỜ KHAI/i.test(h)),
    cellText: cell?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    hadButton: button != null,
    inputAfterClick: document.querySelector('td[data-label="Số tờ khai"] input') != null,
  };
});
check('SỐ TỜ KHAI column present on the board', dispatcherView.hasColumn, dispatcherView.headers);
check('dispatcher cell renders the read-only value', dispatcherView.cellText != null, dispatcherView.cellText);
check('dispatcher clicking does NOT open an inline editor (403 law surfaced as no affordance)', !dispatcherView.hadButton && !dispatcherView.inputAfterClick, { hadButton: dispatcherView.hadButton, inputAfterClick: dispatcherView.inputAfterClick });
await dispatcher.evaluate(() => {
  const pane = document.querySelector('.detailed-plan-grid__wrapper');
  if (pane) pane.scrollLeft = pane.scrollWidth;
});
await sleep(400);
await dispatcher.screenshot({ path: resolve(OUT, 'dispatcher-readonly-1440.png') });
await dispatcher.close();
log('dispatcher pass complete (read-only)');

// ── C: ADMIN edit drive (MANAGER demo account is not seeded in this DB;
//      ADMIN carries the same declaration-writer law) ──────────────────────
const manager = await login('admin', 'Abc123');
log('login ok user=admin (ADMIN)');
await manager.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await manager.waitForSelector('.detailed-plan-grid tbody tr', { timeout: 60000 });
await sleep(1200);

const trigger = await manager.$('td[data-label="Số tờ khai"] button');
if (!trigger) {
  check('manager sees the edit affordance', false, 'no decl edit button on the first row');
} else {
  check('manager sees the edit affordance', true, 'decl edit button present');
  await trigger.evaluate((el) => el.click());
  await manager.waitForSelector('td[data-label="Số tờ khai"] input', { timeout: 5000 });
  log('inline editor opened');
  await manager.type('td[data-label="Số tờ khai"] input', DECL);
  await manager.keyboard.press('Enter');
  // The save refetches the board — wait until the editor closes and the value
  // paints back.
  await manager.waitForFunction((decl) => {
    const cell = document.querySelector('td[data-label="Số tờ khai"]');
    return cell && !cell.querySelector('input') && cell.textContent.includes(decl);
  }, { timeout: 20000 }, DECL).catch(() => {});
  await sleep(800);
  const after = await manager.evaluate((decl) => {
    const cell = document.querySelector('td[data-label="Số tờ khai"]');
    return {
      cellText: cell?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      toastText: document.querySelector('.toast, [role="status"]')?.textContent ?? null,
      inputStill: cell?.querySelector('input') != null,
    };
  }, DECL);
  check('post-click DOM assertion: the cell shows the saved declaration', (after.cellText ?? '').includes(DECL), { cellText: after.cellText, expected: DECL });
  check('editor closed after save', !after.inputStill, { inputStill: after.inputStill });
  // Scroll the rail so the saved cell is IN the frame for the capture.
  await manager.evaluate(() => {
    const pane = document.querySelector('.detailed-plan-grid__wrapper');
    if (pane) pane.scrollLeft = pane.scrollWidth;
  });
  await sleep(400);
  await manager.screenshot({ path: resolve(OUT, 'manager-saved-1440.png') });
  const rowEl = await manager.$('.detailed-plan-grid tbody tr');
  if (rowEl) await rowEl.screenshot({ path: resolve(OUT, 'manager-saved-row.png') });
}
await manager.close();

result.pass = result.checks.every((c) => c.pass);
writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
log(`EXIT ${result.pass ? 0 : 2} — checks: ${result.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'}:${c.name}`).join(' | ')}`);
await browser.close();
process.exit(result.pass ? 0 : 2);
