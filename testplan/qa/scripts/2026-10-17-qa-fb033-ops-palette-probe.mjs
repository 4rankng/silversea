// FB-033 — OPS palette probe: does the global search answer 'ghi nhận chi phí'
// for Role.OPS? Registry switch has no OPS case (suspected default []).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb033probe';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoangnh', password: 'Abc123' }) });
const { token } = await r.json();
const me = await (await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
console.log('role=', me.role, 'username=', me.username);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/my-orders`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);
  const out = {};
  for (const q of ['ghi nhận chi phí', 'khai chi phí', 'lệnh giao nhận']) {
    await page.evaluate(() => { const i = document.querySelector('.topbar__search input'); if (i) { i.focus(); } });
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(q, { delay: 40 });
    await sleep(1200);
    out[q] = await page.evaluate(() => {
      const scope = document.querySelector('.topbar__search');
      const btns = [...(scope?.querySelectorAll('button') ?? [])].map((b) => (b.textContent || '').trim());
      return { btns, noRes: (scope?.textContent || '').includes('Không có kết quả'), raw: (scope?.textContent || '').slice(0, 150) };
    });
  }
  await page.screenshot({ path: `${SHOTS}/01-ops-palette.png` });
  console.log(JSON.stringify(out, null, 1));
} finally { await browser.close(); }
