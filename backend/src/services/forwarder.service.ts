import { db } from '../db';
import { runInTx } from '../lib/tx';
import { operationalName } from '../db/master-data-name';
import type { Tx } from './trip-shared';
export type { Tx };
import * as s from '../db/schema';
import type { GuardedResult } from './approval.service';
import { eq, and, isNull, desc, notInArray, inArray, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import {
  buildNoInvoicePolicySnapshotForExpenseInput,
  toNoInvoicePolicySnapshotValue,
} from './no-invoice-disbursement.service';
import { assertForwarderMutableTripScope } from './forwarder-trip-query.service';
export {
  getForwarderTrips,
  latestTripPhotoKey,
  listTripPhotoKeys,
  getForwarderTripCounts,
  getForwarderTripDetail,
  assertForwarderTripScope,
  assertForwarderMutableTripScope,
  assertForwarderMutableShipmentScope,
} from './forwarder-trip-query.service';
export {
  derivePrimarySealNumber,
  createTripContainer,
  updateTripContainer,
  listTripContainers,
  batchUpsertContainerSeals,
  batchUpsertTripContainers,
} from './forwarder-container.service';
import { SnapshotServices } from './snapshot-services';
import { recomputeShipmentCompletion } from './shipment.service';
import { lockTripCloseAggregate } from './trip-close-readiness.service';
import { lockApplicationOwnedUniquenessSet } from './application-owned-uniqueness.service';
import { assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';

/**
 * Either the singleton db client or an in-flight transaction client. Both
 * expose the same query-builder surface (select/insert/update/delete), so the
 * expense helpers accept either and route through whichever the caller holds.
 */
type DbOrTx = typeof db | Tx;
type LiftPricingSnapshot = NonNullable<typeof s.tripExpenses.$inferInsert.liftPricingSnapshot>;

type TripExpenseRequiredFieldState = {
  expenseType: string;
  declarationNumber: string | null;
};

type SettlementOpsCompletionGroup = {
  tripContainerId: number | null;
  containerNumber: string | null;
  expenseCount: number;
  status: 'IN_PROGRESS' | 'COMPLETED';
};

type SettlementOpsCompletionTrip = {
  tripId: number;
  tripCode: string | null;
  departureDate: string | null;
  completedGroupCount: number;
  totalGroupCount: number;
  groups: SettlementOpsCompletionGroup[];
};

type SettlementOpsCompletionSummary = {
  tripCount: number;
  completedGroupCount: number;
  totalGroupCount: number;
  trips: SettlementOpsCompletionTrip[];
};

export function getTripExpenseRequiredFieldError(state: TripExpenseRequiredFieldState): string | null {
  if (state.expenseType === 'CUSTOMS' && !state.declarationNumber?.trim()) {
    return 'Số tờ khai là bắt buộc cho phí hải quan';
  }
  return null;
}

async function resetExpenseScope(
  txOrDb: DbOrTx,
  tripId: number,
  tripContainerId: number | null,
) {
  const scopeWhere = tripContainerId == null
    ? and(eq(s.tripExpenseCompletionScopes.tripId, tripId), isNull(s.tripExpenseCompletionScopes.tripContainerId))
    : eq(s.tripExpenseCompletionScopes.tripContainerId, tripContainerId);
  await txOrDb.update(s.tripExpenseCompletionScopes).set({
    status: 'IN_PROGRESS',
    completedBy: null,
    completedAt: null,
    updatedAt: new Date(),
  }).where(scopeWhere);
}

export async function setTripExpenseCompletion(
  tripId: number,
  tripContainerId: number | null,
  completed: boolean,
  actorId: number,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [trip] = await tx.select({
      status: s.trips.status,
      shipmentId: s.trips.shipmentId,
    }).from(s.trips)
      .where(eq(s.trips.id, tripId)).limit(1);
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    // Keep the same aggregate lock order as shipment recomputation:
    // shipment -> expense scope. This prevents a scope update racing an e-POD
    // event from deadlocking with the aggregate readiness calculation.
    await lockTripCloseAggregate(tx, tripId);
    const scopeKey = tripContainerId ?? -tripId;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);
    if (trip.status === 'COMPLETED' || trip.status === 'CANCELED') {
      throw new ApiError(409, 'Không thể cập nhật kê khai của chuyến đã hoàn thành hoặc đã hủy');
    }
    if (tripContainerId != null) {
      const [container] = await tx.select({ tripId: s.tripContainers.tripId })
        .from(s.tripContainers).where(eq(s.tripContainers.id, tripContainerId)).limit(1);
      if (!container || container.tripId !== tripId) {
        throw new ApiError(400, 'Container không thuộc chuyến này');
      }
    }
    if (!completed) {
      const expenseScope = tripContainerId == null
        ? and(eq(s.tripExpenses.tripId, tripId), isNull(s.tripExpenses.tripContainerId))
        : eq(s.tripExpenses.tripContainerId, tripContainerId);
      const [activeSettlement] = await tx.select({ id: s.advanceSettlements.id })
        .from(s.tripExpenses)
        .innerJoin(s.settlementExpenses, eq(s.settlementExpenses.tripExpenseId, s.tripExpenses.id))
        .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
        .where(and(
          expenseScope,
          notInArray(s.advanceSettlements.status, ['REJECTED']),
        )).limit(1);
      if (activeSettlement) {
        throw new ApiError(409, 'Chi phí đã gửi kế toán, không thể mở lại kê khai');
      }
    }

    const scopeWhere = tripContainerId == null
      ? and(eq(s.tripExpenseCompletionScopes.tripId, tripId), isNull(s.tripExpenseCompletionScopes.tripContainerId))
      : eq(s.tripExpenseCompletionScopes.tripContainerId, tripContainerId);
    const [existing] = await tx.select({ id: s.tripExpenseCompletionScopes.id })
      .from(s.tripExpenseCompletionScopes).where(scopeWhere).limit(1);
    const values = {
      status: completed ? 'COMPLETED' : 'IN_PROGRESS',
      completedBy: completed ? actorId : null,
      completedAt: completed ? new Date() : null,
      updatedAt: new Date(),
    };
    if (existing) {
      const [updated] = await tx.update(s.tripExpenseCompletionScopes)
        .set(values).where(eq(s.tripExpenseCompletionScopes.id, existing.id)).returning();
      if (trip.shipmentId != null) {
        await recomputeShipmentCompletion(trip.shipmentId, { changedBy: actorId }, tx);
      }
      return updated;
    }
    const [inserted] = await tx.insert(s.tripExpenseCompletionScopes).values({
      tripId,
      tripContainerId,
      ...values,
    }).returning();
    if (trip.shipmentId != null) {
      await recomputeShipmentCompletion(trip.shipmentId, { changedBy: actorId }, tx);
    }
    return inserted;
  };
  return runInTx(transaction, execute);
}

