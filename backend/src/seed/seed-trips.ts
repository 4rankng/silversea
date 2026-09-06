/**
 * Seed trips through the REAL dispatch chain so dispatch/ops screens reflect
 * production-shaped data:
 *
 *   assignShipmentCarriers  (CUS allocates carrier → fulfillments get plannedCarrierType)
 *     → acceptDispatchHandoff  (dispatcher takes the job)
 *       → issueFulfillmentDispatchOrder  (fulfillment-linked trip + containers + notifications)
 *         → transitionTripStatus  (IN_TRANSIT, then COMPLETED via routine close)
 *
 * Prerequisites this module establishes itself (idempotent):
 *   - one ACTIVE trailer per ACTIVE 60C truck (dispatch requires it)
 *   - driver ↔ user links (dispatch validates the driver's ACTIVE user)
 *   - one ACTIVE carrier customer + fleet vehicles (EXTERNAL dispatch requires it)
 *
 * Only dispatches shipments still in READY_FOR_DISPATCH with fully specified
 * containers. Idempotent: shipments that already have a live trip are skipped.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { Role, TripStatus } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import { assignShipmentCarriers } from '../services/shipment-intake.service';
import {
  acceptDispatchHandoff,
  issueFulfillmentDispatchOrder,
} from '../services/dispatch-planning.service';
import { transitionTripStatus } from '../services/trip-status-machine.service';
import { createTripExpense } from '../services/forwarder.service';
import { createPodSubmission, submitPod, attachPodFile } from '../services/trip-pod.service';
import { reviewTripPodSubmission } from '../services/shipment.service';
import { TripPodFileType } from '@tingting/shared';

/** Demo actor ids resolved at runtime by username. */
export interface SeedActorIds {
  cus: number;
  dispatcher: number;
  manager: number;
  accountant: number;
}

export async function resolveSeedActors() {
  const rows = await db.select()
    .from(s.users)
    .where(and(isNull(s.users.deletedAt), inArray(s.users.username, ['cus', 'dieuvan', 'giamdoc', 'ketoan'])));
  const byUsername = new Map(rows.map(r => [r.username, r]));
  // AuthUser carries `userId` while the users table exposes `id` — bridge it.
  const pick = (username: string, role: Role) => {
    const row = byUsername.get(username);
    if (!row || row.role !== role) throw new Error(`Seed actor ${username} (${role}) not found — run the user seeder first.`);
    return { ...row, userId: row.id, role } as AuthUser;
  };
  return {
    cus: pick('cus', Role.CUS),
    dispatcher: pick('dieuvan', Role.DISPATCHER) as AuthUser & { role: Role.DISPATCHER },
    manager: pick('giamdoc', Role.MANAGER),
    accountant: pick('ketoan', Role.ACCOUNTANT),
  };
}

/** Minimal valid PDF (header + content + trailer) for e-POD uploads. */
function minimalPdf(label: string): { buffer: Buffer; mimetype: string; originalname: string; size: number } {
  const content = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R>>endobj\n4 0 obj<</Length ${label.length}>>stream\n${label}\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
  const buffer = Buffer.from(content, 'utf8');
  return { buffer, mimetype: 'application/pdf', originalname: `${label}.pdf`, size: buffer.length };
}

/** Match the plate normalization used across fleet screens. */
function plateKey(plate: string): string {
  return plate.replace(/[.\s]/g, '').toUpperCase();
}

/** One ACTIVE 40FT trailer per ACTIVE 60C truck, plus the trucks.currentTrailerId link. */
async function ensureTrailers() {
  const trucks = await db.select({ id: s.trucks.id, plate: s.trucks.licensePlate })
    .from(s.trucks).where(and(eq(s.trucks.status, 'ACTIVE'), isNull(s.trucks.deletedAt)));
  let created = 0;
  for (const truck of trucks) {
    if (!truck.plate.startsWith('60C')) continue; // Excel fleet rows already carry their own trailers
    const trailerPlate = `RM-${truck.plate}`;
    const [existing] = await db.select({ id: s.trailers.id })
      .from(s.trailers).where(eq(s.trailers.licensePlate, trailerPlate)).limit(1);
    let trailerId = existing?.id;
    if (!trailerId) {
      const [inserted] = await db.insert(s.trailers).values({
        licensePlate: trailerPlate,
        type: '40FT',
        status: 'ACTIVE',
      }).returning({ id: s.trailers.id });
      trailerId = inserted!.id;
      created++;
    }
    await db.update(s.trucks).set({ currentTrailerId: trailerId, updatedAt: new Date() })
      .where(eq(s.trucks.id, truck.id));
  }
  if (created > 0) console.log(`✅ Trailers seeded! (${created} new, linked to trucks)`);
}

