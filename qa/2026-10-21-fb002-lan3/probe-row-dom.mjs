import puppeteer from 'puppeteer';
const API = 'http://localhost:3002/api';
const BASE = 'http://localhost:7176';
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) }).then(r => r.json());
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), login.token);
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('form.csc-workspace', { timeout: 20000 });
const dump = await page.evaluate(() => {
  const row = document.querySelector('input[aria-label="Số container"]')?.closest('tr');
  const items = Array.from(row?.querySelectorAll('button, [role="combobox"], input, [data-field-id]') ?? [])
    .map((el) => ({ tag: el.tagName, aria: el.getAttribute('aria-label'), ph: el.getAttribute('placeholder'), field: el.closest('[data-field-id]')?.getAttribute('data-field-id') ?? el.getAttribute('data-field-id'), cls: (el.className || '').toString().slice(0, 60) }))
    .filter((x) => x.aria || x.ph || x.field);
  return items;
});
console.log(JSON.stringify(dump, null, 1));
await browser.close();
