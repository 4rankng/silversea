// The 22 trip-child tables carry a live FK to trips with the per-table
// policy fixed in 20260919173000_trip_children_trip_fks.sql: CASCADE for
// pure trip payload, RESTRICT for issued-money backstops, SET NULL for
// nullable detach-and-survive rows. Pins run against a THROWAWAY database
// that replays the full migration chain — a fresh-DB replay plus the
// behavioral pins, without touching the shared dev DB.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP_DB = `trip_fk_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;

const CASCADE = ['trip_legs','trip_photos','trip_containers','trip_carrier_info','trip_financial_state','trip_expenses','trip_expense_completion_scopes','trip_pod_submissions','delivery_attempts','driver_incidental_costs','driver_progress_events','fuel_evidence_reviews','fuel_invoice_allocations','profitability_snapshots'];
const RESTRICT = ['billing_document_trip_claims','trip_financial_postings'];
const SET_NULL = ['freight_rate_snapshots','ancillary_revenue','penalties','shipment_milestones','expense_accounting_sources','driver_work_days'];

let sql: postgres.Sql;

async function mkTripChain(tag: string): Promise<number> {
  const [customer] = await sql`insert into customers (name) values (${'fktest ' + tag}) returning id`;
  const [route] = await sql`insert into routes (name) values (${'fktest route ' + tag}) returning id`;
  const [shipment] = await sql`insert into shipments (customer_id, cargo_mode, shipment_code, booking_ref, status, trade_direction, created_by)
    values (${customer.id}, 'FCL', ${'FKT-' + tag}, ${'BOOK-FKT-' + tag}, 'READY_FOR_DISPATCH', 'EXPORT', 0) returning id`;
  const [fulfillment] = await sql`insert into shipment_fulfillments (shipment_id, fulfillment_type, cargo_mode, source_shipment_version) values (${shipment.id}, 'FCL_CONTAINER', 'FCL', 1) returning id`;
  const [trip] = await sql`insert into trips (fulfillment_id, shipment_id, customer_id, route_id, departure_date)
    values (${fulfillment.id}, ${shipment.id}, ${customer.id}, ${route.id}, '2026-01-01') returning id`;
  return trip.id;
}

before(async () => {
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`CREATE DATABASE ${TMP_DB}`);
  await admin.end();
  const migrate = spawnSync('npx', ['drizzle-kit', 'migrate'], {
    cwd: backendRoot, encoding: 'utf8', timeout: 300000,
    env: { ...process.env, TZ: 'UTC', DATABASE_URL: TMP_URL },
  });
  assert.equal(migrate.status, 0, `fresh replay must pass: ${migrate.stderr}`);
  sql = postgres(TMP_URL);
});

after(async () => {
  if (sql) { await sql.end(); }
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

describe('trip children foreign keys', () => {
  test('completeness pin: all 22 constraints live with the approved policies', async () => {
    const rows = await sql`
      select tc.table_name, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and rc.delete_rule in ('CASCADE','RESTRICT','SET NULL')
        and tc.table_name in ${sql(CASCADE.concat(RESTRICT, SET_NULL))}
      group by tc.table_name, rc.delete_rule`;
    const got = new Map(rows.map((r) => [r.table_name, r.delete_rule]));
    for (const t of CASCADE) assert.equal(got.get(t), 'CASCADE', `${t} must CASCADE`);
    for (const t of RESTRICT) assert.equal(got.get(t), 'RESTRICT', `${t} must RESTRICT`);
    for (const t of SET_NULL) assert.equal(got.get(t), 'SET NULL', `${t} must SET NULL`);
    assert.equal(got.size, 22, `expected 22 FK'd tables, saw ${got.size}`);
  });

  test('insert with a dead trip_id is rejected by the FK (23503)', async () => {
    await assert.rejects(
      sql`insert into trip_expenses (trip_id, expense_type, buy_amount) values (999999999, 'OTHER', 1000)`,
      (err: { code?: string }) => err.code === '23503',
      'orphan trip_expense insert must violate the FK',
    );
  });
});

describe('trip child behavior under delete', () => {
  test('deleting a trip cascades payload children and detaches nullable ones', async () => {
    const tripId = await mkTripChain('cascade');
    await sql`insert into trip_expenses (trip_id, expense_type, buy_amount) values (${tripId}, 'OTHER', 123000)`;
    const [milestone] = await sql`insert into shipment_milestones (trip_id, shipment_id, type, occurred_at) select ${tripId}, s.id, 'ARRIVED', now() from shipments s where s.booking_ref = ${'BOOK-FKT-cascade'} returning id`;
    const before = await sql`select count(*)::int as n from trip_expenses where trip_id = ${tripId}`;
    assert.ok(before[0].n >= 1, 'expense inserted');

    await sql`delete from trips where id = ${tripId}`;
    assert.equal(await alive(tripId), 0, 'CASCADE child must die with the trip');

    if (milestone?.id) {
      const [row] = await sql`select trip_id from shipment_milestones where id = ${milestone.id}`;
      assert.ok(row, 'SET NULL child survives');
      assert.equal(row.trip_id, null, 'SET NULL child detaches');
    }
  });

  test('RESTRICT blocks a trip delete that would strand financial postings', async () => {
    const tripId = await mkTripChain('restrict');
    await sql`insert into trip_financial_postings (trip_id, version, trip_version, reason, effective_at)
      values (${tripId}, 1, 1, 'FK-PIN', now())`;
    const attempt = await sql`delete from trips where id = ${tripId}`.then(() => ({ blocked: false })).catch((err) => ({ blocked: err.code === '23503' }));
    assert.equal(attempt.blocked, true, 'the FK must refuse to strand postings');
  });
});

async function alive(tripId: number): Promise<number> {
  const [row] = await sql`select count(*)::int as n from trip_expenses where trip_id = ${tripId}`;
  return row.n;
}
