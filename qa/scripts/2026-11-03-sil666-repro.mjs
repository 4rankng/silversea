// SIL-666 (id 762) — QA 03/11 repro driver (PHASE=before/after evidence).
// LOCAL dev only — BE :3013 of this worktree + ss-prod-db (psql read-only via
// docker exec). Probe family BK-S666-*; housekeeping cancels ONLY its own.
//
//   S666_LOG=before.log node qa/scripts/2026-11-03-sil666-repro.mjs   (pre-fix)
//   S666_LOG=after.log  node qa/scripts/2026-11-03-sil666-repro.mjs   (post-fix)
//
// Phase A — the ticket's primary repro: a brand-new SINGLE 20DC lot on
// 2026-12-10 08:00 assigned to 15H-061.14 must NOT 409 with the TC2
// classification message (no lot shares that day; the truck must have no
// hidden claim). Control: the same-day twin saves on 15H-104.03.
//
// Phase B — the follow-up AC: a real conflict (the truck's own fulfillment-less
// BULK-TR task) must produce a busy message that NAMES the conflicting
// lot/task — never an empty string after the ':' ("…khung giờ trùng lặp:.").
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = process.env.S666_API ?? 'http://localhost:3013/api';
const OUT = path.resolve('qa/2026-11-03-sil666');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, process.env.S666_LOG ?? 'before.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

