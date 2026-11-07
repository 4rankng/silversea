// SIL-704 probe matrix — cổng lái xe với cặp/chung xe cùng rig, cùng ngày.
// Modes (env SIL704_MODE):
//   kep_unpaired : 1 lô FCL 2×20DC → 2 chân khai DOUBLE, cùng xe/driver/ngày,
//                  KHÔNG pair row (SIL-634 declared clamp) — EXPECT: chân 2 nhận OK.
//   kep_paired   : như trên + ghép KEP pair (SIL-602/631) — EXPECT: chân 2 nhận OK.
//   lcl_share    : 2 lô LCL riêng (classification 'LCL' — luật LCL_SHIPMENT), cùng
//                  xe/driver/ngày, windows rời nhau — EXPECT (sau fix): chân 2 nhận OK.
// Usage: QA_API=http://localhost:3002/api SIL704_MODE=kep_unpaired node testplan/qa/scripts/2026-11-07-sil704-accept.mjs
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3002/api';
const MODE = process.env.SIL704_MODE || 'kep_unpaired';
const OUT = path.resolve(process.env.QA_OUT || 'qa/2026-11-07-lane-r1');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `sil704-api-${MODE}-${process.env.QA_TAG || 'run'}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
let failures = 0;
const check = (name, ok, detail = '') => { log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures += 1; };
const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const authed = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const j = async (res, what, okStatuses = [200, 201]) => {
  const text = await res.text();
  log(`${what} -> ${res.status} ${text.slice(0, 260).replace(/\n/g, ' ')}`);
  return { status: res.status, ok: okStatuses.includes(res.status), text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Plan-rows endpoint flaky trên shared dev DB (kết quả 2↔0 cùng tham số khi
// các lane khác cùng chạy) — probe đọc fulfillment trực tiếp từ DB thay vì
// list endpoint. Versions lấy đúng bảng để PATCH/dispatch dùng expected*.
const { execSync } = await import('node:child_process');
const dbOne = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -tAc "${sql}"`, { encoding: 'utf8' }).trim();
const findPlanRow = async (leg) => {
  for (let i = 0; i < 90; i++) {
    const out = dbOne(`select sf.id, sf.version, sh.version, sh.status from shipment_fulfillments sf join shipments sh on sh.id = sf.shipment_id where sf.shipment_id = ${leg.shipId} and sf.canceled_at is null order by sf.id offset ${leg.lotIndex} limit 1;`);
    const [fid, fver, sver, status] = out.split('|');
    if (fid && (status === 'READY_FOR_DISPATCH' || status === 'DISPATCHED')) return { fulfillmentId: Number(fid), version: Number(fver), shipmentVersion: Number(sver) };
    await sleep(3000);
  }
  return null;
};

const cus = await login('cus');
const dieuvan = await login('dieuvan');
const admin = await login('admin');
// Rig sạch cho probe (mỗi mode một rig, tránh đụng luật TC2 giữa các mode;
// xe 45 bị các chuyến BULK-TR zombie chặn vĩnh viễn — không dùng):
//   kep_unpaired → xe 37 (btdung)   kep_paired → xe 29 (lqtuyen, có tải trọng
//   để pair draft qua validate)     lcl_share  → xe 42 (laixe).
const RIGS = {
  kep_unpaired: { truck: 37, driver: 16, user: 'btdung' },
  kep_paired: { truck: 29, driver: 26, user: 'lqtuyen' },
  lcl_share: { truck: 42, driver: 42, user: 'laixe' },
};
const RIG = RIGS[MODE] ?? RIGS.kep_unpaired;
const TRUCK_ID = Number(process.env.SIL704_TRUCK || RIG.truck);
const DRIVER_ID = Number(process.env.SIL704_DRIVER || RIG.driver);
const DRIVER_USER = process.env.SIL704_DRIVER_USER || RIG.user;
const driver = await login(DRIVER_USER);
const TAG = `SIL704-${MODE}-${Date.now()}`;
log(`LOGIN ok TAG=${TAG} MODE=${MODE} API=${API}`);

