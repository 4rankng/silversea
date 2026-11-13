// SIL-817 (id 946, URGENT PROD 13/11) — one-shot repair for trips stranded in
// IN_TRANSIT behind a dispatch handoff that never found a handler.
//
// PROD evidence (silversea.tingting.vip, verified 13/11):
//   - trip 13  TRP-202609-0011 (fulfillment 62, shipment 36 SHP-2609-00036)
//     IN_TRANSIT since 21/09, ORDER_RECEIVED recorded 13/10 — the driver
//     (Nguyễn Huy Vương, drivers.id=5 / users.id=27) ran the leg but the
//     driver app never offered a reachable Hoàn tất while the old build
//     blocked completion, and dispatch handoff #38 (UNSEEN, handler NULL)
//     sat unresolved.
//   - handoff #37 (shipment 35 SHP-2609-00035) UNSEEN, handler NULL, same
//     dispatch burst; its trip 15 TRP-202609-0013 is still CREATED (not
//     running — repairable separately, see --handoff-only mode).
//
// The script reuses the LIVE business services (never raw SQL writes) so the
// repaired rows carry the same side effects as a driver completing in the
// app: milestone inference, shipment completion recompute, attendance/work-day
// sync, report-cache invalidation, and an audit_logs row per repaired trip.
//
// Usage (run from backend/):
//   DRY RUN (default — prints the plan, writes nothing):
//     tsx scripts/repair-sil817-stuck-trips.ts --trip 13
//     tsx scripts/repair-sil817-stuck-trips.ts --shipment 36 --shipment 35
//     tsx scripts/repair-sil817-stuck-trips.ts --handoff 37 --handoff-resolution reject
//   APPLY (writes; requires a staff user id to sign the repair):
//     tsx scripts/repair-sil817-stuck-trips.ts --trip 13 --action complete \
//         --actor-user-id <staffId> --reason "SIL-817 PROD repair 13/11" --apply
//     tsx scripts/repair-sil817-stuck-trips.ts --trip 15 --action cancel \
//         --actor-user-id <staffId> --reason "<business reason>" --apply
//
// Business decision stays with the owner/orchestrator per trip:
//   - complete → trip COMPLETED via the driver path (payroll/attendance/
//     shipment recompute all run), handoff → ACCEPTED (or --handoff-resolution reject).
//   - cancel   → trip CANCELED via the staff path, handoff → REJECTED
//     (--reason is mandatory so the audit trail names why).
import { argv, exit } from 'node:process';

import { eq, inArray, isNull, and } from 'drizzle-orm';
import { db, client } from '../src/db';
import * as s from '../src/db/schema';
import { ApiError } from '../src/errors';
import { persistAudit } from '../src/services/audit.service';
import { AuditEvent } from '../src/services/audit-types';
import { resolveHandoff } from '../src/services/dispatch-handoff.service';
import { completeOwnedFulfillmentTrip } from '../src/services/driver-fulfillment.service';
import { transitionTripWriteCommand } from '../src/services/trip-command.service';
import { syncAttendanceAfterStatusChange } from '../src/services/trip-attendance-sync.service';
import { invalidateReportCaches } from '../src/lib/report-cache';
import { emitNotification } from '../src/services/notification.service';
import { NotificationType, TripStatus } from '@tingting/shared';

interface Args {
  trips: number[];
  shipments: number[];
  handoffIds: number[];
  action: 'complete' | 'cancel';
  actorUserId: number | null;
  reason: string | null;
  handoffResolution: 'accept' | 'reject' | null;
  apply: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    trips: [], shipments: [], handoffIds: [],
    action: 'complete', actorUserId: null, reason: null,
    handoffResolution: null, apply: false,
  };
  const nums = (name: string): number[] => {
    const values: number[] = [];
    for (let index = 0; index < argv.length; index++) {
      const token = argv[index]!;
      if (token === name) {
        const next = argv[index + 1];
        if (next != null && !next.startsWith('--')) values.push(...next.split(',').map(Number));
        index++;
      } else if (token.startsWith(`${name}=`)) {
        values.push(...token.split('=')[1]!.split(',').map(Number));
      }
    }
    return values.filter((value) => Number.isInteger(value) && value > 0);
  };
  args.trips = nums('--trip');
  args.shipments = nums('--shipment');
  args.handoffIds = nums('--handoff');
  const flag = (name: string): string | null => {
    const index = argv.indexOf(name);
    if (index >= 0 && argv[index + 1] != null) return argv[index + 1]!;
    const inline = argv.find((token) => token.startsWith(`${name}=`));
    return inline ? inline.split('=')[1]! : null;
  };
  const action = flag('--action');
  if (action != null) {
    if (action !== 'complete' && action !== 'cancel') {
      console.error(`[repair] invalid --action "${action}" (complete|cancel)`);
      exit(2);
    }
    args.action = action;
  }
  const resolution = flag('--handoff-resolution');
  if (resolution != null) {
    if (resolution !== 'accept' && resolution !== 'reject') {
      console.error(`[repair] invalid --handoff-resolution "${resolution}" (accept|reject)`);
      exit(2);
    }
    args.handoffResolution = resolution;
  }
  const actor = flag('--actor-user-id');
  args.actorUserId = actor != null ? Number(actor) : null;
  args.reason = flag('--reason');
  args.apply = argv.includes('--apply');
  return args;
}

