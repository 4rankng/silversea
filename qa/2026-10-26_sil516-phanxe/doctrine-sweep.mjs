/**
 * SIL-516 commit-2 doctrine sweep (SIL-515: không truncate, wrap full).
 * Loads the workboard UNFILTERED (every rendered row — container rows with
 * the Thao tác column included) at the standard widths and scans every
 * data cell for:
 *   - clipped text (scrollWidth > clientWidth under hidden/clip),
 *   - ellipsis / line-clamp usage,
 *   - text spilling past its own cell (visible overflow = overlap risk),
 *   - region/table horizontal overflow,
 *   - header buttons spilling past their th.
 *
 * READ-ONLY: no clicks that write; it only renders and measures.
 * Usage: node qa/2026-10-26_sil516-phanxe/doctrine-sweep.mjs <baseUrl> <tag>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:7175';
const TAG = process.argv[3] ?? 'sweep';
const API = 'http://localhost:3002/api';
const OUT = 'qa/2026-10-26_sil516-phanxe';
const WIDTHS = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const res = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.ACCOUNT ?? 'admin', password: 'Abc123' }),
});
const body = await res.json();
if (!body.token) throw new Error('login failed');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const report = { base: BASE, tag: TAG, widths: {} };
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), body.token);

  for (const width of WIDTHS) {
    await page.setViewport({ width, height: width <= 480 ? 844 : 1000, deviceScaleFactor: 1 });
    const dates = (process.env.DATES ?? '2026-10-01,2026-10-31').split(',');
    await page.goto(`${BASE}/shipments-detail?transportDateFrom=${dates[0]}&transportDateTo=${dates[1]}&limit=20`, { waitUntil: 'networkidle0', timeout: 45000 });
    await page.waitForSelector('.shipment-container-ledger tbody tr', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 600));

    const scan = await page.evaluate(() => {
      const region = document.querySelector('.shipment-container-ledger');
      const table = region.querySelector('table');
      const clipped = [];
      const spilled = [];
      const ellipsis = [];
      for (const cell of region.querySelectorAll('tbody td, tbody th')) {
        const label = cell.getAttribute('data-label') ?? 'row-head';
        for (const el of cell.querySelectorAll('*')) {
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!own) continue;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const srOnly = cs.clipPath === 'inset(50%)' || (r.width <= 1 && r.height <= 1);
          if (srOnly) continue;
          if (cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none') {
            ellipsis.push({ label, cls: String(el.className).slice(0, 60), text: el.textContent.trim().slice(0, 40) });
          }
          const hides = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
          if (hides && el.scrollWidth > el.clientWidth + 1) {
            clipped.push({ label, cls: String(el.className).slice(0, 60), text: el.textContent.trim().slice(0, 40), scrollW: el.scrollWidth, clientW: el.clientWidth });
          }
          // Text wider than its own box: clipped when overflow hides, a
          // spillover/overlap candidate when it stays visible (nowrap token
          // under a max-width cap, e.g. action labels).
          if (!hides && el.scrollWidth > el.clientWidth + 1) {
            spilled.push({ label, cls: String(el.className).slice(0, 60), text: el.textContent.trim().slice(0, 40), scrollW: el.scrollWidth, clientW: el.clientWidth, whiteSpace: cs.whiteSpace });
          }
          const c = cell.getBoundingClientRect();
          if (r.right > c.right + 1 || r.left < c.left - 1) {
            spilled.push({ label, cls: String(el.className).slice(0, 60), text: el.textContent.trim().slice(0, 40), overRightPx: +(r.right - c.right).toFixed(1), overLeftPx: +(c.left - r.left).toFixed(1) });
          }
        }
      }
      const headerSpill = [...region.querySelectorAll('thead th')].flatMap((th) => {
        const tr = th.getBoundingClientRect();
        if (tr.width <= 2 && tr.height <= 2) return [];
        const btn = th.querySelector('.table-sort-button');
        const b = btn ? btn.getBoundingClientRect() : null;
        const spills = (b ? (b.right > tr.right + 0.5 || b.left < tr.left - 0.5) : false) || th.scrollWidth > th.clientWidth + 1;
        return spills ? [{ label: th.textContent.trim().slice(0, 24), thScrollW: th.scrollWidth, thClientW: th.clientWidth }] : [];
      });
      return {
        rows: region.querySelectorAll('tbody tr').length,
        cells: region.querySelectorAll('tbody td, tbody th').length,
        copyButtons: region.querySelectorAll('.shipment-container-ledger__copy').length,
        actionCells: region.querySelectorAll('td[data-label="Thao tác"]').length,
        regionOverflow: region.scrollWidth > region.clientWidth + 1,
        tableOverflow: table.scrollWidth > table.clientWidth + 1,
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        clipped, spilled, ellipsis, headerSpill,
      };
    });
    report.widths[width] = scan;
    await page.screenshot({ path: `${OUT}/sil516_${TAG}_${width}_ui-doctrine-sweep.png`, fullPage: false });

    console.log(`\n== ${width}px (${TAG}) == rows=${scan.rows} cells=${scan.cells} actionCells=${scan.actionCells} copyButtons=${scan.copyButtons}`);
    console.log(`  overflow: doc=${scan.docOverflow} region=${scan.regionOverflow} table=${scan.tableOverflow}`);
    console.log(`  clipped (${scan.clipped.length}):`, JSON.stringify(scan.clipped));
    console.log(`  spilled (${scan.spilled.length}):`, JSON.stringify(scan.spilled));
    console.log(`  ellipsis (${scan.ellipsis.length}):`, JSON.stringify(scan.ellipsis));
    console.log(`  headerSpill (${scan.headerSpill.length}):`, JSON.stringify(scan.headerSpill));
  }
  writeFileSync(`${OUT}/sil516_${TAG}_report.json`, JSON.stringify(report, null, 2));
  console.log(`\nreport: ${OUT}/sil516_${TAG}_report.json`);
} finally {
  await browser.close();
}
