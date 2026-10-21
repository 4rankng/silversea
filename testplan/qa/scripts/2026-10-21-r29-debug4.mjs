// Debug 4: MergeRevGroupDialog vehicle-class combobox DOM.
import puppeteer from 'puppeteer';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (id) => { const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) }); return (await r.json()).token; };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const token = await login('tiepvv');
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('table', { timeout: 30000 });
await sleep(3000);
for (const bill of ['CL4C-01', 'CL4C-02']) {
  await page.evaluate((b) => {
    const td = Array.from(document.querySelectorAll('td')).find((el) => (el.textContent || '').includes(b));
    td?.closest('tr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, bill);
  await sleep(500);
}
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Ghép cước thu khách') && !b.disabled);
  btn?.click();
});
await sleep(1200);
const inputs = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"], .modal, [class*="modal"]');
  return Array.from(d?.querySelectorAll('input') ?? []).map((i) => ({ placeholder: i.placeholder, role: i.getAttribute('role'), aria: i.getAttribute('aria-label'), cls: String(i.className).slice(0, 40) }));
});
console.log('DIALOG_INPUTS', JSON.stringify(inputs, null, 1));
// click the first input (vehicle class), type 5T
await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"], .modal, [class*="modal"]');
  const input = Array.from(d?.querySelectorAll('input') ?? [])[0];
  input?.click(); input?.focus();
});
await sleep(800);
await page.keyboard.type('5T', { delay: 80 });
await sleep(1500);
const pops = await page.evaluate(() => {
  const vis = (el) => el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
  return Array.from(document.querySelectorAll('[role="listbox"], [role="listbox"] *, [class*="popover"], [class*="popup"]'))
    .filter(vis)
    .filter((el) => (el.textContent || '').trim())
    .slice(0, 6)
    .map((el) => ({ tag: el.tagName, role: el.getAttribute('role'), cls: String(el.className).slice(0, 50), text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 220) }));
});
console.log('POPOVERS_5T', JSON.stringify(pops, null, 1));
await browser.close();