const DAY_OFFSET_DAYS = Number(process.env.QA_DAY_OFFSET || 10);
const d0 = new Date(Date.now() + DAY_OFFSET_DAYS * 24 * 3600e3).toISOString().slice(0, 10);
const d1 = new Date(Date.now() + (DAY_OFFSET_DAYS + 24) * 3600e3).toISOString().slice(0, 10);
// FCL: chân A 08:00-16:00, chân B 17:30-01:30(+1) cùng ngày D — windows RỜI nhau
// (issue không cần carve), nhưng cùng departureDate D. LCL share: 2 lô 08:00/13:00.
const A_START = `${d0}T01:00:00.000Z`, A_END = `${d0}T09:00:00.000Z`;
const B_START = `${d0}T10:30:00.000Z`, B_END = `${d0}T18:30:00.000Z`;
const L2_START = `${d0}T11:00:00.000Z`, L2_END = `${d0}T17:00:00.000Z`;
log(`days D=${d0} D+1=${d1}`);
// Tự dọn chân kẹt của chính probe (các run trước cùng họ SIL704-* trên rig này):
// cancel trip IN_TRANSIT của fulfillments thuộc lô SIL704-* cùng ngày probe.
for (const t of dbOne(`select t.id, t.version from trips t join shipment_fulfillments sf on sf.id = t.fulfillment_id join shipments sh on sh.id = sf.shipment_id where t.truck_id = ${TRUCK_ID} and t.status in ('CREATED','IN_TRANSIT') and t.deleted_at is null and sh.bl_number like 'SIL704-%'`).split('\n').filter(Boolean)) {
  const [tid, tver] = t.split('|');
  const res = await fetch(`${API}/trips/${tid}/cancel`, { method: 'POST', headers: { ...authed(admin), 'Idempotency-Key': `sil704-clean-${tid}-${Date.now()}` }, body: JSON.stringify({ expectedVersion: Number(tver), reason: 'Dọn dữ liệu probe SIL-704' }) });
  log(`cleanup cancel trip ${tid} -> ${res.status} ${(await res.text()).slice(0, 120)}`);
}

const legs = []; // { bl, shipId, fulfillmentId, tripId, start, end, lotIndex }
if (MODE === 'kep_unpaired' || MODE === 'kep_paired') {
  // 1 lô FCL 2×20DC — 2 fulfillments (như sil631)
  const bl = `${TAG}`;
  const created = await fetch(`${API}/shipments/quick`, {
    method: 'POST', headers: { ...authed(cus), 'Idempotency-Key': `${bl}-c` },
    body: JSON.stringify({
      customerId: 1, tradeDirection: 'IMPORT', blNumber: bl, cargoMode: 'FCL',
      containers: [
        { containerTypeId: 1, containerNumber: null, cargoWeightKg: 5000, customerAppointmentAt: A_START, routeId: 106, pickupPortId: 1, dropoffPortId: 2 },
        { containerTypeId: 1, containerNumber: null, cargoWeightKg: 5000, customerAppointmentAt: B_START, routeId: 106, pickupPortId: 1, dropoffPortId: 2 },
      ],
    }),
  });
  const r = await j(created, `create FCL lot`, [200, 201]);
  if (!r.ok) throw new Error(`create: ${r.text.slice(0, 300)}`);
  legs.push({ bl: `${bl}-A`, shipId: r.json.id, start: A_START, end: A_END, lotIndex: 0 });
  legs.push({ bl: `${bl}-B`, shipId: r.json.id, start: B_START, end: B_END, lotIndex: 1 });
} else {
  // 2 lô LCL riêng
  for (const [i, w] of [[1, A_START, A_END], [2, L2_START, L2_END]].entries()) {
    const bl = `${TAG}-L${w[0]}`;
    const created = await fetch(`${API}/shipments/quick`, {
      method: 'POST', headers: { ...authed(cus), 'Idempotency-Key': `${bl}-c` },
      body: JSON.stringify({ customerId: 1, tradeDirection: 'IMPORT', blNumber: bl, cargoMode: 'LCL', routeId: 106, cargoWeightKg: 6000, customsCutoffAt: w[1], plannedReturnAt: w[2], pickupWarehouseSiteId: 13, expectedDeliveryDate: w[2].slice(0, 10), packageType: 'Pallet', packageCount: 10 }),
    });
    const r = await j(created, `create lot ${w[0]}`, [200, 201]);
    if (!r.ok) throw new Error(`create lot ${w[0]}: ${r.text.slice(0, 300)}`);
    // LCL không tự flip READY (becomesReady là FCL-only) — submit-for-dispatch
    // (không có container nên bỏ qua validate factory/route/port).
    const sub = await j(await fetch(`${API}/shipments/${r.json.id}/submit-for-dispatch`, { method: 'POST', headers: { ...authed(cus), 'Idempotency-Key': `${bl}-sub` }, body: JSON.stringify({ expectedVersion: 1 }) }), `submit-for-dispatch ${bl}`, [200, 201]);
    if (!sub.ok) log(`submit ${bl} không pass (tiếp tục poll): ${sub.text.slice(0, 160)}`);
    legs.push({ bl, shipId: r.json.id, start: w[1], end: w[2], lotIndex: 0 });
  }
}

