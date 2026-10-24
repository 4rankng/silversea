#!/usr/bin/env node
/**
 * SIL-161 UI driver — /demo/master-data clicked end-to-end at 1440×900.
 *
 * Drives the REAL page (vite 7175, auth via real backend login): tab
 * switching, fleet search + add-row submit, partner searches, and the Rate
 * Engine cell edits. Every claim is a DOM text assertion; screenshots and
 * this log are the rung-3 artifacts. Demo state is client-side fixtures —
 * there is no DB side effect by design (zero API calls), so the persisted
 * state IS the fixture state re-read from the DOM.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { login } from '../../scripts/lib/http.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const OUT = root;
const FRONTEND = process.env.QA_FRONTEND ?? 'http://localhost:7175';
const results = [];
const consoleErrors = [];

function assert(label, expected, actual) {
  const pass = String(actual).includes(String(expected));
  results.push({ label, expected, actual: String(actual).slice(0, 200), pass });
  if (!pass) throw new Error(`ASSERT FAIL: ${label} — expected "${expected}" in "${String(actual).slice(0, 200)}"`);
}

async function textOf(page, selector) {
  return page.$eval(selector, (el) => el.textContent ?? '');
}

async function clickByText(page, role, needle) {
  const clicked = await page.evaluate((roleText, searchText) => {
    const elements = [...document.querySelectorAll(`[role="${roleText}"], button, [role="tab"]`)];
    const normalize = (el) => (el.textContent ?? '').trim();
    // Exact label first — "Thêm" must hit the submit, not "Thêm đầu kéo".
    const target = elements.find((el) => normalize(el) === searchText)
      ?? elements.find((el) => normalize(el).includes(searchText));
    if (!target) return false;
    target.click();
    return true;
  }, role, needle);
  if (!clicked) throw new Error(`clickByText: no ${role} containing "${needle}"`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const token = await login({ username: 'admin' });
  console.log('login: ok (admin)');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`);
  });
  // Inject the token BEFORE any SPA script runs (guard would bounce to /login).
  await page.evaluateOnNewDocument((jwt) => {
    window.localStorage.setItem('token', jwt);
  }, token);

  /* ── Tab 1: Đội xe nội bộ ─────────────────────────────────────────── */
  await page.goto(`${FRONTEND}/demo/master-data`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="fleet-table"]', { timeout: 20_000 });
  assert('fleet grid renders BKS 51C-138.65', '51C-138.65', await textOf(page, '[data-testid="fleet-row-51C-138.65"]'));
  assert('pairing chips render trailer', '51R-072.44', await textOf(page, '[data-testid="fleet-pair-51C-138.65"]'));
  await page.screenshot({ path: join(OUT, 'sil161-ui-01-fleet.png') });

  // Search filter (click the real input, type, observe the grid).
  await page.type('[data-testid="fleet-search"]', '469');
  await new Promise((r) => setTimeout(r, 300));
  const gone = await page.$('[data-testid="fleet-row-51C-138.65"]');
  assert('search 469 hides TRK-01 row', 'true', String(gone === null));
  assert('search 469 keeps TRK-04 row', '72L-846.30', await textOf(page, '[data-testid="fleet-row-72L-846.30"]'));
  await page.screenshot({ path: join(OUT, 'sil161-ui-02-fleet-search.png') });
  // Clear the search through the prototype setter (controlled React input).
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="fleet-search"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Add-row click-through: open form, fill, submit, observe the new row.
  // The TextField testids sit on wrappers — type into the inner <input>.
  await clickByText(page, 'button', 'Thêm đầu kéo');
  await page.waitForSelector('[data-testid="fleet-add-form"]', { timeout: 5000 });
  await page.type('[data-testid="fleet-add-plate"] input', '51C-777.77');
  await page.type('[data-testid="fleet-add-model"] input', 'Isuzu Giga');
  await page.type('[data-testid="fleet-add-trailer"] input', '51R-777.77');
  // UuiSelectField: click the real trigger, pick the option from the listbox.
  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Chọn tài xế'));
    if (!trigger) throw new Error('select trigger not found');
    trigger.click();
  });
  await page.waitForSelector('[role="option"]', { timeout: 5000 });
  await page.evaluate(() => {
    const option = [...document.querySelectorAll('[role="option"]')].find((o) =>
      (o.textContent ?? '').includes('Nguyễn Văn Tâm'));
    if (!option) throw new Error('driver option not found');
    option.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  await clickByText(page, 'button', 'Thêm');
  await page.waitForSelector('[data-testid="fleet-row-51C-777.77"]', { timeout: 5000 });
  assert('added truck row renders', '51C-777.77', await textOf(page, '[data-testid="fleet-row-51C-777.77"]'));
  assert('added truck pairing chip shows driver', 'Nguyễn Văn Tâm', await textOf(page, '[data-testid="fleet-pair-51C-777.77"]'));
  await page.screenshot({ path: join(OUT, 'sil161-ui-03-fleet-added.png') });

  /* ── Tab 2: Đối tác ───────────────────────────────────────────────── */
  await clickByText(page, 'tab', 'Đối tác');
  await page.waitForSelector('[data-testid="partners-table-vendors"]', { timeout: 10_000 });
  assert('partner customers render', 'Samsung Electronics HCM CE', await textOf(page, '[data-testid="partners-table-customers"]'));
  assert('partner factories render', 'KCN VSIP II', await textOf(page, '[data-testid="partners-table-factories"]'));
  assert('partner vendors render', 'Giao Nhận Nam Hải', await textOf(page, '[data-testid="partners-table-vendors"]'));
  await page.screenshot({ path: join(OUT, 'sil161-ui-04-partners.png'), fullPage: true });

  await page.type('[data-testid="partners-search-customers"]', 'samsung');
  await new Promise((r) => setTimeout(r, 300));
  const intel = await page.$eval('[data-testid="partners-table-customers"]', (el) => el.textContent ?? '');
  assert('customer search keeps Samsung', 'Samsung', intel);
  assert('customer search hides Intel', 'false', String(intel.includes('Intel')));
  await page.screenshot({ path: join(OUT, 'sil161-ui-05-partners-search.png') });

  /* ── Tab 3: Rate Engine ───────────────────────────────────────────── */
  await clickByText(page, 'tab', 'Rate Engine');
  await page.waitForSelector('[data-testid="rate-matrix-ports"]', { timeout: 10_000 });
  assert('port matrix Cát Lái lift 20 export', '1.250.000', await textOf(page, '[data-testid="rate-cell-CL-20-export-lift"]'));

  // Crosshair hover: hover a cell, then screenshot both bands.
  await page.hover('[data-testid="rate-cell-CL-40-export-drop"]');
  await new Promise((r) => setTimeout(r, 200));
  const band = await page.$eval('[data-testid="rate-cell-CL-20-export-lift"]', (el) => el.closest('td')?.className ?? '');
  assert('hover crosshair lights row band', 'bg-brand-50', band);
  await page.screenshot({ path: join(OUT, 'sil161-ui-06-rates-hover.png'), fullPage: true });

  // Edit a port fee cell: click (input mounts with text selected), type the
  // replacement, Enter, observe the committed value.
  await page.click('[data-testid="rate-cell-VICT-20-export-lift"]');
  await page.waitForSelector('input[data-testid="rate-cell-VICT-20-export-lift"]', { timeout: 5000 });
  await page.type('input[data-testid="rate-cell-VICT-20-export-lift"]', '1350000');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (document.querySelector('[data-testid="rate-cell-VICT-20-export-lift"]')?.textContent ?? '').includes('1.350.000'), { timeout: 5000 });
  assert('port cell edit commits 1.350.000', '1.350.000', await textOf(page, '[data-testid="rate-cell-VICT-20-export-lift"]'));
  assert('save notice confirms', 'Đã lưu', await textOf(page, '[data-testid="rate-save-live"]'));
  await page.screenshot({ path: join(OUT, 'sil161-ui-07-rates-edited.png') });

  // Edit a freight cell.
  await page.$eval('[data-testid="rate-matrix-freight"]', (el) => el.scrollIntoView({ block: 'center' }));
  await page.click('[data-testid="freight-cell-FR-01-40"]');
  await page.waitForSelector('input[data-testid="freight-cell-FR-01-40"]', { timeout: 5000 });
  await page.type('input[data-testid="freight-cell-FR-01-40"]', '5000000');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (document.querySelector('[data-testid="freight-cell-FR-01-40"]')?.textContent ?? '').includes('5.000.000'), { timeout: 5000 });
  assert('freight cell edit commits 5.000.000', '5.000.000', await textOf(page, '[data-testid="freight-cell-FR-01-40"]'));
  await page.screenshot({ path: join(OUT, 'sil161-ui-08-freight-edited.png') });

  await browser.close();

  const passed = results.filter((r) => r.pass).length;
  const summary = {
    gate: 'UI DRIVEN',
    viewport: '1440x900',
    url: `${FRONTEND}/demo/master-data`,
    account: 'admin (local dev stack)',
    assertions: results,
    consoleErrors,
    passed,
    failed: results.length - passed,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(OUT, 'sil161-ui-driver.log'), `${results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.label} — "${String(r.actual).slice(0, 120)}"`).join('\n')}\n\nconsoleErrors: ${consoleErrors.length}\npassed: ${passed}/${results.length}\nexit: 0\n`);
  console.log(`\n${passed}/${results.length} assertions passed; console errors: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) console.log(consoleErrors.join('\n'));
}

main().catch((err) => {
  console.error(err);
  writeFileSync(join(OUT, 'sil161-ui-driver.log'), `DRIVER FAILED: ${err.message}\n\n${results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.label}`).join('\n')}\n`);
  process.exit(1);
});
