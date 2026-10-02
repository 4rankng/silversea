#!/usr/bin/env node
/** Card 20260929_204 — a one-command fixture: a trip the DRIVER portal can actually
 *  open (driver profile + a LIVE fulfillment + departure = today), so driver-side UI
 *  rungs stop being hand-built every wave.
 *
 *  Idempotent: one trip per (day, driver) keyed on the trip code `QADRV-<yyyymmdd>-<username>`;
 *  re-running the same day returns the same trip id. `--purge` removes exactly this
 *  prefix's rows (trips → fulfillments → shipment → customer → cargo type), nothing else.
 *
 *  Usage: DATABASE_URL=postgres://… node scripts/qa-driver-trip-fixture.mjs [username] [--purge]
 */
import { createRequire } from 'node:module';
// `postgres` is a backend dependency; scripts/ has no package of its own, so
// resolve through the backend tree explicitly instead of hoping for hoisting.
const postgres = createRequire(import.meta.url)('../backend/node_modules/postgres');

const args = process.argv.slice(2);
const purge = args.includes('--purge');
const username = args.find((a) => !a.startsWith('--')) ?? 'pho';
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const sql = postgres(url, { max: 1 });

const today = new Date();
const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
const tripCode = `QADRV-${ymd}-${username}`.slice(0, 50);
const shpCode = `QADRV-SHP-${username}`.slice(0, 50);

// The name carries the prefix too: the partial unique index on ACTIVE (name, tax_code)
// makes bare re-runs collide unless the row is found-or-created by the same name.
const CUSTOMER_NAME = `QADRV customer ${username}`;
const CARGO_NAME = `QADRV cargo ${username}`;
const ROUTE_NAME = `QADRV route ${username}`;

async function purgeAll() {
  // Purge scope = THIS driver's prefix only: QADRV-% never crosses drivers.
  const rows = await sql`
    SELECT t.id FROM trips t WHERE t.trip_code = ${tripCode}`;
  for (const { id } of rows) {
    await sql`DELETE FROM trip_financial_state WHERE trip_id = ${id}`;
    await sql`DELETE FROM driver_incidental_costs WHERE trip_id = ${id}`;
    await sql`DELETE FROM trips WHERE id = ${id}`;
  }
  await sql`DELETE FROM shipment_fulfillments WHERE shipment_id IN (SELECT id FROM shipments WHERE shipment_code = ${shpCode})`;
  await sql`DELETE FROM shipments WHERE shipment_code = ${shpCode}`;
  await sql`DELETE FROM customers WHERE name = ${CUSTOMER_NAME}`;
  await sql`DELETE FROM cargo_types WHERE name = ${CARGO_NAME}`;
  await sql`DELETE FROM routes WHERE name = ${ROUTE_NAME}`;
  console.log(`[qa-driver-trip-fixture] purged ${rows.length} QADRV trip(s) + their fixture rows`);
}

async function main() {
  const [driver] = await sql`
    SELECT d.id AS driver_id, u.id AS user_id
    FROM users u JOIN drivers d ON d.user_id = u.id
    WHERE u.username = ${username} LIMIT 1`;
  if (!driver) {
    console.error(`no drivers row for user '${username}' (trips point at DRIVERS, not users)`);
    process.exit(1);
  }

  const [existing] = await sql`
    SELECT id, trip_code AS code FROM trips WHERE trip_code = ${tripCode} AND deleted_at IS NULL LIMIT 1`;
  if (existing && !purge) {
    console.log(`[qa-driver-trip-fixture] trip already exists (idempotent): id=${existing.id} code=${existing.code}`);
    console.log(`http://localhost:7175/my-trips/${existing.id}`);
    await sql.end();
    return;
  }

  const [cargoType] = await sql`
    INSERT INTO cargo_types (name) VALUES (${CARGO_NAME})
    ON CONFLICT DO NOTHING
    RETURNING id`;
  const cargoTypeId = cargoType?.id ?? (await sql`SELECT id FROM cargo_types WHERE name = ${CARGO_NAME} LIMIT 1`)[0].id;
  const [route] = await sql`
    INSERT INTO routes (name) VALUES (${ROUTE_NAME})
    ON CONFLICT DO NOTHING
    RETURNING id`;
  const routeId = route?.id ?? (await sql`SELECT id FROM routes WHERE name = ${ROUTE_NAME} LIMIT 1`)[0].id;
  const [customer] = await sql`
    INSERT INTO customers (name) VALUES (${CUSTOMER_NAME})
    ON CONFLICT DO NOTHING
    RETURNING id`;
  const customerId = customer?.id ?? (await sql`SELECT id FROM customers WHERE name = ${CUSTOMER_NAME} LIMIT 1`)[0].id;

  let [shipment] = await sql`
    SELECT id, cargo_type_id FROM shipments WHERE shipment_code = ${shpCode} AND deleted_at IS NULL LIMIT 1`;
  if (!shipment) {
    [shipment] = await sql`
      INSERT INTO shipments (shipment_code, customer_id, route_id, cargo_type_id, cargo_mode, status)
      VALUES (${shpCode}, ${customerId}, ${routeId}, ${cargoTypeId}, 'FCL', 'DISPATCHED')
      RETURNING id, cargo_type_id`;
  }

  // A live trip claims its fulfillment one-to-one (trips_fulfillment_id_live_uniq),
  // so every new day needs a fresh fulfillment row for the fixture shipment.
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [fulfillment] = await sql`
    INSERT INTO shipment_fulfillments (shipment_id, fulfillment_type, cargo_mode, source_shipment_version)
    VALUES (${shipment.id}, 'FCL_CONTAINER', 'FCL', 1)
    RETURNING id`;

  const [trip] = await sql`
    INSERT INTO trips (trip_code, driver_id, shipment_id, customer_id, route_id, cargo_type_id,
                       fulfillment_id, status, departure_date)
    VALUES (${tripCode}, ${driver.driver_id}, ${shipment.id}, ${customerId}, ${routeId}, ${shipment.cargo_type_id},
            ${fulfillment.id}, 'IN_TRANSIT', ${todayISO})
    RETURNING id`;

  console.log(`[qa-driver-trip-fixture] created trip id=${trip.id} code=${tripCode} driver=${username} fulfillment=${fulfillment.id}`);
  console.log(`http://localhost:7175/my-trips/${trip.id}`);
  await sql.end();
}

if (purge) {
  await purgeAll();
  await sql.end();
} else {
  await main();
}
