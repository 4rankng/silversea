// Cards 201026112400 (FB-061 admin) + 201026112500 (FB-014 điều vận) — RUNG-3
// UI drive on the CURRENT staging build. Read-only: no mutation of business data.
//
// FB-061: admin → /accounting/phoi-phieu → Kiểm soát phơi phiếu. The card's
//         signature set must not appear (DOM + wire).
// FB-014: dieuvan → /dispatch-detail → quick tab "Chưa gán xe" lists ONLY rows
//         without a plate (R17-batch2 contract); "Đã gán xe" lists only plated
//         rows. Reads every rendered row's plate cell + chip counts.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = process.env.OUT_DIR || path.resolve(import.meta.dirname, '../../../qa/2026-10-20-fb061-fb014');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash, ok: health.buildHash === '70b5c0a7' });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function drive(identifier, route, token) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem('token', t);
    localStorage.setItem('accounting-debit-hidden-cols', '[]');
  }, token);
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(2500);
  return { page, errors };
}

async function login(identifier) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!r.ok) { console.error(`BLOCKED: login ${identifier} -> ${r.status}`); process.exit(2); }
  const { token, user } = await r.json();
  log('login', { identifier, user: user?.username, role: user?.role });
  return token;
}

const CARD_SIGNATURES = [
  /KHO-SEAM/i, /STG VERIFY/i, /BL-QAKE/i, /E2E-/i, /51K-PROBE/i,
  /Test Driver/i, /99T-99999/i, /QA0915/i,
];

/* ---------------- FB-061 — admin / Kiểm soát phơi phiếu ---------------- */
{
  const token = await login('admin');
  const { page, errors } = await drive('admin', '/accounting/phoi-phieu', token);
  // Wait for the Kiểm soát phơi phiếu board to render rows (or its empty state).
  await page.waitForSelector('table, [class*="empty"]', { timeout: 90000 });
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, '201026112400_ui-01-phoiphieu-board.png'), fullPage: false });

  const dom = await page.evaluate(() => (document.body.innerText || ''));
  const sigHits = CARD_SIGNATURES.filter((re) => re.test(dom));
  log('fb061_dom_scan', { charCount: dom.length, signatureHits: sigHits.map((re) => re.source) });
  fs.writeFileSync(path.join(OUT, '201026112400_dom.txt'), dom);

  // Wire rows again for the same instant + quote the factory/carrier/bill columns.
  const wire = await (await fetch(`${API}/expense-accounting/phoi-phieu/rows`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const rows = wire.items ?? [];
  const wireSigHits = [];
  for (const r of rows) {
    for (const v of [r.factoryName, r.factorySiteName, r.customerName, r.carrierName, r.externalDriverName, r.driverName, r.blNumber, r.bookingRef, r.shipmentCode, r.plateNumber, r.externalPlateNumber, r.licensePlate]) {
      if (typeof v === 'string') for (const re of CARD_SIGNATURES) if (re.test(v)) wireSigHits.push({ shipmentId: r.shipmentId, value: v });
    }
  }
  log('fb061_wire_scan', { rowCount: rows.length, signatureHits: wireSigHits.slice(0, 20) });
  log('fb061_console_errors', { count: errors.length, errors: errors.slice(0, 3) });
  await page.close();
}

/* ---------------- FB-014 — dieuvan / dispatch-detail quick tabs ---------------- */
{
  const token = await login('dieuvan');
  const { page, errors } = await drive('dieuvan', '/dispatch-detail', token);
  await page.waitForSelector('[role="tab"]', { timeout: 90000 });
  await sleep(2000);

  const chipCounts = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    return tabs.map((t) => ({ label: (t.textContent || '').trim(), count: t.querySelector('.ds-tabs__count')?.textContent ?? null }));
  });
  log('fb014_tabs_initial', { tabs: chipCounts });
  await page.screenshot({ path: path.join(OUT, '201026112500_ui-01-tabs-all.png') });

  const clickTab = async (label) => {
    const clicked = await page.evaluate((want) => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => (t.textContent || '').trim().startsWith(want));
      if (!tab) return false;
      tab.click();
      return true;
    }, label);
    if (!clicked) { log('fb014_tab_missing', { label }); return false; }
    await sleep(2200); // refetch + render
    return true;
  };

  // --- Chưa gán xe tab ---
  if (await clickTab('Chưa gán xe')) {
    await page.screenshot({ path: path.join(OUT, '201026112500_ui-02-tab-chua-gan-xe.png') });
    const read = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tbody tr')];
      return rows.map((tr) => {
        const cells = [...tr.querySelectorAll('td')].map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim());
        return cells;
      });
    });
    log('fb014_unassigned_rows', { rowCount: read.length, first: read.slice(0, 8) });
    fs.writeFileSync(path.join(OUT, '201026112500_dom-chua-gan-xe.txt'), JSON.stringify(read, null, 1));
  }

  // --- Đã gán xe tab ---
  if (await clickTab('Đã gán xe')) {
    await page.screenshot({ path: path.join(OUT, '201026112500_ui-03-tab-da-gan-xe.png') });
    const read = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tbody tr')];
      return rows.map((tr) => {
        const cells = [...tr.querySelectorAll('td')].map((td) => (td.innerText || '').replace(/\s+/g, ' ').trim());
        return cells;
      });
    });
    log('fb014_assigned_rows', { rowCount: read.length, first: read.slice(0, 8) });
    fs.writeFileSync(path.join(OUT, '201026112500_dom-da-gan-xe.txt'), JSON.stringify(read, null, 1));
  }
  log('fb014_console_errors', { count: errors.length, errors: errors.slice(0, 3) });
  await page.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'ui-driver.log'), JSON.stringify(LOG, null, 2));
console.log('UI_DRIVE_DONE');
