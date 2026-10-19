// FB-091 (master-plan LCL columns) + FB-092 (3-line container cell) probes.
import puppeteer from 'puppeteer';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb091';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (id) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
  return (await r.json()).token;
};
const tok = await login('dungnv');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tok);
  // master plan
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  await page.evaluate(() => document.querySelector('input[aria-label="Tìm nhanh"], input[type="search"]')?.focus());
  await page.keyboard.type('KBQA-GRP', { delay: 40 });
  await sleep(2500);
  const rows = await page.evaluate(() => {
    const out = [];
    for (const tr of document.querySelectorAll('tr')) {
      const t = (tr.textContent || '');
      if (/KBQA-GRP/.test(t)) out.push(t.slice(0, 400));
    }
    return out;
  });
  await page.screenshot({ path: `${SHOTS}/01-masterplan-kbqa.png` });
  console.log('MASTER PLAN ROWS:');
  for (const r of rows) console.log(' -', r.replace(/\n/g, ' | ').slice(0, 380));
  // detailed plan container cell for lot A
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  await page.evaluate(() => document.querySelector('input[aria-label="Tìm nhanh"]')?.focus());
  await page.keyboard.type('KBQA-GRP-A', { delay: 40 });
  await sleep(2500);
  const cell = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find((r) => /KBQA-GRP-A/.test(r.textContent || ''));
    if (!tr) return null;
    const cont = [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim()).filter((t) => /Lẻ|PALLET|Pallet|kg|CBM/.test(t));
    return cont;
  });
  await page.screenshot({ path: `${SHOTS}/02-detail-container-cell.png` });
  console.log('DETAIL CONTAINER CELL:', JSON.stringify(cell));
} finally { await browser.close(); }
