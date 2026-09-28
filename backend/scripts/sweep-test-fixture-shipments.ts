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

  // Generated customers, and the shipments each one owns.
  const generated = await client`
    select c.id, c.name,
           (select count(*) from shipments s2 where s2.customer_id = c.id)::int as shipments
      from customers c
     where c.name ~ ${FIXTURE_NAME}
     order by c.name
  `;
  const customerIds = generated.map((c: { id: number }) => c.id);
  const fixtureShipments = generated.reduce((n: number, c: { shipments: number }) => n + c.shipments, 0);

  console.log(`${APPLY ? 'APPLY' : 'REPORT'}: ${generated.length} generated customer(s) owning ${fixtureShipments} shipment(s)`);
  for (const c of generated.slice(0, 10)) {
    console.log(`  ${c.name}  (${c.shipments} shipment${c.shipments === 1 ? '' : 's'})`);
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

  // Guard: a matched customer must own ONLY its own generated shipments. If a
  // generated name was later reused for real business, stop rather than guess.
  const risky = await client`
    select c.name, count(s2.id)::int as total
      from customers c
      join shipments s2 on s2.customer_id = c.id
     where c.id = any(${customerIds})
     group by c.name
    having count(s2.id) > 0
  `;
  const perCustomer = new Map(generated.map((c: { id: number; name: string; shipments: number }) => [c.id, c.shipments]));
  const mismatched = risky.filter(
    (r: { name: string; total: number }) =>
      !generated.some((c: { name: string; shipments: number }) => c.name === r.name && c.shipments === r.total),
  );
  if (mismatched.length > 0) {
    console.error('REFUSING: a generated customer owns shipments beyond its generated set.');
    for (const m of mismatched) console.error(`  ${m.name} owns ${m.total}`);
    console.error('Inspect manually; this sweep only deletes what it can prove it generated.');
    await client.end({ timeout: 1 });
    process.exit(1);
  }
  void perCustomer;

  // Resolve the fixture shipment ids in JS rather than as a SQL subquery:
  // drizzle renders `inArray(col, sql\`select …\`)` as `IN (($1, $2, …))`, which
  // is a syntax error. The set is small (hundreds at most) and explicit ids also
  // make the child deletes below readable in the log.
  const fixtureShipmentRows = await client`
    select s.id from shipments s
     where s.customer_id = any(${customerIds})
  `;
  const shipmentIds = fixtureShipmentRows.map((r: { id: number }) => r.id);

  // Children, discovered from `pg_constraint` rather than hardcoded — but ONLY
  // the ones this sweep is allowed to remove.
  //
  // The rule is deliberately conservative. A fixture shipment is normally
  // inert: measured 2026-09-28, 106 of 115 own nothing at all, and those are
  // the ones that pollute the top of /shipments. A minority are NOT inert —
  // they carry `shipment_fulfillments`, and through those, `trips`,
  // `trip_expenses` and onward into `invoice_tracking`. Cascading deletes
  // through that graph means deleting financial records a test happened to
  // touch, which is exactly the kind of quiet damage a cleanup script must
  // never cause. So: sweep the inert ones, REPORT the rest, and point at the
  // repo's own reset rather than guessing which financial rows are real.
  const fkEdges = await client`
    select child.relname as child, att.attname as col, parent.relname as parent
      from pg_constraint con
      join pg_class child on child.oid = con.conrelid
      join pg_class parent on parent.oid = con.confrelid
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
     where con.contype = 'f'
       and parent.relname = 'shipments'
     order by child.relname
  `;
  const edges = fkEdges as Array<{ child: string; col: string; parent: string }>;
  console.log(`  direct child tables: ${edges.map((e) => e.child).join(', ') || '(none)'}`);

  // Which fixture shipments have a downstream link at all? Reported, never
  // cascaded. A direct `shipment_fulfillments` is the only entanglement seen in
  // practice, and it is the thing worth refusing on: everything past it is
  // financial.
  // A fixture shipment is INERT only when no child table of shipments holds a
  // row for it. Anything else is entangled: those reach into trips, expenses
  // and accounting sources, and cascading there means deleting financial rows a
  // test merely touched. Entangled ones are reported, never deleted.
  const entangledIds = new Set<number>();
  const entangledDetail: string[] = [];
  for (const e of edges) {
    const rows = await client.unsafe(
      `select distinct ${e.col} as id from ${e.child} where ${e.col} = any($1)`, [shipmentIds]);
    for (const r of rows as Array<{ id: number }>) entangledIds.add(r.id);
    if ((rows as unknown[]).length > 0) entangledDetail.push(`    ${e.child}: ${(rows as unknown[]).length} row(s)`);
  }

  const inertIds = shipmentIds.filter((id) => !entangledIds.has(id));

  if (entangledIds.size > 0) {
    console.log('\n  fixture shipments carrying child rows — REPORTED, not deleted:');
    for (const d of entangledDetail) console.log(d);
    console.log(`    ${entangledIds.size} of ${shipmentIds.length} fixture shipment(s) are entangled.`);
    console.log('    Clearing those means the repo reset, which also drops real local data:');
    console.log('      cd backend && pnpm db:reset && pnpm db:seed');
  }

  if (inertIds.length === 0) {
    console.log('\nnothing inert to sweep — every fixture shipment is entangled. Database left as-is.');
    await client.end({ timeout: 1 });
    process.exit(0);
  }

  const deletedShipments = await db.delete(s.shipments)
    .where(inArray(s.shipments.id, inertIds))
    .returning({ id: s.shipments.id });
  console.log(`deleted ${deletedShipments.length} inert shipment(s)`);

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
