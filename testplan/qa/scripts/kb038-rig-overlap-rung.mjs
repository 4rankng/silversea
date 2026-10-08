// Card 061026172804 (FB-038) — API rung: the plan-save endpoint refuses once
// with 409 payload code RIG_OVERLAP_COMPLETED when the rig's window overlaps a
// COMPLETED trip, and the confirmed retry (rigOverlapCompletedConfirmed) saves.
// Fixtures are self-named (kb038 marker) and purged in the finally block.
import { createRequire } from 'node:module';
const require = createRequire('/Volumes/LexarSSD/projects/silversea-prod/backend/index.ts');
const postgres = require('postgres');
const sql = postgres({ host: 'localhost', port: 5441, database: 'silversea', user: 'postgres', password: 'postgres', max: 1 });
const q = (strings, ...vars) => sql(strings, ...vars);

const API = 'http://localhost:3002/api';
const DB = { host: 'localhost', port: 5441, database: 'silversea', user: 'postgres', password: 'postgres' };
const L = [];
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; L.push(e); console.log(JSON.stringify(e)); };


const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token) });
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

const suffix = `kb038-${Date.now()}`;
const ids = {};
try {
  const q = async (query, vars = []) => await sql.unsafe(query, vars);
  const [admin] = await q("SELECT id FROM users WHERE role='ADMIN' ORDER BY id LIMIT 1");
  const [customer] = await q("INSERT INTO customers (name, created_at, updated_at) VALUES ($1, now(), now()) RETURNING id", [`KB038 KH ${suffix}`]);
  const [route] = await q("INSERT INTO routes (name, created_at, updated_at) VALUES ($1, now(), now()) RETURNING id", [`KB038 tuyen ${suffix}`]);
  const [site] = await q("INSERT INTO operational_sites (customer_id, code, name, site_type, address, created_at, updated_at) VALUES ($1,$2,$3,'FACTORY','KB038', now(), now()) RETURNING id", [customer.id, `KB038-${suffix}`, `KB038 NM ${suffix}`]);
  const [ctype] = await q("INSERT INTO container_types (code, name) VALUES ($1,$2) RETURNING id", [`K38${suffix.slice(-7)}`.slice(0, 20), 'KB038 type']);
  const t0 = '2026-10-05T08:00:00Z';
  const [shipment] = await q("INSERT INTO shipments (customer_id, route_id, cargo_mode, shipment_code, status, closing_at, created_by, created_at, updated_at) VALUES ($1,$2,'FCL',$3,'READY_FOR_DISPATCH',$4,$5, now(), now()) RETURNING id", [customer.id, route.id, `KB038-${suffix}`, t0, admin.id]);
  const [container] = await q("INSERT INTO shipment_containers (shipment_id, route_id, operational_site_id, container_type_id, container_number, customer_appointment_at, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now()) RETURNING id", [shipment.id, route.id, site.id, ctype.id, `K38${suffix.slice(-6)}`.toUpperCase(), t0, admin.id]);
  const [ff] = await q("INSERT INTO shipment_fulfillments (shipment_id, fulfillment_type, cargo_mode, shipment_container_id, source_shipment_version, created_by, created_at, updated_at) VALUES ($1,'FCL_CONTAINER','FCL',$2,1,$3, now(), now()) RETURNING id, version", [shipment.id, container.id, admin.id]);
  const [truck] = await q("INSERT INTO trucks (license_plate, status, created_at, updated_at) VALUES ($1,'ACTIVE', now(), now()) RETURNING id, license_plate", [`K38-${suffix.slice(-5)}`.toUpperCase()]);
  const [trip] = await q("INSERT INTO trips (trip_code, customer_id, route_id, departure_date, truck_id, planned_start_at, planned_end_at, status, created_by, created_at, updated_at) VALUES ($1,$2,$3,'2026-10-05',$4,$5,$6,'COMPLETED',$7, now(), now()) RETURNING id, trip_code", [`TRP-${suffix}`, customer.id, route.id, truck.id, '2026-10-05T07:00:00Z', '2026-10-05T11:00:00Z', admin.id]);
  Object.assign(ids, { customer: customer.id, route: route.id, site: site.id, ctype: ctype.id, shipment: shipment.id, container: container.id, ff: ff.id, truck: truck.id, trip: trip.id });
  step('fixture', { fulfillmentId: ff.id, plate: truck.license_plate, completedTrip: trip.trip_code });

  const save = async (body) => {
    const res = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${ff.id}/plan`, {
      method: 'PATCH',
      headers: { ...auth, 'Idempotency-Key': `kb038-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const baseBody = {
    expectedFulfillmentVersion: ff.version,
    expectedShipmentVersion: 1,
    carrierType: 'OWN',
    truckId: truck.id,
    plannedRevenue: null,
    plannedCarrierCost: null,
    plannedEndAt: '2026-10-05T10:00:00.000Z',
  };

  // QA-rework scenario (staging cut 2087fe5b): the completed trip RIDES its
  // own fulfillment row wearing the same plate — at HEAD the generic plan-row
  // block masked the completed tier. A second lot's fulfillment wears the
  // plate and carries the completed trip; the save must reach the warning.
  const [shipment2] = await q("INSERT INTO shipments (customer_id, route_id, cargo_mode, shipment_code, status, closing_at, created_by, created_at, updated_at) VALUES ($1,$2,'FCL',$3,'READY_FOR_DISPATCH',$4,$5, now(), now()) RETURNING id", [customer.id, route.id, `KB038B-${suffix}`, t0, admin.id]);
  const [container2] = await q("INSERT INTO shipment_containers (shipment_id, route_id, operational_site_id, container_type_id, container_number, customer_appointment_at, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now()) RETURNING id", [shipment2.id, route.id, site.id, ctype.id, `K38B${suffix.slice(-6)}`.toUpperCase(), t0, admin.id]);
  const [ff2] = await q("INSERT INTO shipment_fulfillments (shipment_id, fulfillment_type, cargo_mode, shipment_container_id, source_shipment_version, planned_vehicle_plate_number, created_by, created_at, updated_at) VALUES ($1,'FCL_CONTAINER','FCL',$2,1,$3,$4, now(), now()) RETURNING id, version", [shipment2.id, container2.id, truck.license_plate, admin.id]);
  const [trip2] = await q("INSERT INTO trips (trip_code, customer_id, route_id, departure_date, truck_id, fulfillment_id, planned_start_at, planned_end_at, status, created_by, created_at, updated_at) VALUES ($1,$2,$3,'2026-10-05',$4,$5,$6,$7,'COMPLETED',$8, now(), now()) RETURNING id", [`TRP-kb038b-${Date.now()}`, customer.id, route.id, truck.id, ff2.id, '2026-10-05T07:00:00Z', '2026-10-05T11:00:00Z', admin.id]);
  ids.ff2 = ff2.id; ids.trip2 = trip2.id; ids.container2 = container2.id; ids.shipment2 = shipment2.id;
  step('fixture-masked', { maskedFulfillment: ff2.id, maskedTrip: trip2.id });

  const first = await save(baseBody);
  step('first-save', { status: first.status, code: first.body?.code, error: first.body?.error, details: first.body?.details });
  if (first.status !== 409 || first.body?.code !== 'RIG_OVERLAP_COMPLETED') throw new Error('expected the 409 RIG_OVERLAP_COMPLETED warning');

  const second = await save({ ...baseBody, rigOverlapCompletedConfirmed: true });
  step('confirmed-save', { status: second.status, error: second.body?.error });
  if (second.status !== 200) throw new Error('confirmed save failed: ' + JSON.stringify(second.body));
  const [row] = await q('SELECT planned_vehicle_plate_number FROM shipment_fulfillments WHERE id = $1', [ff.id]);
  step('persisted', { plate: row.planned_vehicle_plate_number });
  if (row.planned_vehicle_plate_number !== truck.license_plate) throw new Error('plate not persisted');
  step('verdict', { result: 'PASS — warn once, confirmed retry saves (REQ-04)' });
} finally {
  // Purge fixtures (child tables first).
  try {
    await sql.unsafe('DELETE FROM trips WHERE id = $1', [ids.trip2]);
    await sql.unsafe('DELETE FROM trips WHERE id = $1', [ids.trip]);
    await sql.unsafe('DELETE FROM shipment_fulfillments WHERE id = $1', [ids.ff2]);
    await sql.unsafe('DELETE FROM shipment_fulfillments WHERE id = $1', [ids.ff]);
    await sql.unsafe('DELETE FROM shipment_containers WHERE id = $1', [ids.container2]);
    await sql.unsafe('DELETE FROM shipments WHERE id = $1', [ids.shipment2]);
    await sql.unsafe('DELETE FROM shipment_containers WHERE id = $1', [ids.container]);
    await sql.unsafe('DELETE FROM shipments WHERE id = $1', [ids.shipment]);
    await sql.unsafe('DELETE FROM trucks WHERE id = $1', [ids.truck]);
    await sql.unsafe('DELETE FROM shipment_containers WHERE id = $1', [ids.container]);
    await sql.unsafe('DELETE FROM shipments WHERE id = $1', [ids.shipment]);
    await sql.unsafe('DELETE FROM container_types WHERE id = $1', [ids.ctype]);
    await sql.unsafe('DELETE FROM operational_sites WHERE id = $1', [ids.site]);
    await sql.unsafe('DELETE FROM routes WHERE id = $1', [ids.route]);
    await sql.unsafe('DELETE FROM customers WHERE id = $1', [ids.customer]);
    step('cleanup', { purged: true });
  } catch (e) { step('cleanup-error', { message: String(e) }); }
  await sql.end();
}
