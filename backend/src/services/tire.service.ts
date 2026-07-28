import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, ne, sql } from 'drizzle-orm';
import { TIRE_STATUS_LABELS, type TireStatus } from '@tingting/shared';
import { ApiError } from '../errors';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * N1 — Tire lifecycle service.
 *
 * Tires are tracked by their immutable `serial`. A tire mounts on EITHER a
 * truck (truckId) OR a trailer (trailerId). install/remove/dispose are the
 * state transitions; each runs in a transaction so status + dates + the
 * vehicle ids stay consistent.
 *
 *   install:  {truck|trailer}Id + position + installed_at(now) + status=IN_USE, clear removed_at
 *   remove:   truckId/trailerId=null + removed_at(now) + status=IN_STOCK  (back to spare)
 *   dispose:  truckId/trailerId=null + removed_at(now) + status=DISPOSED + disposal_date(now) + disposal_reason
 *   transfer: {truck|trailer}Id + position → new vehicle; status stays IN_USE,
 *             installed_at PRESERVED (keeps "Số ngày chạy" across the move), clear removed_at
 *
 * Lifecycle guard: a tire already IN_USE must be removed first, and a DISPOSED
 * tire can never be re-installed. install + transfer also refuse to land a tire
 * on a position another IN_USE tire already occupies on the same vehicle.
 */

export interface InstallTireInput {
  truckId?: number | null;
  trailerId?: number | null;
  position?: string | null;
}

export interface DisposeTireInput {
  reason: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type TireSerialConflict = {
  id: number;
  serial: string;
  status: string | null;
  truckPlate: string | null;
  trailerPlate: string | null;
  position: string | null;
  deletedAt: Date | string | null;
  disposalDate: string | null;
};

export function tireSerialConflictMessage(tire: TireSerialConflict): string {
  const statusLabel = tire.status && tire.status in TIRE_STATUS_LABELS
    ? TIRE_STATUS_LABELS[tire.status as TireStatus]
    : tire.status || 'Không rõ trạng thái';
  const location = tire.truckPlate
    ? `xe ${tire.truckPlate}`
    : tire.trailerPlate
      ? `rơ-moóc ${tire.trailerPlate}`
      : tire.status === 'IN_STOCK'
        ? 'kho lốp dự phòng'
        : tire.status === 'DISPOSED'
          ? 'danh sách đã thanh lý'
          : tire.deletedAt
            ? 'bản ghi đã xóa'
            : 'hệ thống';
  const position = tire.position ? `, vị trí ${tire.position}` : '';
  return `Serial lốp ${tire.serial} đã tồn tại (${statusLabel}, ${location}${position})`;
}

export async function assertTireSerialAvailable(serial: string | undefined, excludeTireId?: number) {
  const normalizedSerial = serial?.trim();
  if (!normalizedSerial) return;

  const conditions = [eq(s.tires.serial, normalizedSerial)];
  if (excludeTireId != null) conditions.push(ne(s.tires.id, excludeTireId));

  const [existing] = await db.select({
    id: s.tires.id,
    serial: s.tires.serial,
    status: s.tires.status,
    truckPlate: s.trucks.licensePlate,
    trailerPlate: s.trailers.licensePlate,
    position: s.tires.position,
    deletedAt: s.tires.deletedAt,
    disposalDate: s.tires.disposalDate,
  })
    .from(s.tires)
    .leftJoin(s.trucks, eq(s.tires.truckId, s.trucks.id))
    .leftJoin(s.trailers, eq(s.tires.trailerId, s.trailers.id))
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new ApiError(409, tireSerialConflictMessage(existing));
  }
}

/** Local date (YYYY-MM-DD) using system timezone — avoids the UTC drift of
 *  toISOString() (e.g. a 1am Vietnam install recording the previous day). */
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Refuse to land a tire on a slot another IN_USE tire already fills on the same
 * vehicle. No-op when no position is given (nothing specific to conflict with).
 * `excludeTireId` skips the tire being moved so a transfer to its own current
 * slot — or any slot — isn't blocked by itself.
 */
