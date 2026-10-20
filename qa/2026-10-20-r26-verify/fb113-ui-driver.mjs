// QA R26 spot-check — FB-113 on STAGING build d39ee741 (verdict ba9981c2).
// Read-only UI drive, cus (CUS role) → https://vantai.tingting.vip
//
// Surface #3 of the standing complaint: the /shipments/:id header card must
// carry "Số tờ khai" and present the documents group in the card's order
//   Số Bill/Booking → Số tờ khai → Xuất/Nhập → Hãng tàu.
// The 4-column documents ledger (BILL/BOOKING → SỐ TỜ KHAI → NHẬP/XUẤT →
// HÃNG TÀU + inline "Sửa") lives on the sibling surface that shares the nav
// title "Chi tiết lô hàng": /shipments-detail. Both are captured with their
// exact URL. Lot 176 (Booking DNKM13337, tờ khai 102250318903).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { stagingPassword } from './creds.mjs';

const require = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require('puppeteer');

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = path.resolve(import.meta.dirname);
const LOT = { id: 176, ref: 'DNKM13337', declaration: '102250318903' };

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const flush = () => fs.writeFileSync(`${OUT}/fb113-ui-driver.log`, `${LOG.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash, expect: 'd39ee741', base: BASE });
if (health.buildHash !== 'd39ee741') { log('STOP_buildHash_mismatch', { got: health.buildHash }); flush(); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: stagingPassword() }),
});
if (!loginRes.ok) { log('STOP_login', { status: loginRes.status }); flush(); process.exit(2); }
const { token, user } = await loginRes.json();
log('login', { username: user?.username, role: user?.role, customerId: user?.customerId });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);

const stamp = async (label) => {
  await page.evaluate((text) => {
    let el = document.getElementById('qa-url-stamp');
    if (!el) {
      el = document.createElement('div');
      el.id = 'qa-url-stamp';
      el.style.cssText = 'position:fixed;top:6px;left:6px;z-index:2147483647;background:#000;color:#4ade80;'
        + 'font:13px/1.45 ui-monospace,Menlo,monospace;padding:7px 11px;border:2px solid #4ade80;'
        + 'border-radius:4px;max-width:92vw;white-space:pre-wrap;word-break:break-all;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }, `${label}\nURL: ${page.url()}\nbuild d39ee741 · QA R26 · ${new Date().toISOString()}`);
};

// ── Surface A: /shipments/:id header card ─────────────────────────────────────
await page.goto(`${BASE}/shipments/${LOT.id}`, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(4000);

const header = await page.evaluate(() => {
  const card = document.querySelector('.shipment-detail__header');
  const fields = card ? [...card.querySelectorAll('.shipment-detail__fields > div')] : [];
  const pairs = fields.map((div) => ({
    dt: div.querySelector('dt')?.textContent?.trim() ?? null,
    dd: div.querySelector('dd')?.textContent?.trim() ?? null,
  }));
  return {
    pathname: location.pathname + location.search,
    pageTitle: document.querySelector('h1')?.textContent?.trim() ?? null,
    pairs,
    hasLedgerOnThisPage: Boolean(document.querySelector('.shipment-container-ledger')),
    headerText: (card?.innerText ?? '').slice(0, 900),
  };
});
const idx = (label) => header.pairs.findIndex((p) => p.dt === label);
const dokhai = header.pairs.find((p) => p.dt === 'Số tờ khai');
const headerChecks = {
  headerCardPresent: header.pairs.length > 0,
  hasSoToKhaiField: idx('Số tờ khai') >= 0,
  soToKhaiValue: dokhai?.dd ?? null,
  soToKhaiFilled: (dokhai?.dd ?? '').includes(LOT.declaration),
  orderBillBooking_before_toKhai: idx('Số Bill / Số Booking') >= 0 && idx('Số Bill / Số Booking') < idx('Số tờ khai'),
  order_toKhai_before_direction: idx('Số tờ khai') < idx('Xuất / Nhập'),
  order_direction_before_carrier: idx('Xuất / Nhập') < idx('Hãng tàu'),
};
log('header_shipments_id', { ...header, checks: headerChecks, consoleErrors });

await stamp(`FB-113 header · ${BASE}/shipments/${LOT.id} · lot 176 ${LOT.ref} · tờ khai ${LOT.declaration}`);
await page.screenshot({ path: `${OUT}/fb113-01-header-shipments-id.png` });
fs.writeFileSync(`${OUT}/fb113-01-header-dom.txt`,
  `URL: ${header.pathname}\nchecks: ${JSON.stringify(headerChecks, null, 2)}\n\n`
  + `field order:\n${header.pairs.map((p, i) => `${i + 1}. ${p.dt} = ${p.dd}`).join('\n')}\n\n`
  + `${await page.evaluate(() => document.body.innerText)}`, 'utf8');

// ── Surface B: the 4-column documents ledger (/shipments-detail) ──────────────
await page.goto(`${BASE}/shipments-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(4000);

// The ledger opens scoped to the topbar month (01/10–31/10); lot 176's
// containers are older, so widen the date scope with the screen's own
// "Tất cả" preset before searching (real control, real refetch).
const preset = await page.evaluate(() => {
  const group = document.querySelector('[aria-label="Lọc nhanh theo ngày"]');
  if (!group) return { found: false, reason: 'preset group missing' };
  const tabs = [...group.querySelectorAll('button, [role="tab"]')];
  const all = tabs.find((t) => (t.textContent ?? '').trim() === 'Tất cả');
  if (!all) return { found: false, labels: tabs.map((t) => (t.textContent ?? '').trim()) };
  all.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = all.getBoundingClientRect();
  return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
log('date_scope_preset', { ...preset });
if (preset.found) {
  await page.mouse.click(preset.x, preset.y);
  await sleep(3500);
}
log('after_scope_widen', { url: page.url() });

await page.type('input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]', LOT.ref, { delay: 30 });
await sleep(3000);
try {
  await page.waitForSelector('.shipment-container-ledger tbody tr', { timeout: 20000 });
} catch {
  log('ledger_selector_wait_failed', { url: page.url() });
}
await sleep(1500);

const ledger = await page.evaluate(() => {
  const table = document.querySelector('.shipment-container-ledger');
  if (!table) {
    return {
      ledgerPresent: false,
      pathname: location.pathname + location.search,
      hasSearchInput: Boolean(document.querySelector('input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]')),
      bodyText: document.body.innerText.slice(0, 700),
    };
  }
  const rows = [...table.querySelectorAll('tbody tr')];
  const row = rows.find((r) => (r.textContent ?? '').includes('DNKM13337')) ?? rows[0] ?? null;
  if (!row) return { ledgerPresent: true, rows: rows.length, rowFound: false, pathname: location.pathname + location.search, firstRowTexts: rows.slice(0, 3).map((r) => (r.textContent ?? '').slice(0, 200)) };
  const labels = [...row.querySelectorAll('td[data-label]')].map((td) => td.getAttribute('data-label'));
  const docsCells = ['Bill/Booking', 'Số tờ khai', 'Nhập/Xuất', 'Hãng tàu']
    .map((label) => {
      const td = row.querySelector(`td[data-label="${label}"]`);
      if (!td) return { label, present: false };
      const buttons = [...td.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim());
      return { label, present: true, text: (td.textContent ?? '').trim().slice(0, 120), buttons };
    });
  const editButtons = [...row.querySelectorAll('button')]
    .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim())
    .filter((t) => t === 'Sửa' || t.startsWith('Sửa'));
  return {
    ledgerPresent: true,
    pathname: location.pathname + location.search,
    searchValue: document.querySelector('input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]')?.value ?? null,
    rows: rows.length,
    rowFound: true,
    rowText: (row.textContent ?? '').slice(0, 400),
    labels,
    docsCells,
    editButtons,
  };
});

const labels = ledger.labels ?? [];
const pos = (label) => labels.indexOf(label);
const ledgerChecks = {
  ledgerPresent: Boolean(ledger.ledgerPresent),
  rowFound: Boolean(ledger.rowFound),
  hasBillBooking: pos('Bill/Booking') >= 0 || pos('Số Bill/Booking') >= 0 || pos('Số Bill') >= 0 || pos('Số Booking') >= 0,
  hasSoToKhai: pos('Số tờ khai') >= 0,
  hasDirection: pos('Nhập/Xuất') >= 0,
  hasCarrier: pos('Hãng tàu') >= 0,
  order_documents_group: (() => {
    const find = (names) => labels.findIndex((l) => names.includes(l));
    const a = find(['Bill/Booking', 'Số Bill/Booking', 'Số Bill', 'Số Booking']);
    const b = find(['Số tờ khai']);
    const c = find(['Nhập/Xuất']);
    const d = find(['Hãng tàu']);
    return a >= 0 && b >= 0 && c >= 0 && d >= 0 && a < b && b < c && c < d;
  })(),
  inlineEditButton: (ledger.editButtons?.length ?? 0) > 0,
};
log('ledger_shipments_detail', { ...ledger, checks: ledgerChecks, consoleErrors });

await stamp(`FB-113 ledger · ${BASE}/shipments-detail · lot 176 ${LOT.ref} · 4 cột chứng từ`);
await page.screenshot({ path: `${OUT}/fb113-02-ledger-4-columns.png` });
fs.writeFileSync(`${OUT}/fb113-02-ledger-dom.txt`,
  `URL: ${ledger.pathname}\nchecks: ${JSON.stringify(ledgerChecks, null, 2)}\n`
  + `labels: ${JSON.stringify(ledger.labels)}\n`
  + `docsCells: ${JSON.stringify(ledger.docsCells, null, 2)}\n\n`
  + `${await page.evaluate(() => document.body.innerText)}`, 'utf8');

const results = [
  { check: 'FB-113 header /shipments/:id — Số tờ khai field + documents order', pass: Object.values(headerChecks).every(Boolean), checks: headerChecks, url: `${BASE}/shipments/${LOT.id}` },
  { check: 'FB-113 ledger /shipments-detail — 4 cột BILL/BOOKING → SỐ TỜ KHAI → NHẬP/XUẤT → HÃNG TÀU + nút Sửa inline', pass: Object.values(ledgerChecks).every(Boolean), checks: ledgerChecks, url: `${BASE}/shipments-detail` },
];
log('verdict', { results, allPass: results.every((r) => r.pass), consoleErrors });
flush();
await browser.close();
log('done', {});
flush();
