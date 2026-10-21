// Evidence pack 9 cards — Script C: DRIVER surfaces (mobile 390, quyet).
// Cards: dri-01 (SĐT kho/nhà máy tel: chạm-gọi — REQ-14), dri-04 (Cảng hạ
// portless IMPORT — FB-020 direction-aware delivery stage).
// Pin 536aad6c: FE :7175 → BE :3002 → local DB :5441.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const ART = 'qa/2026-10-21-evidence-9cards';
const LOG = `${ART}/ui-driver-driver.log`;
mkdirSync(ART, { recursive: true });
const log = (line) => { const t = `${new Date().toISOString()} ${line}`; console.log(t); appendFileSync(LOG, `${t}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} (pin 536aad6c) ===\n`);

let failures = 0;
const check = (name, ok, detail = '') => { log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures += 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'quyet', password: 'Abc123' }) });
const { token } = await login.json();
log(`login quyet (DRIVER): ${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true } });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('dialog', (d) => void d.accept());

// ---------- dri-01: tel: links on /my-trips/85065 ----------
await page.goto(`${BASE}/my-trips/85065`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction(() => document.body?.innerText.includes('SĐT kho'), { timeout: 30000 });
await sleep(700);
check('dri-01 driver task grid renders (not login)', await page.evaluate(() => !document.body.innerText.includes('Đăng nhập')), `url=${page.url()}`);

const grid = await page.evaluate(() => {
  const facts = [...document.querySelectorAll('.driver-task-fact')];
  const pick = (label) => {
    const row = facts.find((f) => f.querySelector('.driver-task-fact__label')?.textContent?.trim() === label);
    if (!row) return null;
    const a = row.querySelector('.driver-task-fact__value a[href^="tel:"]');
    return { text: row.querySelector('.driver-task-fact__value')?.textContent?.trim() ?? '', href: a?.getAttribute('href') ?? null, isAnchor: Boolean(a) };
  };
  return { kho: pick('SĐT kho'), lienHe: pick('SĐT liên hệ') };
});
check('dri-01 SĐT kho row is a tel: anchor', grid.kho?.isAnchor === true, JSON.stringify(grid.kho));
check('dri-01 SĐT kho href normalized tel:02253555555', grid.kho?.href === 'tel:02253555555', `href=${grid.kho?.href}`);
check('dri-01 SĐT liên hệ row is a tel: anchor (≠ kho)', grid.lienHe?.isAnchor === true && grid.lienHe?.href !== grid.kho?.href, JSON.stringify(grid.lienHe));
writeFileSync(`${ART}/db-dri01-grid.json`, JSON.stringify(grid, null, 2));
await page.screenshot({ path: `${ART}/ui-dri01-info-grid-tel.png` });
log('shot ui-dri01-info-grid-tel.png (390px, THÔNG TIN LỆNH grid)');

// call sheet — "Gọi kho" opens the modal whose numbers are tel: links too
const barButton = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.driver-task-call-bar button, .driver-task-call-bar a')].find((b) => (b.textContent || '').includes('Gọi kho'));
  if (!btn) return { found: false };
  btn.click();
  return { found: true, tag: btn.tagName.toLowerCase() };
});
check('dri-01 call-bar "Gọi kho" control present + clicked', barButton.found === true, JSON.stringify(barButton));
await page.waitForFunction(() => document.body?.innerText.includes('Chọn liên hệ'), { timeout: 15000 });
await sleep(600);
const sheet = await page.evaluate(() => {
  const modal = [...document.querySelectorAll('[role="dialog"], [class*="sheet"], [class*="modal"]')].find((m) => (m.textContent || '').includes('Chọn liên hệ'));
  const links = modal ? [...modal.querySelectorAll('a[href^="tel:"]')].map((a) => ({ text: a.textContent?.trim(), href: a.getAttribute('href') })) : [];
  return { found: Boolean(modal), links };
});
check('dri-01 call sheet opens with tel: contact links', sheet.found && sheet.links.length >= 1, JSON.stringify(sheet.links));
writeFileSync(`${ART}/db-dri01-call-sheet.json`, JSON.stringify(sheet, null, 2));
await page.screenshot({ path: `${ART}/ui-dri01-call-sheet.png` });
log('shot ui-dri01-call-sheet.png (call sheet modal)');
await page.keyboard.press('Escape');
await sleep(400);

// ---------- dri-04: portless IMPORT cảng hạ on /my-trips/194040 ----------
await page.goto(`${BASE}/my-trips/194040`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction(() => document.body?.innerText.includes('Cảng hạ'), { timeout: 30000 });
await sleep(700);
const cangHa = await page.evaluate(() => {
  const facts = [...document.querySelectorAll('.driver-task-fact')];
  const row = facts.find((f) => f.querySelector('.driver-task-fact__label')?.textContent?.trim() === 'Cảng hạ');
  const delivery = facts.find((f) => f.querySelector('.driver-task-fact__label')?.textContent?.trim() === 'Địa chỉ giao hàng');
  return {
    cangHa: row?.querySelector('.driver-task-fact__value')?.textContent?.trim() ?? null,
    delivery: delivery?.querySelector('.driver-task-fact__value')?.textContent?.trim() ?? null,
    hasDeliveryRow: Boolean(delivery),
  };
});
check('dri-04 Cảng hạ row resolves to a real point (NOT "Chưa có cảng hạ")', Boolean(cangHa.cangHa) && cangHa.cangHa !== 'Chưa có cảng hạ', JSON.stringify(cangHa));
check('dri-04 Cảng hạ names the job delivery site (NM REGPK ow8t61419)', (cangHa.cangHa ?? '').includes('NM REGPK ow8t61419'), String(cangHa.cangHa));
check('dri-04 Địa chỉ giao hàng row present for IMPORT', cangHa.hasDeliveryRow, String(cangHa.delivery));
writeFileSync(`${ART}/db-dri04-cangha.json`, JSON.stringify(cangHa, null, 2));
await page.screenshot({ path: `${ART}/ui-dri04-cangha.png` });
log('shot ui-dri04-cangha.png (390px, Cảng hạ + delivery rows)');

await browser.close();
log(`SCRIPT C DONE — failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
