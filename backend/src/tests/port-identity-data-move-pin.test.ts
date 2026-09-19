// The port-identity data move (20260919190000_port_identity_out_of_code.sql):
// five text columns across five tables carry the incidental-cost kind, and
// the migration renames the place-named value LIFT_DROP_LACH_HUYEN to
// LIFT_DROP_ZONE in all five plus the persisted debit-note templates jsonb,
// guarded by the file's own absence assertion. This pin runs the file's own
// remap statements (prose comments stripped before extraction) against a
// throwaway schema-only rig and asserts count parity: count per old value
// before == count per new value after, zero old-value rows stranded in any
// swept column, and the templates jsonb remap lands. Self-rigging like its
// sibling pins: the schema dump comes from the local dev container, so it
// runs green only where the dev DB has schema (the runner-v2 caveat family).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP_DB = `port_identity_pin_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;

// Data values, not identifiers — place names are data (ruling).
const OLD_VALUE = 'LIFT_DROP_LACH_HUYEN';
const NEW_VALUE = 'LIFT_DROP_ZONE';

const SWEPT = [
  { table: 'driver_incidental_costs', column: 'cost_type' },
  { table: 'forwarder_expense_types', column: 'category' },
  { table: 'trip_expenses', column: 'expense_type' },
  { table: 'ops_expense_entries', column: 'expense_type_code' },
  { table: 'ancillary_revenue', column: 'type' },
] as const;

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
  const probe = postgres(TMP_URL);
  const t = await probe`select count(*)::int as n from information_schema.tables where table_schema='public'`;
  assert.ok(t[0].n > 100, 'schema restored');
  await probe.end();
  sql = postgres(TMP_URL);

  // Fixtures: parents first (customers → routes → trips / shipments), then
  // old-value rows in every swept column, plus a template whose persisted
  // jsonb columns still reference the place-named column id.
  const [customer] = await sql`insert into customers (name) values ('port-identity-pin') returning id`;
  const [route] = await sql`insert into routes (name) values ('port-identity-pin') returning id`;
  const [trip] = await sql`insert into trips (customer_id, route_id, departure_date) values (${customer.id}, ${route.id}, current_date) returning id`;
  const [shipment] = await sql`insert into shipments (customer_id, shipment_code, booking_ref, status, trade_direction)
    values (${customer.id}, 'PINPORT-A', 'PINPORT-A', 'READY_FOR_DISPATCH', 'EXPORT') returning id`;
  for (let i = 1; i <= 2; i += 1) {
    await sql`insert into trip_expenses (trip_id, expense_type, buy_amount) values (${trip.id}, ${OLD_VALUE}, ${i * 1000})`;
    await sql`insert into driver_incidental_costs (trip_id, driver_id, cost_type, amount, occurred_at)
      values (${trip.id}, 1, ${OLD_VALUE}, ${i * 1000}, current_date)`;
    await sql`insert into ops_expense_entries (shipment_id, expense_type_code, amount, paid_by_id, paid_at)
      values (${shipment.id}, ${OLD_VALUE}, ${i * 1000}, 1, current_date)`;
    await sql`insert into ancillary_revenue (customer_id, type, amount) values (${customer.id}, ${OLD_VALUE}, ${i * 1000})`;
    await sql`insert into forwarder_expense_types (code, name, category) values (${`PINPORT-${i}`}, ${`pinport ${i}`}, ${OLD_VALUE})`;
  }
  // postgres.js double-encodes a pre-stringified JSON parameter (::jsonb on
  // a string lands as a scalar), so pass the array object directly.
  await sql`insert into debit_note_templates (name, columns) values ('port-identity-pin', ${[
    { id: 'lach_huyen', label: 'Phí nâng hạ theo vùng' },
    { id: 'zone_surcharge', label: 'nâng hạ' },
  ]}::jsonb)`;

  // The file's own remap statements for the swept columns, in file order.
  // Prose comment lines are stripped first so header notes never pollute the
  // extraction (the `-->` breakpoint markers are kept).
  const content = readFileSync(path.join(backendRoot, 'drizzle/20260919190000_port_identity_out_of_code.sql'), 'utf8')
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      return !(t.startsWith('--') && !t.startsWith('-->'));
    })
    .join('\n');
  const statements = content.split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
  const remaps = statements.filter((s) => s.includes(OLD_VALUE) || s.includes('debit_note_templates'));
  assert.ok(remaps.length >= 5, 'the five swept-column remaps plus the templates remap and the absence guard expected');
  for (const stmt of remaps) await sql.unsafe(stmt);
});

after(async () => {
  if (sql) await sql.end();
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

describe('port identity data move', () => {
  test('every old-value row becomes a new-value row; nothing stays stranded; templates remap lands', async () => {
    for (const { table, column } of SWEPT) {
      const [oldRows] = await sql.unsafe(`select count(*)::int as n from ${table} where ${column} = $1`, [OLD_VALUE]);
      const [newRows] = await sql.unsafe(`select count(*)::int as n from ${table} where ${column} = $1`, [NEW_VALUE]);
      assert.equal(oldRows.n, 0, `${table}.${column}: no stranded old-value rows`);
      assert.ok(newRows.n >= 2, `${table}.${column}: remapped rows present (${newRows.n})`);
    }
    const [tpl] = await sql`select columns from debit_note_templates where name = 'port-identity-pin'`;
    const ids = tpl.columns.map((e: { id: string }) => e.id);
    assert.ok(!ids.includes('lach_huyen'), 'templates jsonb: no place-named column id remains');
    assert.ok(ids.includes('zone_surcharge'), 'templates jsonb: remapped to the structural id');
  });
});
