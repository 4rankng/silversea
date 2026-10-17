// Unaccented-seed chain — post-purge UI check: /hr/roster must no longer
// surface 'QA Audit Unit 0914' (dropdown + Bộ phận column).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/purge';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const { token } = await r.json();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/hr/roster`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4500);
  // open the department filter dropdown
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="combobox"], input')].find((x) => /bộ phận/i.test((x.textContent || '') + (x.getAttribute('aria-label') || '') + (x.placeholder || '')));
    el?.click();
  });
  await sleep(1200);
  const st = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('[role="option"], option, li')].map((o) => (o.textContent || '').trim()).filter(Boolean);
    const t = document.body.textContent || '';
    return {
      hasQaUnitInDropdown: opts.some((o) => o.includes('QA Audit Unit 0914')),
      hasQaUnitInRows: /Dương Văn Thực[^]*?QA Audit Unit 0914/.test(t),
      dropdownOptions: opts.slice(0, 8),
    };
  });
  await page.screenshot({ path: `${SHOTS}/01-roster-after-purge.png` });
  console.log(JSON.stringify(st, null, 1));
  process.exit(st.hasQaUnitInRows === false ? 0 : 1);
} finally { await browser.close(); }
