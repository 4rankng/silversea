// Track 2 drive #3: LCL mode via the visible label, hover-neutral shots,
// grid probe on the actual row wrapper.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const OUT = new URL('../1016-ui/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(identifier) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const token = await login('tiepvv');
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(BASE + '/shipments/new', { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);

async function tapAt(x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}
async function tapEl(el) {
  await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await sleep(300);
  const b = await el.evaluate((n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await tapAt(b.x, b.y);
}

// 1. Tap the visible "Hàng lẻ" mode label (react-aria radio group).
const lclLabel = await page.evaluateHandle(() => [...document.querySelectorAll('span, label, div')].find((n) => n.childElementCount === 0 && n.textContent.trim() === 'Hàng lẻ'));
const lclEl = lclLabel.asElement();
if (!lclEl) throw new Error('Hàng lẻ label not found');
await tapEl(lclEl);
await sleep(900);

const mode = await page.evaluate(() => ({
  checked: [...document.querySelectorAll('input[type=radio]')].filter((r) => r.checked).map((r) => r.value || r.id),
  lclFields: {
    khoLayHang: document.body.innerText.includes('Kho lấy hàng'),
    quyCach: document.body.innerText.includes('Quy cách đóng gói'),
    soLuong: document.body.innerText.includes('Số lượng'),
    trongLuong: document.body.innerText.includes('Trọng lượng'),
    cbm: document.body.innerText.includes('Thể tích'),
  },
}));
console.log('MODE2', JSON.stringify(mode));

// Neutral hover + shot of the LCL cargo section.
await page.evaluate(() => document.querySelector('#cargo, fieldset, [id*=cargo]')?.scrollIntoView({ block: 'start' }));
await page.mouse.move(2, 2);
await sleep(500);
await page.screenshot({ path: OUT + '1016_create-mobile-375-lcl-cargo-section.png', fullPage: false });

// 2. Back to FCL, one container row, neutral-hover band shot at 375.
const fclLabel = await page.evaluateHandle(() => [...document.querySelectorAll('span, label, div')].find((n) => n.childElementCount === 0 && n.textContent.trim() === 'Hàng FCL'));
const fclEl = fclLabel.asElement();
if (fclEl) { await tapEl(fclEl); await sleep(700); }
// Ensure exactly one row: remove extra rows down to 1.
await page.evaluate(() => {
  const del = [...document.querySelectorAll('button[aria-label*="Xóa"], button[title*="Xóa"]')];
  del.slice(0, Math.max(0, del.length - 1)).forEach((b) => b.click());
});
await sleep(500);
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(300);
await page.mouse.move(2, 2);
await sleep(300);
await page.screenshot({ path: OUT + '1016_create-mobile-375-container-bands.png', fullPage: false });

// Grid probe on the real row wrapper.
const grid = await page.evaluate(() => {
  const row = document.querySelector('.csc-container-row');
  if (!row) return 'NO-ROW';
  const probe = (n) => { const g = getComputedStyle(n).gridTemplateColumns; return g && g !== 'none' ? g : null; };
  const fromRow = probe(row);
  const inner = [...row.querySelectorAll('*')].map(probe).filter(Boolean)[0] ?? null;
  return { row: fromRow, inner };
});
console.log('GRID', JSON.stringify(grid));

// 3. Desktop re-check of the same state (table intact, bands hidden).
await page.setViewport({ width: 1440, height: 900, isMobile: false });
await sleep(900);
await page.mouse.move(2, 2);
const desktop = await page.evaluate(() => ({
  tableRows: document.querySelectorAll('table tbody tr').length,
  bandsDisplay: [...document.querySelectorAll('.csc-container-row__group')].map((n) => getComputedStyle(n).display),
}));
console.log('DESKTOP2', JSON.stringify(desktop));
await page.screenshot({ path: OUT + '1016_create-desktop-1440-container-row.png', fullPage: false });

await browser.close();
console.log('PAGE-ERRORS', JSON.stringify(errors));