// 2. Điều vận: plan PATCH (FCL: DOUBLE; LCL: giữ 'LCL') + cùng xe 45
for (const leg of legs) {
  const row = await findPlanRow(leg);
  if (!row) throw new Error(`no plan row for ${leg.bl}`);
  leg.row = row;
  const cls = MODE.startsWith('kep') ? 'DOUBLE' : 'LCL';
  const body = { expectedFulfillmentVersion: row.version, expectedShipmentVersion: row.shipmentVersion, carrierType: 'OWN', truckId: TRUCK_ID, plannedRevenue: null, plannedCarrierCost: null, classification: cls, operationalNotes: null };
  let res = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, { method: 'PATCH', headers: { ...authed(dieuvan), 'Idempotency-Key': `sil704-plan-${row.fulfillmentId}-${Date.now()}` }, body: JSON.stringify(body) });
  let t = await j(res, `plan ${cls} ${leg.bl}`);
  if (t.status === 409 && /RIG_OVERLAP|Vẫn lưu/i.test(t.text)) {
    res = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, { method: 'PATCH', headers: { ...authed(dieuvan), 'Idempotency-Key': `sil704-plan-${row.fulfillmentId}-${Date.now()}-c` }, body: JSON.stringify({ ...body, rigOverlapCompletedConfirmed: true }) });
    t = await j(res, `plan confirmed ${leg.bl}`);
  }
  if (!t.ok && !/đã được gán|no_changes/i.test(t.text)) throw new Error(`plan ${leg.bl}: ${t.text.slice(0, 300)}`);
}

// 3. Phát lệnh cả hai chân
for (const leg of legs) {
  const row = await findPlanRow(leg);
  if (!row) throw new Error(`no plan row (issue) for ${leg.bl}`);
  const body = { fulfillmentId: row.fulfillmentId, expectedVersion: row.version, plannedStartAt: leg.start, plannedEndAt: leg.end, endTimeConfirmed: true, carrierType: 'OWN', truckId: TRUCK_ID, driverId: DRIVER_ID };
  let res = await fetch(`${API}/shipments/${leg.shipId}/dispatch`, { method: 'POST', headers: { ...authed(dieuvan), 'Idempotency-Key': `sil704-issue-${row.fulfillmentId}-${Date.now()}` }, body: JSON.stringify(body) });
  let t = await j(res, `issue ${leg.bl}`);
  if (t.status === 409 && /KEP_WEIGHT|Vượt tải|RIG_OVERLAP|Vẫn lưu/i.test(t.text)) {
    res = await fetch(`${API}/shipments/${leg.shipId}/dispatch`, { method: 'POST', headers: { ...authed(dieuvan), 'Idempotency-Key': `sil704-issue-${row.fulfillmentId}-${Date.now()}-c` }, body: JSON.stringify({ ...body, kepWeightWarningConfirmed: true, rigOverlapCompletedConfirmed: true }) });
    t = await j(res, `issue confirmed ${leg.bl}`);
  }
  if (!t.ok) throw new Error(`issue ${leg.bl}: ${t.text.slice(0, 300)}`);
  leg.fulfillmentId = row.fulfillmentId;
  leg.tripId = t.json.trip.id;
  log(`TRIP ${leg.bl} trip=${leg.tripId} fulfillment=${row.fulfillmentId}`);
}

// 4. kep_paired: ghép KEP pair
if (MODE === 'kep_paired') {
  const tripApi = (id) => fetch(`${API}/trips/${id}`, { headers: authed(dieuvan) }).then((r) => r.json());
  const [tA, tB] = await Promise.all(legs.map((l) => tripApi(l.tripId)));
  const draft = (t) => ({ plannedStartAt: new Date(t.plannedStartAt).toISOString(), plannedEndAt: new Date(t.plannedEndAt).toISOString(), canonicalOrigin: t.canonicalOrigin, canonicalDestination: t.canonicalDestination, cargoWeightKg: Number(t.cargoWeightKg), vehicleCapacityKg: Number(t.vehicleCapacityKg), expectedVersion: t.version });
  const pair = await fetch(`${API}/trips/pairs`, { method: 'POST', headers: { ...authed(dieuvan), 'Idempotency-Key': `sil704-pair-${legs[0].tripId}` }, body: JSON.stringify({ firstTripId: legs[0].tripId, secondTripId: legs[1].tripId, pairKind: 'KEP', firstTrip: draft(tA), secondTrip: draft(tB) }) });
  const pt = await j(pair, 'ghép KEP pair', [200, 201]);
  if (!pt.ok) throw new Error(`pair: ${pt.text.slice(0, 300)}`);
}