/** Backfill drivers.user_id for demo drivers lacking the link. */
async function ensureDriverUserLinks() {
  const driverUsers = await db.select({ id: s.users.id, phone: s.users.phone })
    .from(s.users)
    .where(and(eq(s.users.role, Role.DRIVER), isNull(s.users.deletedAt)));
  let linked = 0;
  for (const u of driverUsers) {
    if (!u.phone) continue;
    const updated = await db.update(s.drivers)
      .set({ userId: u.id })
      .where(and(
        eq(s.drivers.phone, u.phone),
        isNull(s.drivers.userId),
        isNull(s.drivers.deletedAt),
      )).returning({ id: s.drivers.id });
    linked += updated.length;
  }
  if (linked > 0) console.log(`✅ Driver↔user links backfilled! (${linked})`);
}

/** Demo external carrier customer + fleet vehicles (both tables start empty). */
async function ensureExternalCarrier(createdBy: number): Promise<number> {
  const CARRIER_TAX_CODE = '0200987654';
  const [existing] = await db.select({ id: s.customers.id })
    .from(s.customers)
    .where(and(
      sql`lower(btrim(${s.customers.taxCode})) = ${CARRIER_TAX_CODE}`,
      isNull(s.customers.deletedAt),
    ))
    .limit(1);
  let carrierId = existing?.id;
  if (!carrierId) {
    const [inserted] = await db.insert(s.customers).values({
      name: 'Công ty TNHH Vận tải Gaya Container Lines',
      shortName: 'Gaya Container Lines',
      taxCode: CARRIER_TAX_CODE,
      contactPerson: 'Đỗ Thị Gaya',
      phone: '02253866778',
      isCarrier: true,
      status: 'ACTIVE',
    }).returning({ id: s.customers.id });
    carrierId = inserted!.id;
    console.log('✅ External carrier customer seeded (Gaya Container Lines)!');
  }
  const fleet = [
    { plate: '15H-154.98' },
    { plate: '19H-04848' },
  ];
  let vehicles = 0;
  for (const v of fleet) {
    const [existingVehicle] = await db.select({ id: s.carrierFleetVehicles.id })
      .from(s.carrierFleetVehicles)
      .where(and(
        eq(s.carrierFleetVehicles.carrierId, carrierId),
        eq(s.carrierFleetVehicles.normalizedPlate, plateKey(v.plate)),
      )).limit(1);
    if (existingVehicle) continue;
    await db.insert(s.carrierFleetVehicles).values({
      carrierId,
      licensePlate: v.plate,
      normalizedPlate: plateKey(v.plate),
      isActive: true,
      createdBy,
    });
    vehicles++;
  }
  if (vehicles > 0) console.log(`✅ Carrier fleet vehicles seeded! (${vehicles})`);
  return carrierId;
}

interface TripSeedPlan {
  ref: string; // blNumber (IMPORT) or bookingRef (EXPORT)
  carrierType: 'OWN' | 'EXTERNAL';
  truckPlate?: string;
  driverName?: string;
  externalPlate?: string;
  externalDriverName?: string;
  externalDriverPhone?: string;
  advanceTo?: 'IN_TRANSIT' | 'COMPLETED';
  plannedStartAt: string; // +07:00 ISO
  plannedEndAt: string;
}

