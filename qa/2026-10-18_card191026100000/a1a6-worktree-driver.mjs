// Card 191026100000 — rung-3 driver for the WORKTREE build (:7275):
// (1) A.1: drawer Thêm container opens with loại/weight/appointment seeded
//     from the lot rows, Số container empty.
// (2) A.6: typing a bad-check-digit number shows the live hint; the one-tap
//     "Đổi thành" fills the corrected number; the add then passes the gate.
// Lot 110902 (Bill FB109-706110), CUS demo account.
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';

const FE = 'http://localhost:7275';
const API = 'http://localhost:3002/api';
const OUT = '/Users/dev/.paseo/worktrees/1njkloyy/fix-chungtu-cus/qa/2026-10-18_card191026100000';
const BILL = 'FB109-706110';
const log = [];
const say = (m) => { console.log(m); log.push(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { token } = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
}).then((r) => r.json());
say(`login ok=${Boolean(token)}`);

const browser = await puppeteer.launch({ headless: 'new', defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

async function clickByText(text) {
  for (const h of await page.$$('button')) {
    if ((await h.evaluate((el) => el.textContent?.trim())) === text) { await h.click(); return true; }
  }
  return false;
}

await page.goto(`${FE}/shipments?searchSuffix=${encodeURIComponent(BILL)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
for (let i = 0; i < 8; i += 1) {
  if (await page.$('table tbody tr')) break;
  for (const b of await page.$$('button')) {
    if ((await b.evaluate((el) => el.textContent?.trim())) === 'Thử lại') { await b.click(); break; }
  }
  await sleep(2500);
}
await sleep(1200);
say(`rows=${await page.$$eval('table tbody tr', (r) => r.length)}`);

const drawerBtn = (await page.$$('table tbody tr button')).find(async () => true);
for (const h of await page.$$('table tbody tr button')) {
  if (((await h.evaluate((el) => el.getAttribute('aria-label') || '')) || '').includes('Mở chi tiết lô hàng')) { await h.click(); break; }
}
await sleep(2500);
say(`drawer containers=${await page.$$eval('.cus-container-table tbody tr', (r) => r.length)}`);

// ── A.1: open the add row — inspect the seeded fields. ──────────────────
await clickByText('Thêm container');
await sleep(600);
const seeded = await page.evaluate(() => ({
  number: (document.querySelector('input[aria-label="Số container"]'))?.value ?? null,
  weight: (document.querySelector('input[aria-label="Trọng lượng (kg)"]'))?.value ?? null,
  time: document.querySelector('input[data-seg="hh"]')?.value ?? null,
  day: document.querySelector('input[data-seg="dd"]')?.value ?? null,
  typeTrigger: [...document.querySelectorAll('.cus-container-ledger__add-row button')].map((b) => b.textContent?.trim()).find((t) => t && t !== 'Thêm' && t !== 'Hủy') ?? null,
}));
say(`A.1 seeded=${JSON.stringify(seeded)}`);
await page.screenshot({ path: `${OUT}/a1-seeded-addrow.png` });

// ── A.6: type a failing number — hint + one-tap fix. ────────────────────
const contInput = await page.$('input[aria-label="Số container"]');
await contInput.type('MSCU4615853', { delay: 20 });
await sleep(400);
const hint = await page.evaluate(() => document.querySelector('.cus-container-ledger__add-hint')?.textContent?.trim() ?? null);
say(`A.6 hint=${JSON.stringify(hint)}`);
await page.screenshot({ path: `${OUT}/a6-hint.png` });

const fixBtn = (await page.$$('.cus-container-ledger__add-hint button')).pop();
if (fixBtn) {
  await fixBtn.click();
  await sleep(300);
  const afterFix = await page.evaluate(() => ({
    number: (document.querySelector('input[aria-label="Số container"]'))?.value ?? null,
    hint: document.querySelector('.cus-container-ledger__add-hint')?.textContent?.trim() ?? null,
  }));
  say(`A.6 after-fix=${JSON.stringify(afterFix)}`);
  await page.screenshot({ path: `${OUT}/a6-after-fix.png` });
  // Clean close — do NOT actually add a container to this QA lot.
  await clickByText('Hủy');
  await sleep(400);
  say(`add row closed=${await page.evaluate(() => !document.querySelector('.cus-container-ledger__add-row'))}`);
}

await browser.close();
writeFileSync(`${OUT}/a1a6-worktree-driver.log`, log.join('\n') + '\n');
say('driver done');
