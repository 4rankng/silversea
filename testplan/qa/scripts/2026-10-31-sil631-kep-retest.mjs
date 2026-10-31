// SIL-631 retest (owner steps 31/10) — local dev, NEW data, rung UI 390px.
// Shape chuẩn kẹp như prod (602/631): MỘT lô FCL 2x20DC → 2 trip ghép KEP pair.
// (2 lô riêng cross-lot bị guard chặn đè lịch truck — đúng luật; kẹp FCL =
// 1 lô 2 cont như fixture DRI-03/lot 133.)
// Flow: cus quick-create 1 lô 2 cont (A 09:00 / B 12:00, 20000kg/cont) →
// dieuvan gán cùng xe bqhuong + driver 11, phát lệnh cả 2 → ghép KEP pair →
// driver UI nhận lệnh A (→ Đang chạy) rồi lệnh B → EXPECT: B nhận được,
// KHÔNG toast "Xe đang chạy chuyến…" (fix 2cd4b587: exemption theo pair row).
// Usage: node testplan/qa/scripts/2026-10-31-sil631-kep-retest.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3002/api';
const FRONT = process.env.QA_BASE || 'http://localhost:7175';
const BL = process.env.BL || `SIL631-${Date.now()}`;
const OUT = path.resolve('qa/2026-10-31-sil631-retest');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'sil631-retest.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
let failures = 0;
const check = (name, ok, detail = '') => { log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures += 1; };

const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const authed = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

const cus = await login('cus');
const dieuvan = await login('dieuvan');
log(`LOGIN ok cus + dieuvan; BL=${BL}`);

// Ngày kế tiếp còn free (+07): cont A 09:00, cont B 12:00
const day = new Date(Date.now() + 96 * 3600e3);
const z = (h) => `${day.toISOString().slice(0, 10)}T${String(h - 7).padStart(2, '0')}:00:00.000Z`;
const APPT_A = z(9), APPT_B = z(12);
log(`APPT A=${APPT_A} B=${APPT_B}`);

// 1. CUS tạo lô kẹp — 1 lô FCL 2x20DC, 20000kg/cont, giờ hẹn riêng
const created = await fetch(`${API}/shipments/quick`, {
  method: 'POST', headers: { ...authed(cus), 'Idempotency-Key': `sil631-${Date.now()}` },
  body: JSON.stringify({
    customerId: 1, tradeDirection: 'IMPORT', blNumber: BL, cargoMode: 'FCL',
    containers: [
      { containerTypeId: 1, containerNumber: null, cargoWeightKg: 5000, customerAppointmentAt: APPT_A, routeId: 106, pickupPortId: 1, dropoffPortId: 2 },
      { containerTypeId: 1, containerNumber: null, cargoWeightKg: 5000, customerAppointmentAt: APPT_B, routeId: 106, pickupPortId: 1, dropoffPortId: 2 },
    ],
  }),
});
const createText = await created.text();
log(`create`, { status: created.status, body: createText.slice(0, 160) });
if (!created.ok && !/tồn tại|existing|duplicate/i.test(createText)) throw new Error(`create: ${createText.slice(0, 300)}`);
const shipId = JSON.parse(createText).id;
log(`SHIPMENT ${shipId}`);

// 2. Dieuvan: gán cùng xe 45 (60C-45678) + driver 11 (bqhuong) cho cả 2 legs
const planRows = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&q=${BL}`, { headers: authed(dieuvan) }).then((r) => r.json());
const rows = (planRows.items ?? []).filter((i) => i.shipmentId === shipId);
log(`plan_rows ${rows.length}`);
if (rows.length !== 2) throw new Error(`expected 2 plan rows, got ${rows.length}`);

for (const row of rows) {
  const cls = 'DOUBLE'; // Kẹp declaration — guard carve-out needs BOTH legs DOUBLE
  const body = { expectedFulfillmentVersion: row.version, expectedShipmentVersion: row.shipmentVersion, carrierType: 'OWN', truckId: 45, plannedRevenue: null, plannedCarrierCost: null, classification: cls, operationalNotes: null };
  let res = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, { method: 'PATCH', headers: { ...authed(dieuvan), 'Idempotency-Key': `sil631-as-${row.fulfillmentId}-${Date.now()}` }, body: JSON.stringify(body) });
  let text = await res.text();
  if (res.status === 409 && /RIG_OVERLAP|Vẫn lưu/i.test(text)) {
    res = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, { method: 'PATCH', headers: { ...authed(dieuvan), 'Idempotency-Key': `sil631-as-${row.fulfillmentId}-${Date.now()}-c` }, body: JSON.stringify({ ...body, rigOverlapCompletedConfirmed: true }) });
    text = await res.text();
  }
  log(`assign ${row.fulfillmentId}`, { status: res.status });
  if (!res.ok && !/đã được gán|no_changes/i.test(text)) throw new Error(`assign: ${text.slice(0, 200)}`);
}

// 3. Phát lệnh cả 2 legs (cùng xe, cùng driver, giờ riêng)
const FRESH = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&q=${BL}`, { headers: authed(dieuvan) }).then((r) => r.json());
const fresh = (FRESH.items ?? []).filter((i) => i.shipmentId === shipId);
const issued = [];
for (const [idx, row] of fresh.entries()) {
  const appt = idx === 0 ? APPT_A : APPT_B;
  const end = idx === 0 ? `${day.toISOString().slice(0, 10)}T08:00:00.000Z` : `${day.toISOString().slice(0, 10)}T11:00:00.000Z`;
  const body = { fulfillmentId: row.fulfillmentId, expectedVersion: row.version, plannedStartAt: appt, plannedEndAt: end, endTimeConfirmed: true, carrierType: 'OWN', truckId: 45, driverId: 11, trailerId: 43, containerTypeId: 1 };
  let res = await fetch(`${API}/shipments/${shipId}/dispatch`, { method: 'POST', headers: { ...authed(dieuvan), 'Idempotency-Key': `sil631-is-${row.fulfillmentId}-${Date.now()}` }, body: JSON.stringify(body) });
  let text = await res.text();
  if (res.status === 409 && /RIG_OVERLAP|Vẫn lưu/i.test(text)) {
    res = await fetch(`${API}/shipments/${shipId}/dispatch`, { method: 'POST', headers: { ...authed(dieuvan), 'Idempotency-Key': `sil631-is-${row.fulfillmentId}-${Date.now()}-c` }, body: JSON.stringify({ ...body, rigOverlapCompletedConfirmed: true }) });
    text = await res.text();
  }
  log(`issue ${idx + 1}`, { status: res.status, body: text.slice(0, 140) });
  if (!res.ok) throw new Error(`issue leg ${idx + 1}: ${text.slice(0, 300)}`);
  const outcome = JSON.parse(text);
  issued.push({ fulfillmentId: row.fulfillmentId, tripId: outcome.trip.id });
}
const REUSE = (process.env.REUSE_TRIPS || '').split(",").map(Number).filter(Boolean);
const [legA, legB] = REUSE.length === 2 ? REUSE.map((id, i) => ({ fulfillmentId: null, tripId: id, tag: i === 0 ? 'A' : 'B' })) : issued;
log(`TRIPS A=${legA.tripId} B=${legB.tripId}`);
if (legA.tripId === legB.tripId) throw new Error('both legs same trip');

