// SIL-479 — "Chi tiết container" horizontal-scroll defect on /shipments/:id (LOCAL ONLY).
// Captures the container-ledger block at the SPEC viewports (1024/1440 desktop, 390
// phone sanity) BEFORE and AFTER the CSS fix, plus a computed-style probe of the
// scroll wrapper + table + colgroup so the verdict is mechanical:
//   desktop (>=1024): wrapper.scrollWidth <= wrapper.clientWidth (no horizontal scroll)
//   phone  (<1024):  scroll kept (wrapper.scrollWidth > wrapper.clientWidth)
// The --label flag names the capture phase (before/after).
// Run: node qa/scripts/2026-10-25-sil479-container-fullrow-shots.mjs --label before
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const label = process.argv.includes('--label')
  ? process.argv[process.argv.indexOf('--label') + 1]
  : 'before';
const FRONT = process.env.FRONT_URL ?? 'http://localhost:7175';
const API = process.env.API_URL ?? 'http://localhost:3002/api';
const SHIPMENT = process.env.SHIPMENT_ID ?? '300';
const WIDTHS = (process.env.WIDTHS ?? '1024,1440,390').split(',').map(Number);
const OUT = path.resolve('qa/2026-10-25-sil479');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `driver-${label}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login failed (${loginRes.status})`); process.exit(2); }
const { token } = await loginRes.json();
log('LOGIN ok role=cus');

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, token);

for (const WIDTH of WIDTHS) {
  await page.setViewport({ width: WIDTH, height: 950 });
  await page.goto(`${FRONT}/shipments/${SHIPMENT}`, { waitUntil: 'networkidle2', timeout: 60000 });
  let wrap;
  try {
    await page.waitForSelector('.cus-container-table-scroll', { timeout: 30000 });
    // An empty ledger would probe green trivially — wait for an actual row.
    await page.waitForSelector('.cus-container-table tbody tr', { timeout: 30000 });
    wrap = await page.$('.cus-container-table-scroll');
  } catch {
    log(`WARN ${WIDTH}: no .cus-container-table-scroll/tbody tr rendered — capturing viewport anyway`);
    await page.screenshot({ path: path.join(OUT, `shipment-${WIDTH}-${label}-viewport.png`) });
    continue;
  }
  await page.evaluate(() => {
    document.querySelector('.cus-container-ledger')?.scrollIntoView({ block: 'center' });
  });
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, `shipment-${WIDTH}-${label}-viewport.png`) });
  const ledger = await page.$('.cus-container-ledger');
  if (ledger) await ledger.screenshot({ path: path.join(OUT, `shipment-${WIDTH}-${label}-ledger.png`) });

  // Edit mode (the owner's screenshot state): inputs/dropdowns must keep their
  // behavior; capture the ledger with the edit toggle active at desktop widths.
  if (WIDTH >= 1024) {
    const editBtn = await page.$('.cus-container-edit-action');
    const text = editBtn ? await editBtn.evaluate((el) => el.textContent ?? '') : null;
    if (text && text.includes('Chỉnh sửa')) {
      await editBtn.click();
      await sleep(600);
      const ledger2 = await page.$('.cus-container-ledger');
      if (ledger2) await ledger2.screenshot({ path: path.join(OUT, `shipment-${WIDTH}-${label}-ledger-edit.png`) });
      await page.evaluate(() => {
        document.querySelector('.cus-container-edit-action')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await sleep(400);
    } else {
      // Loud skip: the ledger may already BE in edit mode ("Hoàn tất" showing)
      // — that state is what the main screenshots capture, so nothing is lost,
      // but the capture phase must say so instead of failing silently.
      log(`NOTE ${WIDTH}: edit toggle not in 'Chỉnh sửa' state (text=${JSON.stringify(text)}) — ledger captured in its current mode`);
    }
    // FB-045-critical state: the add-container row (tfoot) riding the same
    // colgroup — open it, capture, cancel. No data is written.
    const addBtn = await page.$('.cus-container-ledger__add button');
    if (addBtn) {
      await addBtn.click();
      try {
        await page.waitForSelector('.cus-container-ledger__add-row', { timeout: 8000 });
        await sleep(400);
        const ledger3 = await page.$('.cus-container-ledger');
        if (ledger3) await ledger3.screenshot({ path: path.join(OUT, `shipment-${WIDTH}-${label}-ledger-addrow.png`) });
        const cancel = await page.$('.cus-container-ledger__add-actions .btn--ghost');
        if (cancel) { await cancel.click(); await sleep(300); }
      } catch {
        log(`NOTE ${WIDTH}: add row did not open — skipping addrow capture`);
      }
    }
  }

  const probe = await page.evaluate(() => {
    const wrapEl = document.querySelector('.cus-container-table-scroll');
    const table = document.querySelector('.cus-container-table');
    if (!wrapEl || !table) return null;
    const w = wrapEl.getBoundingClientRect();
    const t = table.getBoundingClientRect();
    const cols = [...document.querySelectorAll('.cus-container-table colgroup col')].map((c) => {
      const s = getComputedStyle(c);
      return { cls: c.getAttribute('class')?.replace('cus-container-col__', ''), w: s.width };
    });
    return {
      viewport: window.innerWidth,
      wrap: { clientWidth: Math.round(w.width), scrollWidth: wrapEl.scrollWidth, overflowX: getComputedStyle(wrapEl).overflowX, scrolls: wrapEl.scrollWidth > wrapEl.clientWidth },
      table: { width: Math.round(t.width), scrollWidth: table.scrollWidth, minWidth: getComputedStyle(table).minWidth, layout: getComputedStyle(table).tableLayout },
      cols,
    };
  });
  log(`PROBE ${WIDTH}: ${JSON.stringify(probe)}`);
  fs.writeFileSync(path.join(OUT, `shipment-${WIDTH}-${label}-probe.json`), JSON.stringify(probe, null, 2));
}

await browser.close();
log(`DONE label=${label}`);
