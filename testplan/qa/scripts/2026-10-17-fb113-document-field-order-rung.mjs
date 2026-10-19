// FB-113 (kanban card 171026122140) — verify the RENDERED field order of the
// "Chỉnh sửa chứng từ và hãng tàu" editor after the reorder:
//   Số Bill/Số Booking → Số tờ khai → Nhập / Xuất → Hãng tàu
// LOCAL ONLY: vite 7175 → api 3002.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb113';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let L = null;
for (let i = 1; i <= 3 && !L?.token; i++) {
  const t = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) })).text();
  try { L = JSON.parse(t); } catch { await sleep(1200 * i); }
}
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), L.token);
try {
  await page.goto(`${BASE}/shipments-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(6000);
  // open the documents editor on the first row that offers it
  const opened = await page.evaluate(() => {
    // The "Chỉnh sửa ..." purpose line is screen-reader-only, so innerText
    // misses it — match on textContent (or the cell label) instead.
    const btns = [...document.querySelectorAll('button, [role="button"]')]
      .filter((b) => /chứng từ và hãng tàu/i.test(
        (b.textContent || '') + ' ' + (b.getAttribute('data-cell-label') || '') + ' ' + (b.getAttribute('aria-label') || '')));
    if (!btns.length) return false;
    btns[0].scrollIntoView({ block: 'center' });
    btns[0].click();
    return true;
  });
  await sleep(2500);
  const order = await page.evaluate(() => {
    const grid = document.querySelector('.shipment-container-ledger__editor-grid');
    if (!grid) return null;
    return [...grid.querySelectorAll('label > span')].map((s) => (s.innerText || '').trim()).filter(Boolean);
  });
  await page.screenshot({ path: `${SHOTS}/01-thu-tu-chung-tu.png` });
  console.log('opened =', opened);
  console.log('RENDERED ORDER =', JSON.stringify(order));
  const want = ['Số tờ khai', 'Nhập / Xuất', 'Hãng tàu'];
  const ref = (order ?? []).find((x) => /^Số (Bill|Booking)$/.test(x));
  console.log('reference field first =', !!ref && order[0] === ref, '(', ref, ')');
  console.log('declaration 2nd       =', order?.[1] === want[0]);
  console.log('direction 3rd         =', order?.[2] === want[1]);
  console.log('shipping line 4th     =', order?.[3] === want[2]);
  const ok = !!ref && order[0] === ref && order[1] === 'Số tờ khai' && order[2] === 'Nhập / Xuất' && order[3] === 'Hãng tàu';
  console.log(ok ? '\n=== PASS: order matches the card ===' : '\n=== FAIL ===');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.log('ERR', e.message);
  process.exitCode = 1;
} finally { await browser.close(); }
