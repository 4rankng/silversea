// Card 20261004_358 criterion-2 staging rung — /shipments/:id/edit must land
// on the detail surface, never the 404. Usage:
//   BASE=https://vantai.tingting.vip IDENTIFIER=admin node <script> [shipmentId]
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE || 'https://vantai.tingting.vip';
const ID = process.argv[2] || '315';
const OUT = 'qa/2026-10-05_card358-staging';
mkdirSync(OUT, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: process.env.IDENTIFIER || 'admin', password: 'Abc123' }) });
if (!login.ok) throw new Error(`login failed ${login.status}`);
const { token } = await login.json();
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/shipments/${ID}/edit`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await settle(4500);
const state = await page.evaluate(() => ({
  url: location.pathname,
  body: document.querySelector('main')?.textContent?.replace(/\s+/g, ' ').slice(0, 160) ?? '',
  is404: /không tìm thấy|trang bạn tìm|404/i.test(document.body.textContent ?? ''),
}));
console.log(JSON.stringify(state));
await page.screenshot({ path: `${OUT}/edit-alias-landing.png` });
writeFileSync(`${OUT}/probe-results.json`, JSON.stringify(state, null, 2));
console.log('VERDICT:', !state.is404 && state.url === `/shipments/${ID}` ? 'ALIAS LANDS ON DETAIL' : 'CHECK OUTPUT');
await browser.close();
