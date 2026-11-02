// SIL-644 companion probe: the FIRST issue of a weightless container lot is
// loudly refused (409 "Thiếu trọng tải") and leaves no trip row — the
// designed backstop that makes the assignment window the right place to
// enter the weight. Fresh lot: SHP-2610-00149 / MSKU1234565 (dev DB).
import { execSync } from 'node:child_process';
const db = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -tAc "${sql}"`, { encoding: 'utf8' }).trim();
const base = process.env.BE_URL || 'http://localhost:3102';
const token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }) })).json()).token;
const fulfillmentId = Number(db(`SELECT id FROM shipment_fulfillments WHERE shipment_container_id=272 AND canceled_at IS NULL ORDER BY id DESC LIMIT 1`));
const version = Number(db(`SELECT version FROM shipment_fulfillments WHERE id=${fulfillmentId}`));
const drivers = db(`SELECT id FROM drivers WHERE deleted_at IS NULL ORDER BY id LIMIT 10`).split('\n').map(Number).filter(Number.isFinite);
const trucks = db(`SELECT DISTINCT truck_id FROM truck_driver_assignments WHERE ends_at IS NULL OR ends_at > now() ORDER BY truck_id LIMIT 20`).split('\n').map(Number).filter(Number.isFinite);
const start = new Date(Date.now() + 3 * 86400000);
start.setUTCHours(1, 0, 0, 0);
let outcome = null;
outer:
for (const driverId of drivers) {
for (const truckId of trucks) {
  const r = await fetch(`${base}/api/shipments/228/dispatch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ fulfillmentId, expectedVersion: version, plannedStartAt: start.toISOString(), plannedEndAt: new Date(start.getTime() + 21600000).toISOString(), endTimeConfirmed: true, carrierType: 'OWN', truckId, driverId }),
  });
  const text = await r.text();
  console.log(`driver ${driverId} truck ${truckId} → ${r.status} ${text.slice(0, 160)}`);
  if (r.status !== 409 || !/trùng|được gán/.test(text)) { outcome = { status: r.status, text }; break outer; }
}
}

const liveTrips = db(`SELECT count(*) FROM trips WHERE fulfillment_id=${fulfillmentId} AND deleted_at IS NULL AND status <> 'CANCELED'`);
console.log(`liveTrips after probe: ${liveTrips}`);
const pass = outcome && outcome.status === 409 && /Thiếu trọng tải/.test(outcome.text) && liveTrips === '0';
console.log(`C0-BACKSTOP ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