interface StuckTripPlan {
  tripId: number;
  tripCode: string | null;
  status: string;
  version: number;
  driverId: number | null;
  driverName: string | null;
  fulfillmentId: number | null;
  shipmentId: number | null;
  shipmentCode: string | null;
  handoff: { id: number; status: string; version: number; handlerId: number | null } | null;
}

async function loadStuckTripPlans(args: Args): Promise<StuckTripPlan[]> {
  const tripIds = [...args.trips];
  if (args.shipments.length > 0) {
    const rows = await db.select({ id: s.trips.id })
      .from(s.trips)
      .innerJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
      .where(and(
        inArray(s.shipmentFulfillments.shipmentId, args.shipments),
        isNull(s.trips.deletedAt),
        isNull(s.shipmentFulfillments.canceledAt),
        inArray(s.trips.status, [TripStatus.CREATED, TripStatus.IN_TRANSIT]),
      ));
    for (const row of rows) if (!tripIds.includes(row.id)) tripIds.push(row.id);
  }
  if (tripIds.length === 0) return [];

  const tripRows = await db.select({
    tripId: s.trips.id,
    tripCode: s.trips.tripCode,
    status: s.trips.status,
    version: s.trips.version,
    driverId: s.trips.driverId,
    driverName: s.drivers.name,
    fulfillmentId: s.trips.fulfillmentId,
    shipmentId: s.trips.shipmentId,
    shipmentCode: s.shipments.shipmentCode,
  }).from(s.trips)
    .leftJoin(s.drivers, eq(s.drivers.id, s.trips.driverId))
    .leftJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
    .where(inArray(s.trips.id, tripIds));

  const plans: StuckTripPlan[] = [];
  for (const trip of tripRows) {
    const [handoff] = trip.shipmentId != null
      ? await db.select({
        id: s.dispatchHandoffs.id,
        status: s.dispatchHandoffs.status,
        version: s.dispatchHandoffs.version,
        handlerId: s.dispatchHandoffs.handlerId,
      }).from(s.dispatchHandoffs)
        .where(and(
          eq(s.dispatchHandoffs.shipmentId, trip.shipmentId),
          inArray(s.dispatchHandoffs.status, ['UNSEEN', 'SEEN']),
        ))
        .limit(1)
      : [];
    plans.push({ ...trip, handoff: handoff ?? null });
  }
  return plans.sort((a, b) => a.tripId - b.tripId);
}

async function loadHandoffOnly(args: Args): Promise<Array<{ id: number; status: string; version: number; handlerId: number | null; shipmentId: number; shipmentCode: string | null }>> {
  if (args.handoffIds.length === 0) return [];
  return db.select({
    id: s.dispatchHandoffs.id,
    status: s.dispatchHandoffs.status,
    version: s.dispatchHandoffs.version,
    handlerId: s.dispatchHandoffs.handlerId,
    shipmentId: s.dispatchHandoffs.shipmentId,
    shipmentCode: s.shipments.shipmentCode,
  }).from(s.dispatchHandoffs)
    .leftJoin(s.shipments, eq(s.shipments.id, s.dispatchHandoffs.shipmentId))
    .where(inArray(s.dispatchHandoffs.id, args.handoffIds));
}

async function loadActor(args: Args): Promise<{ id: number; fullName: string | null; role: string } | null> {
  if (args.actorUserId == null) return null;
  const [actor] = await db.select({
    id: s.users.id,
    fullName: s.users.fullName,
    role: s.users.role,
  }).from(s.users).where(eq(s.users.id, args.actorUserId)).limit(1);
  return actor ?? null;
}

