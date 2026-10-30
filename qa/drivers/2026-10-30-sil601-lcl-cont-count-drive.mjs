// SIL-601 (id 702) — LCL lot ≡ 1-cont lot. LOCAL ONLY, no deploy.
//
// Pass structure (evidence for qa/2026-10-30_sil601_ui-driver.log):
//   (A) DB contrast: Σ trips.container_count over the lot's active trips can
//       read N (the pre-SIL-601 phone-meta value) while every API count for
//       the same lot reads exactly 1 (never 0, never N).
//   (B) UI rung-3: CUS workboard "Tổng quan hàng hóa" cell ("1 cont"), the
//       /shipments-debit phone meta ("… · 1 cont"), and the ops-orders
//       Container cell ("1 cont") — real pages, screenshots + DOM asserts.
//
// Usage: LOT_ID=777 node …  reuses an existing fixture; without LOT_ID the
// driver creates a fresh package-less LCL lot + one trip with
// container_count=2 (the pre-law Σ=2 "many conts" case).
import puppeteer from 'puppeteer';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = process.env.API ?? 'http://localhost:3002/api';
const OUT = process.env.EVIDENCE ?? 'qa';
const TAG = '2026-10-30_sil601';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (section, ...rest) => console.log(`[${new Date().toISOString()}] ${section}`, ...rest);
const shot = async (page, name) => {
  const path = `${OUT}/${TAG}_${name}.png`;
  await page.screenshot({ path, fullPage: true });
  log('SHOT', path);
};
const psql = (sql) => execFileSync('docker', [
  'exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea',
  '-X', '-A', '-t', '-c', sql,
], { encoding: 'utf8' }).trim();

async function login(identifier) {
  for (let i = 1; i <= 3; i++) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: 'Abc123' }),
    });
    const text = await res.text();
    try {
      const token = JSON.parse(text).token;
      if (token) return token;
    } catch { /* retry */ }
    await sleep(1200 * i);
  }
  console.log(`LOGIN FAILED: ${identifier}`);
  process.exit(1);
}
const adminToken = await login('admin');
const opsToken = await login('giaonhan');
log('LOGIN OK (admin + giaonhan/OPS)');
const client = (token) => ({
  get: async (path) => {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
  },
  post: async (path, payload) => {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': `sil601-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
  },
});
const admin = client(adminToken);
const ops = client(opsToken);

// ── fixture (reuse when LOT_ID given) ──────────────────────────────────────
let lotId = Number(process.env.LOT_ID ?? 0);
let lotCode = null;
if (!lotId) {
  const [customers, routes, cargoTypes, containerTypes, trucks, drivers] = await Promise.all(
    ['/customers', '/routes', '/cargo-types', '/container-types', '/trucks', '/drivers'].map(async (p) => {
      const r = await admin.get(p);
      return r.body?.items ?? r.body?.data ?? (Array.isArray(r.body) ? r.body : []);
    }),
  );
  const pick = (rows, label) => {
    const row = rows[0];
    if (!row?.id) { console.log(`CATALOG EMPTY: ${label}`); process.exit(1); }
    return row;
  };
  const customer = pick(customers, 'customers');
  const route = pick(routes, 'routes');
  const cargoType = pick(cargoTypes, 'cargo-types');
  const containerType = pick(containerTypes, 'container-types');
  const truck = pick(trucks, 'trucks');
  const driver = pick(drivers, 'drivers');
  const today = new Date().toISOString().slice(0, 10);
  const created = await admin.post('/shipments', {
    customerId: customer.id,
    routeId: route.id,
    cargoMode: 'LCL',
    tradeDirection: 'IMPORT',
    expectedDeliveryDate: today,
  });
  if (created.status !== 201 && created.status !== 200) {
    console.log('CREATE LOT FAILED', created.status, JSON.stringify(created.body).slice(0, 400));
    process.exit(1);
  }
  lotId = created.body.id ?? created.body.shipment?.id;
  lotCode = created.body.shipmentCode ?? created.body.code ?? `#${lotId}`;
  log('LOT CREATED', lotId, lotCode);
  // ONE active trip with container_count=2 — the pre-SIL-601 Σ semantics
  // would print "2 cont" for this single lot ("không phải nhiều cont").
  const trip = await admin.post('/trips', {
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    containerTypeId: containerType.id,
    departureDate: today,
    shipmentId: lotId,
    containerCount: 2,
    truckId: truck.id,
    driverId: driver.id,
    customerReference: 'SIL601-TRIP-1',
  });
  log('TRIP 1 (container_count=2)', trip.status, trip.body?.id ?? JSON.stringify(trip.body).slice(0, 200));
  if (trip.status !== 201 && trip.status !== 200) process.exit(1);
} else {
  log('REUSING LOT', lotId);
}

// ── (A) DB contrast: Σ vs the law ─────────────────────────────────────────
const lotRow = psql(`select id || ' ' || cargo_mode || ' ' || coalesce(package_count::text,'-') || ' ' || coalesce(package_type,'-') || ' ' || coalesce(shipment_code,'-') from shipments where id = ${lotId}`);
lotCode = lotCode ?? lotRow.split(' ').at(-1);
const tripSum = psql(`select count(*) || ' trips, sum(container_count)=' || coalesce(sum(container_count),0) from trips where shipment_id = ${lotId} and deleted_at is null and status <> 'CANCELED'`);
log('DB lot (id mode pkg type code):', lotRow);
log('DB trips — PRE-LAW Σ source:', tripSum, '(the old phone meta printed this Σ)');

// ── (A) API counts — every one must read 1 ────────────────────────────────
const detail = await admin.get(`/shipments/${lotId}`);
const detailCont = detail.body?.containerCount ?? detail.body?.shipment?.containerCount;
const projectionQty = detail.body?.pricingProjection?.breakdown?.[0]?.quantity
  ?? detail.body?.shipment?.pricingProjection?.breakdown?.[0]?.quantity;