// 4b. SIL704_DRIFT=1 — mô phỏng dữ liệu container drift giữa issue và accept
// (row trip_containers biến mất/không type — đúng shape probe đọc "not proven").
if (process.env.SIL704_DRIFT === '1') {
  for (const leg of legs) {
    dbOne(`delete from trip_containers where trip_id = ${leg.tripId};`);
    log(`DRIFT: xóa trip_containers của trip ${leg.tripId}`);
  }
}

// 5. DB proof: trip_containers mỗi chân
for (const leg of legs) {
  const out = dbOne(`select coalesce(tc.container_type_id::text,'NULL'), coalesce(ct.code,'NULL') from trip_containers tc left join container_types ct on ct.id = tc.container_type_id where tc.trip_id = ${leg.tripId};`);
  log(`DB trip_containers ${leg.bl} trip ${leg.tripId}: [${out.split('\n').join(' ; ')}]`);
}

// 6. Lái xe nhận lệnh A rồi B (SIL704_UI=1 → drive UI lái xe thật 390px;
// mặc định: API recordProgress đúng đường FE dùng). UI mode nhận QA_FRONT
// (mặc định 7175 — worktree khác có thể cần port riêng, ví dụ 7196).
const FRONT = process.env.QA_FRONT || 'http://localhost:7175';
const UI = process.env.SIL704_UI === '1';
let browser = null;
let page = null;
if (UI) {
  const puppeteer = (await import('puppeteer')).default;
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, driver);
  log(`UI drive bật — FRONT=${FRONT} (390px, token lái xe)`);
}
const shot = (name) => UI ? page.screenshot({ path: path.join(OUT, `sil704-ui-${TAG}-${name}.png`) }) : Promise.resolve();
const accept = async (leg, tag) => {
  if (!UI) {
    const det = await fetch(`${API}/driver/me/fulfillments/${leg.fulfillmentId}`, { headers: authed(driver) }).then((r) => r.json());
    const ver = det.tripVersion ?? det.trip?.version ?? det.version;
    const res = await fetch(`${API}/driver/me/fulfillments/${leg.fulfillmentId}/progress`, {
      method: 'POST', headers: { ...authed(driver), 'Idempotency-Key': `sil704-accept-${leg.fulfillmentId}-${tag}` },
      body: JSON.stringify({ eventType: 'ORDER_RECEIVED', occurredAt: new Date().toISOString(), expectedVersion: ver }),
    });
    return j(res, `driver accept ${tag} ${leg.bl}`);
  }
  await page.goto(`${FRONT}/my-trips/${leg.tripId}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  await shot(`${tag}-1-detail`);
  let clicked = false;
  for (let i = 0; i < 10 && !clicked; i++) {
    clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, a')).find((b) => /Nhận lệnh vận chuyển/i.test(b.textContent || ''));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!clicked) await sleep(800);
  }
  await sleep(2000);
  await shot(`${tag}-2-after`);
  const bodyText = await page.evaluate(() => document.body.textContent || '');
  const blocked = /Xe đang chạy chuyến/.test(bodyText);
  return { ok: clicked && !blocked, status: blocked ? 409 : 200, text: bodyText.match(/Xe đang chạy chuyến[^\n]{0,80}/)?.[0] ?? `clicked=${clicked}` , json: null };
};
const st = async (leg, tag) => {
  const det = await fetch(`${API}/driver/me/fulfillments/${leg.fulfillmentId}`, { headers: authed(driver) }).then((r) => r.json());
  const status = det.tripStatus ?? det.trip?.status ?? det.status;
  log(`status ${tag}: ${status}`);
  return status;
};

const a = await accept(legs[0], 'A');
check('chân A nhận lệnh OK (201)', a.ok, a.text.slice(0, 160));
check('chân A Đang chạy (IN_TRANSIT)', (await st(legs[0], 'A')) === 'IN_TRANSIT');

const b = await accept(legs[1], 'B');
const blocked = /Xe đang chạy chuyến/.test(b.text);
check(`chân B nhận lệnh KHÔNG 409 "Xe đang chạy chuyến…" (${MODE} — SIL-704)`, b.ok && !blocked, b.text.slice(0, 200));
check('chân B Đang chạy (IN_TRANSIT) — chạy đồng thời chân A', (await st(legs[1], 'B')) === 'IN_TRANSIT');

if (browser) await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures ? 1 : 0);
