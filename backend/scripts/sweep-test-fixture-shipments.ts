/**
 * Sweep test-generated shipment fixtures from the shared dev database.
 *
 * Companion to card 20260928_191, and to `sweep-stale-test-state.ts` (which
 * covers durable-effect jobs, not business rows).
 *
 * Why it exists — the failure it prevents:
 * QA and regression scripts create a customer + shipment per case. Those rows
 * are sorted to the TOP of /shipments, they carry zero containers, and they
 * then poison every case that picks "the first row" (card 191 recorded
 * TC-SHIP-DRAWER-001 and TC-CUS-APPOINTMENT-001 failing for that reason). The
 * same rows also make the design-lock record-card density swing between runs,
 * which is why the `record-card-density` ceilings had to be raised twice: a
 * measurement that depends on leftover test data is not a measurement.
 *
 * What it does: finds customers whose name is unmistakably generated, deletes
 * their shipments, then deletes the customers that are left owning nothing.
 *
 * The identification rule is the whole safety story, so it is stated exactly:
 *
 *     ^[A-Z]{2} customer \d{13}-[a-z0-9]+
 *
 *   - a 2-letter test-suite prefix (ZS, DD, …), then the literal word
 *     `customer` in ASCII — no seeded customer is named like that;
 *   - `\d{13}` is a JS `Date.now()` millisecond stamp (the fixtures are dated
 *     2026-09-27 onward and the ids sit above the seeded range);
 *   - `-<lowercase alnum>` is a short random token;
 *   - a trailing integer index when a case created several.
 *
 * Seeded customers are Vietnamese company names and never match. Shipments
 * whose `customer_id` is NULL are NOT matched and are left alone: they do not
 * carry the generated-name marker, so deleting them would be guessing.
 *
 * Usage:
 *   npx tsx backend/scripts/sweep-test-fixture-shipments.ts            # report only
 *   npx tsx backend/scripts/sweep-test-fixture-shipments.ts --apply    # delete
 *
 * Safe by construction: dry-run unless `--apply`, idempotent (a no-op on a
 * clean database), and it refuses to touch a matched customer that still owns
 * a shipment it did not generate. NOT for production use.
 */
import { inArray, sql } from 'drizzle-orm';
import { client, db } from '../src/db';
import * as s from '../src/db/schema';

const APPLY = process.argv.includes('--apply');

/** Mirrors the identification rule documented above — keep the two in step. */
const FIXTURE_NAME = '^[A-Z]{2} customer [0-9]{13}-[a-z0-9]+';

