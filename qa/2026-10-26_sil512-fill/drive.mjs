/**
 * SIL-512 measurement drive — the /shipments/new FCL container table at 1440:
 * appointment-column dead strip (200px col vs fit-content date cluster), the
 * HH:mm ↔ DD/MM/YYYY visual gap, and whether the table fills the card width.
 *
 * Usage: node qa/2026-10-26_sil512-fill/drive.mjs <tag>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:7176';
const API = 'http://localhost:3002/api';
const OUT = 'qa/2026-10-26_sil512-fill';
const TAG = process.argv[2] ?? 'before';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const { token } = await login.json();

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 45000 });
  await page.waitForSelector('.csc-container-table', { timeout: 30000 });
  // Ensure FCL mode (default) and 2 rows so the sheet is representative.
  const rows = await page.$$eval('.csc-container-table tbody tr', (trs) => trs.length);
  if (rows < 2) {
    // Bump the add-count input to 1 extra row and click Thêm container once.
    await page.evaluate(() => {
      const input = document.querySelector('#container-add-count');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '2');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.click('.csc-add-container');
    await new Promise((r) => setTimeout(r, 600));
  }

  const m = await page.evaluate(() => {
    const table = document.querySelector('.csc-container-table');
    const scroll = document.querySelector('.csc-container-table-scroll');
    const tableRect = table.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const colgroup = [...table.querySelectorAll('colgroup col')].map((col) => ({
      cls: col.className,
      w: col.getBoundingClientRect().width,
    }));
    const head = [...table.querySelectorAll('thead th')].map((th) => {
      const r = th.getBoundingClientRect();
      return { label: th.textContent.trim() || '(sr-only)', x: Math.round(r.x), w: Math.round(r.width) };
    });
    const apptCell = table.querySelector('td.csc-container-cell--appointment');
    const fields = apptCell?.querySelector('.split-datetime__fields');
    const fieldsRect = fields?.getBoundingClientRect();
    const timeGroup = apptCell?.querySelector('.split-datetime__field:first-child')?.getBoundingClientRect();
    const dateGroup = apptCell?.querySelector('.split-datetime__field:last-child')?.getBoundingClientRect();
    const section = table.closest('.csc-section');
    const sectionRect = section?.getBoundingClientRect();
    const copyBtn = apptCell?.querySelector('.csc-container-cell__actions');
    const copyRect = copyBtn?.getBoundingClientRect();
    const tableRight = Math.round(tableRect.right);
    return {
      tableWidth: Math.round(tableRect.width),
      scrollClientWidth: Math.round(scrollRect.width),
      tableFillsScroll: Math.abs(tableRect.width - scrollRect.clientWidth) < 2,
      sectionWidth: sectionRect ? Math.round(sectionRect.width) : null,
      tableRightInsideSection: sectionRect ? tableRight <= Math.round(sectionRect.right) : null,
      colgroup,
      head,
      appointment: {
        cellWidth: apptCell ? Math.round(apptCell.getBoundingClientRect().width) : null,
        fieldsWidth: fieldsRect ? Math.round(fieldsRect.width) : null,
        deadStripPx: fieldsRect && apptCell ? Math.round(apptCell.getBoundingClientRect().width - fieldsRect.width) : null,
        timeToDateGapPx: timeGroup && dateGroup ? Math.round(dateGroup.x - (timeGroup.x + timeGroup.width)) : null,
        fieldsLeftOffset: fieldsRect && apptCell ? Math.round(fieldsRect.x - apptCell.getBoundingClientRect().x) : null,
      },
      copyButton: copyRect ? { x: Math.round(copyRect.x), w: Math.round(copyRect.width), insideApptCell: apptCell ? copyRect.right <= apptCell.getBoundingClientRect().right : null } : null,
      scrollOverflowsX: scroll.scrollWidth > scroll.clientWidth,
      pageOverflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  writeFileSync(`${OUT}/sil512_${TAG}_measure.json`, JSON.stringify(m, null, 2));
  await page.screenshot({ path: `${OUT}/sil512_${TAG}_1440_create-table.png`, fullPage: false });
  console.log(JSON.stringify(m, null, 2));
} finally {
  await browser.close();
}