export async function getTripExpenseCompletionScopes(tripId: number) {
  return db.select({
    tripId: s.tripExpenseCompletionScopes.tripId,
    tripContainerId: s.tripExpenseCompletionScopes.tripContainerId,
    status: s.tripExpenseCompletionScopes.status,
    completedBy: s.tripExpenseCompletionScopes.completedBy,
    completedAt: s.tripExpenseCompletionScopes.completedAt,
    completedByName: s.users.fullName,
  }).from(s.tripExpenseCompletionScopes)
    .leftJoin(s.users, eq(s.users.id, s.tripExpenseCompletionScopes.completedBy))
    .where(eq(s.tripExpenseCompletionScopes.tripId, tripId));
}

export class NoForwarderProfileError extends Error {
  status = 404;
  constructor() {
    super('Không tìm thấy thông tin nhân viên giao nhận');
    this.name = 'NoForwarderProfileError';
  }
}


export async function getForwarderByUserId(userId: number) {
  const [user] = await db.select({
    id: s.users.id,
    username: s.users.username,
    fullName: s.users.fullName,
    role: s.users.role,
  }).from(s.users)
    .where(and(eq(s.users.id, userId), eq(s.users.role, 'OPS'), eq(s.users.status, 'ACTIVE')))
    .limit(1);
  if (!user) throw new NoForwarderProfileError();
  return user;
}

function validateNoInvoiceExpenseState(
  policy: Awaited<ReturnType<typeof buildNoInvoicePolicySnapshotForExpenseInput>>,
  state: {
    expenseDate: string | null | undefined;
    payeeName: string | null | undefined;
    note: string | null | undefined;
    evidenceTypes: string[] | null | undefined;
  },
) {
  if (!policy) return;
  if (!state.expenseDate) throw new ApiError(400, 'Ngày chi là bắt buộc khi không có hóa đơn');
  if (!state.payeeName?.trim()) throw new ApiError(400, 'Người nhận là bắt buộc khi không có hóa đơn');
  if (!state.note?.trim()) throw new ApiError(400, 'Lý do chi là bắt buộc khi không có hóa đơn');
  const evidenceTypes = Array.from(new Set(state.evidenceTypes ?? []));
  if (evidenceTypes.length === 0) {
    throw new ApiError(400, 'Cần chọn ít nhất một loại chứng cứ thay thế khi không có hóa đơn');
  }
  const allowedEvidenceTypes = new Set<string>(policy.allowedEvidenceTypes);
  if (
    allowedEvidenceTypes.size > 0
    && evidenceTypes.some((evidenceType) => !allowedEvidenceTypes.has(evidenceType))
  ) {
    throw new ApiError(400, 'Loại chứng cứ thay thế không được phép cho hạng mục chi phí này');
  }
}

type TripExpenseCreateInput = {
  tripId: number;
  forwarderId: number | null;
  createdBy?: number | null;
  expenseType: string;
  buyAmount: string;
  sellAmount?: string;
  settlementMethod?: string;
  supplierId?: number | null;
  approvalStatus?: string;
  expenseDate?: string | null;
  payeeName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  declarationNumber?: string | null;
  containerNumber?: string | null;
  tripContainerId?: number | null;
  liftPricingId?: number | null;
  liftPricingSnapshot?: LiftPricingSnapshot | null;
  note: string | null;
  noInvoiceEvidenceTypes?: string[] | null;
};

async function lockTripExpenseCreateRelationships(
  tx: Tx,
  data: TripExpenseCreateInput,
) {
  const tripContainerId = data.tripContainerId ?? null;
  const supplierId = data.supplierId ?? null;
  const liftPricingId = data.liftPricingId ?? null;
  const userIds = [...new Set(
    [data.forwarderId, data.createdBy ?? null]
      .filter((id): id is number => id != null),
  )];

  await lockApplicationOwnedUniquenessSet(tx, [
    { scope: 'relationship.trip', parts: [data.tripId] },
    ...userIds.map((id) => ({ scope: 'relationship.user', parts: [id] })),
    ...(supplierId == null ? [] : [{ scope: 'relationship.supplier', parts: [supplierId] }]),
    ...(tripContainerId == null ? [] : [{ scope: 'relationship.trip-container', parts: [tripContainerId] }]),
    ...(liftPricingId == null ? [] : [{ scope: 'relationship.lift-pricing', parts: [liftPricingId] }]),
  ]);

  const [trip] = await tx.select({
    status: s.trips.status,
    deletedAt: s.trips.deletedAt,
  }).from(s.trips)
    .where(eq(s.trips.id, data.tripId))
    .limit(1)
    .for('share');
  if (!trip || trip.deletedAt != null) {
    throw new ApiError(404, 'Không tìm thấy chuyến đi');
  }

  if (userIds.length > 0) {
    const users = await tx.select({
      id: s.users.id,
      role: s.users.role,
      status: s.users.status,
      deletedAt: s.users.deletedAt,
    }).from(s.users)
      .where(inArray(s.users.id, userIds))
      .for('share');
    const usersById = new Map(users.map((user) => [user.id, user]));
    const creator = data.createdBy == null ? null : usersById.get(data.createdBy);
    if (data.createdBy != null && (!creator || creator.deletedAt != null)) {
      throw new ApiError(400, 'Người tạo chi phí không tồn tại');
    }
    const forwarder = data.forwarderId == null ? null : usersById.get(data.forwarderId);
    if (
      data.forwarderId != null
      && (!forwarder || forwarder.deletedAt != null || forwarder.status !== 'ACTIVE' || forwarder.role !== 'OPS')
    ) {
      throw new ApiError(400, 'Nhân viên giao nhận không tồn tại hoặc đã ngưng hoạt động');
    }
  }

  if (supplierId != null) {
    const [supplier] = await tx.select({
      status: s.suppliers.status,
      deletedAt: s.suppliers.deletedAt,
    }).from(s.suppliers)
      .where(eq(s.suppliers.id, supplierId))
      .limit(1)
      .for('share');
    if (!supplier || supplier.deletedAt != null || supplier.status !== 'ACTIVE') {
      throw new ApiError(400, 'Nhà cung cấp không tồn tại hoặc đã ngưng dùng');
    }
  }

  let containerLabel = data.containerNumber ?? null;
  if (tripContainerId != null) {
    const [container] = await tx.select({
      tripId: s.tripContainers.tripId,
      containerNumber: s.tripContainers.containerNumber,
    }).from(s.tripContainers)
      .where(eq(s.tripContainers.id, tripContainerId))
      .limit(1)
      .for('share');
    if (!container || container.tripId !== data.tripId) {
      throw new ApiError(400, 'Container không thuộc chuyến này');
    }
    containerLabel = container.containerNumber;
  }

  if (liftPricingId != null) {
    const [liftPricing] = await tx.select({ deletedAt: s.liftPricing.deletedAt })
      .from(s.liftPricing)
      .where(eq(s.liftPricing.id, liftPricingId))
      .limit(1)
      .for('share');
    if (!liftPricing || liftPricing.deletedAt != null) {
      throw new ApiError(400, 'Biểu phí nâng hạ không tồn tại hoặc đã ngưng dùng');
    }
  }

  return { trip, tripContainerId, containerLabel };
}