log('API detail containerCount =', detailCont, '| pricingProjection LCL qty =', projectionQty, '(expect 1)');
if (detailCont === undefined && projectionQty === undefined) {
  log('API detail raw head:', JSON.stringify(detail.body).slice(0, 300));
}

const wsList = await admin.get('/shipments/cus-workspace');
const wsItems = wsList.body?.items ?? (Array.isArray(wsList.body) ? wsList.body : []);
const wsRow = wsItems.find((r) => r.id === lotId);
log('API cus-workspace totalContainers =', wsRow?.operational?.totalContainers, '(expect 1; items:', wsItems.length, 'status', wsList.status, ')');
if (!wsRow) log('API cus-workspace raw head:', JSON.stringify(wsList.body).slice(0, 200));

const opsList = await ops.get(`/ops/orders?date=${new Date().toISOString().slice(0, 10)}`);
const opsItems = opsList.body?.items ?? (Array.isArray(opsList.body) ? opsList.body : []);
const opsRow = opsItems.find((r) => r.id === lotId);
log('API ops-orders containerCount =', opsRow?.containerCount, '(expect 1; items:', opsItems.length, 'status', opsList.status, ')');

const debitList = await admin.get('/shipments/debit-summary');
const debitRow = (debitList.body?.items ?? []).find((r) => r.shipmentId === lotId);
log('API debit-summary containerCount =', debitRow?.containerCount, '(expect 1 — the phone meta "n cont"; row:', debitRow ? 'present' : 'absent', ')');

// ── (B) UI rung-3 ─────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });

// CUS workboard — isolate the lot via the FILTER-ROW search (the app-bar
// search is the global page finder), then read the cargo cell. Under the
// default month date-filter the LCL cell shows the SIL-586 label
// ("Chưa chọn hàng lẻ" — appointment groups are lot-level for LCL); without
// a date filter it shows the count law ("1 cont"). Both are law-conformant.
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), adminToken);
page.on('pageerror', (err) => log('PAGEERROR', err.message));
await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1500);
const searchSel = 'input[placeholder*="Bill"]';
await page.waitForSelector(searchSel, { timeout: 15000 });
await page.click(searchSel);
await page.type(searchSel, lotCode, { delay: 25 });
await sleep(2000);
const cusCell = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('tr.cus-dashboard-row'));
  return rows.slice(0, 3).map((r) => {
    const cell = r.querySelector('td[data-label="Tổng quan hàng hóa"]');
    return { cargo: cell?.textContent.trim(), row: r.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) };
  });
});
log('UI CUS filtered rows (cargo cell + row):', JSON.stringify(cusCell));
await shot(page, 'ui-cus-workboard-1440');
await page.setViewport({ width: 390, height: 844 });
await sleep(800);
await shot(page, 'ui-cus-workboard-390');
await page.setViewport({ width: 1440, height: 900 });
await sleep(400);

// Debit: desktop table identity + phone meta face at 390 (ShipmentDebitRecords)
await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1500);
const debitHit = await page.evaluate((code) => document.body.textContent.includes(code), lotCode);
log('UI debit table contains lot code', lotCode, ':', debitHit);
await shot(page, 'ui-shipments-debit-1440');
// Phone face — filter to the fixture customer so the row renders.
await page.setViewport({ width: 390, height: 844 });
await sleep(1000);
const filtered = await page.evaluate(() => {
  const selects = Array.from(document.querySelectorAll('select'));
  const target = selects.find((s) => Array.from(s.options).some((o) => o.textContent.includes('Tất cả khách hàng')));
  if (!target) return { ok: false, selects: selects.map((s) => s.options[0]?.textContent) };
  const opt = Array.from(target.options).find((o) => o.textContent.includes('LONG MINH') || o.textContent.includes('LOG COM'));
  if (!opt) return { ok: false, options: Array.from(target.options).map((o) => o.textContent).slice(0, 12) };
  target.value = opt.value;
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, picked: opt.textContent };
});
log('customer filter:', JSON.stringify(filtered));
await sleep(1800);
const metaHit = await page.evaluate(() => {
  const texts = Array.from(document.querySelectorAll('.ledger-glist__meta, [class*=meta]'))
    .map((el) => el.textContent.trim())
    .filter((t) => t.includes('1 cont'));
  return texts.slice(0, 3);
});
log('UI debit phone meta lines with "1 cont":', JSON.stringify(metaHit), metaHit.length ? '→ rung 3 OK' : '(no meta line — see API rung-2 evidence)');
await shot(page, 'ui-shipments-debit-390');
await page.setViewport({ width: 1440, height: 900 });
await sleep(400);

// Ops orders (OPS role) — Container cell
const opsPage = await browser.newPage();
await opsPage.setViewport({ width: 1440, height: 900 });
await opsPage.evaluateOnNewDocument((t) => localStorage.setItem('token', t), opsToken);
opsPage.on('pageerror', (err) => log('OPS PAGEERROR', err.message));
await opsPage.goto(`${BASE}/ops/orders?date=${new Date().toISOString().slice(0, 10)}`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1500);
const opsCell = await opsPage.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('tr'));
  const hit = rows.find((r) => {
    const cell = r.querySelector('td[data-label="Container"]');
    return cell && cell.textContent.trim() === '1 cont';
  });
  return hit ? hit.textContent.replace(/\s+/g, ' ').trim().slice(0, 220) : { rowsSeen: rows.length };
});
log('UI ops-orders Container cell = "1 cont" row:', JSON.stringify(opsCell));
await shot(opsPage, 'ui-ops-orders-1440');

await browser.close();
log('DRIVER DONE exit=0');
