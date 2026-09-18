// Carrier combobox, second pass: viewport screenshots (full-page capture drops
// position:fixed popovers) plus a precise element dump.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:7174';
const API = 'http://localhost:3001/api';

mkdirSync('qa', { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const LOGFILE = `qa/${ts}_local-carrier-probe2.log`;
const lines = [];
const log = (s) => { console.log(s); lines.push(s); writeFileSync(LOGFILE, lines.join('\n') + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const r = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await r.json();

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForFunction(() => document.body.innerText.includes('Tạo lô hàng'));
await sleep(1200);

const comboboxes = await page.evaluate(() => Array.from(document.querySelectorAll('input[role="combobox"]')).map((i) => {
  const rect = i.getBoundingClientRect();
  const label = document.querySelector(`label[for="${i.id}"]`);
  return { id: i.id, placeholder: i.getAttribute('placeholder'), label: label?.textContent?.trim() || null, rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)] };
}));
log('--- all combobox inputs ---');
log(JSON.stringify(comboboxes, null, 2));

const handle = await page.evaluateHandle(() => {
  const all = Array.from(document.querySelectorAll('input[role="combobox"]'));
  return all.find((i) => (i.getAttribute('placeholder') || '').includes('hãng tàu')) || null;
});
const el = handle.asElement();
const carrierId = await el.evaluate((e) => e.id);
log('carrier input id: ' + carrierId);

await el.click();
await sleep(500);
await page.screenshot({ path: `qa/${ts}_carrier2-open-empty.png` });

await page.keyboard.type('MSC', { delay: 100 });
await sleep(1000);
const s1 = await page.evaluate((id) => {
  const input = document.getElementById(id);
  const rect = input.getBoundingClientRect();
  const lb = document.querySelector('[role="listbox"]');
  const lbRect = lb?.getBoundingClientRect();
  return {
    value: input.value,
    expanded: input.getAttribute('aria-expanded'),
    inputRect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
    listboxRect: lbRect ? [Math.round(lbRect.x), Math.round(lbRect.y), Math.round(lbRect.width), Math.round(lbRect.height)] : null,
    listboxParentPosition: lb ? getComputedStyle(lb.parentElement).position : null,
    listboxPosition: lb ? getComputedStyle(lb).position : null,
    visibleOptions: Array.from(document.querySelectorAll('[role="option"]')).filter((o) => o.getBoundingClientRect().height > 0).map((o) => o.textContent.trim()),
  };
}, carrierId);
log('typed MSC → ' + JSON.stringify(s1, null, 2));
await page.screenshot({ path: `qa/${ts}_carrier2-typed-MSC.png` });
// clip exactly around the field so the popup is unambiguous
await page.screenshot({
  path: `qa/${ts}_carrier2-typed-MSC-clip.png`,
  clip: { x: 260, y: 180, width: 600, height: 340 },
});

await page.keyboard.press('Escape');
await sleep(300);
await browser.close();
log('artifact log: ' + LOGFILE);