const TRIP_PLANS: TripSeedPlan[] = [
  {
    ref: '105254549001', carrierType: 'OWN',
    truckPlate: '60C-45678', driverName: 'Nguyễn Văn Phố',
    advanceTo: 'COMPLETED',
    plannedStartAt: '2026-08-12T05:30:00+07:00', plannedEndAt: '2026-08-12T17:30:00+07:00',
  },
  {
    ref: '105254549088', carrierType: 'OWN',
    truckPlate: '60C-12345', driverName: 'Phạm Văn Hùng',
    advanceTo: 'COMPLETED',
    plannedStartAt: '2026-08-01T05:30:00+07:00', plannedEndAt: '2026-08-01T16:00:00+07:00',
  },
  {
    ref: 'DNKM13338', carrierType: 'OWN',
    truckPlate: '60C-23456', driverName: 'Nguyễn Văn Thụ',
    advanceTo: 'COMPLETED',
    plannedStartAt: '2026-07-25T06:00:00+07:00', plannedEndAt: '2026-07-25T17:00:00+07:00',
  },
  {
    ref: '105254550147', carrierType: 'OWN',
    truckPlate: '60C-34567', driverName: 'Lê Văn Quyết',
    advanceTo: 'COMPLETED',
    plannedStartAt: '2026-07-20T05:00:00+07:00', plannedEndAt: '2026-07-20T15:30:00+07:00',
  },
  {
    ref: '137465192255', carrierType: 'OWN',
    truckPlate: '60C-45678', driverName: 'Nguyễn Văn Phố',
    advanceTo: 'COMPLETED',
    plannedStartAt: '2026-07-27T05:30:00+07:00', plannedEndAt: '2026-07-27T17:00:00+07:00',
  },
  {
    ref: '137465191612', carrierType: 'OWN',
    truckPlate: '60C-12345', driverName: 'Phạm Văn Hùng',
    advanceTo: 'IN_TRANSIT',
    plannedStartAt: '2026-08-17T05:30:00+07:00', plannedEndAt: '2026-08-17T17:00:00+07:00',
  },
  {
    ref: 'DNKM13335', carrierType: 'OWN',
    truckPlate: '60C-23456', driverName: 'Nguyễn Văn Thụ',
    advanceTo: 'IN_TRANSIT',
    plannedStartAt: '2026-08-17T06:00:00+07:00', plannedEndAt: '2026-08-17T16:30:00+07:00',
  },
  {
    ref: '137465191698', carrierType: 'OWN',
    truckPlate: '60C-34567', driverName: 'Lê Văn Quyết',
    advanceTo: 'IN_TRANSIT',
    plannedStartAt: '2026-08-16T05:00:00+07:00', plannedEndAt: '2026-08-16T15:00:00+07:00',
  },
  {
    ref: 'DNKM13336', carrierType: 'EXTERNAL',
    externalPlate: '15H-154.98', externalDriverName: 'Vũ Văn Giang', externalDriverPhone: '0912111222',
    advanceTo: 'IN_TRANSIT',
    plannedStartAt: '2026-08-16T07:00:00+07:00', plannedEndAt: '2026-08-16T18:00:00+07:00',
  },
];

type SeedActors = Awaited<ReturnType<typeof resolveSeedActors>>;

