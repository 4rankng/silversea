/* eslint-disable @typescript-eslint/no-explicit-any */
// One-shot backfill: a READY_FOR_DISPATCH shipment that has zero live
// fulfillment rows is invisible to the dispatch detail plan (its rows
// inner-join shipment_fulfillments). The BUG 5 fix prevents NEW shipments
// from reaching that state; this backfill repairs the legacy rows that
// already flipped without decomposing.
//
// Repro on staging (2026-09-12): SHP-2609-00007 + SHP-2609-00015 — both
// READY_FOR_DISPATCH, 0 fulfillments, missing from /dispatch-detail.
//
// Idempotent: ensureShipmentFulfillmentsInTx short-circuits when live
// fulfillments already exist and match the snapshot.
import { runInTx } from '../src/lib/tx';
import { ensureShipmentFulfillmentsInTx } from '../src/services/shipment-fulfillment.service';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

async function findAdminUserId(): Promise<number> {
  const [row] = await db.execute<{ id: number }>(sql`
    SELECT id FROM users
    WHERE role IN ('ADMIN','OPS')
    ORDER BY role = 'ADMIN' DESC, id ASC
    LIMIT 1
  `);
  if (!row) throw new Error('No admin/ops user available to act as actor');
  return row.id;
}

async function main() {
  const targets = await db.execute<{ id: number; status: string; cargo_mode: string }>(sql`
    SELECT id, status, cargo_mode
    FROM shipments
    WHERE status IN ('READY_FOR_DISPATCH','DISPATCHED','IN_TRANSIT')
      AND deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM shipment_fulfillments f
        WHERE f.shipment_id = shipments.id AND f.canceled_at IS NULL
      )
    ORDER BY id
  `);
  if (targets.length === 0) {
    console.log('[backfill] no affected shipments found — DB is clean');
    return;
  }
  console.log(`[backfill] affected shipments: ${targets.map((t) => `${t.id}(${t.status},${t.cargo_mode})`).join(', ')}`);
  const actorId = await findAdminUserId();
  console.log(`[backfill] using actor ${actorId}`);
  for (const t of targets) {
    const fulf = await runInTx(undefined, (tx) => ensureShipmentFulfillmentsInTx(tx, {
      shipmentId: t.id,
      actorId,
      allowClerkIntake: true,
    }));
    console.log(`[backfill] shipment ${t.id}: ${fulf.length} fulfillment(s) ensured`);
  }
  console.log('[backfill] done');
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill] FAILED:', err);
  process.exit(1);
});