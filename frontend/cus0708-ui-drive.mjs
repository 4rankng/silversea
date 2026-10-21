// CUS-08 + CUS-07 + CUS-03 UI drive (QA tickets 211026125242 / 211026125715 / 211026125815)
// Drives the REAL local SPA on :7175 (pre-change code, ancestor commit — CUS surfaces identical)
// and :7176 (this worktree with the change). Artifacts land beside this script.
// Run: node qa/2026-10-21-cus07-08/ui-drive.mjs
import { chromium } from '@playwright/test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Artifacts land in qa/2026-10-21-cus07-08/ (gitignored — local evidence).
const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../qa/2026-10-21-cus07-08');
const LOG = resolve(HERE, 'ui-driver.log');
// Same env contract as the sibling cus-qa-* drivers — accounts live only in
// testplan/testaccounts.txt, never hardcoded here.
const USER = process.env.QA_USER;
const PASS = process.env.QA_PASS;
if (!USER || !PASS) throw new Error('Set QA_USER and QA_PASS (see testplan/testaccounts.txt) before running.');
mkdirSync(HERE, { recursive: true });
appendFileSync(LOG, `# ui-drive ${new Date().toISOString()}\n`);

function log(line) {
  console.log(line);
  appendFileSync(LOG, line + '\n');
}

