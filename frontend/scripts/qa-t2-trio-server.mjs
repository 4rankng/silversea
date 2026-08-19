// QA: trio pages after server-side pagination rewire.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:7174';
const login = await fetch('http://localhost:3001/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) { console.error('LOGIN FAILED'); process.exit(1); }
const { token } = await login.json();

const browser = await chromium.launch();
const failures = [];
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures.push(name);
};

// /debt (admin) — 23 rows seeded → 25/page = 1 page but exercise bucket pill + search
const ctx = await browser.newContext();
await ctx.addInitScript((t) => localStorage.setItem('token', t), token);
const page = await ctx.newPage();

await page.goto(BASE + '/debt', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
check('/debt renders', !page.url().includes('/login'));
const debtRows = await page.locator('.debt-list-table tbody tr').count();
console.log(`  /debt rows: ${debtRows}`);
// KPI strip values present (server totals)
const heroTotal = await page.locator('.hero-kpi-card__amount').first().textContent().catch(() => null);
console.log(`  /debt hero total text: ${heroTotal?.trim().slice(0, 40)}`);
check('/debt hero KPI rendered', Boolean(heroTotal && heroTotal.trim().length > 0 && /[0-9]/.test(heroTotal)));

// search narrows server-side
const debtSearch = page.locator('.debt-filter-search input').first();
if (await debtSearch.count()) {
  await debtSearch.fill('NoSuchCustomerXQZH');
  await page.waitForTimeout(800);
  const after = await page.locator('.debt-list-table tbody tr').count();
  console.log(`  /debt rows after bogus search: ${after}`);
  check('/debt search empties list', after <= 1);
  await debtSearch.fill('');
  await page.waitForTimeout(800);
}

await page.goto(BASE + '/payables', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
check('/payables renders', !page.url().includes('/login'));
const payRows = await page.locator('tbody tr').count();
console.log(`  /payables rows: ${payRows} (seeded total 7)`);
check('/payables rows bounded by server page', payRows > 0 && payRows <= 25);

await browser.close();
console.log(failures.length ? `\nFAILURES: ${failures.join(', ')}` : '\nALL PASS');
process.exit(failures.length ? 1 : 0);