function psql(query) {
  return execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-At', '-c', query], { encoding: 'utf8' }).trim();
}
const shipVersion = (id) => Number(psql(`SELECT version FROM shipments WHERE id = ${id}`)) || 1;
const ffVersion = (id) => Number(psql(`SELECT version FROM shipment_fulfillments WHERE id = ${id}`)) || 1;

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (res.status !== 200) throw new Error(`login ${identifier} -> ${res.status}`);
  const body = await res.json();
  return body.token ?? body.accessToken;
}
const send = async (token, apiPath, method = 'GET', payload, extraHeaders = {}) => {
  const res = await fetch(`${API}${apiPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
      ...(payload ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      ...extraHeaders,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};

const check10 = (prefix10) => {
  const MAP = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 18, H: 19, I: 20, J: 21, K: 22, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
  let sum = 0; const POW = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
  [...prefix10].forEach((ch, i) => { sum += (/\d/.test(ch) ? Number(ch) : MAP[ch]) * POW[i]; });
  return `${prefix10}${sum % 11 === 10 ? 0 : sum % 11}`;
};

let serial = (Date.now() % 100000) + 7000;

async function makeLot(tag, { appointment, day }) {
  const bl = `BK-S666-${tag}-${Date.now()}`;
  const created = await send(admin, '/shipments', 'POST', {
    customerId: customer.id, tradeDirection: 'IMPORT', cargoMode: 'FCL',
    blNumber: bl, expectedDeliveryDate: day, cargoWeightKg: 12000,
  });
  if (created.status !== 201) throw new Error(`lot ${tag} create -> ${created.status}`);
  const shipmentId = created.body?.shipment?.id ?? created.body?.id;
  const cur = await send(admin, `/shipments/${shipmentId}`);
  const curVersion = cur.body?.version ?? cur.body?.shipment?.version ?? 0;
  const conts = await send(admin, `/shipments/${shipmentId}/containers`, 'PUT', {
    expectedVersion: curVersion,
    containers: [{
      containerNumber: check10(`TSTU${String(serial).padStart(6, '0')}`),
      containerTypeId: type20.id, routeId: route.id, operationalSiteId: site?.id,
      pickupPortId: (ports[0] ?? ports[1]).id, dropoffPortId: (ports[1] ?? ports[0]).id,
      cargoWeightKg: 5000,
      ...(appointment ? { customerAppointmentAt: appointment } : {}),
    }],
  });
  serial += 3;
  if (!(conts.status === 200 || conts.status === 201)) throw new Error(`lot ${tag} containers -> ${conts.status}`);
  const after = await send(admin, `/shipments/${shipmentId}`);
  await send(admin, `/shipments/${shipmentId}/submit-for-dispatch`, 'POST', { expectedVersion: after.body?.version ?? after.body?.shipment?.version ?? curVersion });
  const rows = await send(dispatch, `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(bl)}&limit=50`);
  const unissued = (rows.body?.items ?? []).filter((r) => r.dispatch?.tripId == null && r.dispatch?.carrierType !== 'EXTERNAL');
  return { bl, shipmentId, row: unissued[0] };
}

const planSave = (lot, extra = {}) => send(dispatch, `/shipments/dispatch-detail-plan-rows/${lot.row.fulfillmentId}/plan`, 'PATCH', {
  expectedFulfillmentVersion: ffVersion(lot.row.fulfillmentId),
  expectedShipmentVersion: shipVersion(lot.shipmentId),
  carrierType: 'OWN', classification: 'SINGLE', plannedRevenue: 0, plannedCarrierCost: 0,
  ...extra,
});

let admin, dispatch, customer, route, type20, ports, site;
const TRUCK_61 = { id: 39, plate: '15H-061.14' };
const TRUCK_104 = { id: 37, plate: '15H-104.03' };

(async () => {
  admin = await login('admin');
  dispatch = await login('dieuvan');
  log(`logged in admin + dieuvan; BE=${API}`);

  // Housekeeping — clear ONLY this probe family's leftovers (BK-S666-*):
  // cancel its live trips AND release its plan-row plates. Never touches any
  // other lane's or business data.
  const stale = psql(`SELECT t.id, t.version FROM trips t
    JOIN shipment_fulfillments sf ON sf.id = t.fulfillment_id
    JOIN shipments sh ON sh.id = sf.shipment_id
    WHERE sh.bl_number LIKE 'BK-S666-%' AND t.deleted_at IS NULL
      AND t.status IN ('CREATED','IN_TRANSIT') ORDER BY t.id`).split('\n').filter(Boolean);
  for (const entry of stale) {
    const [tripId, version] = entry.split('|').map(Number);
    const cancel = await send(admin, `/trips/${tripId}/cancel`, 'POST', { expectedVersion: version, reason: 'SIL-666 housekeeping' });
    log(`housekeeping: cancel trip ${tripId} → ${cancel.status}`);
  }
  const releasedPlates = psql(`UPDATE shipment_fulfillments sf
    SET planned_vehicle_plate_number = NULL
    FROM shipments sh
    WHERE sh.id = sf.shipment_id AND sh.bl_number LIKE 'BK-S666-%'
      AND sf.planned_vehicle_plate_number IS NOT NULL
    RETURNING sf.id`).split('\n').filter(Boolean).length;
  log(`housekeeping: released ${releasedPlates} family plan-row plate(s)`);

  const [routesRes, ctypesRes, portsRes, customersRes] = await Promise.all([
    send(admin, '/routes?limit=50'),
    send(admin, '/container-types?limit=50'),
    send(admin, '/ports?limit=50'),
    send(admin, '/customers?limit=100'),
  ]);
  route = (routesRes.body?.items ?? []).find((r) => /KCN|TUYẾN|M57|HN|HCM/i.test(`${r.code ?? ''} ${r.name ?? ''}`)) ?? routesRes.body?.items?.[0];
  type20 = (ctypesRes.body?.items ?? []).find((t) => /^20/.test(t.code ?? ''));
  ports = portsRes.body?.items ?? [];
  customer = (customersRes.body?.items ?? []).find((c) => c.status === 'ACTIVE' && !c.isCarrier);
  let siteRes = await send(admin, `/shipments/operational-sites?customerId=${customer.id}`);
  site = (siteRes.body?.items ?? []).filter((x) => x.siteType === 'FACTORY' && (x.routeId == null || x.routeId === route.id)).at(-1);
  log(`refs: truck61=${TRUCK_61.plate} truck104=${TRUCK_104.plate} type20=${type20?.code}`);

  // ── PHASE A — the ticket's primary repro (SIL-666 claim): brand-new SINGLE
  // 20DC lot, 10/12/2026 08:00, assigned to 15H-061.14. No lot shares that
  // day; the truck's visible holders (Oct plan rows, June–Aug BULK trips)
  // cannot reach this window. Expect a clean save — NO 409, NO TC2 message.
  const dayA = '2026-12-10';
  const atA = (h) => new Date(`${dayA}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();
  {
    const lot61 = await makeLot('A61', { appointment: atA(8), day: dayA });
    const save61 = await planSave(lot61, { truckId: TRUCK_61.id });
    log(`A assign SINGLE 10/12 08:00 → 15H-061.14 → ${save61.status} ${save61.status >= 400 ? JSON.stringify(save61.body).slice(0, 240) : ''}`);
    check('A (SIL-666 chính): lô SINGLE mới + 15H-061.14 KHÔNG còn 409 "Cần cả 2 cont cùng khai báo KẸP"',
      save61.status === 200, `status=${save61.status} body=${JSON.stringify(save61.body).slice(0, 200)}`);

    const lot104 = await makeLot('A104', { appointment: atA(8), day: dayA });
    const save104 = await planSave(lot104, { truckId: TRUCK_104.id });
    log(`A control SINGLE 10/12 08:00 → 15H-104.03 → ${save104.status} ${save104.status >= 400 ? JSON.stringify(save104.body).slice(0, 240) : ''}`);
    check('A (đối chứng): cùng ngày + 15H-104.03 vẫn lưu OK', save104.status === 200, `status=${save104.status}`);
  }

  // ── PHASE B — the follow-up AC: a REAL conflict must be NAMED in the busy
  // message. Truck 39's own fulfillment-less task BULK-TR-0180 (CREATED,
  // 26/08→02/09/2026) claims the rig; a plan-row save inside that window must
  // refuse AND name the conflicting task — never render "…trùng lặp:.".
  {
    const dayB = '2026-08-28';
    const atB = (h) => new Date(`${dayB}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();
    const bulk = psql(`SELECT id || '|' || trip_code || '|' || status || '|' || coalesce(planned_start_at::text,'') || '|' || coalesce(planned_end_at::text,'')
      FROM trips WHERE truck_id = ${TRUCK_61.id} AND deleted_at IS NULL AND status = 'CREATED'
        AND fulfillment_id IS NULL
        AND planned_start_at < '${dayB}T23:59:00+07:00'::timestamptz
        AND coalesce(planned_end_at, planned_start_at + interval '8 hours') > '${dayB}T00:00:00+07:00'::timestamptz
      ORDER BY id LIMIT 1`);
    log(`B conflicting task on ${TRUCK_61.plate}: ${bulk || '(none)'}`);
    const [bulkId, bulkCode, bulkStatus] = (bulk || '||').split('|');

    const lotB = await makeLot('B61', { appointment: atB(8), day: dayB });
    const saveB = await planSave(lotB, { truckId: TRUCK_61.id });
    const msg = typeof saveB.body?.error === 'string' ? saveB.body.error : JSON.stringify(saveB.body);
    log(`B assign SINGLE 28/08 08:00 → 15H-061.14 (xung đột ${bulkCode} ${bulkStatus}) → ${saveB.status}`);
    log(`B message: ${msg}`);
    check('B (xung đột thật): 409 hard tier vẫn chặn (không lưu im lặng)',
      saveB.status === 409 && !String(msg).includes('Vẫn lưu?'), `status=${saveB.status}`);
    const colonPart = String(msg).split('khung giờ trùng lặp:')[1] ?? '';
    const namedRef = colonPart.trim().length > 1; // more than just the trailing '.'
    check('B (AC bổ sung): message NÊU RÕ lô/tác vụ xung đột — không để chuỗi rỗng sau dấu ":"',
      namedRef && /(Lô |Lệnh )/.test(colonPart), `colonPart="${colonPart.trim()}"`);
  }

  log(failures === 0 ? 'SIL-666 REPRO COMPLETE — all expectations hold' : `SIL-666 REPRO COMPLETE — ${failures} expectation(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { log(`REPRO CRASHED: ${err.message}`); process.exit(2); });