async function assertPositionFree(
  tx: Tx,
  target: { truckId: number | null; trailerId: number | null; position: string | null },
  excludeTireId: number,
) {
  const position = target.position?.trim() || null;
  if (!position) return;
  const vehicleLockKey = target.truckId != null
    ? `truck:${target.truckId}`
    : target.trailerId != null
      ? `trailer:${target.trailerId}`
      : null;
  if (!vehicleLockKey) return;

  // Competing tire rows are different records, so row locks alone cannot
  // protect the shared vehicle-position invariant. Serialize that logical
  // slot before checking it; hash collisions only add harmless contention.
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext(${vehicleLockKey}), hashtext(${position}))
  `);

  // Callers guarantee exactly one of truckId/trailerId is set; narrow for eq().
  const onVehicle = target.truckId != null
    ? eq(s.tires.truckId, target.truckId)
    : target.trailerId != null
      ? eq(s.tires.trailerId, target.trailerId)
      : null;
  if (!onVehicle) return;

  const [conflict] = await tx.select({ id: s.tires.id }).from(s.tires)
    .where(and(
      eq(s.tires.status, 'IN_USE'),
      isNull(s.tires.deletedAt),
      onVehicle,
      eq(s.tires.position, position),
      ne(s.tires.id, excludeTireId),
    ))
    .limit(1);

  if (conflict) {
    const vehicleNoun = target.truckId != null ? 'xe đầu kéo' : 'rơ-moóc';
    throw new HttpError(409, `Vị trí "${position}" trên ${vehicleNoun} đã có lốp`);
  }
}

function assertExpectedUpdatedAt(
  actual: Date,
  expectedUpdatedAt: Date | undefined,
) {
  if (!expectedUpdatedAt) {
    throw new HttpError(428, 'Cần tải lại phiên bản lốp mới nhất trước khi thao tác.');
  }
  if (actual.getTime() !== expectedUpdatedAt.getTime()) {
    throw new HttpError(409, 'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.');
  }
}

/** Install a tire onto a truck OR trailer (sets IN_USE). Exactly one target. */
export async function installTire(tireId: number, input: InstallTireInput, expectedUpdatedAt: Date) {
  return db.transaction((tx) => installTireInTx(tx, tireId, input, expectedUpdatedAt));
}

export async function installTireInTx(
  tx: Tx,
  tireId: number,
  input: InstallTireInput,
  expectedUpdatedAt: Date,
) {
  const truckId = input.truckId ?? null;
  const trailerId = input.trailerId ?? null;
  if ((truckId == null) === (trailerId == null)) {
    throw new HttpError(400, 'Phải chọn xe đầu kéo hoặc rơ-moóc để lắp lốp');
  }

  if (truckId != null) {
    const [truck] = await tx.select({ id: s.trucks.id })
      .from(s.trucks)
      .where(and(eq(s.trucks.id, truckId), isNull(s.trucks.deletedAt)))
      .limit(1);
    if (!truck) throw new HttpError(404, 'Không tìm thấy xe đầu kéo');
  } else if (trailerId != null) {
    const [trailer] = await tx.select({ id: s.trailers.id })
      .from(s.trailers)
      .where(and(eq(s.trailers.id, trailerId), isNull(s.trailers.deletedAt)))
      .limit(1);
    if (!trailer) throw new HttpError(404, 'Không tìm thấy rơ-moóc');
  }

  const [existing] = await tx.select().from(s.tires)
    .where(and(eq(s.tires.id, tireId), isNull(s.tires.deletedAt)))
    .limit(1)
    .for('update');
  if (!existing) {
    throw new HttpError(404, 'Không tìm thấy lốp');
  }
  assertExpectedUpdatedAt(existing.updatedAt, expectedUpdatedAt);
  if (existing.status === 'DISPOSED') {
    throw new HttpError(409, 'Lốp đã thanh lý, không thể lắp lại');
  }
  if (existing.status === 'IN_USE') {
    throw new HttpError(
      409,
      existing.truckId != null || existing.trailerId != null
        ? 'Lốp đang lắp trên phương tiện khác — vui lòng tháo ra trước'
        : 'Lốp đang sử dụng — vui lòng tháo ra trước',
    );
  }

  const resolvedPosition = input.position ?? existing.position ?? null;
  await assertPositionFree(tx, { truckId, trailerId, position: resolvedPosition }, tireId);

  const patch: Partial<typeof s.tires.$inferSelect> = {
    truckId,
    trailerId,
    position: resolvedPosition,
    installedAt: todayISO(),
    removedAt: null,
    status: 'IN_USE',
    updatedAt: new Date(),
  };

  const [updated] = await tx.update(s.tires).set(patch)
    .where(eq(s.tires.id, tireId)).returning();
  return updated;
}

/**
 * Move a mounted (IN_USE) tire to another vehicle in one atomic step. Unlike
 * install, this PRESERVES installed_at so "Số ngày chạy" keeps counting across
 * the move (the prior mount isn't silently truncated). The source assignment is
 * cleared because exactly one of truckId/trailerId is set per call.
 */
export async function transferTire(tireId: number, input: InstallTireInput, expectedUpdatedAt: Date) {
  return db.transaction((tx) => transferTireInTx(tx, tireId, input, expectedUpdatedAt));
}

export async function transferTireInTx(
  tx: Tx,
  tireId: number,
  input: InstallTireInput,
  expectedUpdatedAt: Date,
) {
  const truckId = input.truckId ?? null;
  const trailerId = input.trailerId ?? null;
  if ((truckId == null) === (trailerId == null)) {
    throw new HttpError(400, 'Phải chọn xe đầu kéo hoặc rơ-moóc để chuyển lốp');
  }

  if (truckId != null) {
    const [truck] = await tx.select({ id: s.trucks.id })
      .from(s.trucks)
      .where(and(eq(s.trucks.id, truckId), isNull(s.trucks.deletedAt)))
      .limit(1);
    if (!truck) throw new HttpError(404, 'Không tìm thấy xe đầu kéo');
  } else if (trailerId != null) {
    const [trailer] = await tx.select({ id: s.trailers.id })
      .from(s.trailers)
      .where(and(eq(s.trailers.id, trailerId), isNull(s.trailers.deletedAt)))
      .limit(1);
    if (!trailer) throw new HttpError(404, 'Không tìm thấy rơ-moóc');
  }

  const [existing] = await tx.select().from(s.tires)
    .where(and(eq(s.tires.id, tireId), isNull(s.tires.deletedAt)))
    .limit(1)
    .for('update');
  if (!existing) throw new HttpError(404, 'Không tìm thấy lốp');
  assertExpectedUpdatedAt(existing.updatedAt, expectedUpdatedAt);
  if (existing.status === 'DISPOSED') {
    throw new HttpError(409, 'Lốp đã thanh lý, không thể chuyển');
  }
  if (existing.status !== 'IN_USE') {
    throw new HttpError(409, 'Lốp chưa được lắp, không thể chuyển');
  }

  const resolvedPosition = input.position ?? existing.position ?? null;
  await assertPositionFree(tx, { truckId, trailerId, position: resolvedPosition }, tireId);

  const patch: Partial<typeof s.tires.$inferSelect> = {
    truckId,
    trailerId,
    position: resolvedPosition,
    removedAt: null,
    updatedAt: new Date(),
  };

  const [updated] = await tx.update(s.tires).set(patch)
    .where(eq(s.tires.id, tireId)).returning();
  return updated;
}

/** Remove a tire from its vehicle back to the spare pool (IN_STOCK). */
export async function removeTire(tireId: number, expectedUpdatedAt: Date) {
  return db.transaction((tx) => removeTireInTx(tx, tireId, expectedUpdatedAt));
}

export async function removeTireInTx(
  tx: Tx,
  tireId: number,
  expectedUpdatedAt: Date,
) {
  const [existing] = await tx.select().from(s.tires)
    .where(and(eq(s.tires.id, tireId), isNull(s.tires.deletedAt)))
    .limit(1)
    .for('update');
  if (!existing) throw new HttpError(404, 'Không tìm thấy lốp');
  assertExpectedUpdatedAt(existing.updatedAt, expectedUpdatedAt);
  if (existing.status === 'DISPOSED') {
    throw new HttpError(409, 'Lốp đã thanh lý');
  }
  if (existing.status !== 'IN_USE') {
    throw new HttpError(409, 'Lốp chưa được lắp');
  }

  const patch: Partial<typeof s.tires.$inferSelect> = {
    truckId: null,
    trailerId: null,
    position: null,
    removedAt: existing.removedAt ?? todayISO(),
    status: 'IN_STOCK',
    updatedAt: new Date(),
  };
  const [updated] = await tx.update(s.tires).set(patch)
    .where(eq(s.tires.id, tireId)).returning();
  return updated;
}

/** Dispose of (thanh lý) a tire with a reason. Unmounts if still mounted. */
export async function disposeTire(tireId: number, input: DisposeTireInput, expectedUpdatedAt: Date) {
  return db.transaction((tx) => disposeTireInTx(tx, tireId, input, expectedUpdatedAt));
}

export async function disposeTireInTx(
  tx: Tx,
  tireId: number,
  input: DisposeTireInput,
  expectedUpdatedAt: Date,
) {
  const reason = input.reason?.trim();
  if (!reason) throw new HttpError(400, 'Chọn lý do thanh lý');

  const [existing] = await tx.select().from(s.tires)
    .where(and(eq(s.tires.id, tireId), isNull(s.tires.deletedAt)))
    .limit(1)
    .for('update');
  if (!existing) throw new HttpError(404, 'Không tìm thấy lốp');
  assertExpectedUpdatedAt(existing.updatedAt, expectedUpdatedAt);
  if (existing.status === 'DISPOSED') {
    throw new HttpError(409, 'Lốp đã thanh lý rồi');
  }

  const patch: Partial<typeof s.tires.$inferSelect> = {
    truckId: null,
    trailerId: null,
    position: null,
    removedAt: existing.removedAt ?? todayISO(),
    status: 'DISPOSED',
    disposalDate: todayISO(),
    disposalReason: reason,
    updatedAt: new Date(),
  };
  const [updated] = await tx.update(s.tires).set(patch)
    .where(eq(s.tires.id, tireId)).returning();
  return updated;
}

/** Typed accessor for routes to rethrow HttpError-shaped status codes. */
export function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError;
}
