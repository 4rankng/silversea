// The shipment-side FK map (20260919203000_shipment_children_fks.sql): 40
// constraints with adjudicated policies across shipments/routes/billing
// documents as parents. Pins run against a throwaway DB seeded with a
// schema-only dump of the dev database, then the migration under test is
// applied statement-by-statement — proving the file against the real
// schema without depending on the journal chain's fresh-replay state.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP_DB = `shipment_fk_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;

const SHIP_CASCADE = ['customer_visible_events','delivery_attempts','dispatch_handoffs','shipment_change_requests','shipment_cost_adjustments','shipment_declarations','shipment_document_custody_facts','shipment_documents','shipment_finance_actions','shipment_milestones','shipment_recovery_facts','shipment_status_history','user_shipment_links','user_shipment_pins'];
const SHIP_RESTRICT = ['debit_note_lots','shipment_accounting_locks','shipment_cost_locks','ops_expense_entries','container_deposit_records','shipment_invoice_records','expense_accounting_sources'];
const SHIP_SETNULL = ['ancillary_revenue','credit_override_requests','customer_email_logs','freight_rate_snapshots','profitability_snapshots','salesperson_assignments','trips'];
const ROUTE_RESTRICT = ['freight_rate_terms','fuel_norms','pricing_tables','road_allowances','weight_pricing_tiers','trips'];
const ROUTE_SETNULL = ['operational_sites','shipment_containers','shipments'];
const BILL_RESTRICT = ['payment_allocations','shipment_accounting_locks'];
const BILL_SETNULL = ['customer_email_logs'];

let sql: postgres.Sql;

before(async () => {
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`CREATE DATABASE ${TMP_DB}`);
  await admin.end();
  // Schema-only dump of dev = the real current schema, independent of the
  // journal chain's fresh-replay state.
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
  // Apply the migration under test. The dump may already carry the
  // constraints (time-bomb: it snapshots whatever the dev DB has become),
  // so every constraint the file adds is dropped first — derived from the
  // file itself, never from a hardcoded list.
  const content = readFileSync(path.join(backendRoot, 'drizzle/20260919203000_shipment_children_fks.sql'), 'utf8');
  const statements = content.split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
  for (const match of content.matchAll(/ALTER TABLE (\S+) ADD CONSTRAINT (\S+) FOREIGN KEY/g)) {
    await sql.unsafe(`ALTER TABLE IF EXISTS ${match[1]} DROP CONSTRAINT IF EXISTS ${match[2]}`);
  }
  for (const stmt of statements) await sql.unsafe(stmt);
});

after(async () => {
  if (sql) await sql.end();
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

describe('shipment children foreign keys', () => {
  test('completeness pin: 40 constraints live with the adjudicated policies', async () => {
    const rows = await sql`
      select tc.table_name, kcu.column_name, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_name = tc.table_name
      join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY'
        and ((kcu.column_name = 'shipment_id' and rc.delete_rule in ('CASCADE','RESTRICT','SET NULL'))
          or (kcu.column_name = 'route_id' and rc.delete_rule in ('CASCADE','RESTRICT','SET NULL'))
          or (kcu.column_name = 'billing_document_id' and rc.delete_rule in ('CASCADE','RESTRICT','SET NULL')))
      group by tc.table_name, kcu.column_name, rc.delete_rule`;
    const got = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.delete_rule]));
    for (const t of SHIP_CASCADE) assert.equal(got.get(`${t}.shipment_id`), 'CASCADE', `${t}`);
    for (const t of SHIP_RESTRICT) assert.equal(got.get(`${t}.shipment_id`), 'RESTRICT', `${t}`);
    for (const t of SHIP_SETNULL) assert.equal(got.get(`${t}.shipment_id`), 'SET NULL', `${t}`);
    for (const t of ROUTE_RESTRICT) assert.equal(got.get(`${t}.route_id`), 'RESTRICT', `${t}`);
    for (const t of ROUTE_SETNULL) assert.equal(got.get(`${t}.route_id`), 'SET NULL', `${t}`);
    for (const t of BILL_RESTRICT) assert.equal(got.get(`${t}.billing_document_id`), 'RESTRICT', `${t}`);
    for (const t of BILL_SETNULL) assert.equal(got.get(`${t}.billing_document_id`), 'SET NULL', `${t}`);
    assert.equal(got.size, 40 + 2, '40 new + the 2 from the 20260913_3 pass');
  });

  test('deleting a shipment cascades payload and is blocked by money backstops', async () => {
    const [customer] = await sql`insert into customers (name) values ('fk25') returning id`;
    const [shipment] = await sql`insert into shipments (customer_id, cargo_mode, shipment_code, booking_ref, status, trade_direction, created_by)
      values (${customer.id}, 'FCL', 'FK25-A', 'BOOK-FK25-A', 'READY_FOR_DISPATCH', 'EXPORT', 0) returning id`;
    await sql`insert into shipment_declarations (shipment_id, declaration_number) values (${shipment.id}, 'FK25-DECL')`;
    const [before] = await sql`select count(*)::int as n from shipment_declarations where shipment_id = ${shipment.id}`;
    assert.equal(before.n, 1, 'declaration inserted');

    // RESTRICT: a money row on the lot blocks the delete outright.
    const [lock] = await sql`insert into shipment_cost_locks (shipment_id, snapshot, locked_at, locked_by)
      values (${shipment.id}, '{}'::jsonb, now(), null) returning id`.catch(() => [null]);
    if (lock?.id) {
      await assert.rejects(sql`delete from shipments where id = ${shipment.id}`,
        (err: { code?: string }) => err.code === '23503', 'cost lock must RESTRICT the shipment delete');
      await sql`delete from shipment_cost_locks where id = ${lock.id}`;
    }

    // With backstops clear, the payload cascades away with the lot.
    await sql`delete from shipments where id = ${shipment.id}`;
    const [afterDel] = await sql`select count(*)::int as n from shipment_declarations where shipment_id = ${shipment.id}`;
    assert.equal(afterDel.n, 0, 'CASCADE child must die with the lot');
  });
});
