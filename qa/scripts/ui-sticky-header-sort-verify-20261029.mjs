// SIL-578 verify — duplicated/stacked sticky header sort buttons:
//   /shipments-detail ≤1000 container (card mode): the duplicated header is
//   RETIRED (display:none) — zero .table-sort-button rects, nothing invisible
//   left tabbable/clickable;
//   /shipments 390/768/1024 (incl. after horizontal scroll): every visible
//   .table-sort-button keeps its own column — no two rects intersect, and a
//   click moves aria-sort to the clicked header only.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7199';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 800 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'giamdoc');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  say(`login → ${new URL(page.url()).pathname}`);

  const sweepSortButtons = () => page.evaluate(() => {
    const btns = [...document.querySelectorAll('.table-sort-button')]
      .filter((b) => { const st = getComputedStyle(b); const th = b.closest('th'); const row = b.closest('tr'); const head = b.closest('thead');
        return st.display !== 'none' && st.visibility !== 'hidden' && head && getComputedStyle(head).display !== 'none'
          && (!th || getComputedStyle(th).display !== 'none') && (!row || getComputedStyle(row).display !== 'none'); });
    const rects = btns.map((b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, label: (b.textContent || '').trim().slice(0, 24), key: b.closest('th')?.getAttribute('aria-sort') != null ? b.closest('th').querySelector('.table-sort-button') === b : true }; });
    const pairs = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 0.5 && iy > 0.5) pairs.push({ a: a.label, b: b.label, ix: +ix.toFixed(1), iy: +iy.toFixed(1) });
    }
    // invisible interactive leftovers: buttons inside a clipped/1px sr-only th
    const ghosts = [...document.querySelectorAll('thead .table-sort-button')].filter((b) => {
      const th = b.closest('th');
      return th && (getComputedStyle(th).clip.startsWith('rect(0px') || getComputedStyle(th).clipPath === 'inset(50%)');
    }).length;
    return { visible: rects.length, pairs, ghosts };
  });

  // ── /shipments-detail: card band retires the duplicated header ──
  for (const width of [1024, 768, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${FE}/shipments-detail`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1600));
    const s = await sweepSortButtons();
    check(`@${width} detail visible-sort-pairs 0`, s.pairs.length === 0, JSON.stringify(s.pairs.slice(0, 2)));
    check(`@${width} detail no ghost clipped buttons`, s.ghosts === 0, `ghosts=${s.ghosts}`);
    if (width === 1024) {
      // the duplicated header is gone entirely: no thead boxes at all
      const theadGone = await page.evaluate(() => {
        const t = document.querySelector('.shipment-container-ledger thead');
        return !t || getComputedStyle(t).display === 'none';
      });
      check('@1024 detail thead display:none in card band', theadGone);
      await page.screenshot({ path: resolve(OUT, '2026-10-29_sil578_ui-detail-1024-card.png') });
    }
    if (width === 390) await page.screenshot({ path: resolve(OUT, '2026-10-29_sil578_ui-detail-390-card.png') });
  }

  // ── /shipments: visible header keeps one rect per column, clicks its own ──
  for (const width of [1024, 768, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${FE}/shipments`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1600));
    let s = await sweepSortButtons();
    check(`@${width} shipments visible-sort-pairs 0`, s.pairs.length === 0, JSON.stringify(s.pairs.slice(0, 2)));
    check(`@${width} shipments no ghost clipped buttons`, s.ghosts === 0, `ghosts=${s.ghosts}`);
    if (s.visible > 0) {
      // click the first header: aria-sort must land on ITS column
      const clicked = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.table-sort-button')].find((b) => {
          const th = b.closest('th'); if (!th) return false;
          const r = th.getBoundingClientRect();
          return r.width > 1 && r.height > 1;
        });
        if (!btn) return null;
        const th = btn.closest('th');
        const idx = [...th.parentElement.children].indexOf(th);
        btn.click();
        return new Promise((res) => setTimeout(() => {
          const thead = th.closest('thead');
          const cell = thead.rows[0].cells[idx];
          res({ label: (btn.textContent || '').trim().slice(0, 24), ariaSort: cell.getAttribute('aria-sort') });
        }, 500));
      });
      check(`@${width} shipments click sorts its own column`, clicked != null && clicked.ariaSort !== null && clicked.ariaSort !== 'none', JSON.stringify(clicked));
    }
    if (width === 1024) await page.screenshot({ path: resolve(OUT, '2026-10-29_sil578_ui-shipments-1024.png') });
    if (width === 390) await page.screenshot({ path: resolve(OUT, '2026-10-29_sil578_ui-shipments-390.png') });
  }

  // desktop 1280 sanity — real header untouched
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${FE}/shipments-detail`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1600));
  const d = await sweepSortButtons();
  check('@1280 detail desktop header live', d.visible >= 5 && d.pairs.length === 0, `visible=${d.visible} pairs=${d.pairs.length}`);
  await page.screenshot({ path: resolve(OUT, '2026-10-29_sil578_ui-detail-1280-table.png') });
} finally {
  await browser.close();
  writeFileSync(resolve(OUT, '2026-10-29_sil578_ui-driver.log'), log.join('\n'));
  say(`TOTAL ${checks - fails.length}/${checks} PASS`);
  if (fails.length) process.exit(1);
}