export async function createTripExpense(
  txOrDb: DbOrTx,
  data: TripExpenseCreateInput,
): Promise<typeof s.tripExpenses.$inferSelect> {
  if (txOrDb === db) {
    return db.transaction((tx) => createTripExpense(tx, data));
  }
  const tx = txOrDb as Tx;
  await assertTripShipmentAccountingUnlocked(tx, data.tripId);
  // O2C: costs stay editable after COMPLETED (no hard-freeze). CANCELED trips
  // remain immutable. A cost edit on a completed trip re-evaluates both
  // reconciliation snapshots so AR/AP queues stay honest.
  const { trip, tripContainerId, containerLabel } = await lockTripExpenseCreateRelationships(tx, data);
  if (trip.status === 'CANCELED') {
    throw new ApiError(409, 'Không thể thêm chi phí cho chuyến đã hủy');
  }

  const scopeKey = tripContainerId ?? -data.tripId;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);

  // Null counterparties remain allowed for receivables-only fees. Approved
  // COMPANY_DIRECT rows with a supplier now also feed supplier AP at completion.

  // Authenticated actor-backed writes start pending: office creation is not
  // approval and Q15 requires a distinct approver. Preserve the historical
  // trusted/internal helper behavior for actor-less office imports; those
  // legacy callers carry no maker authority and are not inferred from a
  // payable counterparty.
  const approvalStatus = data.approvalStatus
    ?? (data.createdBy != null || data.forwarderId != null ? 'PENDING' : 'APPROVED');
  const noInvoicePolicySnapshot = await buildNoInvoicePolicySnapshotForExpenseInput(tx, {
    expenseType: data.expenseType,
    invoiceNumber: data.invoiceNumber ?? null,
  });
  validateNoInvoiceExpenseState(noInvoicePolicySnapshot, {
    expenseDate: data.expenseDate ?? null,
    payeeName: data.payeeName ?? null,
    note: data.note,
    evidenceTypes: data.noInvoiceEvidenceTypes ?? [],
  });

  const [inserted] = await tx.insert(s.tripExpenses).values({
    tripId: data.tripId,
    forwarderId: data.forwarderId,
    createdBy: data.createdBy ?? null,
    expenseType: data.expenseType,
    buyAmount: data.buyAmount,
    sellAmount: data.sellAmount ?? '0',
    settlementMethod: data.settlementMethod ?? 'OPS_ADVANCE',
    supplierId: data.supplierId ?? null,
    expenseDate: data.expenseDate ?? null,
    payeeName: data.payeeName?.trim() || null,
    invoiceNumber: data.invoiceNumber ?? null,
    invoiceDate: data.invoiceDate ?? null,
    declarationNumber: data.declarationNumber ?? null,
    containerNumber: containerLabel,
    tripContainerId,
    liftPricingId: data.liftPricingId ?? null,
    liftPricingSnapshot: data.liftPricingSnapshot ?? null,
    approvalStatus,
    note: data.note,
    noInvoiceEvidenceTypes: data.noInvoiceEvidenceTypes ?? [],
    noInvoicePolicySnapshot: toNoInvoicePolicySnapshotValue(noInvoicePolicySnapshot),
    returnForEvidenceReason: null,
    returnedForEvidenceAt: null,
    returnedForEvidenceBy: null,
  }).returning();
  if (data.forwarderId != null) {
    await resetExpenseScope(tx, data.tripId, tripContainerId);
  }
  // O2C: a cost edit on a completed trip re-evaluates both reconciliation
  // snapshots. No-op for non-completed trips.
  if (trip.status === 'COMPLETED') {
    await SnapshotServices.markBothDirty(data.tripId, tx);
  }
  return inserted;
}

