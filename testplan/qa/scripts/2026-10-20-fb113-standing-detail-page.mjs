// FB-113 standing — phase 2: the SECOND "Chi tiết lô hàng" surface.
// /shipments/:id (ShipmentDetailPage) shares the nav title "Chi tiết lô hàng"
// with /shipments-detail and is reachable from the CUS list drawer's
// "Chi tiết lô hàng" button (ShipmentsPage cus-drawer-lot-detail link).
// v1 (popup) and v2 (ledger) never touched it. This drive captures what a
// QA tester following the same flow sees in its header card: field order
// and whether "Số tờ khai" is present at all. READ-ONLY.
// Usage: node testplan/qa/scripts/2026-10-20-fb113-standing-detail-page.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const EXPECT_BUILD = process.env.QA_BUILD || 'bf3a0ff9';
const TAG = process.env.QA_TAG || 'before';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-fb113-standing');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => {
  results.push({ id, pass, detail });
  if (!pass) exitCode = 1;
  log('RESULT', { id, pass, detail });
};

async function main() {
  const health = await (await fetch(`${API}/health`)).json();
  log('health', health);
  record(`build under test is ${EXPECT_BUILD}`, health.buildHash === EXPECT_BUILD, `buildHash=${health.buildHash}`);

  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
  });
  const { token } = await loginRes.json();
  const call = async (p) => (await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } })).json();

  // Same lot the phase-1 probe proved populated: scan ALL pages (local and
  // staging order the workspace differently) for a lot with a declaration.
  const flatRows = [];
  for (let pageNo = 1; pageNo <= 10; pageNo += 1) {
    // eslint-disable-next-line no-await-in-loop
    const pageData = await call(`/shipments/cus-workspace/containers?page=${pageNo}&limit=200`);
    const items = pageData.items ?? [];
    flatRows.push(...items);
    if (flatRows.length >= (pageData.total ?? items.length) || items.length === 0) break;
  }
  const withDecl = flatRows.find((r) => !r.isLotLevel && (r.declarationNumber ?? '').trim());
  if (!withDecl) throw new Error('no populated lot found');
  const shipmentId = withDecl.shipmentId;
  log('picked lot', { shipmentId, bill: withDecl.billOrBookNumber, decl: withDecl.declarationNumber, cont: withDecl.containerNumber });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // The QA click path: list → Chi tiết (drawer) → "Chi tiết lô hàng" link.
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.shipment-container-ledger, table, main', { timeout: 30000 });
  await sleep(800);
  // Navigate exactly through the drawer link when the row is on page 1; else direct URL (same route the link targets).
  const linkSelector = '#cus-dashboard-detail-';
  const rowBtn = await page.$(`[id^="${linkSelector}"]`);
  let usedPath = 'direct-url';
  if (rowBtn) {
    try {
      await rowBtn.click();
      await page.waitForSelector('.cus-drawer-lot-detail', { timeout: 15000 });
      await page.click('.cus-drawer-lot-detail');
      usedPath = 'list→drawer→Chi tiết lô hàng link';
    } catch (e) {
      log('drawer path missed, falling back', { error: String(e).slice(0, 120) });
    }
  }
  if (usedPath === 'direct-url') {
    await page.goto(`${BASE}/shipments/${shipmentId}`, { waitUntil: 'networkidle2', timeout: 60000 });
  }
  await page.waitForSelector('.shipment-detail__fields', { timeout: 30000 });
  await sleep(600);
  log('nav path', { usedPath, url: page.url() });

  // The header card's field order, as QA reads it.
  const fields = await page.evaluate(() => Array.from(document.querySelectorAll('.shipment-detail__fields > div')).map((div) => {
    const dt = div.querySelector('dt')?.textContent.trim();
    const dd = div.querySelector('dd')?.textContent.trim();
    return { dt, dd };
  }));
  log('header fields', fields);
  const dts = fields.map((f) => f.dt);

  const idxOf = (name) => dts.indexOf(name);
  record('[detail-page] header has Số tờ khai', idxOf('Số tờ khai') >= 0, `dts=${JSON.stringify(dts)}`);
  const EXPECTED = ['Số Bill / Số Booking', 'Số tờ khai', 'Xuất / Nhập', 'Hãng tàu'];
  const orderOk = EXPECTED.every((h, i, arr) => {
    const at = idxOf(h);
    return at >= 0 && (i === 0 || at > idxOf(arr[i - 1]));
  });
  record('[detail-page] documents order Bill/Booking → Số tờ khai → Xuất/Nhập → Hãng tàu', orderOk, JSON.stringify(dts));

  // §9 identity: header values vs API for the same lot.
  const apiDetail = await call(`/shipments/${shipmentId}`);
  const shipment = apiDetail?.shipment ?? apiDetail;
  log('api detail keys', { hasShipment: Boolean(apiDetail?.shipment), bl: shipment?.blNumber, booking: shipment?.bookingRef, declCount: (apiDetail?.declarations ?? shipment?.declarations ?? []).length });
  const decls = (apiDetail?.declarations ?? shipment?.declarations ?? []).map((d) => (d.declarationNumber ?? '').trim()).filter(Boolean);
  const expectedRef = (shipment?.blNumber?.trim() || shipment?.bookingRef?.trim() || 'Chưa có số Bill/Booking');
  const uiRef = fields.find((f) => f.dt === 'Số Bill / Số Booking')?.dd ?? null;
  const uiDecl = fields.find((f) => f.dt === 'Số tờ khai')?.dd ?? null;
  record('[detail-page] UI↔API Bill/Booking identity', uiRef === expectedRef, `ui=${JSON.stringify(uiRef)} api=${JSON.stringify(expectedRef)}`);
  record('[detail-page] UI↔API Số tờ khai identity', uiDecl === (decls[0] ?? '—'), `ui=${JSON.stringify(uiDecl)} api=${JSON.stringify(decls[0] ?? '—')}`);

  const card = await page.$('.shipment-detail__header');
  const clip = await card.boundingBox();
  await page.screenshot({ path: path.join(OUT, `ui-4-detail-page-header-${TAG}.png`), clip });
  await page.screenshot({ path: path.join(OUT, `ui-4b-detail-page-full-${TAG}.png`), fullPage: false });

  await browser.close();
  fs.writeFileSync(path.join(OUT, `ui-driver-detail-page-${TAG}.log`), LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, `results-detail-page-${TAG}.json`), JSON.stringify({ build: health.buildHash, usedPath, results, exitCode }, null, 2));
  log('SUMMARY', { pass: results.filter((r) => r.pass).length, fail: results.filter((r) => !r.pass).length });
  process.exit(exitCode);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  log('FATAL', { error: String(err?.stack ?? err) });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `ui-driver-detail-page-${TAG}.log`), LOG.map((e) => JSON.stringify(e)).join('\n') + `\nFATAL ${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
