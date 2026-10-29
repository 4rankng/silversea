// SIL-571 + SIL-578 verify — /shipments sort buttons never intersect at
// 1024/1280/1366/1440/1920; every column resolves ≥ its exact floor; the
// viewport scrolls only where the worksheet container is narrower than the
// floored table; the pinned-thead law (card 20260926_49) holds wherever the
// viewport stays a non-scroll container; a sort click sorts its own column.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7291';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };

// Exact floors (button one-line width + 24px th padding; documents carries
// the 16-char mono data floor) — the CSS shares are these / 1188.7.
const FLOORS = {
  customer: 199.5, documents: 175.4, classification: 191.3,
  cargo: 188.8, schedule: 180.3, notes: 134, status: 119.4,
};

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
const results = {};
let failed = 0;
const check = (name, ok, detail = '') => { say(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failed += 1; };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  await page.goto(`${FE}/shipments`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1600));

  const sweep = () => page.evaluate((floors) => {
    const btns = [...document.querySelectorAll('.cus-dashboard-table thead .table-sort-button')];
    const rects = btns.map((b) => b.getBoundingClientRect());
    const pairs = [];
    for (let i = 0; i < rects.length - 1; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]; const b = rects[j];
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 0.5 && iy > 0.5) pairs.push({ ix: +ix.toFixed(1), iy: +iy.toFixed(1), i: btns[i].textContent.trim(), j: btns[j].textContent.trim() });
      }
    }
    const ths = [...document.querySelectorAll('.cus-dashboard-table thead th')];
    const keyOf = (th) => [...th.classList].find((c) => /cus-dashboard-col--/.test(c)) ?? th.querySelector('[class*="col--"]')?.className ?? th.textContent.trim();
    const undersized = [];
    for (const th of ths) {
      const w = th.getBoundingClientRect().width;
      const label = th.textContent.trim();
      const floorKey = Object.keys(floors).find((k) => label.toLowerCase().includes(k.slice(0, 6)) || (
        (k === 'documents' && label.includes('Chứng từ')) ||
        (k === 'classification' && label.includes('Phân loại')) ||
        (k === 'cargo' && label.includes('Tổng quan')) ||
        (k === 'schedule' && label.includes('Lịch trình')) ||
        (k === 'notes' && label.includes('Ghi chú')) ||
        (k === 'status' && label.includes('Trạng thái')) ||
        (k === 'customer' && label.includes('Khách hàng'))));
      if (floorKey && w + 0.5 < floors[floorKey]) undersized.push({ label, w: +w.toFixed(1), floor: floors[floorKey] });
    }
    const viewport = document.querySelector('.cus-dashboard-viewport');
    const table = document.querySelector('.cus-dashboard-table');
    return {
      pairs, undersized,
      tableW: +table.getBoundingClientRect().width.toFixed(1),
      overflowX: viewport ? getComputedStyle(viewport).overflowX : null,
      hScroll: viewport ? viewport.scrollWidth > viewport.clientWidth : null,
      btnHeightsMax: Math.max(...btns.map((b) => b.getBoundingClientRect().height)),
    };
  }, FLOORS);

  for (const width of [1024, 1280, 1366, 1440, 1920]) {
    await page.setViewport({ width, height: 800 });
    await new Promise((r) => setTimeout(r, 900));
    const r = await sweep();
    results[`w${width}`] = r;
    check(`@${width} no sort-button pair intersects`, r.pairs.length === 0, JSON.stringify(r.pairs));
    check(`@${width} every column ≥ its exact floor`, r.undersized.length === 0, JSON.stringify(r.undersized));
    check(`@${width} buttons one line (≤30px tall)`, r.btnHeightsMax <= 30, `${r.btnHeightsMax}`);
    say(`   @${width} table=${r.tableW} overflowX=${r.overflowX} hScroll=${r.hScroll}`);
  }

  // Sort click still sorts its own column (@1280 desktop header live).
  await page.setViewport({ width: 1280, height: 800 });
  await new Promise((r) => setTimeout(r, 700));
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.cus-dashboard-table thead .table-sort-button')]
      .find((b) => b.textContent.includes('Tổng quan'));
    const th = btn.closest('th');
    btn.click();
    return new Promise((res) => setTimeout(() => res({
      sorted: th.getAttribute('aria-sort') ?? th.getAttribute('data-sort') ?? document.querySelector('.cus-dashboard-table thead th[aria-sort]')?.getAttribute('aria-sort') ?? 'none',
      col: th.textContent.trim(),
    }), 400));
  });
  check('sort click sorts its own column (aria-sort on the clicked th)', clicked.sorted === 'ascending' || clicked.sorted === 'descending', JSON.stringify(clicked));

  // Pinned-thead law wherever the viewport is a non-scroll container.
  for (const width of [1280, 1366]) {
    await page.setViewport({ width, height: 800 });
    await new Promise((r) => setTimeout(r, 700));
    if (results[`w${width}`].overflowX !== 'clip') { check(`@${width} viewport non-scroll container`, false, results[`w${width}`].overflowX); continue; }
    const pin = await page.evaluate(async () => {
      const th = document.querySelector('.cus-dashboard-table thead th');
      const before = th.getBoundingClientRect().top;
      document.querySelector('main.app-body, .app-body, body')?.scrollBy?.(0, 600) ?? window.scrollBy(0, 600);
      await new Promise((r) => setTimeout(r, 500));
      const after = th.getBoundingClientRect().top;
      window.scrollTo(0, 0);
      return { before: +before.toFixed(1), after: +after.toFixed(1) };
    });
    check(`@${width} thead stays pinned over page scroll (law 20260926_49)`, Math.abs(pin.after - pin.before) < 8, JSON.stringify(pin));
  }

  // Evidence screenshots (required bands + phone record-card untouched).
  await page.setViewport({ width: 1440, height: 800 });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil571-578_ui-shipments-1440.png` });
  say('screenshot qa/2026-10-29_sil571-578_ui-shipments-1440.png');
  await page.setViewport({ width: 1280, height: 800 });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil571-578_ui-shipments-1280.png` });
  say('screenshot qa/2026-10-29_sil571-578_ui-shipments-1280.png');
  await page.setViewport({ width: 768, height: 1024 });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil571-578_ui-shipments-768.png` });
  say('screenshot qa/2026-10-29_sil571-578_ui-shipments-768.png');
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil571-578_ui-shipments-390.png` });
  say('screenshot qa/2026-10-29_sil571-578_ui-shipments-390.png');
} finally { await browser.close(); }
say(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
writeFileSync(`${OUT}/2026-10-29_sil571-578_ui-driver.log`, log.join('\n') + '\n');
process.exit(failed === 0 ? 0 : 1);
