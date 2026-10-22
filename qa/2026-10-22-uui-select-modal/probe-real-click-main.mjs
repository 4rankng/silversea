import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:7175/login', { waitUntil: 'networkidle', timeout: 30000 });
await page.fill('input[name="username"]', 'admin');
await page.fill('input[name="password"]', 'Abc123');
await page.click('button[type="submit"]');
await page.waitForTimeout(3000);
await page.goto('http://localhost:7175/config/quotations', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
for (const b of await page.$$('button')) {
  const t = await b.textContent() || '';
  if (/Tạo|Thêm/i.test(t) && /báo giá/i.test(t)) { await b.click(); break; }
}
const dlg = page.locator('[role="dialog"]').first();
await dlg.waitFor({ timeout: 8000 });
const combo = dlg.locator('[role="combobox"]').first();
await combo.click({ timeout: 5000 });
await page.waitForTimeout(800);
const pop = page.locator('.ds-uui-select__popover');
console.log('popover count:', await pop.count());
const popOpts = pop.locator('[role="option"]');
console.log('options INSIDE popover:', await popOpts.count());
// also count page-list role=option impostors
const impostors = await page.evaluate(() => {
  const all = [...document.querySelectorAll('[role="option"]')];
  const outside = all.filter(o => !o.closest('.ds-uui-select__popover'));
  return { total: all.length, outside: outside.length, outsideSample: outside.slice(0, 3).map(e => `${e.tagName} in ${(e.closest('[class]')?.className || '').toString().slice(0, 40)}`) };
});
console.log('impostors:', JSON.stringify(impostors));
if (await popOpts.count() > 1) {
  const label = await popOpts.nth(1).textContent();
  await popOpts.nth(1).click({ timeout: 5000 });
  await page.waitForTimeout(400);
  const val = await combo.inputValue();
  console.log(`REAL_OPTION_CLICK OK label="${(label || '').trim()}" inputValue="${val.trim()}"`);
} else {
  console.log('REAL_OPTION_CLICK FAILED: no options inside popover');
}
await browser.close();
