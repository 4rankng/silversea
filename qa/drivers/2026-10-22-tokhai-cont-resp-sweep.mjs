// Card 261022095235a/b — responsive sweep of the changed surfaces at
// 390/768/1440 (AGENTS §3 UI routing: drive changed screens + siblings).
// LOCAL ONLY 7178 → 3005. Reuses the last post-fix lot via env LOT.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7178';
const API = `${BASE}/api`;
const LOT = process.env.LOT;
const SHOTS = '/tmp/tokhai-shots';
if (!LOT) { console.error('need LOT'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let L = null;
for (let i = 0; i < 3 && !L?.token; i++) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
  try { L = await r.json(); } catch { }
  if (!L?.token) await sleep(1000);
}
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), L.token);
const results = [];
const check = (id, ok, detail = '') => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' :: ' + detail : ''}`); };

for (const [width, height, tag] of [[390, 844, '390'], [768, 1024, '768'], [1440, 1000, '1440']]) {
  await page.setViewport({ width, height, isMobile: width === 390, hasTouch: width === 390 });
  // Detail page — management ledger + tờ khai column
  await page.goto(`${BASE}/shipments/${LOT}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2000);
  await page.screenshot({ path: `${SHOTS}/sweep-detail-${tag}.png`, fullPage: false });
  const detailMetrics = await page.evaluate(() => {
    const decl = document.querySelector('.cus-declaration-trigger');
    const add = [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Thêm container');
    const scrollBand = document.querySelector('.cus-container-table-scroll');
    const pageOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    return {
      declVisible: Boolean(decl) && decl.getBoundingClientRect().width > 40,
      add,
      bandScrolls: scrollBand ? scrollBand.scrollWidth >= scrollBand.clientWidth : null,
      pageOverflow,
    };
  });
  check(`W${tag} detail tờ khai cell`, detailMetrics.declVisible, JSON.stringify(detailMetrics));
  check(`W${tag} detail no page overflow (scroll stays in band)`, !detailMetrics.pageOverflow, `overflow=${detailMetrics.pageOverflow} band=${detailMetrics.bandScrolls}`);

  // Drawer Tổng quan (sibling surface sharing the ledger)
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  const opened = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label*="Mở chi tiết lô hàng"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (opened) {
    await sleep(1800);
    await page.screenshot({ path: `${SHOTS}/sweep-drawer-${tag}.png`, fullPage: false });
    const drawerMetrics = await page.evaluate(() => {
      const decl = [...document.querySelectorAll('.cus-declaration-trigger')].find((b) => b.getBoundingClientRect().width > 40);
      const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      return { declVisible: Boolean(decl), overflow };
    });
    check(`W${tag} drawer tờ khai cell`, drawerMetrics.declVisible, JSON.stringify(drawerMetrics));
    check(`W${tag} drawer no page overflow`, !drawerMetrics.overflow);
  } else {
    check(`W${tag} drawer open`, false, 'row button not found');
  }
}

fs.copyFileSync(`${SHOTS}/sweep-detail-390.png`, 'qa/2026-10-22-cus-tokhai-cont/ui-detail-390.png');
fs.copyFileSync(`${SHOTS}/sweep-drawer-390.png`, 'qa/2026-10-22-cus-tokhai-cont/ui-drawer-390.png');
fs.copyFileSync(`${SHOTS}/sweep-detail-768.png`, 'qa/2026-10-22-cus-tokhai-cont/ui-detail-768.png');
fs.copyFileSync(`${SHOTS}/sweep-detail-1440.png`, 'qa/2026-10-22-cus-tokhai-cont/ui-detail-1440.png');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} sweep checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
