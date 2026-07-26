import { chromium } from 'playwright';

const BASE = 'http://localhost:7174';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const requests = [];
page.on('request', (r) => {
  if (r.url().includes('/api/shipments') || r.url().includes('/api/api/')) {
    requests.push({ method: r.method(), url: r.url() });
  }
});
const responses = [];
page.on('response', async (r) => {
  if (r.url().includes('/shipments')) {
    responses.push({ status: r.status(), url: r.url() });
  }
});

// 1. Login as admin
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[type="text"], input[name="username"], input[placeholder*="tên" i], input[id*="user" i]', 'admin').catch(() => {});
await page.fill('input[type="password"]', 'admin123').catch(() => {});
// Try multiple login button strategies
const loginBtn = page.locator('button:has-text("Đăng nhập"), button[type="submit"]').first();
await loginBtn.click().catch(async () => { await page.keyboard.press('Enter'); });
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 10000 }).catch(() => {});
console.log('after login, url:', page.url());

// 2. Navigate to shipments
await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log('shipments url:', page.url());

// 3. Desktop screenshot
await page.screenshot({ path: '/tmp/shipments_desktop.png', fullPage: true });
console.log('desktop screenshot saved');

// 4. Mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/shipments_mobile.png', fullPage: true });
console.log('mobile screenshot saved');

// 5. Tablet
await page.setViewportSize({ width: 820, height: 1180 });
await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/shipments_tablet.png', fullPage: true });
console.log('tablet screenshot saved');

console.log('\n=== API requests observed ===');
console.log(JSON.stringify(requests, null, 2));
console.log('\n=== API responses observed ===');
console.log(JSON.stringify(responses, null, 2));

await browser.close();
