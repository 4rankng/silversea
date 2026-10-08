// Card 061026221226 — width-matrix capture for the freight-rate-terms table.
// Used before (red) and after (green) the CrudTable redesign. Per width:
// full-page screenshot + probe of the presentation mode (thead visible?),
// the per-cell data-label gluing (card mode), and any clipped cell.
import puppeteer from 'puppeteer';
import { appendFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const TAG = process.argv[2] ?? 'red';
const DRIVER_LOG = `${QA}/2026-10-07_card061026221226_ui-${TAG}-driver.log`;
const LOG = [];
const log = (step, obj) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  appendFileSync(DRIVER_LOG, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};

mkdirSync(QA, { recursive: true });
const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { status: health.status, tag: TAG });

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login admin failed: ${login.status}`);
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
log('login', { user: 'admin', role: 'ADMIN (local demo)', gotToken: Boolean(token) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  for (const width of [1440, 768, 390]) {
    await page.setViewport({ width, height: 1000 });
    await page.goto(`${BASE}/config/freight-rate-terms`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for actual data rows, not the loading skeleton row.
    await page.waitForSelector('.record-table tbody tr:not(.cfg-empty-row)', { timeout: 90000 });
    await page.waitForFunction(() => {
      const tds = [...document.querySelectorAll('.record-table tbody td')];
      return tds.length > 0 && tds.some((td) => (td.textContent || '').trim() !== '' && (td.textContent || '').includes('%'));
    }, { timeout: 90000 });
    await new Promise((r) => setTimeout(r, 800)); // settle animations/HMR
    const probe = await page.evaluate(() => {
      const table = document.querySelector('.record-table');
      const thead = table?.querySelector('thead');
      const theadVisible = thead ? getComputedStyle(thead).display !== 'none' : false;
      const tds = [...(table?.querySelectorAll('tbody td') ?? [])];
      let gluedLabels = 0;
      let clippedCells = 0;
      for (const td of tds) {
        const before = getComputedStyle(td, '::before').content;
        if (before && before !== 'none' && before !== '""') gluedLabels += 1;
        if (td.scrollWidth > td.clientWidth + 1) clippedCells += 1;
      }
      const wrap = document.querySelector('.record-table-wrap');
      return {
        theadVisible,
        wrapWidth: wrap ? wrap.clientWidth : null,
        rowCount: table ? table.querySelectorAll('tbody tr').length : 0,
        gluedLabels,
        clippedCells,
      };
    });
    log(`probe-${width}`, probe);
    await page.screenshot({ path: `${QA}/2026-10-07_card061026221226_ui-${TAG}-${width}.png`, fullPage: width !== 1440 });
    log(`screenshot-${width}`, { path: `qa/2026-10-07_card061026221226_ui-${TAG}-${width}.png` });
  }
} finally {
  await browser.close();
}
appendFileSync(DRIVER_LOG, 'DRIVER OK\n');
console.log('DRIVER OK');
