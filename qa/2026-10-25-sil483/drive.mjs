/**
 * SIL-483 UI drive — drawer Chi tiết lô before/after at 390/1024/1440.
 *
 * Logs in as the local CUS demo account (testplan/testaccounts.txt), injects
 * the JWT BEFORE any page load (puppeteer-spa-auth law), drives the real
 * workboard drawer open, and captures:
 *   - full screenshots of the open drawer at each width,
 *   - the drawer's horizontal-scroll geometry (AC: no scroll-x at 1024/1440),
 *   - the SIL-483 chrome assertions (no lot bar, header trash, expand toggle).
 * At 1440 the expanded (full-screen) state is captured as well.
 *
 * Usage: node qa/2026-10-25-sil483/drive.mjs <baseUrl> <tag>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:7175';
const TAG = process.argv[3] ?? 'before';
const API = 'http://localhost:3002/api';
const OUT = 'qa/2026-10-25-sil483';
const WIDTHS = [390, 1024, 1440];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const { token } = await login.json();

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const report = { base: BASE, tag: TAG, widths: {} };

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle0', timeout: 45000 });
    await page.waitForSelector('table', { timeout: 30000 });
    // The row detail affordance opens the drawer.
    await page.waitForSelector('button[aria-label*="Mở chi tiết lô hàng"]', { timeout: 30000 });
    const buttons = await page.$$('button[aria-label*="Mở chi tiết lô hàng"]');
    await buttons[0].click();

    await page.waitForSelector('.cus-shipment-drawer', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('.cus-container-ledger') !== null || document.body.textContent.includes('Lô hàng chưa có dữ liệu container'), { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1600)); // slide-in settle

    const assertions = await page.evaluate(() => {
      const drawer = document.querySelector('.cus-shipment-drawer');
      const scroll = document.querySelector('.cus-container-table-scroll');
      const geom = scroll
        ? { scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth, scrollsX: scroll.scrollWidth > scroll.clientWidth + 1 }
        : null;
      const statusHeading = [...drawer.querySelectorAll('h3')].find((h) => h.textContent === 'Trạng thái lô');
      const ledger = drawer.querySelector('.cus-container-ledger');
      return {
        drawerWidth: drawer ? Math.round(drawer.getBoundingClientRect().width) : null,
        hasLotBar: Boolean(document.querySelector('.cus-drawer-lot-bar')),
        chiTietLink: Boolean([...(drawer.querySelectorAll('a') ?? [])].find((a) => a.textContent.includes('Chi tiết lô hàng'))),
        headerDelete: Boolean(drawer.querySelector('.cus-drawer-lot-delete')),
        expandButton: Boolean(document.querySelector('.drawer__expand')),
        ledgerBeforeStatus: Boolean(ledger && statusHeading && ledger.compareDocumentPosition(statusHeading) & Node.DOCUMENT_POSITION_FOLLOWING),
        headerCells: [...(document.querySelectorAll('.cus-container-table thead th') ?? [])].map((th) => th.textContent.trim()),
        tableGeometry: geom,
        trashButtons: drawer.querySelectorAll('.cus-container-row__remove').length,
      };
    });
    report.widths[width] = assertions;
    await page.screenshot({ path: `${OUT}/sil483_${TAG}_${width}_drawer.png` });

    if (width === 1440) {
      const expand = await page.$('.drawer__expand');
      if (expand) {
        await expand.click();
        await new Promise((r) => setTimeout(r, 600));
        report.expanded = await page.evaluate(() => {
          const drawer = document.querySelector('.cus-shipment-drawer');
          return { width: Math.round(drawer.getBoundingClientRect().width), expandedClass: drawer.className.includes('drawer--expanded') };
        });
        await page.screenshot({ path: `${OUT}/sil483_${TAG}_1440_drawer-expanded.png` });
      }
    }
  }
} finally {
  await browser.close();
}

writeFileSync(`${OUT}/sil483_${TAG}_report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