export async function updateTripExpense(
  txOrDb: DbOrTx,
  id: number,
  patch: {
    expenseType?: string;
    buyAmount?: string;
    sellAmount?: string;
    settlementMethod?: string;
    supplierId?: number | null;
    expenseDate?: string | null;
    payeeName?: string | null;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    declarationNumber?: string | null;
    containerNumber?: string | null;
    /** B5: authoritative container FK; validated against the expense's trip. */
    tripContainerId?: number | null;
    liftPricingId?: number | null;
    liftPricingSnapshot?: LiftPricingSnapshot | null;
    note?: string | null;
    noInvoiceEvidenceTypes?: string[] | null;
  },
): Promise<typeof s.tripExpenses.$inferSelect | null> {
  if (txOrDb === db) {
    return db.transaction((tx) => updateTripExpense(tx, id, patch));
  }
  await txOrDb.execute(sql`SELECT pg_advisory_xact_lock(6102, ${id})`);
  // Fetch existing to check forwarderId — if forwarder-owned and sellAmount
  // is being updated, re-pend for manager review.
  // Also check parent trip status (spec §4.9: completed trips are immutable).
  const [existing] = await txOrDb
    .select({
      forwarderId: s.tripExpenses.forwarderId,
      tripId: s.tripExpenses.tripId,
      tripContainerId: s.tripExpenses.tripContainerId,
      expenseType: s.tripExpenses.expenseType,
      expenseDate: s.tripExpenses.expenseDate,
      payeeName: s.tripExpenses.payeeName,
      invoiceNumber: s.tripExpenses.invoiceNumber,
      note: s.tripExpenses.note,
      noInvoiceEvidenceTypes: s.tripExpenses.noInvoiceEvidenceTypes,
      declarationNumber: s.tripExpenses.declarationNumber,
      approvalStatus: s.tripExpenses.approvalStatus,
    })
    .from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, id))
    .limit(1);

  if (!existing) return null;
  await assertTripShipmentAccountingUnlocked(txOrDb as Tx, existing.tripId);
  if (existing.approvalStatus === 'APPROVED') {
    throw new ApiError(409, 'Chi phí đã duyệt không được sửa trực tiếp; hãy lập yêu cầu điều chỉnh');
  }
  if (existing.forwarderId != null) {
    const [activeLink] = await txOrDb.select({ id: s.settlementExpenses.id })
      .from(s.settlementExpenses)
      .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
      .where(and(
        eq(s.settlementExpenses.tripExpenseId, id),
        notInArray(s.advanceSettlements.status, ['REJECTED']),
      )).limit(1);
    if (activeLink) throw new ApiError(409, 'Chi phí đã gửi kế toán, chỉ được điều chỉnh trên phiếu hoàn ứng');
  }
  const scopeKeys = [...new Set([
    existing.tripContainerId ?? -existing.tripId,
    patch.tripContainerId === undefined ? (existing.tripContainerId ?? -existing.tripId) : (patch.tripContainerId ?? -existing.tripId),
  ])].sort((a, b) => a - b);
  for (const scopeKey of scopeKeys) {
    await txOrDb.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);
  }

  // O2C: costs stay editable after COMPLETED (no hard-freeze); only CANCELED
  // trips reject edits. A cost edit on a completed trip flips ar_snapshot_dirty.
  const [trip] = await txOrDb.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, existing.tripId)).limit(1);
  if (trip?.status === 'CANCELED') {
    throw new ApiError(409, 'Không thể sửa chi phí của chuyến đã hủy');
  }

  const requiredFieldError = getTripExpenseRequiredFieldError({
    expenseType: patch.expenseType ?? existing.expenseType,
    declarationNumber: patch.declarationNumber === undefined
      ? existing.declarationNumber
      : patch.declarationNumber,
  });
  if (requiredFieldError) throw new ApiError(400, requiredFieldError);

  const setPatch: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  const nextExpenseType = patch.expenseType ?? existing.expenseType;
  const nextInvoiceNumber = patch.invoiceNumber === undefined
    ? existing.invoiceNumber
    : patch.invoiceNumber;
  const noInvoicePolicySnapshot = await buildNoInvoicePolicySnapshotForExpenseInput(txOrDb, {
    expenseType: nextExpenseType,
    invoiceNumber: nextInvoiceNumber ?? null,
  });
  validateNoInvoiceExpenseState(noInvoicePolicySnapshot, {
    expenseDate: patch.expenseDate === undefined ? existing.expenseDate : patch.expenseDate,
    payeeName: patch.payeeName === undefined ? existing.payeeName : patch.payeeName,
    note: patch.note === undefined ? existing.note : patch.note,
    evidenceTypes: patch.noInvoiceEvidenceTypes === undefined
      ? existing.noInvoiceEvidenceTypes
      : patch.noInvoiceEvidenceTypes,
  });
  setPatch.noInvoicePolicySnapshot = toNoInvoicePolicySnapshotValue(noInvoicePolicySnapshot);

  if (patch.sellAmount !== undefined && existing.forwarderId != null) {
    setPatch.approvalStatus = 'PENDING';
  }
  if (patch.noInvoiceEvidenceTypes !== undefined) {
    setPatch.noInvoiceEvidenceTypes = patch.noInvoiceEvidenceTypes ?? [];
  }
  if (existing.approvalStatus === 'RETURN_FOR_EVIDENCE') {
    setPatch.approvalStatus = 'PENDING';
    setPatch.returnForEvidenceReason = null;
    setPatch.returnedForEvidenceAt = null;
    setPatch.returnedForEvidenceBy = null;
  }

  // B5: resolve an authoritative container change against this trip. An
  // explicit null clears the link (and the mirrored free-text label); a number
  // is validated against the trip and its label mirrored.
  if (patch.tripContainerId !== undefined) {
    if (patch.tripContainerId == null) {
      setPatch.tripContainerId = null;
      setPatch.containerNumber = null;
    } else {
      const [container] = await txOrDb
        .select({
          id: s.tripContainers.id,
          cTripId: s.tripContainers.tripId,
          containerNumber: s.tripContainers.containerNumber,
        })
        .from(s.tripContainers)
        .where(eq(s.tripContainers.id, patch.tripContainerId))
        .limit(1);
      if (!container || container.cTripId !== existing.tripId) {
        throw new ApiError(400, 'Container không thuộc chuyến này');
      }
      setPatch.containerNumber = container.containerNumber;
    }
  }

  const [updated] = await txOrDb
    .update(s.tripExpenses)
    .set(setPatch)
    .where(eq(s.tripExpenses.id, id))
    .returning();
  await resetExpenseScope(txOrDb, existing.tripId, existing.tripContainerId);
  if (patch.tripContainerId !== undefined && patch.tripContainerId !== existing.tripContainerId) {
    await resetExpenseScope(txOrDb, existing.tripId, patch.tripContainerId);
  }
  // O2C: a cost edit on a completed trip re-evaluates both snapshots.
  if (trip?.status === 'COMPLETED') {
    await SnapshotServices.markBothDirty(existing.tripId, txOrDb);
  }
  return updated;
}

export async function updateForwarderTripExpense(
  expenseId: number,
  forwarderId: number,
  patch: Parameters<typeof updateTripExpense>[2],
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
    const [expense] = await tx.select({
      id: s.tripExpenses.id,
      tripId: s.tripExpenses.tripId,
      ownerId: s.tripExpenses.forwarderId,
      tripContainerId: s.tripExpenses.tripContainerId,
    }).from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);
    if (!expense) throw new ApiError(404, 'Không tìm thấy chi phí');
    if (expense.ownerId !== forwarderId) throw new ApiError(403, 'Không có quyền sửa chi phí này');
    await assertForwarderMutableTripScope(expense.tripId, forwarderId, tx);
    const [activeLink] = await tx.select({ id: s.settlementExpenses.id })
      .from(s.settlementExpenses)
      .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
      .where(and(
        eq(s.settlementExpenses.tripExpenseId, expenseId),
        notInArray(s.advanceSettlements.status, ['REJECTED']),
      )).limit(1);
    if (activeLink) throw new ApiError(409, 'Chi phí đã gửi kế toán, không thể sửa');
    return updateTripExpense(tx, expenseId, patch);
  });
}

function assertExpenseExpectedUpdatedAt(
  actual: Date,
  expectedUpdatedAt: Date,
  message: string,
) {
  if (actual.getTime() !== expectedUpdatedAt.getTime()) {
    throw new ApiError(409, message);
  }
}

