// Debug: why does the customer combobox click not land?
import { chromium } from '@playwright/test';
const BASE = 'http://localhost:7176';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => { errors.push('PAGEERROR: ' + String(e).slice(0, 300)); });
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[name="username"]', 'cus');
  await page.fill('input[name="password"]', 'Abc123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/kho-debug-1-form.png' });
  const probe = await page.evaluate(() => {
    const input = document.querySelector('[data-field-id="shipment-customer"] input, #shipment-customer input');
    if (!input) return { input: false };
    const r = input.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    return {
      input: true, rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      topElementAtCenter: topEl ? `${topEl.tagName}.${String(topEl.className).slice(0, 80)}` : null,
      isInputItself: topEl === input,
      overlays: Array.from(document.querySelectorAll('[role="dialog"], .toast, [data-toast], [data-radix-popper-content-wrapper]'))
        .filter((e) => e.getBoundingClientRect().height > 0)
        .map((e) => `${e.tagName}.${String(e.className).slice(0, 60)}`),
    };
  });
  console.log(JSON.stringify(probe, null, 2));
  console.log('console errors:', JSON.stringify(errors.slice(0, 5)));
} catch (e) {
  console.log('FAIL', e?.message ?? e);
} finally {
  await browser.close();
}
