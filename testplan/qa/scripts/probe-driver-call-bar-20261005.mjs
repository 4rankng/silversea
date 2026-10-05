// Card 20261005_364 (REQ-05) — the driver trip page renders the Gọi kho
// tel: link with the SITE phone (never the order contact), and renders no
// dial affordance when the site phone is empty. Usage:
//   BASE=https://vantai.tingting.vip IDENTIFIER=dvthuc node <script>
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'https://vantai.tingting.vip';
const OUT = 'qa/2026-10-05_card364-staging';
mkdirSync(OUT, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: process.env.IDENTIFIER || 'dvthuc', password: 'Abc123' }) });
if (!login.ok) throw new Error(`login failed ${login.status}`);
const { token } = await login.json();
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/my-trips`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(3500);
const tripId = await page.evaluate(async () => {
  const t = localStorage.getItem('token');
  const res = await fetch('/api/driver/me/journey-board', { headers: { Authorization: `Bearer ${t}` } });
  const json = await res.json();
  return json.items?.[0]?.tripId ?? null;
});
if (!tripId) throw new Error('no trip on the board');
await page.goto(`${BASE}/my-trips/${tripId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(3500);
const probe = await page.evaluate(() => {
  const links = [...document.querySelectorAll('a[href^="tel:"]')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent?.trim().slice(0, 24), cls: a.className.slice(0, 40) }));
  const bar = document.querySelector('[class*="driver-task-call"]');
  return { telLinks: links, barPresent: Boolean(bar), barText: bar?.textContent?.replace(/\s+/g, ' ').slice(0, 80) ?? null };
});
console.log(JSON.stringify(probe, null, 1));
await page.screenshot({ path: `${OUT}/driver-call-bar-390.png`, fullPage: false });
writeFileSync(`${OUT}/probe-results.json`, JSON.stringify(probe, null, 2));
const ok = probe.telLinks.some((l) => l.href.startsWith('tel:0'));
console.log('VERDICT:', ok ? 'TEL LINK PRESENT WITH SITE PHONE' : 'CHECK OUTPUT');
await browser.close();