export async function updateForwarderTripExpenseInTx(
  tx: Tx,
  expenseId: number,
  forwarderId: number,
  patch: Parameters<typeof updateTripExpense>[2],
  expectedUpdatedAt: Date,
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
  const [expense] = await tx.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    ownerId: s.tripExpenses.forwarderId,
    tripContainerId: s.tripExpenses.tripContainerId,
    updatedAt: s.tripExpenses.updatedAt,
  }).from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);
  if (!expense) throw new ApiError(404, 'Không tìm thấy chi phí');
  if (expense.ownerId !== forwarderId) throw new ApiError(403, 'Không có quyền sửa chi phí này');
  await assertForwarderMutableTripScope(expense.tripId, forwarderId, tx);
  assertExpenseExpectedUpdatedAt(
    expense.updatedAt,
    expectedUpdatedAt,
    'Chi phí đã thay đổi. Vui lòng tải lại trước khi cập nhật.',
  );
  const [activeLink] = await tx.select({ id: s.settlementExpenses.id })
    .from(s.settlementExpenses)
    .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
    .where(and(
      eq(s.settlementExpenses.tripExpenseId, expenseId),
      notInArray(s.advanceSettlements.status, ['REJECTED']),
    )).limit(1);
  if (activeLink) throw new ApiError(409, 'Chi phí đã gửi kế toán, không thể sửa');
  return updateTripExpense(tx, expenseId, patch);
}

export async function getTripExpenses(txOrDb: DbOrTx, tripId: number) {
  return txOrDb.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    forwarderId: s.tripExpenses.forwarderId,
    expenseType: s.tripExpenses.expenseType,
    buyAmount: s.tripExpenses.buyAmount,
    sellAmount: s.tripExpenses.sellAmount,
    settlementMethod: s.tripExpenses.settlementMethod,
    supplierId: s.tripExpenses.supplierId,
    expenseDate: s.tripExpenses.expenseDate,
    payeeName: s.tripExpenses.payeeName,
    invoiceNumber: s.tripExpenses.invoiceNumber,
    invoiceDate: s.tripExpenses.invoiceDate,
    declarationNumber: s.tripExpenses.declarationNumber,
    containerNumber: s.tripExpenses.containerNumber,
    tripContainerId: s.tripExpenses.tripContainerId,
    approvalStatus: s.tripExpenses.approvalStatus,
    note: s.tripExpenses.note,
    noInvoiceEvidenceTypes: s.tripExpenses.noInvoiceEvidenceTypes,
    noInvoicePolicySnapshot: s.tripExpenses.noInvoicePolicySnapshot,
    returnForEvidenceReason: s.tripExpenses.returnForEvidenceReason,
    returnedForEvidenceAt: s.tripExpenses.returnedForEvidenceAt,
    createdAt: s.tripExpenses.createdAt,
    updatedAt: s.tripExpenses.updatedAt,
    forwarderName: s.users.fullName,
    expenseTypeName: s.forwarderExpenseTypes.name,
    supplierName: operationalName(s.suppliers.shortName, s.suppliers.name),
  }).from(s.tripExpenses)
    .leftJoin(s.users, eq(s.tripExpenses.forwarderId, s.users.id))
    .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
    .leftJoin(s.suppliers, eq(s.tripExpenses.supplierId, s.suppliers.id))
    .where(eq(s.tripExpenses.tripId, tripId))
    .orderBy(desc(s.tripExpenses.createdAt));
}

export async function deleteTripExpense(expenseId: number, forwarderId: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
    const [existing] = await tx.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, expenseId)).limit(1);
    if (!existing) return null;
    if (existing.forwarderId == null || existing.forwarderId !== forwarderId) return 'FORBIDDEN';
    await assertTripShipmentAccountingUnlocked(tx, existing.tripId);
    await assertForwarderMutableTripScope(existing.tripId, forwarderId, tx);
    if (existing.approvalStatus === 'APPROVED') {
      throw new ApiError(409, 'Chi phí đã duyệt không được xóa trực tiếp; hãy lập yêu cầu điều chỉnh');
    }
    const scopeKey = existing.tripContainerId ?? -existing.tripId;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);
    const [trip] = await tx.select({ status: s.trips.status }).from(s.trips)
      .where(eq(s.trips.id, existing.tripId)).limit(1);
    // O2C: CANCELED trips are immutable; COMPLETED trips allow cost edits
    // (deletion re-evaluates both snapshots for the reconciliation queues).
    if (trip?.status === 'CANCELED') {
      throw new ApiError(409, 'Không thể xóa chi phí của chuyến đã hủy');
    }
    const [activeLink] = await tx.select({ id: s.settlementExpenses.id })
      .from(s.settlementExpenses)
      .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
      .where(and(
        eq(s.settlementExpenses.tripExpenseId, expenseId),
        notInArray(s.advanceSettlements.status, ['REJECTED']),
      )).limit(1);
    if (activeLink) throw new ApiError(409, 'Chi phí đã gửi kế toán, không thể xóa');
    await tx.delete(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId));
    await resetExpenseScope(tx, existing.tripId, existing.tripContainerId);
    if (trip?.status === 'COMPLETED') {
      await SnapshotServices.markBothDirty(existing.tripId, tx);
    }
    return 'DELETED';
  });
}

export async function deleteTripExpenseInTx(
  tx: Tx,
  expenseId: number,
  forwarderId: number,
  expectedUpdatedAt: Date,
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
  const [existing] = await tx.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    tripContainerId: s.tripExpenses.tripContainerId,
    forwarderId: s.tripExpenses.forwarderId,
    approvalStatus: s.tripExpenses.approvalStatus,
    updatedAt: s.tripExpenses.updatedAt,
  }).from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);
  if (!existing) return null;
  if (existing.forwarderId == null || existing.forwarderId !== forwarderId) return 'FORBIDDEN';
  await assertTripShipmentAccountingUnlocked(tx, existing.tripId);
  await assertForwarderMutableTripScope(existing.tripId, forwarderId, tx);
  assertExpenseExpectedUpdatedAt(
    existing.updatedAt,
    expectedUpdatedAt,
    'Chi phí đã thay đổi. Vui lòng tải lại trước khi xóa.',
  );
  if (existing.approvalStatus === 'APPROVED') {
    throw new ApiError(409, 'Chi phí đã duyệt không được xóa trực tiếp; hãy lập yêu cầu điều chỉnh');
  }
  const scopeKey = existing.tripContainerId ?? -existing.tripId;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);
  const [trip] = await tx.select({ status: s.trips.status }).from(s.trips)
    .where(eq(s.trips.id, existing.tripId)).limit(1);
  if (trip?.status === 'COMPLETED' || trip?.status === 'CANCELED') {
    throw new ApiError(409, 'Không thể xóa chi phí của chuyến đã chốt hoặc đã hủy');
  }
  const [activeLink] = await tx.select({ id: s.settlementExpenses.id })
    .from(s.settlementExpenses)
    .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
    .where(and(
      eq(s.settlementExpenses.tripExpenseId, expenseId),
      notInArray(s.advanceSettlements.status, ['REJECTED']),
    )).limit(1);
  if (activeLink) throw new ApiError(409, 'Chi phí đã gửi kế toán, không thể xóa');
  await tx.delete(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId));
  await resetExpenseScope(tx, existing.tripId, existing.tripContainerId);
  return 'DELETED';
}

