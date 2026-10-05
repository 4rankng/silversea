// Card 20261004_355 UI rung — the OPS "Khai báo chi phí" fee-type combobox
// (UuiSelectField = React-Aria combobox INPUT) must offer the FUEL entry
// ("Phí nhiên liệu / dầu"). In-eval clicks can't open react-aria usePress
// triggers (input-death days), but eval FOCUS + a trusted CDP ArrowDown does
// — that is the driving recipe here. Usage:
//   BASE=http://localhost:7175 API=http://localhost:3002 IDENTIFIER=opsqa \
//   node testplan/qa/scripts/probe-ops-fuel-combobox-20261005.mjs
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:7175';
const API = process.env.API || 'http://localhost:3002';
const OUT = process.env.OUT_DIR || 'qa/2026-10-05_card355';
mkdirSync(OUT, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: process.env.IDENTIFIER || 'opsqa', password: 'Abc123' }) });
if (!login.ok) throw new Error(`API login failed: ${login.status} (need an OPS-role account — /ops/orders is opsOnly)`);
const { token } = await login.json();
console.log(`API login OK (${process.env.IDENTIFIER || 'opsqa'})`);
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/ops/orders`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await settle(2500);
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Khai chi phí')?.click(); });
await settle(2500);
const focus = await page.evaluate(() => {
  const input = document.querySelector('[role="dialog"] input[role="combobox"], [role="dialog"] div[data-combobox-value] input');
  // Fall back to the labelled field when the aria-label is on the wrapper.
  const label = [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.textContent?.includes('Loại phí'));
  const trigger = input ?? label?.nextElementSibling?.querySelector('input');
  if (!trigger) return { ok: false };
  trigger.focus();
  return { ok: document.activeElement === trigger, role: trigger.getAttribute('role') };
});
console.log('combobox focus:', JSON.stringify(focus));
if (!focus.ok) throw new Error('fee-type combobox input not found');
await page.keyboard.press('ArrowDown'); // trusted: opens the react-aria listbox
await settle(1000);
const opts = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim()));
const hasFuel = opts.some((o) => o.includes('nhiên liệu'));
console.log(`listbox options: ${opts.length}; fuel present: ${hasFuel}`);
await page.screenshot({ path: `${OUT}/ops-fuel-combobox-1440.png` });
writeFileSync(`${OUT}/combobox-options.json`, JSON.stringify({ count: opts.length, hasFuel, options: opts }, null, 2));
console.log('VERDICT:', hasFuel ? 'FUEL PRESENT' : 'FUEL MISSING');
await browser.close();
process.exit(hasFuel ? 0 : 2);
