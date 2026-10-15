/* FB-090 UI drive — QA run 2026-10-15.
 * Drives the REAL changed screens on the local stack (frontend :7199 →
 * backend :3099, local dev Postgres :5441):
 *   1. /config/carrier-route-pricing — create a generic (Giá chung) lane row
 *      (Hải Phòng-NEWEB × 5T × 1.234.500₫) through the actual form controls.
 *   2. /config/vehicle-size-classes — catalog renders with sourcing rules.
 *   3. /config/pricing-tables — Loại xe selector present on the pricing form.
 * Auth: JWT pre-injected via evaluateOnNewDocument (puppeteer-spa-auth).
 * Lives at frontend root per the cus-qa*.mjs / role-ui-sweep.mjs precedent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = fs.readFileSync('/private/var/folders/8j/qs8k8y3n1hlfbl4q20k0hgjh0000gn/T/opencode/fb090_token.txt', 'utf8').trim();
const BASE = 'http://localhost:7199';
const QA_DIR = path.resolve(__dirname, '../../qa');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const log = (...a) => console.log('[fb090-ui]', ...a);

async function clickButtonByText(page, text, { exact = false } = {}) {
  const handle = await page.evaluateHandle((needle, isExact) => {
    // Approximate the accessible name: aria-labelledby beats aria-label
    // beats text content — matches how the UUI select trigger is named.
    const accName = (el) => {
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        return labelledby.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
      }
      return el.getAttribute('aria-label') || el.textContent || '';
    };
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(b => {
      const t = (accName(b) || '').replace(/\s+/g, ' ').trim();
      return isExact ? t === needle : t.includes(needle);
    }) || null;
  }, text, exact);
  const el = handle.asElement();
  if (!el) throw new Error(`button not found: ${text}`);
  await el.click();
  return el;
}

/** Find a form control by its <label for=id> text (works for combobox
 *  triggers, which are inputs — not buttons — once the option count crosses
 *  the UUI search threshold). */
async function controlByLabel(page, labelText) {
  const handle = await page.evaluateHandle((needle) => {
    const label = Array.from(document.querySelectorAll('label'))
      .find(l => (l.textContent || '').replace(/\s+/g, ' ').trim().includes(needle));
    if (!label) return null;
    const forId = label.getAttribute('for');
    const control = forId ? document.getElementById(forId) : label.querySelector('input, button, [role="button"]');
    return control || null;
  }, labelText);
  const el = handle.asElement();
  if (!el) throw new Error(`no control for label: ${labelText}`);
  return el;
}

async function pickUuiOption(page, labelText, optionText) {
  const control = await controlByLabel(page, labelText);
  await control.click();
  await page.waitForSelector('[role="option"]', { timeout: 10000 });
  const handle = await page.evaluateHandle((needle) => {
    const opts = Array.from(document.querySelectorAll('[role="option"]'));
    return opts.find(o => (o.textContent || '').replace(/\s+/g, ' ').trim().includes(needle)) || null;
  }, optionText);
  const el = handle.asElement();
  if (!el) throw new Error(`option not found: ${optionText}`);
  await el.click();
  log(`picked ${labelText} → ${optionText}`);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), TOKEN);
  const consoleLogs = [];
  page.on('console', m => consoleLogs.push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', e => consoleLogs.push(`[pageerror] ${e.message}`));

  // ── 1. Carrier pricing: create a generic lane row ─────────────────────────
  await page.goto(`${BASE}/config/carrier-route-pricing`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('table', { timeout: 30000 });
  log('carrier-pricing page loaded');
  await clickButtonByText(page, 'Thêm mới');
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await pickUuiOption(page, 'Tuyến đường', 'Hải Phòng');
  await pickUuiOption(page, 'Loại xe', '5T — Xe 5 tấn');
  // Nhà xe stays on the default "Giá chung (mọi nhà xe)" option.
  const priceControl = await controlByLabel(page, 'Cước trả nhà xe');
  const priceId = await page.evaluate(el => el.id, priceControl);
  await page.evaluate((id) => {
    const input = document.getElementById(id);
    if (!input) throw new Error('price input not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '1234500');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, priceId);
  log('price filled: 1234500');
  await clickButtonByText(page, 'Thêm', { exact: true });
  await new Promise(r => setTimeout(r, 2500));
  const bodyText = await page.evaluate(() => document.body.innerText);
  if (!bodyText.includes('1.234.500')) throw new Error('created row price 1.234.500 not visible after save');
  if (!bodyText.includes('Giá chung')) throw new Error('generic lane label "Giá chung" not visible');
  log('row created and visible (1.234.500 · Giá chung)');
  await page.screenshot({ path: `${QA_DIR}/2026-10-15_fb090_ui-carrier-pricing-created.png`, fullPage: true });

  // ── 2. Vehicle size class catalog renders with sourcing rules ────────────
  await page.goto(`${BASE}/config/vehicle-size-classes`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('table', { timeout: 30000 });
  const catalogText = await page.evaluate(() => document.body.innerText);
  if (!catalogText.includes('100% xe ngoài')) throw new Error('sourcing label "100% xe ngoài" missing from catalog');
  if (!catalogText.includes('Xe nội bộ hoặc xe ngoài')) throw new Error('sourcing label "Xe nội bộ hoặc xe ngoài" missing');
  log('vehicle-size-classes catalog renders both sourcing rules');
  await page.screenshot({ path: `${QA_DIR}/2026-10-15_fb090_ui-vehicle-classes.png`, fullPage: true });

  // ── 3. Pricing tables form exposes the Loại xe selector ──────────────────
  await page.goto(`${BASE}/config/pricing-tables`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('table', { timeout: 30000 });
  await clickButtonByText(page, 'Thêm mới');
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const dialogText = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return dlg ? dlg.innerText : '';
  });
  for (const label of ['Khách hàng', 'Tuyến đường', 'Loại xe', 'Loại container', 'Cước thu khách']) {
    if (!dialogText.includes(label)) throw new Error(`pricing form missing field: ${label}`);
  }
  log('pricing-tables form shows the Loại xe + Cước thu khách fields');
  await page.screenshot({ path: `${QA_DIR}/2026-10-15_fb090_ui-pricing-form.png`, fullPage: true });

  fs.writeFileSync(`${QA_DIR}/2026-10-15_fb090_ui-console.log`, consoleLogs.join('\n') || '(no console output)');
  await browser.close();
  log('DONE');
  process.exit(0);
})().catch((err) => {
  console.error('[fb090-ui] FAILED:', err.message);
  process.exit(1);
});
