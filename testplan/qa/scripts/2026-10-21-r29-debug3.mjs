// Debug 3: /shipments-debit row structure + selection behavior.
import puppeteer from 'puppeteer';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (id) => { const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) }); const j = await r.json(); if (!j.token) console.log('LOGIN_FAIL', r.status); return j.token; };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const token = await login('tiepvv');
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('table', { timeout: 30000 });
await sleep(3000);
const dump = await page.evaluate(() => {
  const td = Array.from(document.querySelectorAll('td')).find((el) => (el.textContent || '').includes('SHP-2610-00433'));
  if (!td) return { found: false, sampleCodes: Array.from(document.querySelectorAll('td')).slice(0, 6).map((t) => (t.textContent || '').slice(0, 30)) };
  const tr = td.closest('tr');
  const clickable = tr?.querySelector('[data-selected]');
  return {
    found: true,
    trHasDataSelected: Boolean(tr?.matches('[data-selected]')),
    clickableTag: clickable?.tagName ?? null,
    clickableAttrs: clickable ? Array.from(clickable.attributes).map((a) => a.name).slice(0, 10) : [],
    trClass: String(tr?.className).slice(0, 120),
    checkbox: Boolean(tr?.querySelector('input[type="checkbox"]')),
    canManageHint: Boolean(document.querySelector('[data-manage], .debit-manage')),
    mergeBtn: Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter((t) => t.includes('Ghép')).slice(0, 3),
  };
});
console.log('ROW_DUMP', JSON.stringify(dump, null, 1));
// try clicking the [data-selected] element
await page.evaluate(() => {
  const td = Array.from(document.querySelectorAll('td')).find((el) => (el.textContent || '').includes('SHP-2610-00433'));
  const tr = td?.closest('tr');
  const clickable = tr?.querySelector('[data-selected]') || tr;
  clickable?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await sleep(800);
const after = await page.evaluate(() => ({
  selectedCount: document.querySelectorAll('[data-selected="true"]').length,
  selectedFalse: document.querySelectorAll('[data-selected="false"]').length,
  mergeDisabled: Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Ghép cước thu khách'))?.disabled ?? null,
}));
console.log('AFTER_CLICK', JSON.stringify(after));
await browser.close();
