// Debug 6: CL4C-01 row cells per column on the debit board table.
import puppeteer from 'puppeteer';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (id) => { const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) }); return (await r.json()).token; };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const token = await login('ketoan');
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('table', { timeout: 30000 });
await sleep(4000);
const dump = await page.evaluate(() => {
  const out = {};
  out.bodyHasLe = document.body.innerText.includes('Lẻ ·');
  out.bodyHasThongSo = document.body.innerText.includes('Thông số container');
  // find the row whose text includes CL4C-01
  const trs = Array.from(document.querySelectorAll('tr'));
  const tr = trs.find((r) => (r.textContent || '').includes('CL4C-01'));
  if (tr) {
    const table = tr.closest('table');
    const headers = Array.from(table.querySelectorAll('th')).map((th) => (th.textContent || '').trim());
    out.headers = headers;
    out.cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim().slice(0, 80));
    out.cellCount = out.cells.length;
  } else {
    out.rowFound = false;
  }
  // any tr with Ghép cùng Bill?
  out.trWithGhep = trs.filter((r) => (r.textContent || '').includes('Ghép cùng Bill')).length;
  return out;
});
console.log('ROW_DUMP', JSON.stringify(dump, null, 1));
await browser.close();
