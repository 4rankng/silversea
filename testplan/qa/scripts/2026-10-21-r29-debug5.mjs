// Debug 5: ketoan /accounting/chot-debit page state.
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
  const body = document.body.innerText;
  return {
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tr').length,
    hasCL4C: body.includes('CL4C'),
    hasGhep: body.includes('Ghép cùng Bill'),
    ghepCount: (body.match(/Ghép cùng Bill/g) ?? []).length,
    tachButtons: Array.from(document.querySelectorAll('button[aria-label^="Tách nhóm"]')).map((b) => b.getAttribute('aria-label')),
    cl4cIdx: body.indexOf('CL4C'),
    around: body.includes('CL4C') ? body.slice(Math.max(0, body.indexOf('CL4C') - 120), body.indexOf('CL4C') + 200).replace(/\n/g, ' | ') : null,
    errors: Array.from(document.querySelectorAll('[role="alert"]')).map((e) => (e.textContent || '').slice(0, 120)).slice(0, 3),
    url: location.pathname,
    h2s: Array.from(document.querySelectorAll('h2, h1')).map((h) => (h.textContent || '').trim()).slice(0, 5),
  };
});
console.log('KETOAN_PAGE', JSON.stringify(dump, null, 1));
await page.screenshot({ path: 'qa/2026-10-21-r29-verify/fb093/debug-ketoan.png', fullPage: false });
await browser.close();