export async function seedTrips(seedActors: SeedActors & {
  ops?: typeof s.users.$inferSelect;
}): Promise<{ created: number; skipped: number; opsExpenseIds: number[] }> {
  await ensureTrailers();
  await ensureDriverUserLinks();
  const externalCarrierId = await ensureExternalCarrier(seedActors.dispatcher.userId);

  const cusActor = seedActors.cus;
  const dispatcherActor = seedActors.dispatcher;
  const accountantActor = seedActors.accountant;

  const trucks = await db.select({ id: s.trucks.id, plate: s.trucks.licensePlate })
    .from(s.trucks).where(and(eq(s.trucks.status, 'ACTIVE'), isNull(s.trucks.deletedAt)));
  const truckByPlate = new Map(trucks.map(t => [t.plate, t.id]));
  const drivers = await db.select({ id: s.drivers.id, name: s.drivers.name })
    .from(s.drivers).where(and(isNull(s.drivers.deletedAt), eq(s.drivers.status, 'ACTIVE')));
  const driverByName = new Map(drivers.map(d => [d.name, d.id]));
  // Scope to THIS run's carrier — stale fleet rows from prior failed runs
  // must never satisfy the plate lookup (issue-order validates carrier match).
  const fleetVehicles = await db.select({
    id: s.carrierFleetVehicles.id,
    plate: s.carrierFleetVehicles.licensePlate,
  })
    .from(s.carrierFleetVehicles)
    .where(and(
      eq(s.carrierFleetVehicles.isActive, true),
      isNull(s.carrierFleetVehicles.deletedAt),
      eq(s.carrierFleetVehicles.carrierId, externalCarrierId),
    ));
  const vehicleByPlate = new Map(fleetVehicles.map(v => [plateKey(v.plate), v.id]));

  let created = 0;
  let skipped = 0;
  const opsExpenseIds: number[] = [];
  // The first two COMPLETED plans carry forwarder-owned expenses that later
  // feed the advance settlement (scope must complete pre-close).
  const OPS_EXPENSE_REFS = new Set(['105254549001', '105254549088']);

  for (const plan of TRIP_PLANS) {
    // Resolve the OWN-carrier fixtures before touching the shipment: on
    // prod-synced DBs the demo driver row can be legitimately absent (the
    // linked demo user may already own a differently-named active driver row,
    // and the one-active-driver-per-user constraint makes the seed skip it).
    // issueFulfillmentDispatchOrder hard-rejects OWN without truck+driver, so
    // a missing fixture must skip the whole plan, not crash the seed.
    if (plan.carrierType === 'OWN') {
      const truckId = truckByPlate.get(plan.truckPlate!) ?? null;
      const driverId = driverByName.get(plan.driverName!) ?? null;
      if (truckId == null || driverId == null) {
        console.warn(
          `[seed-trips] skip ${plan.ref}: OWN fixture unresolved (truck=${plan.truckPlate}:${truckId != null}, driver=${plan.driverName}:${driverId != null})`,
        );
        skipped++;
        continue;
      }
    }
    const [shipment] = await db.select({
      id: s.shipments.id, version: s.shipments.version, status: s.shipments.status,
    })
      .from(s.shipments)
      .where(and(
        isNull(s.shipments.deletedAt),
        sql`(${s.shipments.blNumber} = ${plan.ref} or ${s.shipments.bookingRef} = ${plan.ref})`,
      ))
      .limit(1);
    if (!shipment || shipment.status !== 'READY_FOR_DISPATCH') {
      skipped++;
      continue;
    }

    // Live trip already exists → idempotent skip.
    const [liveTrip] = await db.select({ id: s.trips.id })
      .from(s.trips)
      .where(and(
        eq(s.trips.shipmentId, shipment.id),
        isNull(s.trips.deletedAt),
        sql`${s.trips.status} <> 'CANCELED'`,
      ))
      .limit(1);
    if (liveTrip) { skipped++; continue; }

    // Count containers by 20/40 bucket to build an exact allocation.
    const containers = await db.select({
      typeCode: s.containerTypes.code,
    })
      .from(s.shipmentContainers)
      .innerJoin(s.containerTypes, eq(s.shipmentContainers.containerTypeId, s.containerTypes.id))
      .where(eq(s.shipmentContainers.shipmentId, shipment.id));
    const count20 = containers.filter(c => c.typeCode.startsWith('20')).length;
    const count40 = containers.filter(c => !c.typeCode.startsWith('20')).length;

    // CUS allocates the planned carrier across all containers.
    const allocation = await assignShipmentCarriers({
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      carrierAllocations: [{
        carrierType: plan.carrierType,
        count20: plan.carrierType === 'OWN' ? count20 : count20,
        count40: plan.carrierType === 'OWN' ? count40 : count40,
        ...(plan.carrierType === 'EXTERNAL' ? { externalCarrierId } : {}),
      }],
      actor: cusActor,
    });

    const target = allocation.assignments[0];
    if (!target) {
      console.warn(`  ⚠️ Trip seed: no fulfillment assignment for ${plan.ref}`);
      skipped++;
      continue;
    }

    // Dispatcher takes the open handoff (created when the shipment became ready).
    const [handoff] = await db.select({
      id: s.dispatchHandoffs.id,
      version: s.dispatchHandoffs.version,
      status: s.dispatchHandoffs.status,
    })
      .from(s.dispatchHandoffs)
      .where(and(
        eq(s.dispatchHandoffs.shipmentId, shipment.id),
        inArray(s.dispatchHandoffs.status, ['UNSEEN', 'SEEN']),
      ))
      .orderBy(sql`${s.dispatchHandoffs.id} desc`)
      .limit(1);
    if (handoff) {
      await acceptDispatchHandoff({
        shipmentId: shipment.id,
        handoffId: handoff.id,
        expectedVersion: handoff.version,
        actor: dispatcherActor,
      });
    }

    // Issue the dispatch order → creates the fulfillment-linked trip.
    const order = await issueFulfillmentDispatchOrder({
      shipmentId: shipment.id,
      fulfillmentId: target.fulfillmentId,
      expectedVersion: target.version,
      plannedStartAt: plan.plannedStartAt,
      plannedEndAt: plan.plannedEndAt,
      endTimeConfirmed: true,
      carrierType: plan.carrierType,
      truckId: plan.carrierType === 'OWN' ? (truckByPlate.get(plan.truckPlate!) ?? null) : null,
      driverId: plan.carrierType === 'OWN' ? (driverByName.get(plan.driverName!) ?? null) : null,
      externalCarrierId: plan.carrierType === 'EXTERNAL' ? externalCarrierId : null,
      externalCarrierVehicleId: plan.carrierType === 'EXTERNAL'
        ? (vehicleByPlate.get(plateKey(plan.externalPlate!)) ?? null)
        : null,
      externalDriverName: plan.carrierType === 'EXTERNAL' ? plan.externalDriverName : null,
      externalDriverPhone: plan.carrierType === 'EXTERNAL' ? plan.externalDriverPhone : null,
      // Fresh key per run: idempotency_keys is PRESERVED across wipes, so a
      // stable key would collide with a prior run's different payload.
      idempotencyKey: `seed-trip:${plan.ref}:${new Date().toISOString()}`,
      actor: dispatcherActor,
    });

    created++;

    if (plan.advanceTo === 'IN_TRANSIT') {
      await transitionTripStatus(order.trip.id, TripStatus.IN_TRANSIT, dispatcherActor.userId, dispatcherActor.role);
      // Production fires this from driver progress events; seed mirrors the
      // same recompute so the shipment reflects the running trip.
      const { recomputeShipmentCompletion } = await import('../services/shipment.service.js');
      await recomputeShipmentCompletion(shipment.id, { changedBy: dispatcherActor.userId });
    } else if (plan.advanceTo === 'COMPLETED') {
      await transitionTripStatus(order.trip.id, TripStatus.IN_TRANSIT, dispatcherActor.userId, dispatcherActor.role);
      // Forwarder (OPS) books recoverable fees on the first two completed
      // chains while the trip is still open — expense creation resets the
      // completion scope, so they must land before the scope rows below.
      if (seedActors.ops && OPS_EXPENSE_REFS.has(plan.ref)) {
        const expense = await createTripExpense(db, {
          tripId: order.trip.id,
          forwarderId: seedActors.ops.id,
          expenseType: plan.ref === '105254549001' ? 'LIFTING' : 'OTHER',
          expenseDate: '2026-08-16',
          buyAmount: plan.ref === '105254549001' ? '1650000' : '820000',
          sellAmount: plan.ref === '105254549001' ? '1800000' : '900000',
          settlementMethod: 'OPS_ADVANCE',
          payeeName: plan.ref === '105254549001' ? 'Trạm nâng hạ cảng Đình Vũ' : null,
          invoiceNumber: plan.ref === '105254549001' ? null : 'BOT-2026-008812',
          noInvoiceEvidenceTypes: plan.ref === '105254549001' ? ['RECEIPT'] : [],
          note: plan.ref === '105254549001' ? 'Phí nâng container cảng Đình Vũ' : 'Phí cầu đường BOT QL5',
        } as never);
        opsExpenseIds.push(expense.id);
        // Settlement validation joins expenses to the forwarder via
        // user_shipment_links on the trip's shipment.
        const [existingLink] = await db.select({ id: s.userShipmentLinks.id })
          .from(s.userShipmentLinks)
          .where(and(
            eq(s.userShipmentLinks.userId, seedActors.ops.id),
            eq(s.userShipmentLinks.shipmentId, shipment.id),
          )).limit(1);
        if (!existingLink) {
          await db.insert(s.userShipmentLinks).values({
            userId: seedActors.ops.id,
            shipmentId: shipment.id,
          });
        }
      }
      // Real O2C close sequence:
      //   1. Expense scopes complete (general + per container) while the
      //      trip is still IN_TRANSIT — the close readiness gate reads them.
      //   2. Driver e-POD: submission → required files → submit.
      //   3. CUS accepts the e-POD (records POD recovery).
      //   4. A DIFFERENT accountant performs the routine close (checker
      //      separation forbids the same account accepting + closing).
      const tripContainers = await db.select({ id: s.tripContainers.id })
        .from(s.tripContainers).where(eq(s.tripContainers.tripId, order.trip.id));
      const now = new Date();
      const scopeValues = [
        {
          tripId: order.trip.id,
          tripContainerId: null,
          status: 'COMPLETED',
          completedBy: dispatcherActor.userId,
          completedAt: now,
        },
        ...tripContainers.map((container) => ({
          tripId: order.trip.id,
          tripContainerId: container.id,
          status: 'COMPLETED' as const,
          completedBy: dispatcherActor.userId,
          completedAt: now,
        })),
      ];
      for (const scope of scopeValues) {
        const scopeWhere = scope.tripContainerId == null
          ? and(eq(s.tripExpenseCompletionScopes.tripId, scope.tripId), isNull(s.tripExpenseCompletionScopes.tripContainerId))
          : eq(s.tripExpenseCompletionScopes.tripContainerId, scope.tripContainerId);
        const [existingScope] = await db.select({ id: s.tripExpenseCompletionScopes.id })
          .from(s.tripExpenseCompletionScopes).where(scopeWhere).limit(1);
        if (existingScope) {
          await db.update(s.tripExpenseCompletionScopes)
            .set({ status: 'COMPLETED', completedBy: scope.completedBy, completedAt: scope.completedAt, updatedAt: new Date() })
            .where(eq(s.tripExpenseCompletionScopes.id, existingScope.id));
        } else {
          await db.insert(s.tripExpenseCompletionScopes).values(scope);
        }
      }

      const [tripRow] = await db.select({
        id: s.trips.id,
        version: s.trips.version,
        tripCode: s.trips.tripCode,
        driverId: s.trips.driverId,
      }).from(s.trips).where(eq(s.trips.id, order.trip.id)).limit(1);
      let driverUserId: number | null = null;
      if (tripRow?.driverId != null) {
        const [driverUser] = await db.select({ userId: s.drivers.userId })
          .from(s.drivers).where(eq(s.drivers.id, tripRow.driverId)).limit(1);
        driverUserId = driverUser?.userId ?? null;
      }
      if (tripRow?.driverId != null && driverUserId != null) {
        const key = `seed-pod:${plan.ref}:${Date.now()}`;
        const created = await createPodSubmission({
          driverId: tripRow.driverId,
          actorUserId: driverUserId,
          fulfillmentId: target.fulfillmentId,
          expectedVersion: tripRow.version,
          idempotencyKey: `${key}:create`,
        });
        let submission = created.submission;
        for (const fileType of [TripPodFileType.YARD_OR_DROP_RECEIPT, TripPodFileType.SIGNED_DELIVERY_NOTE]) {
          const attached = await attachPodFile({
            driverId: tripRow.driverId,
            actorUserId: driverUserId,
            fulfillmentId: target.fulfillmentId,
            submissionId: submission.id,
            expectedVersion: submission.version,
            idempotencyKey: `${key}:file:${fileType}`,
            fileType,
            file: minimalPdf(`${order.trip.tripCode}-${fileType}`),
          });
          submission = attached.submission;
        }
        const submitted = await submitPod({
          driverId: tripRow.driverId,
          actorUserId: driverUserId,
          fulfillmentId: target.fulfillmentId,
          submissionId: submission.id,
          expectedVersion: submission.version,
          idempotencyKey: `${key}:submit`,
        });
        await reviewTripPodSubmission({
          shipmentId: shipment.id,
          submissionId: submitted.submission.id,
          expectedVersion: submitted.submission.version,
          resolution: 'ACCEPT',
          idempotencyKey: `${key}:review`,
          actor: cusActor,
          podRecovered: true,
        });
      }

      await transitionTripStatus(
        order.trip.id, TripStatus.COMPLETED, accountantActor.userId, accountantActor.role,
        true, // confirmZeroRevenue — seed trips carry no pricing-table match.
        true, // confirmNoPhoto — seed trips carry no photo evidence.
        { routineShipmentClose: true },
      );
    }
  }

  console.log(`✅ Trips seeded through dispatch chain! (${created} chains, ${skipped} skipped)`);
  return { created, skipped, opsExpenseIds };
}
