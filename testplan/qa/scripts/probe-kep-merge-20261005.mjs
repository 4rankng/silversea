// Card 20261004_353 staging rung — the dispatcher Kẹp merge completes:
// (fix 1) POST /trips/pairs no longer 403s for DISPATCHER; (fix 2) "Lệnh ghép
// cùng" lists the same-lot sibling. Real sequence on the E2E-KEP-002 fixture.
// Usage: BASE=https://vantai.tingting.vip IDENTIFIER=dungnv node <script>
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'https://vantai.tingting.vip';
const OUT = 'qa/2026-10-05_card353-staging';
mkdirSync(OUT, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: process.env.IDENTIFIER || 'dungnv', password: 'Abc123' }) });
if (!login.ok) throw new Error(`login failed ${login.status}`);
const { token } = await login.json();
console.log(`API login OK (${process.env.IDENTIFIER || 'dungnv'})`);
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const pairResponses = [];
page.on('response', async (r) => {
  if (r.url().includes('/trips/pairs') && r.request().method() === 'POST') {
    pairResponses.push({ status: r.status(), body: await r.text().catch(() => '') });
  }
});
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(4000);
// Open the merge dialog from the first row offering "Ghép chuyến".
const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent || '').includes('Ghép chuyến'));
  if (!btn) return { ok: false, buttons: [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent?.trim()).filter((t) => t?.includes('Ghép') || t?.includes('Kẹp')).slice(0, 6) };
  btn.click();
  return { ok: true };
});
console.log('trigger:', JSON.stringify(opened));
await settle(1200);
const comboFocus = async (label) => page.evaluate((lbl) => {
  const label2 = [...document.querySelectorAll('[role="dialog"] label, [role="alertdialog"] label')].find((l) => l.textContent?.includes(lbl));
  const input = label2?.nextElementSibling?.querySelector('input') ?? label2?.parentElement?.querySelector('input');
  if (!input) return false;
  input.focus();
  return document.activeElement === input;
}, label);
// Pick "Kẹp" in Loại ghép: open with ArrowDown, ArrowDown to KEP, Enter.
await comboFocus('Loại ghép');
await page.keyboard.press('ArrowDown');
await settle(500);
await page.keyboard.press('ArrowDown');
await settle(200);
await page.keyboard.press('Enter');
await settle(500);
const kindValue = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.textContent?.includes('Loại ghép'))?.nextElementSibling?.querySelector('input')?.value ?? '');
console.log('Loại ghép =', JSON.stringify(kindValue));
// Read the partner options (fix 2 assertion): open the listbox, dump options.
await comboFocus('Lệnh ghép cùng');
await page.keyboard.press('ArrowDown');
await settle(700);
const partnerOptions = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim()));
console.log('partner options:', JSON.stringify(partnerOptions));
await page.screenshot({ path: `${OUT}/kep-dialog-partner-options.png` });
const realPartner = partnerOptions.filter((o) => o && !o.includes('Chọn lệnh ghép'));
if (realPartner.length) {
  await page.keyboard.press('ArrowDown');
  await settle(200);
  await page.keyboard.press('Enter');
  await settle(400);
  // Submit.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes('Ghép chuyến'));
    btn?.click();
  });
  await settle(2500);
  await page.screenshot({ path: `${OUT}/kep-after-submit.png` });
}
const dialogState = await page.evaluate(() => ({
  dialogOpen: Boolean(document.querySelector('[role="dialog"]')),
  alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent?.trim()).filter(Boolean),
}));
console.log('after submit:', JSON.stringify({ dialogState, pairResponses }));
writeFileSync(`${OUT}/probe-results.json`, JSON.stringify({ opened, kindValue, partnerOptions, dialogState, pairResponses }, null, 2));
const ok = realPartner.length > 0 && pairResponses.some((r) => r.status === 201);
console.log('VERDICT:', ok ? 'MERGE COMPLETED (201, sibling listed)' : 'CHECK OUTPUT');
await browser.close();