async function resolveHandoffFor(
  handoff: { id: number; status: string; version: number; handlerId: number | null },
  resolution: 'ACCEPTED' | 'REJECTED',
  actorUserId: number,
  reason: string | null,
): Promise<string> {
  if (handoff.status !== 'UNSEEN' && handoff.status !== 'SEEN') {
    return `handoff #${handoff.id} already ${handoff.status} — skipped`;
  }
  await resolveHandoff(handoff.id, resolution, actorUserId, handoff.version, {
    rejectReason: resolution === 'REJECTED' ? (reason ?? 'SIL-817 data repair — stranded handoff') : undefined,
  });
  return `handoff #${handoff.id} → ${resolution}`;
}

async function repairTrip(plan: StuckTripPlan, args: Args, actor: { id: number; fullName: string | null; role: string }): Promise<string[]> {
  const lines: string[] = [];
  if (args.action === 'complete') {
    if (plan.status !== TripStatus.IN_TRANSIT) {
      return [`trip ${plan.tripId} ${plan.tripCode ?? ''} is ${plan.status}, not IN_TRANSIT — complete refused (use --action cancel or accept it in the app first)`];
    }
    if (plan.fulfillmentId == null || plan.driverId == null) {
      return [`trip ${plan.tripId} has no fulfillment/driver — complete refused (ad-hoc trip needs the staff close path)`];
    }
    if (args.apply) {
      const { trip: completed } = await completeOwnedFulfillmentTrip({
        fulfillmentId: plan.fulfillmentId,
        driverId: plan.driverId,
        actorUserId: actor.id,
        expectedVersion: plan.version,
        idempotencyKey: `repair-sil817-trip-${plan.tripId}`,
      });
      lines.push(`trip ${plan.tripId} ${plan.tripCode ?? ''} → COMPLETED (v${completed.version}, completedAt ${completed.completedAt ?? 'n/a'})`);
    } else {
      lines.push(`trip ${plan.tripId} ${plan.tripCode ?? ''} would COMPLETE (driver path: infer milestones, recompute shipment, sync attendance)`);
    }
    await persistAudit({
      event: AuditEvent.TRIP_COMPLETED,
      entityType: 'trips',
      entityId: plan.tripId,
      entityKey: plan.tripCode ?? undefined,
      actorRole: actor.role,
      actorName: actor.fullName ?? `user ${actor.id}`,
      userId: actor.id,
      metadata: {
        repair: 'SIL-817',
        applied: args.apply,
        path: 'driver-fulfillment completion (milestone inference, shipment recompute, attendance sync)',
        handoffId: plan.handoff?.id ?? null,
        reason: args.reason,
      },
    });
    lines.push(`audit_logs row written for trip ${plan.tripId}`);
  } else {
    if (plan.status === TripStatus.COMPLETED || plan.status === TripStatus.CANCELED) {
      return [`trip ${plan.tripId} already ${plan.status} — cancel refused`];
    }
    if (!args.reason) {
      return [`trip ${plan.tripId} cancel requires --reason (audit trail names why)`];
    }
    if (args.apply) {
      const { trip: canceled } = await transitionTripWriteCommand({
        tripId: plan.tripId,
        targetStatus: TripStatus.CANCELED,
        actor: { userId: actor.id, role: actor.role as never },
        expectedVersion: plan.version,
      });
      await invalidateReportCaches();
      await syncAttendanceAfterStatusChange(
        canceled.id, TripStatus.CANCELED, canceled.driverId ?? null,
        canceled.departureDate ?? null, null, actor.id,
      );
      try {
        emitNotification({
          type: NotificationType.TRIP_CANCELED,
          title: 'Chuyến đã hủy',
          message: `Chuyến ${plan.tripCode ?? ''} đã bị hủy (dọn dữ liệu SIL-817)`,
          relatedEntityType: 'trips',
          relatedEntityId: plan.tripId,
          targetDriverId: plan.driverId ?? undefined,
        });
      } catch (notifyError) {
        lines.push(`notification emit skipped: ${notifyError instanceof Error ? notifyError.message : String(notifyError)}`);
      }
      lines.push(`trip ${plan.tripId} ${plan.tripCode ?? ''} → CANCELED`);
    } else {
      lines.push(`trip ${plan.tripId} ${plan.tripCode ?? ''} would CANCEL (staff path + attendance resync)`);
    }
    await persistAudit({
      event: AuditEvent.TRIP_CANCELED,
      entityType: 'trips',
      entityId: plan.tripId,
      entityKey: plan.tripCode ?? undefined,
      actorRole: actor.role,
      actorName: actor.fullName ?? `user ${actor.id}`,
      userId: actor.id,
      metadata: {
        repair: 'SIL-817',
        applied: args.apply,
        path: 'staff cancel (transition + attendance resync)',
        handoffId: plan.handoff?.id ?? null,
        reason: args.reason,
      },
    });
    lines.push(`audit_logs row written for trip ${plan.tripId}`);
  }
  return lines;
}