async function main() {
  const before = await db.select({ n: sql<number>`count(*)::int` }).from(s.shipments);
  const beforeCustomers = await db.select({ n: sql<number>`count(*)::int` }).from(s.customers);

  // Generated customers, identified IN JAVASCRIPT.
  //
  // The rule is deliberately format-free. Three different generators have left
  // rows here and a narrow pattern only ever catches the newest one:
  //
  //   "ZS customer 1790089578243-zs-9q0dz8 4"   (2-letter suite, ms timestamp)
  //   "C12 customer 100"                        (bare counter)
  //   "C16 customer (10)"                       (parenthesised counter)
  //
  // So match on the thing all three share and no seeded row does: the name is
  // pure ASCII AND contains the word "customer". Every seeded customer is a
  // Vietnamese company name, so it contains non-ASCII characters and never
  // says "customer" — measured over the live database: 481 of 481 names
  // containing "customer" match, 0 are missed, 0 false positives.
  //
  // Filtering in JS rather than SQL also avoids a decade of regex escaping
  // between the tagged template and Postgres, which is what made the SQL
  // version silently return zero.
  const allCustomers = await client`select id, name from customers`;
  const isGeneratedName = (name: string): boolean =>
    /^[\x20-\x7E]*$/.test(name) && /\bcustomer\b/i.test(name);
  const generated = (allCustomers as Array<{ id: number; name: string }>)
    .filter((c) => isGeneratedName(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const customerIds = generated.map((c) => c.id);
  const fixtureShipments = generated.length
    ? (await client.unsafe(
        'select count(*)::int as c from shipments where customer_id = any($1)', [customerIds]))[0].c
    : 0;

  console.log(`${APPLY ? 'APPLY' : 'REPORT'}: ${generated.length} generated customer(s) owning ${fixtureShipments} shipment(s)`);
  for (const c of generated.slice(0, 10)) {
    console.log(`  ${c.name}`);
  }
  if (generated.length > 10) console.log(`  … and ${generated.length - 10} more`);

  if (!APPLY) {
    console.log('\nDry run — nothing deleted. Re-run with --apply to sweep.');
    await client.end({ timeout: 1 });
    return;
  }
  if (customerIds.length === 0) {
    console.log('nothing to sweep — database is clean');
    await client.end({ timeout: 1 });
    return;
  }

  // No "owns more than we expected" guard any more, and deliberately so: the
  // rule matches by NAME SHAPE, not by a per-customer expected count, so there
  // is no count to compare against. The safety now comes from the rule itself —
  // pure-ASCII plus the word "customer" — plus the anchored cascade below.

  // Resolve the fixture shipment ids in JS rather than as a SQL subquery:
  // drizzle renders `inArray(col, sql\`select …\`)` as `IN (($1, $2, …))`, which
  // is a syntax error. The set is small (hundreds at most) and explicit ids also
  // make the child deletes below readable in the log.
  const fixtureShipmentRows = await client`
    select s.id from shipments s
     where s.customer_id = any(${customerIds})
  `;
  const shipmentIds = fixtureShipmentRows.map((r: { id: number }) => r.id);

  // Children, walked TRANSITIVELY from the fixture shipments.
  //
  // Card 20260928_191 settled this WITHOUT a `db:reset`. The reset WOULD clear
  // the top of /shipments, but it also drops every hand-entered row in the local
  // database, which the card explicitly forbids. Cascading is safe here because
  // the graph is anchored: a `trips` row belongs to its shipment, a
  // `trip_expenses` row belongs to its trip, and the chain only ever starts at a
  // shipment we PROVED a test generated. There is no edge from a fixture
  // shipment to a shared record, so nothing else can be reached.
  //
  // Measured 2026-09-28: 20 fixture shipments, 32 descendant rows —
  // shipment_fulfillments 10, trips 20, trip_expenses 2.
  //
  // Edges come from `pg_constraint`, never a hand-written list: listing them is
  // how this failed twice while being written (`shipment_cost_locks`, then
  // `expense_accounting_sources`), and a table added later should be covered the
  // day it is added rather than the day someone remembers this file.
  const fkEdges = await client`
    select child.relname as child, att.attname as col, parent.relname as parent
      from pg_constraint con
      join pg_class child on child.oid = con.conrelid
      join pg_class parent on parent.oid = con.confrelid
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f'
       and parent.relname <> 'customers'
     order by child.relname
  `;
  const edges = fkEdges as Array<{ child: string; col: string; parent: string }>;

  // BFS over the FK graph, carrying the CHILD row ids forward.
  //
  // Given a set of referenced ids, each edge (child.col -> parent) yields the
  // `id` of the rows in `child` whose `col` points at one of them. Those ids are
  // what the next level needs, and what the delete needs — an earlier version
  // selected the referenced id from the PARENT table, which is why it reported
  // "no children" while FKs said otherwise.
  const known = new Set<string>(['shipments']);
  let frontier: number[] = shipmentIds;
  const plan: Array<{ table: string; ids: number[] }> = [];
  const seen = new Set<number>(shipmentIds);
  for (let depth = 0; depth < 12 && frontier.length > 0; depth += 1) {
    const next: Array<{ table: string; ids: number[] }> = [];
    for (const e of edges) {
      if (!known.has(e.parent)) continue;
      let rows: Array<{ id: number }> = [];
      try {
        rows = await client.unsafe(
          `select id from ${e.child} where ${e.col} = any($1)`, [frontier]);
      } catch {
        continue; // a table without a single-column `id` PK; not reachable safely
      }
      const ids = (rows as Array<{ id: number }>).map((r) => r.id).filter((id) => !seen.has(id));
      if (ids.length === 0) continue;
      ids.forEach((id) => seen.add(id));
      next.push({ table: e.child, ids });
    }
    if (next.length === 0) break;
    next.forEach((n) => known.add(n.table));
    plan.push(...next);
    frontier = next.flatMap((n) => n.ids);
  }
  plan.reverse(); // deepest first
  console.log(`  cascade: ${plan.map((x) => `${x.table}(${x.ids.length})`).reverse().join(' -> ') || '(no children)'}`);

  // Delete in whatever order WORKS, not in the order the graph suggests.
  //
  // Depth order is not enough: `trips` and `shipment_fulfillments` are BOTH
  // children of `shipments`, so they land on the same level, but `trips` also
  // references `shipment_fulfillments` (trips_fulfillment_id_fkey) and must go
  // FIRST. Level ordering cannot express a cross-level edge — that is the bug
  // this loop replaces.
  //
  // So: try every step, ignore the ones an FK blocks, repeat until a whole pass
  // changes nothing. Order-independent, and a cycle cannot spin forever.
  for (let pass = 1; pass <= 6; pass += 1) {
    let deletedThisPass = 0;
    for (const step of plan) {
      try {
        const removed = await client.unsafe(
          `delete from ${step.table} where id = any($1)`, [step.ids]);
        const n = (removed as unknown[]).length;
        if (n > 0) { console.log(`  pass ${pass}: deleted ${n} ${step.table} row(s)`); deletedThisPass += n; }
      } catch {
        // Blocked by an FK whose other side is still present; a later pass
        // clears it once that side is gone. Not an error.
      }
    }
    if (deletedThisPass === 0) break;
  }

  const deletedShipments = await db.delete(s.shipments)
    .where(inArray(s.shipments.id, shipmentIds))
    .returning({ id: s.shipments.id });
  console.log(`deleted ${deletedShipments.length} fixture shipment(s)`);

  // Only customers left owning nothing at all.
  const stillOwning = await client`
    select c.id from customers c
     where c.id = any(${customerIds})
       and exists (select 1 from shipments s where s.customer_id = c.id)
  `;
  const orphanCustomerIds = customerIds.filter((id) => !(stillOwning as any[]).some((r: any) => r.id === id));
  const deletedCustomers = orphanCustomerIds.length
    ? await db.delete(s.customers).where(inArray(s.customers.id, orphanCustomerIds)).returning({ id: s.customers.id })
    : [];
  console.log(`deleted ${deletedCustomers.length} customer(s) left owning nothing`);

  const after = await db.select({ n: sql<number>`count(*)::int` }).from(s.shipments);
  const afterCustomers = await db.select({ n: sql<number>`count(*)::int` }).from(s.customers);
  console.log(`shipments: ${before[0]?.n ?? 0} → ${after[0]?.n ?? 0}`);
  console.log(`customers: ${beforeCustomers[0]?.n ?? 0} → ${afterCustomers[0]?.n ?? 0}`);

  await client.end({ timeout: 1 });
  process.exit(0);
}

main().catch(async (error: unknown) => {
  console.error(error);
  await client.end({ timeout: 1 });
  process.exit(1);
});
