// FB-001 probe — drive the CUS create-lot form at HEAD, test picker-open paths.
import puppeteer from 'puppeteer';
const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002';
const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await loginRes.json();
if (!token) throw new Error('no token — check thanhdc account');
const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 } });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  console.log('url:', page.url());
  console.log('h1:', await page.evaluate(() => document.querySelector('h1')?.textContent ?? document.title));
  const probe = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('[data-seg-part]')];
    return groups.map((g) => ({
      part: g.getAttribute('data-seg-part'),
      label: g.getAttribute('aria-label') || g.closest('[role=group]')?.getAttribute('aria-label'),
      rect: (() => { const r = g.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      inputs: [...g.querySelectorAll('input')].map((i) => { const r = i.getBoundingClientRect(); return { seg: i.dataset.seg, w: Math.round(r.width) }; }),
    }));
  });
  console.log(JSON.stringify(probe, null, 1));
} finally { await browser.close(); }
