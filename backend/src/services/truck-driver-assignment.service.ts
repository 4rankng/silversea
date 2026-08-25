/**
 * Driver<->truck assignment — the single read/write authority over
 * truck_driver_assignments (Phase 3 of the driver-vehicle assignment plan).
 * Every legacy drivers.assignedTruckId consumer migrates onto the helpers
 * here; the legacy column stays in place, read-only, until the Phase 5
 * cleanup gate drops it.
 *
 * Layering: imports dispatch-planning-utils only (utils <- this <- everyone),
 * so detail-plan/commands/queries can all depend on it acyclically.
 */
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { assertDispatchActor, type Tx } from './dispatch-planning-utils.service';

type DbClient = typeof db | Tx;

const activePrimary = () => and(
  isNull(s.truckDriverAssignments.endsAt),
  eq(s.truckDriverAssignments.role, 'PRIMARY'),
);

export interface ActiveTruckDriver {
  truckId: number;
  driverId: number;
  driverName: string;
  driverUserId: number | null;
}

/**
 * Who currently drives this truck, under dispatch semantics: the driver must
 * be alive and ACTIVE (mirrors the legacy resolveDispatchVehicleAssignment
 * derivation exactly, including its hint behavior on missing drivers).
 * At most one row can exist per truck — the partial unique index guarantees
 * determinism, no ORDER BY needed.
 */
export async function getActiveAssignment(client: DbClient, truckId: number): Promise<ActiveTruckDriver | null> {
  const [row] = await client.select({
    truckId: s.truckDriverAssignments.truckId,
    driverId: s.truckDriverAssignments.driverId,
    driverName: s.drivers.name,
    driverUserId: s.drivers.userId,
  }).from(s.truckDriverAssignments)
    .innerJoin(s.drivers, eq(s.drivers.id, s.truckDriverAssignments.driverId))
    .where(and(
      eq(s.truckDriverAssignments.truckId, truckId),
      activePrimary(),
      isNull(s.drivers.deletedAt),
      eq(s.drivers.status, 'ACTIVE'),
    ))
    .limit(1);
  return row ?? null;
}

/**
 * Batch truck→driver map for list views. Matches the legacy dispatch fleet
 * query semantics: driver rows soft-delete-filtered only (status is not
 * filtered, so an INACTIVE-status driver's assignment still resolves, as it
 * did when it lived on drivers.assignedTruckId).
 */
export async function getActiveAssignmentsByTruckIds(
  client: DbClient,
  truckIds: number[],
): Promise<Map<number, { driverId: number; driverName: string }>> {
  const unique = [...new Set(truckIds)];
  if (unique.length === 0) return new Map();
  const rows = await client.select({
    truckId: s.truckDriverAssignments.truckId,
    driverId: s.truckDriverAssignments.driverId,
    driverName: s.drivers.name,
  }).from(s.truckDriverAssignments)
    .innerJoin(s.drivers, eq(s.drivers.id, s.truckDriverAssignments.driverId))
    .where(and(
      inArray(s.truckDriverAssignments.truckId, unique),
      activePrimary(),
      isNull(s.drivers.deletedAt),
    ));
  return new Map(rows.map((row) => [row.truckId, { driverId: row.driverId, driverName: row.driverName }]));
}

/**
 * Driver→truck resolution for the driver-facing fallback reads. Joins the
 * driver row and filters soft-deletes, matching the legacy query's semantics.
 */
export async function getActiveTruckIdForDriver(client: DbClient, driverId: number): Promise<number | null> {
  const [row] = await client.select({ truckId: s.truckDriverAssignments.truckId })
    .from(s.truckDriverAssignments)
    .innerJoin(s.drivers, eq(s.drivers.id, s.truckDriverAssignments.driverId))
    .where(and(
      eq(s.truckDriverAssignments.driverId, driverId),
      activePrimary(),
      isNull(s.drivers.deletedAt),
    ))
    .limit(1);
  return row?.truckId ?? null;
}

/** Batch driver→truck map for roster/list reads. */
export async function getActiveTruckIdByDriverIds(
  client: DbClient,
  driverIds: number[],
): Promise<Map<number, number>> {
  const unique = [...new Set(driverIds)];
  if (unique.length === 0) return new Map();
  const rows = await client.select({
    driverId: s.truckDriverAssignments.driverId,
    truckId: s.truckDriverAssignments.truckId,
  }).from(s.truckDriverAssignments)
    .where(and(
      inArray(s.truckDriverAssignments.driverId, unique),
      activePrimary(),
    ));
  return new Map(rows.map((row) => [row.driverId, row.truckId]));
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  // Drizzle wraps driver errors (DrizzleQueryError) — the Postgres code sits
  // on the cause; unwrapped postgres.js errors carry it directly.
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
}

/**
 * Transactional core: end the truck's current active assignment row (if any)
 * and start a new one for the incoming driver — never a hand-edit of a live
 * row. Callers that already hold the 6201-class advisory lock for this truck
 * (bulk import batches) pass skipAdvisoryLock to avoid self-deadlock; every
 * other path takes the lock, using the same lock class as dispatch issuance
 * so a reassignment and an order issuance on one truck serialize.
 */