// 4. Ghép KEP pair
const tripApi = (id) => fetch(`${API}/trips/${id}`, { headers: authed(dieuvan) }).then((r) => { if (!r.ok) throw new Error(`GET /trips/${id} ${r.status}`); return r.json(); });
const tA = await tripApi(legA.tripId); const tB = await tripApi(legB.tripId);
const draftFor = (t) => ({ plannedStartAt: new Date(t.plannedStartAt).toISOString(), plannedEndAt: new Date(t.plannedEndAt).toISOString(), canonicalOrigin: t.canonicalOrigin, canonicalDestination: t.canonicalDestination, cargoWeightKg: Number(t.cargoWeightKg), vehicleCapacityKg: Number(t.vehicleCapacityKg), expectedVersion: t.version });
const pair = await fetch(`${API}/trips/pairs`, { method: 'POST', headers: { ...authed(dieuvan), 'Idempotency-Key': `sil631-pair-${legA.tripId}-${legB.tripId}` }, body: JSON.stringify({ firstTripId: legA.tripId, secondTripId: legB.tripId, pairKind: 'KEP', firstTrip: draftFor(tA), secondTrip: draftFor(tB) }) });
const pairText = await pair.text();
log('pair', { status: pair.status, body: pairText.slice(0, 200) });
if (!pair.ok && !/trùng nhưng nội dung khác|replay|tồn tại/i.test(pairText)) throw new Error(`pair: ${pairText.slice(0, 300)}`);

// ── 5. Driver UI: nhận lệnh A rồi B — KHÔNG được toast "Xe đang chạy chuyến…" ──
const driverLogin = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) });
if (!driverLogin.ok) throw new Error('driver login failed');
const dToken = (await driverLogin.json()).token;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, dToken);

const acceptOnDetail = async (tripId, tag) => {
  await page.goto(`${FRONT}/my-trips/${tripId}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  await shot(page, `${tag}-1-detail`);
  let btn = null;
  for (let i = 0; i < 10; i++) {
    btn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      const b = btns.find((x) => (x.textContent || '').replace(/\s+/g, ' ').trim().match(/^Nhận lệnh/));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { text: b.textContent } : null;
    });
    if (btn) break;
    await sleep(1000);
  }
  if (!btn) { log(`${tag}: no "Nhận lệnh" button visible`); await shot(page, `${tag}-2-nobtn`); return { clicked: false, blocked: false }; }
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a'));
    const b = btns.find((x) => (x.textContent || '').replace(/\s+/g, ' ').trim().match(/^Nhận lệnh/));
    b.click();
  });
  await sleep(3000);
  await shot(page, `${tag}-3-after`);
  const bodyText = await page.evaluate(() => (document.body.textContent || ''));
  const blocked = /Xe đang chạy chuyến/.test(bodyText);
  const trip = await fetch(`${API}/driver/me/trips/${tripId}`, { headers: authed(dToken) }).then((r) => r.json());
  log(`${tag}: blocked=${blocked} status=${trip.status}`);
  return { clicked: true, blocked, status: trip.status };
};

const resA = await acceptOnDetail(legA.tripId, 'legA');
check('leg A nhận lệnh → Đang chạy (IN_TRANSIT)', resA.clicked && resA.status === 'IN_TRANSIT', `status=${resA.status} blocked=${resA.blocked}`);
const resB = await acceptOnDetail(legB.tripId, 'legB');
check('leg B nhận lệnh KHÔNG bị chặn "Xe đang chạy chuyến" (SIL-631)', resB.clicked && !resB.blocked && resB.status === 'IN_TRANSIT', `status=${resB.status} blocked=${resB.blocked}`);
const tripsFinal = await Promise.all([legA.tripId, legB.tripId].map((id) => fetch(`${API}/driver/me/trips/${id}`, { headers: authed(dToken) }).then((r) => r.json())));
check('CẢ HAI chuyến đều Đang chạy đồng thời (ruling 602)', tripsFinal.every((t) => t.status === 'IN_TRANSIT'), JSON.stringify(tripsFinal.map((t) => ({ id: t.id, st: t.status }))));

await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures ? 1 : 0);
