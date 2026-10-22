// DOM probe — dump the kho field structure on the create form.
import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://localhost:7175';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[name="username"]', 'cus');
  await page.fill('input[name="password"]', 'Abc123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  const customerInput = page.locator('#shipment-customer input, [data-field-id="shipment-customer"] input').first();
  await customerInput.click();
  await page.waitForTimeout(700);
  await page.locator('[role="option"]', { hasText: 'LONG MINH' }).first().click();
  await page.waitForTimeout(900);
  const dirSelect = page.locator('[data-field-id="shipment-trade-direction"] select').first();
  await dirSelect.selectOption('IMPORT').catch(async () => {
    const btn = page.locator('[data-field-id="shipment-trade-direction"] button').first();
    await btn.click(); await page.waitForTimeout(400);
    await page.locator('[role="option"]', { hasText: 'Nhập khẩu' }).first().click();
  });
  await page.waitForTimeout(500);
  const lclSwitch = page.locator('button:has-text("lẻ"), [role="radio"]:has-text("lẻ"), label:has-text("Hàng lẻ")').first();
  if (await lclSwitch.count()) { await lclSwitch.scrollIntoViewIfNeeded(); await lclSwitch.click(); await page.waitForTimeout(700); }

  const dump = await page.evaluate(() => {
    const field = document.querySelector('[data-field-id="shipment-pickup-warehouse"]');
    if (!field) return { error: 'no pickup-warehouse field' };
    const inputs = field.querySelectorAll('input');
    const label = field.querySelector('label');
    const group = field.querySelector('[data-uui-control="combobox"]');
    return {
      fieldHTMLSnippet: field.outerHTML.slice(0, 900),
      inputCount: inputs.length,
      input0: inputs[0] ? {
        id: inputs[0].id, name: inputs[0].name, role: inputs[0].getAttribute('role'),
        ariaLabel: inputs[0].getAttribute('aria-label'),
        ariaExpanded: inputs[0].getAttribute('aria-expanded'),
        ariaControls: inputs[0].getAttribute('aria-controls'),
        value: inputs[0].value, focused: document.activeElement === inputs[0],
      } : null,
      labelFor: label?.getAttribute('for') ?? null,
      groupId: group?.id ?? null,
    };
  });
  console.log(JSON.stringify(dump, null, 2));
} catch (e) {
  console.log('FAIL', e?.message ?? e);
} finally {
  await browser.close();
}