async function main() {
  const args = parseArgs();
  if (args.trips.length + args.shipments.length + args.handoffIds.length === 0) {
    console.error('[repair] nothing selected — pass --trip <id> / --shipment <id> / --handoff <id>');
    exit(2);
  }
  if (args.apply) {
    if (args.actorUserId == null) {
      console.error('[repair] --apply requires --actor-user-id <staffId> (signs the audit trail)');
      exit(2);
    }
    if (args.action === 'cancel' && !args.reason) {
      console.error('[repair] --action cancel requires --reason');
      exit(2);
    }
  }

  const actor = await loadActor(args);
  if (args.apply) {
    if (!actor) {
      console.error(`[repair] actor user ${args.actorUserId} not found`);
      exit(2);
    }
    if (actor.role === 'DRIVER') {
      console.error('[repair] actor must be staff (the repair signs the dispatch/ops trail)');
      exit(2);
    }
    console.log(`[repair] actor: ${actor.fullName ?? actor.id} (${actor.role})`);
  }

  const plans = await loadStuckTripPlans(args);
  const handoffOnly = await loadHandoffOnly(args);
  if (plans.length === 0 && handoffOnly.length === 0) {
    console.log('[repair] no matching stuck trips/handoffs — nothing to do');
    return;
  }

  console.log(`[repair] mode: ${args.apply ? 'APPLY' : 'DRY-RUN (pass --apply to write)'} action=${args.action}`);
  for (const plan of plans) {
    console.log(`  trip ${plan.tripId} ${plan.tripCode ?? ''} [${plan.status}] v${plan.version} driver=${plan.driverId ?? '—'} (${plan.driverName ?? '—'}) ship=${plan.shipmentCode ?? plan.shipmentId ?? '—'} handoff=${plan.handoff ? `#${plan.handoff.id} ${plan.handoff.status} handler=${plan.handoff.handlerId ?? 'NULL'}` : 'none'}`);
  }
  for (const handoff of handoffOnly) {
    console.log(`  handoff #${handoff.id} [${handoff.status}] v${handoff.version} handler=${handoff.handlerId ?? 'NULL'} ship=${handoff.shipmentCode ?? handoff.shipmentId}`);
  }

  if (!args.apply) {
    console.log('[repair] dry run — nothing written. Decide complete vs cancel per trip, then rerun with --apply --actor-user-id <staffId>.');
    return;
  }
  if (!actor) exit(2); // unreachable: validated above

  // CLI vocabulary is lowercase; the service/DB domain is UPPERCASE. Map
  // explicitly — the enum column is plain text (applicationEnum), so a raw
  // passthrough would silently write 'accept' instead of 'ACCEPTED'.
  const resolution: 'ACCEPTED' | 'REJECTED' = args.handoffResolution === 'accept'
    ? 'ACCEPTED'
    : args.handoffResolution === 'reject'
      ? 'REJECTED'
      : args.action === 'complete' ? 'ACCEPTED' : 'REJECTED';
  // A handoff reached through --shipment/--trip must not be resolved twice
  // when also named by --handoff (second resolve would just report "already
  // resolved", but the log should not imply double work).
  const standaloneHandoffs = handoffOnly.filter((handoff) => !plans.some((plan) => plan.handoff?.id === handoff.id));

  for (const plan of plans) {
    try {
      for (const line of await repairTrip(plan, args, actor)) console.log(`  ${line}`);
      if (plan.handoff) {
        console.log(`  ${await resolveHandoffFor(plan.handoff, resolution, actor.id, args.reason)}`);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        console.error(`  trip ${plan.tripId} FAILED: ${error.statusCode} ${error.message}`);
      } else {
        console.error(`  trip ${plan.tripId} FAILED:`, error);
      }
    }
  }
  for (const handoff of standaloneHandoffs) {
    try {
      console.log(`  ${await resolveHandoffFor(handoff, resolution, actor.id, args.reason)}`);
    } catch (error) {
      if (error instanceof ApiError) {
        console.error(`  handoff #${handoff.id} FAILED: ${error.statusCode} ${error.message}`);
      } else {
        console.error(`  handoff #${handoff.id} FAILED:`, error);
      }
    }
  }
  console.log('[repair] done');
}

main()
  .then(() => client.end())
  .then(() => exit(0))
  .catch((error) => {
    console.error('[repair] fatal:', error);
    exit(1);
  });
