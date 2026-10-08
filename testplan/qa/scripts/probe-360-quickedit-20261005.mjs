// Card 20261005_360 rung — the CUS quick-edit weight input hydrates WITHOUT
// PG's dead decimals (stored "12500.50" → the field reads "12500.5").
// Usage: BASE=https://vantai.tingting.vip IDENTIFIER=thanhdc node <script>
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'https://vantai.tingting.vip';
const OUT = 'qa/2026-10-05_card360-staging';
mkdirSync(OUT, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: process.env.IDENTIFIER || 'thanhdc', password: 'Abc123' }) });
if (!login.ok) throw new Error(`login failed ${login.status}`);
const { token } = await login.json();
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/shipments`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(3500);
// Open the CUS shipment detail (Chi tiết lô hàng) for the lot holding TSTU4182600.
const lotId = process.env.LOT_ID;
const opened = { ok: Boolean(lotId), lot: lotId };
if (opened.ok) await page.goto(`${BASE}/shipments-detail?shipment=${lotId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('lot open:', JSON.stringify(opened));
if (opened.ok) {
  await settle(4000);
  // The container row's edit affordance (Sửa / Chỉnh sửa thông số) — eval-clickable button.
  // Card 365 live: the today-default hides lots dated otherwise — click the
  // "Tất cả" date chip (ALL_DATES_PRESET) to reveal them, and record whether
  // the reveal was NEEDED (that IS the 365 root-cause confirmation).
  const chip = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="button"], a')].find((b) => b.textContent?.trim() === 'Tất cả');
    if (!el) return { found: false };
    el.click();
    return { found: true };
  });
  console.log('Tất cả chip:', JSON.stringify(chip));
  await settle(2500);
  const edit = await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr, [class*="container-row"]')].find((r) => r.textContent?.includes('TSTU4182600'));
    const btn = row ? [...row.querySelectorAll('button')].find((b) => /Sửa|Chỉnh sửa|Thông số/i.test(b.textContent || b.getAttribute('aria-label') || '')) : null;
    if (!btn) return { ok: false, buttons: row ? [...row.querySelectorAll('button')].map((b) => b.textContent?.trim().slice(0, 20)) : null };
    btn.click();
    return { ok: true };
  });
  console.log('edit open:', JSON.stringify(edit));
  await settle(1200);
  const probe = await page.evaluate(() => {
    const input = [...document.querySelectorAll('input')]
      .find((i) => (i.closest('label')?.textContent || i.getAttribute('aria-label') || '').includes('Trọng lượng'));
    return { weightValue: input?.value ?? null, found: Boolean(input), modal: Boolean(document.querySelector('[role="dialog"], .cus-quick-edit-modal')) };
  });
  console.log('weight field:', JSON.stringify(probe));
  await page.screenshot({ path: `${OUT}/quickedit-weight.png` });
  writeFileSync(`${OUT}/probe-results.json`, JSON.stringify(probe, null, 2));
  console.log('VERDICT:', probe.found && probe.weightValue === '12500.5' ? 'HYDRATES CLEAN (no dead decimals)' : 'CHECK OUTPUT');
}
await browser.close();
