import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:7176/login', { waitUntil: 'networkidle', timeout: 30000 });
await page.fill('input[name="username"]', 'admin');
await page.fill('input[name="password"]', 'Abc123');
await page.click('button[type="submit"]');
await page.waitForTimeout(3000);
await page.goto('http://localhost:7176/config/quotations', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
for (const b of await page.$$('button')) {
  const t = await b.textContent() || '';
  if (/Tạo|Thêm/i.test(t) && /báo giá/i.test(t)) { await b.click(); break; }
}
const dlg = page.locator('[role="dialog"]').first();
await dlg.waitFor({ timeout: 8000 });
await dlg.locator('[role="combobox"]').first().click();
await page.waitForTimeout(800);
const hit = await page.evaluate(() => {
  const opt = document.querySelectorAll('[role="option"]')[1];
  const pop = document.querySelector('.ds-uui-select__popover');
  if (!opt || !pop) return { err: 'missing', opt: !!opt, pop: !!pop };
  const r = opt.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const stack = document.elementsFromPoint(cx, cy).slice(0, 6).map(e => `${e.tagName}.${(e.className || '').toString().slice(0, 50)} pe=${getComputedStyle(e).pointerEvents}`);
  const popR = pop.getBoundingClientRect();
  return {
    optRect: { x: r.x, y: r.y, w: r.width, h: r.height },
    popRect: { x: popR.x, y: popR.y, w: popR.width, h: popR.height },
    popZ: getComputedStyle(pop).zIndex,
    optInPop: pop.contains(opt),
    hitStack: stack,
  };
});
console.log(JSON.stringify(hit, null, 1));
await browser.close();
