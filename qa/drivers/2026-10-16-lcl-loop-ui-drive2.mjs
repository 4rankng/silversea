// LCL closed-loop QA — Track 2 interactive drive: cargo-mode toggle, LCL
// fields, and the mobile container-editor bands (Thông tin container / Lộ
// trình / Thời gian) per the redesign spec (HANDOFF 2026-10-16).
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const OUT = new URL('../1016-ui/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
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

const errors = [];
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200)); });

const token = await login('tiepvv');
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(BASE + '/shipments/new', { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);

// Real tap helper: hit-test at element centre then trusted mouse events.
async function tap(el) {
  const box = await el.evaluate((n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.up();
}

// 1. Toggle "Hàng lẻ" cargo mode (the radio fieldset legend "Loại hàng").
const lclRadio = await page.$('input[type=radio][value="LCL"], input#cargoMode-LCL, input[name*=cargo][value=LCL]');
let viaInput = false;
if (lclRadio) { viaInput = true; await tap(lclRadio); } else {
  // Fall back to the label text.
  const label = await page.evaluateHandle(() => [...document.querySelectorAll('label, span')].find((n) => n.textContent.trim() === 'Hàng lẻ'));
  const el = label.asElement();
  if (el) await tap(el);
}
await sleep(800);
const checkedRadios = await page.evaluate(() => [...document.querySelectorAll('input[type=radio]')].filter((r) => r.checked).map((r) => r.value || r.id));
console.log('MODE', JSON.stringify({ viaInput, checked: checkedRadios }));

// 2. LCL-specific fields appear.
const lclFields = await page.evaluate(() => ({
  khoLayHang: document.body.innerText.includes('Kho lấy hàng'),
  quyCach: document.body.innerText.includes('Quy cách đóng gói'),
  soLuong: document.body.innerText.includes('Số lượng'),
  trongLuong: document.body.innerText.includes('Trọng lượng'),
  cbm: document.body.innerText.includes('Thể tích'),
}));
console.log('LCL-FIELDS', JSON.stringify(lclFields));
await page.screenshot({ path: OUT + '1016_create-mobile-375-lcl-mode.png', fullPage: false });

// 3. Screenshot the LCL cargo section area (scroll to it).
await page.evaluate(() => document.querySelector('#cargo, [id*=cargo], fieldset')?.scrollIntoView({ block: 'start' }));
await sleep(400);
await page.screenshot({ path: OUT + '1016_create-mobile-375-lcl-cargo-section.png', fullPage: false });

// 4. FCL bands: switch back to FCL and add a container row.
const fclRadio = await page.$('input[type=radio][value="FCL"], input[name*=cargo][value=FCL]');
if (fclRadio) { await tap(fclRadio); await sleep(600); }
const addBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /Thêm container|Thêm dòng|Thêm container/.test(b.textContent)));
const addEl = addBtn.asElement();
if (addEl) { await tap(addEl); await sleep(900); }
const bands = await page.evaluate(() => ({
  bands: ['Thông tin container', 'Lộ trình', 'Thời gian'].map((s) => document.body.innerText.includes(s)),
  bandEls: [...document.querySelectorAll('.csc-container-row__group')].map((n) => n.textContent.trim()),
  chevronSeam: !!document.querySelector('[class*="chevron-seam"], .csc-container-cell__label'),
  cellLabels: [...document.querySelectorAll('.csc-container-cell__label')].slice(0, 8).map((n) => n.textContent.trim()),
  twoCol: (() => {
    const row = document.querySelector('.csc-container-row');
    if (!row) return 'NO-ROW';
    const cells = [...row.querySelectorAll('td')];
    return cells.map((c) => getComputedStyle(c).gridTemplateColumns).filter(Boolean)[0] ?? 'no-grid';
  })(),
}));
console.log('BANDS', JSON.stringify(bands));
await page.evaluate(() => document.querySelector('.csc-container-row')?.scrollIntoView({ block: 'start' }));
await sleep(400);
await page.screenshot({ path: OUT + '1016_create-mobile-375-container-bands.png', fullPage: false });

// 5. Desktop container table with one row (1440) — table intact.
await page.setViewport({ width: 1440, height: 900, isMobile: false });
await sleep(900);
const desktop = await page.evaluate(() => ({
  tableRows: document.querySelectorAll('table tbody tr').length,
  bandElsHidden: [...document.querySelectorAll('.csc-container-row__group')].map((n) => getComputedStyle(n).display),
}));
console.log('DESKTOP-TABLE', JSON.stringify(desktop));
await page.screenshot({ path: OUT + '1016_create-desktop-1440-container-row.png', fullPage: false });

await browser.close();
console.log('PAGE-ERRORS', JSON.stringify(errors));
