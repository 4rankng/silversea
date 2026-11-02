// One-shot backfill: a container number entered by the DRIVER (trip_containers)
// before SIL-653 (id 760) shipped never reached the lot's shipment_containers
// row, so dispatch + CUS kept reading "Chưa có số cont" forever.
//
// SIL-653 made the bridge WRITE-TRIGGERED: the driver's "Số cont & seal" save
// now mirrors the number onto the lot (and vice-versa). Rows written BEFORE
// that fix are not revisited — the bridge only runs on a write. This script
// replays the mirror for the stranded rows so the lots heal without the
// driver having to re-enter every number by hand.
//
// Repro on staging (02/11/2026): trip_containers 283 (trip 155, lot 552),
// 277 (trip 151) and 272 (trip 148) carried a number while their
// shipment_containers row was still NULL — the QA repro from SIL-653 itself.
//
// Idempotent: only rows that actually DIFFER are written, and the same
// normalize + in-lot duplicate rules as the live command are applied.
import { db } from '../src/db';
import { sql } from 'drizzle-orm';
import { runInTx } from '../src/lib/tx';
import { syncShipmentIdentityFromTripContainers } from '../src/services/shipment-containers.service';

const APPLY = process.argv.includes('--apply');

async function main() {
  const rows = await db.execute<{
    trip_container_id: number;
    trip_id: number;
    shipment_container_id: number | null;
    trip_number: string | null;
    lot_number: string | null;
    shipment_id: number;
    shipment_code: string | null;
  }>(sql`
    SELECT tc.id AS trip_container_id,
           tc.trip_id,
           tc.source_shipment_container_id AS shipment_container_id,
           tc.container_number AS trip_number,
           sc.container_number AS lot_number,
           sc.shipment_id,
           sh.shipment_code AS shipment_code
    FROM trip_containers tc
    JOIN shipment_containers sc ON sc.id = tc.source_shipment_container_id
    JOIN shipments sh ON sh.id = sc.shipment_id
    WHERE tc.container_number IS NOT NULL
      AND tc.container_number <> ''
      AND tc.source_shipment_container_id IS NOT NULL
      AND (sc.container_number IS NULL OR sc.container_number <> tc.container_number)
    ORDER BY tc.id
  `);

  if (rows.length === 0) {
    console.log('[backfill] no stranded container numbers — nothing to do');
    return;
  }

  console.log(`[backfill] stranded trip_containers: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  tc=${r.trip_container_id} trip=${r.trip_id} lot=${r.shipment_code ?? r.shipment_id}`
      + ` trip_num="${r.trip_number}" lot_num="${r.lot_number ?? 'NULL'}"`,
    );
  }

  if (!APPLY) {
    console.log('[backfill] dry run — pass --apply to write');
    return;
  }

  const ids = rows.map((r) => r.trip_container_id);
  await runInTx(undefined, async (tx) => {
    await syncShipmentIdentityFromTripContainers(tx, ids);
  });

  const after = await db.execute<{ id: number; container_number: string | null }>(sql`
    SELECT id, container_number FROM shipment_containers WHERE id IN (
      SELECT source_shipment_container_id FROM trip_containers WHERE id IN (
        SELECT unnest(${sql.raw(ids.join(','))}::int[])
      )
    )
  `);
  console.log('[backfill] after:');
  for (const r of after) console.log(`  sc=${r.id} container_number="${r.container_number ?? 'NULL'}"`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] failed:', err);
    process.exit(1);
  });
