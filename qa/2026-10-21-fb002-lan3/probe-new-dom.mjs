import puppeteer from 'puppeteer';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'tiepvv', password: 'Abc123' }) }).then(r => r.json());
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), login.token);
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('form.csc-workspace', { timeout: 20000 });
const dump = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('.csc-workspace input, .csc-workspace button[role="combobox"], .csc-workspace [role="combobox"]'))
    .map((el) => ({ tag: el.tagName, id: el.id || null, ph: el.getAttribute('placeholder'), aria: el.getAttribute('aria-label'), field: el.closest('[data-field-id]')?.getAttribute('data-field-id') ?? null, type: el.getAttribute('type') }));
  return { inputs: inputs.slice(0, 40) };
});
console.log(JSON.stringify(dump, null, 1));
await browser.close();