/**
 * Fetch expense audit info (type name, amounts, trip code, supplier) for logging.
 * Returns null if expense not found.
 */
export async function getTripExpenseAuditInfo(expenseId: number, executor: DbOrTx = db) {
  const [expense] = await executor.select({
    buyAmount: s.tripExpenses.buyAmount,
    typeName: s.forwarderExpenseTypes.name,
    tripCode: s.trips.tripCode,
    supplierName: operationalName(s.suppliers.shortName, s.suppliers.name),
  }).from(s.tripExpenses)
    .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
    .leftJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .leftJoin(s.suppliers, eq(s.tripExpenses.supplierId, s.suppliers.id))
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);
  return expense ?? null;
}

/**
 * Hard-delete a trip expense with business guards:
 * - Trip must not be COMPLETED
 * - Expense must not be linked to any settlement
 * Must be called from the trips route (not the forwarder portal).
 */
export async function deleteTripExpenseGuarded(
  tripId: number,
  expenseId: number,
  transaction?: Tx,
): Promise<GuardedResult> {
  const execute = async (tx: Tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
    const [expense] = await tx.select({
      tripId: s.tripExpenses.tripId,
      tripContainerId: s.tripExpenses.tripContainerId,
      approvalStatus: s.tripExpenses.approvalStatus,
    }).from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);
    if (!expense || expense.tripId !== tripId) {
      return { error: 'Không tìm thấy chi phí của chuyến xe', status: 404 };
    }
    if (expense.approvalStatus === 'APPROVED') {
      return {
        error: 'Chi phí đã duyệt không được xóa trực tiếp; hãy lập yêu cầu điều chỉnh',
        status: 409,
      };
    }
    const scopeKey = expense.tripContainerId ?? -expense.tripId;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${scopeKey})`);
    // Guard: trip must not be completed
    const [trip] = await tx.select({ status: s.trips.status })
      .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
    if (!trip) return { error: 'Không tìm thấy chuyến xe', status: 404 };
    if (trip.status === 'COMPLETED') return { error: 'Không thể xóa chi phí trên chuyến đã hoàn thành', status: 400 };
    // Keep historical settlement snapshots referentially intact, including
    // rejected submissions. Corrections can be edited and resubmitted instead.
    const [link] = await tx.select({ id: s.settlementExpenses.id })
      .from(s.settlementExpenses)
      .where(eq(s.settlementExpenses.tripExpenseId, expenseId)).limit(1);
    if (link) return { error: 'Không thể xóa chi phí đã được thanh toán', status: 400 };
    await tx.delete(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId));
    await resetExpenseScope(tx, expense.tripId, expense.tripContainerId);
    return { ok: true as const };
  };
  return runInTx(transaction, execute);
}

/**
 * List trip expenses belonging to a forwarder that are NOT yet linked to a
 * non-rejected settlement. Used in the settlement form for expense selection.
 */
export async function listUnlinkedTripExpenses(forwarderId: number) {
  // Get all expense IDs already linked to non-rejected settlements
  const linked = await db.select({ tripExpenseId: s.settlementExpenses.tripExpenseId })
    .from(s.settlementExpenses)
    .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
    .where(notInArray(s.advanceSettlements.status, ['REJECTED']));
  const linkedIds = new Set(linked.map(l => l.tripExpenseId));

  const rows = await db.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    expenseType: s.tripExpenses.expenseType,
    buyAmount: s.tripExpenses.buyAmount,
    approvalStatus: s.tripExpenses.approvalStatus,
    tripContainerId: s.tripExpenses.tripContainerId,
    completionStatus: sql<string>`COALESCE((
      SELECT scope.status FROM trip_expense_completion_scopes scope
      WHERE scope.trip_id = ${s.tripExpenses.tripId}
        AND (scope.trip_container_id = ${s.tripExpenses.tripContainerId}
          OR (scope.trip_container_id IS NULL AND ${s.tripExpenses.tripContainerId} IS NULL))
      LIMIT 1
    ), 'IN_PROGRESS')`,
    note: s.tripExpenses.note,
    createdAt: s.tripExpenses.createdAt,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    truckPlate: s.trucks.licensePlate,
    containerNumbers: s.tripContainers.containerNumber,
  }).from(s.tripExpenses)
    .leftJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.tripContainers, eq(s.tripExpenses.tripContainerId, s.tripContainers.id))
    // Intentionally scoped to forwarder-owned expenses only (forwarderId IS NOT NULL).
    // Accountant-created expenses (forwarderId = null) are excluded by design —
    // they are not eligible for forwarder advance settlement.
    .where(and(
      eq(s.tripExpenses.forwarderId, forwarderId),
      inArray(s.tripExpenses.approvalStatus, ['PENDING', 'APPROVED']),
      sql<boolean>`EXISTS (
        SELECT 1
        FROM user_shipment_links scoped_assignment
        WHERE scoped_assignment.user_id = ${forwarderId}
          AND scoped_assignment.shipment_id = ${s.trips.shipmentId}
      )`,
    ))
    .orderBy(desc(s.tripExpenses.createdAt));

  return rows.filter(r => !linkedIds.has(r.id));
}
export async function listTripExpenses(filters?: { tripId?: number; forwarderId?: number; expenseType?: string }) {
  const conditions = [];
  if (filters?.tripId) conditions.push(eq(s.tripExpenses.tripId, filters.tripId));
  if (filters?.forwarderId) conditions.push(eq(s.tripExpenses.forwarderId, filters.forwarderId));
  if (filters?.expenseType) conditions.push(eq(s.tripExpenses.expenseType, filters.expenseType));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    forwarderId: s.tripExpenses.forwarderId,
    expenseType: s.tripExpenses.expenseType,
    amount: s.tripExpenses.buyAmount,
    note: s.tripExpenses.note,
    createdAt: s.tripExpenses.createdAt,
    forwarderName: s.users.fullName,
    tripCode: s.trips.tripCode,
  }).from(s.tripExpenses)
    .leftJoin(s.users, eq(s.tripExpenses.forwarderId, s.users.id))
    .leftJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .where(where)
    .orderBy(desc(s.tripExpenses.createdAt));
}

export async function listSettlementOpsCompletionSummaries(settlementIds: number[]) {
  const ids = [...new Set(
    settlementIds
      .filter((value) => Number.isInteger(value) && value > 0),
  )];
  if (ids.length === 0) return [];

  const settlements = await db
    .select({
      settlementId: s.advanceSettlements.id,
      forwarderId: s.advanceSettlements.forwarderId,
    })
    .from(s.advanceSettlements)
    .where(inArray(s.advanceSettlements.id, ids));
  if (settlements.length === 0) return [];

  const linkedTrips = await db
    .select({
      settlementId: s.settlementExpenses.settlementId,
      forwarderId: s.advanceSettlements.forwarderId,
      tripId: s.tripExpenses.tripId,
    })
    .from(s.settlementExpenses)
    .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
    .innerJoin(s.tripExpenses, eq(s.tripExpenses.id, s.settlementExpenses.tripExpenseId))
    .where(inArray(s.settlementExpenses.settlementId, ids));

  const settlementTripKeys = new Map<number, Set<string>>();
  for (const row of linkedTrips) {
    const key = `${row.forwarderId}:${row.tripId}`;
    const current = settlementTripKeys.get(row.settlementId);
    if (current) current.add(key);
    else settlementTripKeys.set(row.settlementId, new Set([key]));
  }

  const tripIds = [...new Set(linkedTrips.map((row) => row.tripId))];
  if (tripIds.length === 0) {
    return settlements.map((settlement) => ({
      settlementId: settlement.settlementId,
      opsCompletion: {
        tripCount: 0,
        completedGroupCount: 0,
        totalGroupCount: 0,
        trips: [],
      } satisfies SettlementOpsCompletionSummary,
    }));
  }

  const [scopeRows, expenseRows, containerRows] = await Promise.all([
    db.select({
      tripId: s.tripExpenseCompletionScopes.tripId,
      tripContainerId: s.tripExpenseCompletionScopes.tripContainerId,
      status: s.tripExpenseCompletionScopes.status,
    })
      .from(s.tripExpenseCompletionScopes)
      .where(inArray(s.tripExpenseCompletionScopes.tripId, tripIds)),
    db.select({
      forwarderId: s.tripExpenses.forwarderId,
      tripId: s.tripExpenses.tripId,
      tripCode: s.trips.tripCode,
      departureDate: s.trips.departureDate,
      tripContainerId: s.tripExpenses.tripContainerId,
      containerNumber: sql<string | null>`COALESCE(${s.tripContainers.containerNumber}, ${s.tripExpenses.containerNumber})`.as('resolved_container_number'),
    })
      .from(s.tripExpenses)
      .leftJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId))
      .leftJoin(s.tripContainers, eq(s.tripContainers.id, s.tripExpenses.tripContainerId))
      .where(inArray(s.tripExpenses.tripId, tripIds)),
    db.select({
      tripId: s.tripContainers.tripId,
      tripContainerId: s.tripContainers.id,
      containerNumber: s.tripContainers.containerNumber,
    })
      .from(s.tripContainers)
      .where(inArray(s.tripContainers.tripId, tripIds)),
  ]);

  const relevantTripKeys = new Set<string>(linkedTrips.map((row) => `${row.forwarderId}:${row.tripId}`));
  const scopeByGroup = new Map<string, 'IN_PROGRESS' | 'COMPLETED'>(
    scopeRows.map((row) => [
      `${row.tripId}:${row.tripContainerId ?? 'general'}`,
      row.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
    ] as const),
  );

  const tripSummaryByKey = new Map<string, {
    tripId: number;
    tripCode: string | null;
    departureDate: string | null;
    groups: Map<string, SettlementOpsCompletionGroup>;
  }>();

  for (const expense of expenseRows) {
    if (expense.forwarderId == null) continue;
    const tripKey = `${expense.forwarderId}:${expense.tripId}`;
    if (!relevantTripKeys.has(tripKey)) continue;

    let tripSummary = tripSummaryByKey.get(tripKey);
    if (!tripSummary) {
      tripSummary = {
        tripId: expense.tripId,
        tripCode: expense.tripCode ?? null,
        departureDate: expense.departureDate ?? null,
        groups: new Map(),
      };
      tripSummaryByKey.set(tripKey, tripSummary);
    }

    const groupKey = `${expense.tripId}:${expense.tripContainerId ?? 'general'}`;
    const normalizedContainerNumber = expense.containerNumber?.trim() || null;
    const existingGroup = tripSummary.groups.get(groupKey);
    if (existingGroup) {
      existingGroup.expenseCount += 1;
      if (!existingGroup.containerNumber && normalizedContainerNumber) {
        existingGroup.containerNumber = normalizedContainerNumber;
      }
      continue;
    }

    tripSummary.groups.set(groupKey, {
      tripContainerId: expense.tripContainerId,
      containerNumber: normalizedContainerNumber,
      expenseCount: 1,
      status: scopeByGroup.get(groupKey) ?? 'IN_PROGRESS',
    });
  }

  // A zero-expense container is still a real Ops scope. Surface every
  // container plus the general scope so Accounting can see what is still being
  // entered instead of learning about a scope only after its first expense.
  for (const tripKey of relevantTripKeys) {
    const tripSummary = tripSummaryByKey.get(tripKey);
    if (!tripSummary) continue;

    for (const container of containerRows) {
      if (container.tripId !== tripSummary.tripId) continue;
      const groupKey = `${container.tripId}:${container.tripContainerId}`;
      if (tripSummary.groups.has(groupKey)) continue;
      tripSummary.groups.set(groupKey, {
        tripContainerId: container.tripContainerId,
        containerNumber: container.containerNumber?.trim() || null,
        expenseCount: 0,
        status: scopeByGroup.get(groupKey) ?? 'IN_PROGRESS',
      });
    }

    const generalKey = `${tripSummary.tripId}:general`;
    if (!tripSummary.groups.has(generalKey)) {
      tripSummary.groups.set(generalKey, {
        tripContainerId: null,
        containerNumber: null,
        expenseCount: 0,
        status: scopeByGroup.get(generalKey) ?? 'IN_PROGRESS',
      });
    }
  }

  return settlements.map((settlement) => {
    const tripKeys = [...(settlementTripKeys.get(settlement.settlementId) ?? new Set<string>())];
    const trips = tripKeys
      .map((key) => tripSummaryByKey.get(key))
      .filter((trip): trip is NonNullable<typeof trip> => Boolean(trip))
      .map((trip) => {
        const groups = [...trip.groups.values()].sort((left, right) => {
          if (left.tripContainerId == null && right.tripContainerId != null) return 1;
          if (left.tripContainerId != null && right.tripContainerId == null) return -1;
          const leftLabel = left.containerNumber ?? '';
          const rightLabel = right.containerNumber ?? '';
          return leftLabel.localeCompare(rightLabel, 'vi');
        });
        const completedGroupCount = groups.filter((group) => group.status === 'COMPLETED').length;
        return {
          tripId: trip.tripId,
          tripCode: trip.tripCode,
          departureDate: trip.departureDate,
          completedGroupCount,
          totalGroupCount: groups.length,
          groups,
        } satisfies SettlementOpsCompletionTrip;
      })
      .sort((left, right) => {
        const leftDate = left.departureDate ?? '';
        const rightDate = right.departureDate ?? '';
        if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
        return (left.tripCode ?? '').localeCompare(right.tripCode ?? '', 'vi');
      });

    const completedGroupCount = trips.reduce((sum, trip) => sum + trip.completedGroupCount, 0);
    const totalGroupCount = trips.reduce((sum, trip) => sum + trip.totalGroupCount, 0);

    return {
      settlementId: settlement.settlementId,
      opsCompletion: {
        tripCount: trips.length,
        completedGroupCount,
        totalGroupCount,
        trips,
      } satisfies SettlementOpsCompletionSummary,
    };
  });
}

// ─── Trip Expense Photos ──────────────────────────────────────────────────────

export async function addExpensePhoto(tripExpenseId: number, storageKey: string, uploadedBy: number | null) {
  const [inserted] = await db.insert(s.tripExpensePhotos).values({
    tripExpenseId,
    storageKey,
    uploadedBy,
  }).returning();
  return inserted;
}

export async function getExpensePhotos(tripExpenseId: number) {
  return db.select({
    id: s.tripExpensePhotos.id,
    storageKey: s.tripExpensePhotos.storageKey,
    uploadedAt: s.tripExpensePhotos.uploadedAt,
  }).from(s.tripExpensePhotos)
    .where(eq(s.tripExpensePhotos.tripExpenseId, tripExpenseId))
    .orderBy(desc(s.tripExpensePhotos.uploadedAt));
}

/**
 * N1 ownership precheck for the forwarder expense-photo endpoints. Returns the
 * expense id when `tripExpenses.forwarderId === forwarderId`, else null. A NULL
 * forwarderId (accountant/manager-created) never matches a forwarder. GET-list
 * and POST gate on this so an unowned expense yields 404 — not 403 — which
 * removes the photo-id existence oracle on a security-sensitive path.
 */
/** Trip link for an owned expense (scope check downstream in the route). */
export async function getExpenseTripLink(expenseId: number): Promise<number | null> {
  const [row] = await db.select({ tripId: s.tripExpenses.tripId })
    .from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);
  return row?.tripId ?? null;
}

/** Forwarder expense-type catalog rows (policy snapshot inputs). */
export async function listForwarderExpenseTypeRows() {
  return db.select({
    code: s.forwarderExpenseTypes.code,
    name: s.forwarderExpenseTypes.name,
    requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
    substituteEvidenceAllowed: s.forwarderExpenseTypes.substituteEvidenceAllowed,
    noInvoiceEvidenceTypes: s.forwarderExpenseTypes.noInvoiceEvidenceTypes,
    noInvoicePerItemLimit: s.forwarderExpenseTypes.noInvoicePerItemLimit,
    noInvoicePerDayLimit: s.forwarderExpenseTypes.noInvoicePerDayLimit,
    noInvoiceFinanceLeadItemApprovalLimit: s.forwarderExpenseTypes.noInvoiceFinanceLeadItemApprovalLimit,
    noInvoiceDirectorDayApprovalLimit: s.forwarderExpenseTypes.noInvoiceDirectorDayApprovalLimit,
    noInvoiceFinanceLeadApprovalTitle: s.forwarderExpenseTypes.noInvoiceFinanceLeadApprovalTitle,
    noInvoiceDirectorApprovalTitle: s.forwarderExpenseTypes.noInvoiceDirectorApprovalTitle,
    noInvoicePolicyVersion: s.forwarderExpenseTypes.noInvoicePolicyVersion,
  }).from(s.forwarderExpenseTypes)
    .orderBy(s.forwarderExpenseTypes.name);
}

export async function getForwarderOwnedExpenseId(
  expenseId: number,
  forwarderId: number,
): Promise<number | null> {
  const [row] = await db.select({ id: s.tripExpenses.id })
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId))
    .where(and(
      eq(s.tripExpenses.id, expenseId),
      eq(s.tripExpenses.forwarderId, forwarderId),
      sql<boolean>`EXISTS (
        SELECT 1
        FROM user_shipment_links scoped_assignment
        WHERE scoped_assignment.user_id = ${forwarderId}
          AND scoped_assignment.shipment_id = ${s.trips.shipmentId}
      )`,
    ))
    .limit(1);
  return row?.id ?? null;
}

export async function deleteExpensePhoto(photoId: number, forwarderId: number) {
  return db.transaction(async (tx) => {
    // Verify ownership and current shipment scope in the same transaction as
    // deletion so an admin revocation is an effective authorization boundary.
    const [photo] = await tx.select({
      id: s.tripExpensePhotos.id,
      storageKey: s.tripExpensePhotos.storageKey,
      forwarderId: s.tripExpenses.forwarderId,
      tripId: s.tripExpenses.tripId,
    }).from(s.tripExpensePhotos)
      .innerJoin(s.tripExpenses, eq(s.tripExpensePhotos.tripExpenseId, s.tripExpenses.id))
      .where(eq(s.tripExpensePhotos.id, photoId))
      .limit(1);
    if (!photo || photo.forwarderId !== forwarderId) return null;
    await assertForwarderMutableTripScope(photo.tripId, forwarderId, tx);
    await tx.delete(s.tripExpensePhotos).where(eq(s.tripExpensePhotos.id, photoId));
    return { storageKey: photo.storageKey };
  });
}

export async function listActiveSuppliersForForwarder() {
  return db
    .select({
      id: s.suppliers.id,
      name: operationalName(s.suppliers.shortName, s.suppliers.name),
      contactPerson: s.suppliers.contactPerson,
      phone: s.suppliers.phone,
    })
    .from(s.suppliers)
    .where(and(isNull(s.suppliers.deletedAt), eq(s.suppliers.status, 'ACTIVE')));
}

/** Executor-default read for the trips route leaf (route stays db-free). */
export async function getTripExpensesForRoute(tripId: number) {
  return getTripExpenses(db, tripId);
}
