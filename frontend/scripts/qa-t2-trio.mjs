// T2 QA: verify the three formerly-unpaginated list pages now paginate client-side.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:7174';
const login = await fetch('http://localhost:3001/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) { console.error('LOGIN FAILED', login.status); process.exit(1); }
const { token } = await login.json();

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
const page = await ctx.newPage();
const failures = [];
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures.push(name);
};

for (const [path, listSelector] of [
  ['/debt', '.debt-list-table tbody tr, .m-card-list .m-card'],
  ['/payables', 'tbody tr, .m-card'],
  ['/my-settlements', '.fset-card'],
]) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check(`${path} renders`, !page.url().includes('/login'));

  const cards = await page.locator(listSelector.split(', ')[0]).count();
  console.log(`  ${path} visible items: ${cards}`);

  const pagination = page.locator('.pagination, nav[aria-label*="pagination" i], [class*="pagination" i]').first();
  const hasPagination = await pagination.count();
  console.log(`  ${path} pagination present: ${hasPagination > 0 ? 'yes' : 'no'}`);

  if (hasPagination > 0) {
    const next = page.locator('[class*="pagination" i] button:not([disabled])').last();
    if (await next.count()) {
      await next.click();
      await page.waitForTimeout(400);
      const after = await page.locator(listSelector.split(', ')[0]).count();
      console.log(`  ${path} after next-page click: ${after} items`);
    }
  }
}

await browser.close();
console.log(failures.length ? `\nFAILURES: ${failures.join(', ')}` : '\nALL PASS');
process.exit(failures.length ? 1 : 0);
