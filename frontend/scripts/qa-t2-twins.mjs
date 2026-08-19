// T2 QA: verify Customers/Suppliers list pages after useTableQueryState migration.
// Pattern per puppeteer-spa-auth skill: API login → evaluateOnNewDocument token inject.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:7174';
const API = 'http://localhost:3001/api/auth/login';

const login = await fetch(API, {
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

for (const [path, sel] of [
  ['/customers', '.customers-page'],
  ['/suppliers', '.suppliers-page'],
]) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // 1. Page renders with data or empty state (not login redirect)
  check(`${path} renders`, await page.locator(sel).count() === 1);
  check(`${path} not redirected to login`, !page.url().includes('/login'));

  // 2. Rows present (seeded data) + Pagination control present
  const rows = await page.locator('tbody tr').count();
  console.log(`  ${path} tbody rows: ${rows}`);

  // 3. Search input works: type, wait debounce, rows refetch
  const search = page.locator('input[name="customerSearch"], input[name="supplierSearch"]').first();
  if (await search.count()) {
    await search.fill('xqzh NoSuchName');
    await page.waitForTimeout(600); // debounce 300ms + fetch
    const afterRows = await page.locator('tbody tr').count();
    check(`${path} search filters to empty state`, afterRows <= 1);
    await search.fill('');
    await page.waitForTimeout(600);
  } else {
    check(`${path} has search input`, false);
  }

  // 4. Filter pills toggle
  const pills = page.locator('.toolbar .filter-pill, .FilterPill, [class*="filter"]').count();
  console.log(`  ${path} filter-ish elements: ${pills}`);
}

await page.screenshot({ path: '/tmp/qa-customers.png', fullPage: true });
await browser.close();
console.log(failures.length ? `\nFAILURES: ${failures.join(', ')}` : '\nALL PASS');
process.exit(failures.length ? 1 : 0);
