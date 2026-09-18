// Verify the drawer ledger's container-number ruling (2026-09-18): the code
// must sit on ONE line, stay non-bold, and never be covered by the copy icon.
//
// Usage: node testplan/qa/scripts/ui-drawer-container-number-20260918.mjs
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:7174';
const API = process.env.API_URL || 'http://localhost:3001/api';
const SHIPMENT_ID = Number(process.env.SHIPMENT_ID || 41987);
const SEARCH = process.env.SEARCH_SUFFIX || '9732531';
const DIR = process.env.OUT_DIR || 'qa/2026-09-18-filter-layout';
mkdirSync(DIR, { recursive: true });
const LOGFILE = `${DIR}/drawer-number.log`;
const lines = [];
const log = (s, extra) => {
  const line = extra === undefined ? s : `${s} ${JSON.stringify(extra)}`;
  console.log(line);
  lines.push(line);
  writeFileSync(LOGFILE, lines.join('\n') + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await login.json();

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let failed = null;
try {
  const page = await browser.newPage();
  for (const width of [1568, 1280, 1024]) {
    await page.setViewport({ width, height: 900 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/shipments?searchSuffix=${SEARCH}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector(`#cus-dashboard-detail-${SHIPMENT_ID}`, { timeout: 30000 });
    await page.click(`#cus-dashboard-detail-${SHIPMENT_ID}`);
    await page.waitForSelector(`#cus-detail-drawer-${SHIPMENT_ID} .cus-container-row`, { timeout: 30000 });
    await sleep(1000);

    const probe = await page.evaluate((id) => {
      const rows = Array.from(document.querySelectorAll(`#cus-detail-drawer-${id} .cus-container-row`));
      return rows.map((row) => {
        const cell = row.querySelector('.cus-container-cell--identity');
        const strong = cell && cell.querySelector('strong');
        if (!strong) return { missing: 'strong' };
        const sr = strong.getBoundingClientRect();
        const info = {
          text: strong.textContent,
          lines: strong.getClientRects().length,
          fontSize: getComputedStyle(strong).fontSize,
          weight: getComputedStyle(strong).fontWeight,
          numberWidth: Math.round(sr.width),
          cellWidth: Math.round(cell.getBoundingClientRect().width),
          hasCopy: Boolean(cell.querySelector('.cus-container-row__copy')),
        };
        const button = cell.querySelector('.cus-container-row__copy');
        if (button) {
          button.style.visibility = 'visible';
          const br = button.getBoundingClientRect();
          // Glyph-level, not element-level: in card mode the code element fills
          // the whole card, so boxes would report an overlap no glyph has.
          const range = document.createRange();
          range.selectNodeContents(strong);
          const glyphRects = Array.from(range.getClientRects());
          info.copyLeft = Math.round(br.left);
          info.numberLeft = Math.round(glyphRects[0]?.left ?? sr.left);
          info.overlapWithCopy = glyphRects.some((box) => (
            box.width > 0 && box.height > 0
            && br.left < box.right - 1 && br.right > box.left + 1
            && br.top < box.bottom - 1 && br.bottom > box.top + 1
          ));
        }
        return info;
      });
    }, SHIPMENT_ID);
    log(`width ${width}`, probe);

    for (const row of probe) {
      if (row.missing) failed = `row without a container-number element: ${JSON.stringify(row)}`;
      else if (row.lines > 1) failed = `container number wraps at ${width}px: ${JSON.stringify(row)}`;
      else if (row.weight !== '400') failed = `container number is bold at ${width}px: ${row.weight}`;
      else if (row.overlapWithCopy) failed = `copy icon covers the code at ${width}px: ${JSON.stringify(row)}`;
    }

    if (width === 1568) {
      const drawer = await page.$(`#cus-detail-drawer-${SHIPMENT_ID}`);
      const box = await drawer.boundingBox();
      await page.screenshot({ path: `${DIR}/drawer-container-number.png`, clip: { x: box.x, y: box.y + 300, width: box.width, height: 320 } });
    }
  }
} finally {
  await browser.close();
}

if (failed) {
  log(`FAIL ${failed}`);
  process.exitCode = 1;
} else {
  log('PASS — the container code stays on one line, unbolded and clear of the copy icon');
}
log(`artifact driver log: ${LOGFILE}`);