export async function reassignTruckDriverInTx(tx: Tx, input: {
  truckId: number;
  /** null ends the active assignment without starting a replacement. */
  driverId: number | null;
  createdBy: number | null;
  skipAdvisoryLock?: boolean;
}): Promise<{ previousDriverId: number | null }> {
  const [truck] = await tx.select({
    id: s.trucks.id,
    status: s.trucks.status,
    deletedAt: s.trucks.deletedAt,
  }).from(s.trucks).where(eq(s.trucks.id, input.truckId)).limit(1);
  if (!truck || truck.deletedAt != null || truck.status !== 'ACTIVE') {
    throw new ApiError(400, 'Xe đầu kéo liên kết không tồn tại hoặc đã ngưng dùng');
  }

  if (input.driverId != null) {
    const [driver] = await tx.select({
      id: s.drivers.id,
      status: s.drivers.status,
      deletedAt: s.drivers.deletedAt,
    }).from(s.drivers).where(eq(s.drivers.id, input.driverId)).limit(1);
    if (!driver || driver.deletedAt != null || driver.status !== 'ACTIVE') {
      throw new ApiError(400, 'Tài xế liên kết không tồn tại hoặc đã ngưng dùng');
    }
  }

  if (input.skipAdvisoryLock !== true) {
    // Same advisory-lock class as dispatch issuance contention (6201), so a
    // reassignment and an order issuance on the same truck serialize.
    await tx.execute(sql`select pg_advisory_xact_lock(6201, ${input.truckId})`);
  }

  const [current] = await tx.select({
    id: s.truckDriverAssignments.id,
    driverId: s.truckDriverAssignments.driverId,
  }).from(s.truckDriverAssignments)
    .where(and(
      eq(s.truckDriverAssignments.truckId, input.truckId),
      activePrimary(),
    ))
    .limit(1)
    .for('update');

  if (current?.driverId === input.driverId) {
    // No-op for the table — but still re-sync the legacy mirror in case it
    // drifted (hand-edited data, old fixture): the table is authoritative,
    // the column is only a compatibility mirror.
    if (input.driverId != null) {
      await tx.update(s.drivers)
        .set({ assignedTruckId: input.truckId, updatedAt: new Date() })
        .where(eq(s.drivers.id, input.driverId));
    }
    return { previousDriverId: current.driverId };
  }

  if (current) {
    await tx.update(s.truckDriverAssignments)
      .set({ endsAt: new Date() })
      .where(eq(s.truckDriverAssignments.id, current.id));
  }

  // Move semantics: the incoming driver leaves any OTHER truck first — one
  // active PRIMARY row per driver, exactly like the legacy single-value
  // column meant. The per-driver partial unique index is the backstop; this
  // loop keeps the write legal instead of tripping it.
  if (input.driverId != null) {
    const otherTrucks = await tx.select({
      id: s.truckDriverAssignments.id,
    }).from(s.truckDriverAssignments)
      .where(and(
        eq(s.truckDriverAssignments.driverId, input.driverId),
        activePrimary(),
        ne(s.truckDriverAssignments.truckId, input.truckId),
      ))
      .for('update');
    for (const other of otherTrucks) {
      await tx.update(s.truckDriverAssignments)
        .set({ endsAt: new Date() })
        .where(eq(s.truckDriverAssignments.id, other.id));
    }
  }

  // Deprecation-window mirror: keep drivers.assignedTruckId in sync until the
  // Phase 5 drop gate removes the column. Every migrated reader already uses
  // the assignment table; this mirror exists so unmigrated surfaces (generic
  // catalog CRUD lists, seeded fixtures) never show stale pairing data.
  if (current != null && current.driverId !== input.driverId) {
    await tx.update(s.drivers)
      .set({ assignedTruckId: null, updatedAt: new Date() })
      .where(eq(s.drivers.id, current.driverId));
  }
  if (input.driverId != null) {
    await tx.update(s.drivers)
      .set({ assignedTruckId: input.truckId, updatedAt: new Date() })
      .where(eq(s.drivers.id, input.driverId));
  }

  if (input.driverId != null) {
    try {
      await tx.insert(s.truckDriverAssignments).values({
        truckId: input.truckId,
        driverId: input.driverId,
        role: 'PRIMARY',
        createdBy: input.createdBy,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A concurrent path bypassing the advisory lock hit the partial
        // unique index — surface it as contention, not a raw 500.
        throw new ApiError(409, 'Xe đã được gán cho tài xế khác. Vui lòng tải lại.');
      }
      throw error;
    }
  }

  return { previousDriverId: current?.driverId ?? null };
}

/**
 * Authorized reassignment entry point. Gated exactly like every other
 * privileged dispatch mutation (assertDispatchActor) — the consolidation
 * decision (validation session 1) moved ADMIN/ACCOUNTANT form writes here,
 * onto the dispatch-owned surface.
 */
export async function reassignTruckDriver(
  actor: AuthUser,
  input: { truckId: number; driverId: number | null },
): Promise<{ previousDriverId: number | null }> {
  assertDispatchActor(actor);
  return db.transaction((tx) => reassignTruckDriverInTx(tx, {
    truckId: input.truckId,
    driverId: input.driverId,
    createdBy: actor.userId,
  }));
}

/** Durable command boundary for the route (idempotent replay-safe reassign). */
export async function reassignTruckDriverWriteCommand(input: {
  truckId: number;
  driverId: number | null;
  idempotencyKey: string;
  actor: AuthUser;
}): Promise<{ truckId: number; driverId: number | null; previousDriverId: number | null; replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<{ previousDriverId: number | null }>({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRUCK_DRIVER_REASSIGN,
    idempotencyKey: input.idempotencyKey,
    payload: {
      truckId: input.truckId,
      driverId: input.driverId,
    },
    createdBy: input.actor.userId,
    entityType: 'trucks',
    getEntityId: () => input.truckId,
    create: (tx) => reassignTruckDriverInTx(tx, {
      truckId: input.truckId,
      driverId: input.driverId,
      createdBy: input.actor.userId,
    }),
  });
  return {
    truckId: input.truckId,
    driverId: input.driverId,
    previousDriverId: outcome.result.previousDriverId,
    replayed: outcome.replayed,
  };
}