async function drive(name, BASE) {
  const API = `${BASE}/api`;
  const results = { name, BASE, checks: {} };
  log(`\n===== ${name} ${BASE} =====`);
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: USER, password: PASS }),
  });
  if (!loginRes.ok) throw new Error(`login failed ${loginRes.status}`);
  const { token } = await loginRes.json();
  log(`login ok (${USER} via ${API}/auth/login)`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN' });
  const page = await ctx.newPage();
  await page.addInitScript((t) => globalThis.localStorage.setItem('token', t), token);

  // --- 1. CUS workspace row: cargo weight display -------------------------
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.cus-cargo-summary__weight', { timeout: 20000 });
  const rowWeight = await page.evaluate(() => {
    const cell = document.querySelector('.cus-cargo-summary__weight');
    const lot = cell?.closest('tr')?.querySelector('[data-cell-label="Khách hàng & nhà máy"]')?.textContent?.slice(0, 40);
    return { weight: cell?.textContent?.trim() ?? null, lot };
  });
  results.checks.workspaceRowWeight = rowWeight;
  log(`workspace row weight: ${JSON.stringify(rowWeight)}`);
  await page.screenshot({ path: resolve(HERE, `ui-${name}-workspace-row.png`), fullPage: false });

  // --- 2. Drawer container table: weight column ---------------------------
  // Lot QAENV01-FCL-KEP (id 311985): container QATU0001233 got cargoWeightKg
  // 15000.00 through the CUS container-line API before this drive — the
  // drawer cell renders "15.000" before / "15 tấn" after.
  await page.getByRole('button', { name: /Mở chi tiết lô hàng QA-QAENV01-FCL-KEP/ }).first().click();
  const weightLabel = name === 'after' ? 'Trọng lượng' : 'Trọng lượng (kg)';
  await page.waitForSelector(`[data-label="${weightLabel}"]`, { timeout: 15000 });
  await page.waitForTimeout(600);
  const drawer = await page.evaluate((label) => {
    const ths = [...document.querySelectorAll('th')].map((th) => th.textContent?.trim());
    const cell = document.querySelector(`tbody [data-label="${label}"]`);
    return { header: ths.find((t) => t?.startsWith('Trọng lượng')) ?? null, weightCell: cell?.textContent?.trim() ?? null };
  }, weightLabel);
  results.checks.drawerWeight = drawer;
  log(`drawer weight: ${JSON.stringify(drawer)}`);
  await page.screenshot({ path: resolve(HERE, `ui-${name}-drawer-weight.png`), fullPage: false });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // --- 3. Create form ------------------------------------------------------
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-field-id="shipment-customer"]', { timeout: 20000 });
  await page.waitForTimeout(500);

  // pick LONG MINH — the demo customer whose factories carry address + MST
  await page.locator('[data-field-id="shipment-customer"] input').click();
  await page.waitForSelector('[role="option"]', { timeout: 10000 });
  await page.locator('[role="option"]', { hasText: 'LONG MINH' }).first().click();
  await page.waitForTimeout(1200);

  // second container so copy-ALL has something to overwrite
  const addBtn = page.getByRole('button', { name: 'Thêm container' });
  if (await addBtn.count()) await addBtn.click();
  await page.waitForTimeout(400);

  // CUS-07: pick a factory on row 1, then open the detail popover
  const factoryInput = page.locator('[data-field-id$="-factory"] input').first();
  await factoryInput.click();
  await page.waitForSelector('[role="option"]', { timeout: 10000 });
  await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(600);
  const factoryCellText = await page.evaluate(() => {
    const info = [...document.querySelectorAll('button[aria-label^="Xem chi tiết nhà máy"]')];
    return { firstInfoCount: info.length, firstInfoLabel: info[0]?.getAttribute('aria-label') ?? null };
  });
  results.checks.factoryInfoButton = factoryCellText;
  log(`factory info button: ${JSON.stringify(factoryCellText)}`);

  if (name === 'after') {
    await page.locator('button[aria-label^="Xem chi tiết nhà máy"]').first().click();
    await page.waitForSelector('.factory-detail-pop', { timeout: 8000 });
    const pop = await page.evaluate(() => {
      const pop = document.querySelector('.factory-detail-pop');
      return {
        name: pop?.querySelector('.factory-detail-pop__name')?.textContent?.trim() ?? null,
        address: pop?.querySelector('.factory-detail-pop__address')?.textContent?.trim() ?? null,
        hasMst: /MST/.test(pop?.textContent ?? ''),
      };
    });
    results.checks.factoryPopover = pop;
    log(`factory popover: ${JSON.stringify(pop)}`);
    await page.screenshot({ path: resolve(HERE, 'ui-after-factory-popover.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else {
    await page.screenshot({ path: resolve(HERE, 'ui-before-factory-cell.png'), fullPage: false });
  }

  // CUS-03: schedule row 1, then copy to ALL
  const row1 = page.locator('tr.csc-container-row').first();
  for (const [seg, val] of [['dd', '25'], ['mm2', '12'], ['yyyy', '2026'], ['hh', '09'], ['mm', '30']]) {
    await row1.locator(`input[data-seg="${seg}"]`).fill(val);
  }
  await page.waitForTimeout(600);
  const allBtn = page.getByRole('button', { name: /Copy giờ hẹn cho tất cả \d+ cont/ });
  const allBtnCount = await allBtn.count();
  results.checks.copyAllButtonVisible = allBtnCount;
  log(`copy-all button count: ${allBtnCount}`);
  await page.screenshot({ path: resolve(HERE, `ui-${name}-create-schedule.png`), fullPage: false });

  if (name === 'after') {
    if (!allBtnCount) throw new Error('copy-ALL button missing on after');
    await allBtn.first().click();
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tr.csc-container-row')];
      const values = rows.map((row) => ({
        dd: row.querySelector('input[data-seg="dd"]')?.value ?? '',
        mm2: row.querySelector('input[data-seg="mm2"]')?.value ?? '',
        yyyy: row.querySelector('input[data-seg="yyyy"]')?.value ?? '',
        hh: row.querySelector('input[data-seg="hh"]')?.value ?? '',
        mm: row.querySelector('input[data-seg="mm"]')?.value ?? '',
      }));
      const toasts = [...document.querySelectorAll('[role="status"], .toast, [class*="toast"]')].map((t) => t.textContent?.trim()).filter((t) => t && /copy/i.test(t));
      return { values, toast: toasts[0] ?? null };
    });
    results.checks.copyAllResult = after;
    log(`copy-all result: ${JSON.stringify(after)}`);
    await page.screenshot({ path: resolve(HERE, 'ui-after-copy-all.png'), fullPage: false });
  } else if (allBtnCount) {
    throw new Error('copy-ALL button unexpectedly present on before');
  }

  await browser.close();
  return results;
}

const summary = [];
summary.push(await drive('before', 'http://localhost:7175'));
summary.push(await drive('after', 'http://localhost:7176'));
writeFileSync(resolve(HERE, 'ui-drive-summary.json'), JSON.stringify(summary, null, 2));
log('\nDONE both drives');
