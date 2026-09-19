// The trips→routes disposition (20260919203000_shipment_children_fks.sql):
// a trip whose assigned route no longer exists keeps its row and loses only
// the dead stamp — route_id is nulled, not the row — and trips_route_id_fkey
// lands VALIDATED. The pin runs the file's own statements against a
// throwaway DB seeded with a schema-only dump of the dev database, with this
// one constraint dropped first to recreate the pre-migration state (the dev
// schema already carries the migrated constraint).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP_DB = `trips_route_pin_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;

let sql: postgres.Sql;

before(async () => {
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`CREATE DATABASE ${TMP_DB}`);
  await admin.end();
  const dump = spawnSync('docker', ['exec', 'ss-prod-db', 'pg_dump', '-U', 'postgres', '-d', 'silversea', '--schema-only'], {
    encoding: 'utf8', timeout: 120000,
  });
  assert.equal(dump.status, 0, 'schema dump must succeed (local docker required)');
  const restore = spawnSync('docker', ['exec', '-i', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', TMP_DB, '-q'], {
    input: dump.stdout, encoding: 'utf8', timeout: 180000,
  });
  assert.equal(restore.status, 0, 'schema restore must succeed');
  sql = postgres(TMP_URL);
  // Recreate the pre-migration state for the constraint under test: the
  // dump already carries the migrated constraint, so drop it and let the
  // file's own ADD rebuild it.
  await sql`alter table trips drop constraint if exists trips_route_id_fkey`;
  // Fixtures: one live assignment, one dangling one.
  const [customer] = await sql`insert into customers (name) values ('trips-route-pin') returning id`;
  const [route] = await sql`insert into routes (name) values ('trips-route-pin-live') returning id`;
  await sql`insert into trips (customer_id, departure_date, route_id) values (${customer.id}, current_date, ${route.id})`;
  await sql`insert into trips (customer_id, departure_date, route_id) values (${customer.id}, current_date, 2147483000)`;

  // The file's own statements for this disposition, in file order.
  const content = readFileSync(path.join(backendRoot, 'drizzle/20260919203000_shipment_children_fks.sql'), 'utf8');
  const statements = content.split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
  const cleanup = statements.filter((s) => /\btrips\b/.test(s) && /route_id/.test(s) && /NOT EXISTS/.test(s));
  assert.equal(cleanup.length, 1, 'exactly one trips route_id cleanup statement expected');
  const add = statements.filter((s) => s.startsWith('ALTER TABLE trips ADD CONSTRAINT trips_route_id_fkey'));
  const validate = statements.filter((s) => s.startsWith('ALTER TABLE trips VALIDATE CONSTRAINT trips_route_id_fkey'));
  assert.equal(add.length, 1, 'constraint add statement expected');
  assert.equal(validate.length, 1, 'constraint validate statement expected');
  for (const stmt of [...cleanup, ...add, ...validate]) await sql.unsafe(stmt);
});

after(async () => {
  if (sql) await sql.end();
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

describe('trips route disposition', () => {
  test('a dangling route stamp is nulled, the trip survives, and the constraint validates', async () => {
    const [counts] = await sql`
      select
        (select count(*)::int from trips) as "tripTotal",
        (select count(*)::int from trips where route_id is null) as "nulledCount",
        (select count(*)::int from trips t left join routes r on t.route_id = r.id where t.route_id is not null and r.id is null) as "danglingCount",
        (select convalidated from pg_constraint where conname = 'trips_route_id_fkey') as "validated"`;
    assert.equal(counts.tripTotal, 2, 'both trips survive the disposition');
    assert.equal(counts.nulledCount, 1, 'exactly the dangling stamp is nulled');
    assert.equal(counts.danglingCount, 0, 'no dangling route_id remains');
    assert.equal(counts.validated, true, 'trips_route_id_fkey must be VALIDATED');
  });
});
