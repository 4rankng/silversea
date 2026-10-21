// Evidence pack 9 cards — dis-09 CLEAN re-run on BULK-IMP-0127 (ff 137).
// Fixes the polluted confirm screenshot (filter panel overlapped it).
// Flow: editor → EXTERNAL carrier + "Bổ sung sau" → Lưu → Phát lệnh →
// 409 PLATE_DEFERRED_CONFIRM "…Vẫn phát lệnh?" → clean screenshot → Xác nhận.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const ART = 'qa/2026-10-21-evidence-9cards';
const LOG = `${ART}/ui-driver-dispatch.log`;
mkdirSync(ART, { recursive: true });
const log = (line) => { const t = `${new Date().toISOString()} ${line}`; console.log(t); appendFileSync(LOG, `${t}\n`); };
appendFileSync(LOG, `\n=== dis-09 clean re-run ${new Date().toISOString()} (pin 536aad6c) ===\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }) });
const { token } = await login.json();
if (!token) process.exit(1);
log('login dieuvan OK');

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('dialog', (d) => void d.accept());

await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction(() => document.body?.innerText.includes('Xóa lọc'), { timeout: 30000 });
await sleep(1200);
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Xóa lọc'))?.click(); });
await sleep(2000);
// q search WITHOUT opening the Bộ lọc panel (keeps the stage clean)
await page.evaluate(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder ?? '').includes('Bill, Cont'));
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'BULK-IMP-0127');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
let rowFound = false;
for (let i = 0; i < 30 && !rowFound; i += 1) {
  rowFound = await page.evaluate(() => [...document.querySelectorAll('tr')].some((r) => (r.textContent || '').includes('BULK-IMP-0127')));
  if (!rowFound) await sleep(700);
}
log(`BULK-IMP-0127 row visible: ${rowFound}`);
await sleep(800);

// open editor
let opened = false;
for (let i = 0; i < 15 && !opened; i += 1) {
  opened = await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes('BULK-IMP-0127'));
    if (!row) return false;
    const btn = [...row.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('Sửa ô điều phối') || (b.textContent || '').trim() === 'Sửa');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!opened) await sleep(600);
}
await page.waitForFunction(() => document.body?.innerText.includes('Chỉnh sửa điều phối'), { timeout: 20000 });
log('editor open');
await sleep(800);

// EXTERNAL carrier
await page.evaluate(() => { document.querySelector('input[id^="dispatch-carrier-"], [id^="dispatch-carrier-"]')?.click(); });
await sleep(900);
await page.evaluate(() => {
  const opts = [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent != null);
  const external = opts.find((o) => !/nội bộ/i.test(o.textContent || ''));
  (external ?? opts[0])?.click();
});
await sleep(1200);
// "Bổ sung sau"
await page.evaluate(() => { document.querySelector('[id^="dispatch-vehicle-"]')?.click(); });
await sleep(1000);
await page.evaluate(() => {
  const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').includes('Bổ sung sau'));
  opt?.click();
});
await sleep(500);
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Lưu thay đổi')?.click(); });
await page.waitForFunction(() => ![...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent || '').includes('Chỉnh sửa điều phối')), { timeout: 20000 });
await sleep(1000);
log('editor saved (deferred plate)');

await page.screenshot({ path: `${ART}/ui-dis09-editor-deferred.png` });
// Phát lệnh → confirm
let issuedBtn = false;
for (let i = 0; i < 10 && !issuedBtn; i += 1) {
  issuedBtn = await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes('BULK-IMP-0127'));
    const btn = row && [...row.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('Phát lệnh'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!issuedBtn) await sleep(600);
}
await page.waitForFunction(() => document.querySelector('.confirm-box') != null, { timeout: 20000 });
await sleep(600);
const confirmMsg = await page.evaluate(() => document.querySelector('.confirm-box')?.textContent?.trim() ?? null);
log(`confirm text: ${confirmMsg}`);
// ensure no popover overlays the stage for the clean shot
const overlaysGone = await page.evaluate(() => {
  document.body.click();
  return true;
});
await sleep(300);
// re-open the confirm if the body click dismissed it
const stillOpen = await page.evaluate(() => document.querySelector('.confirm-box') != null);
if (!stillOpen) {
  log('body click dismissed confirm — re-clicking Phát lệnh');
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes('BULK-IMP-0127'));
    const btn = row && [...row.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('Phát lệnh'));
    btn?.click();
  });
  await page.waitForFunction(() => document.querySelector('.confirm-box') != null, { timeout: 20000 });
  await sleep(600);
}
await page.screenshot({ path: `${ART}/ui-dis09-confirm-dialog.png` });
log('shot ui-dis09-confirm-dialog.png (CLEAN)');
appendFileSync(`${ART}/dom-dis09-confirm.txt`, `\n[clean rerun] ${confirmMsg}\n`);

await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.confirm-box button')].find((b) => (b.textContent || '').includes('Xác nhận'));
  btn?.click();
});
await page.waitForFunction(() => document.querySelector('.confirm-box') == null, { timeout: 20000 });
await sleep(1200);
const issued = await page.evaluate(() => {
  const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes('BULK-IMP-0127'));
  return row?.textContent?.replace(/\s+/g, ' ').slice(0, 300) ?? null;
});
log(`issued row: ${issued}`);
appendFileSync(`${ART}/dom-dis09-issued-row.json`, `\n[clean rerun BULK-IMP-0127] ${issued}\n`);
await page.screenshot({ path: `${ART}/ui-dis09-issued-row.png` });
log('shot ui-dis09-issued-row.png (CLEAN)');

await browser.close();
log('dis-09 clean re-run DONE');
