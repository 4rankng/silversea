// Debug 2: Nhà máy cell popover behavior (click → wait → type).
import puppeteer from 'puppeteer';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (id) => { const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) }); const j = await r.json(); if (!j.token) console.log('LOGIN_FAIL', r.status, JSON.stringify(j).slice(0, 120)); return j.token; };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const token = await login('tiepvv');
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('form.csc-workspace', { timeout: 60000 });
await sleep(1500);

const dump = () => page.evaluate(() => Array.from(document.querySelectorAll('[role="listbox"], .searchable-select__popover, .combobox__popup, [class*="popover"]'))
  .filter((p) => p.offsetParent !== null)
  .map((p) => ({ cls: String(p.className).slice(0, 50), text: (p.textContent || '').replace(/\s+/g, ' ').slice(0, 250) })));

const cellInput = await page.$('input[aria-label="Nhà máy"]');
await cellInput.click();
await sleep(1500);
console.log('FACTORY_CLICK', JSON.stringify(await dump()));
await page.keyboard.type('a', { delay: 60 });
await sleep(1200);
console.log('FACTORY_TYPED', JSON.stringify(await dump()));

// also try 'Cảng nâng' after closing
await page.keyboard.press('Escape');
await sleep(400);
const port = await page.$('input[aria-label="Cảng nâng"]');
await port.click();
await sleep(1500);
console.log('PORT_CLICK', JSON.stringify(await dump()));
await browser.close();
