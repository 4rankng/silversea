// Debug: dump visible popover contents for customer field + Nhà máy cell.
import puppeteer from 'puppeteer';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (id) => { const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) }); console.log('LOGIN', id, r.status); const j = await r.json().catch(() => ({})); if (j.error) console.log('LOGIN_ERR', JSON.stringify(j).slice(0, 200)); return j.token; };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
let token = await login('tiepvv'); if (!token) { await new Promise(r=>setTimeout(r,4000)); token = await login('tiepvv'); } if (!token) { console.log('NO TOKEN'); process.exit(4); }
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector("form.csc-workspace", { timeout: 60000 }).catch(async () => { const b = await page.evaluate(() => document.body.innerText.slice(0, 300)); console.log("FORM_MISSING", JSON.stringify(b), page.url()); process.exit(3); });
await sleep(1500);

await page.click('[data-field-id="shipment-customer"] input');
await sleep(1200);
let dump = await page.evaluate(() => {
  const pops = Array.from(document.querySelectorAll('.searchable-select__popover, [role="listbox"]'))
    .filter((p) => p.offsetParent !== null || getComputedStyle(p).position === 'fixed');
  return pops.map((p) => ({
    cls: p.className?.slice?.(0, 60) ?? p.tagName,
    text: (p.textContent || '').replace(/\s+/g, ' ').slice(0, 300),
    optionCount: p.querySelectorAll('[role="option"], button, li').length,
  }));
});
console.log('CUSTOMER_POPOVERS', JSON.stringify(dump, null, 1));

// type 'a' to filter
await page.keyboard.type('a', { delay: 50 });
await sleep(1000);
dump = await page.evaluate(() => {
  const pops = Array.from(document.querySelectorAll('.searchable-select__popover, [role="listbox"]'))
    .filter((p) => p.offsetParent !== null || getComputedStyle(p).position === 'fixed');
  return pops.map((p) => ({ cls: String(p.className).slice(0, 60), text: (p.textContent || '').replace(/\s+/g, ' ').slice(0, 400) }));
});
console.log('CUSTOMER_AFTER_TYPE_A', JSON.stringify(dump, null, 1));
await page.keyboard.press('Escape');
await sleep(400);

const input = await page.$('input[aria-label="Nhà máy"]');
await input.click();
await sleep(1200);
dump = await page.evaluate(() => {
  const pops = Array.from(document.querySelectorAll('.searchable-select__popover, [role="listbox"]'))
    .filter((p) => p.offsetParent !== null || getComputedStyle(p).position === 'fixed');
  return pops.map((p) => ({ cls: String(p.className).slice(0, 60), text: (p.textContent || '').replace(/\s+/g, ' ').slice(0, 400) }));
});
console.log('FACTORY_POPOVERS', JSON.stringify(dump, null, 1));
await browser.close();
// FACTORY with typed query
const input2 = await page.$('input[aria-label="Nhà máy"]');
await input2.click();
await sleep(1500);
let d1 = await page.evaluate(() => Array.from(document.querySelectorAll('[role="listbox"], .searchable-select__popover')).filter((p) => p.offsetParent !== null).map((p) => (p.textContent || '').replace(/\s+/g, ' ').slice(0, 200)));
console.log('FACTORY_CLICK_WAIT1500', JSON.stringify(d1));
await page.keyboard.type('a', { delay: 60 });
await sleep(1200);
d1 = await page.evaluate(() => Array.from(document.querySelectorAll('[role="listbox"], .searchable-select__popover')).filter((p) => p.offsetParent !== null).map((p) => (p.textContent || '').replace(/\s+/g, ' ').slice(0, 300)));
console.log('FACTORY_TYPED_A', JSON.stringify(d1));
await browser.close();
