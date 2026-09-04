import { and, eq, isNull, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';


import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import type { Tx } from './trip-shared';

export type ShipmentRecoveryKind = 'DEPOSIT' | 'REPAIR' | 'OTHER';
export type ShipmentRecoveryStatus = 'OPEN' | 'PARTIAL' | 'RECOVERED' | 'WAIVED';

export interface RecordShipmentRecoveryInput {
  expenseId: number;
  expectedExpenseVersion: number;
  expectedSourceVersion: string;
  /** Zero creates the fact; a positive value must match the persisted fact version. */
  expectedRecoveryVersion: number;
  kind: ShipmentRecoveryKind;
  recoveredAmount: string;
  status: ShipmentRecoveryStatus;
  waiverReason?: string | null;
  actor: Pick<AuthUser, 'userId' | 'username' | 'fullName' | 'role'>;
  transaction?: Tx;
}

const RECOVERY_KINDS = new Set<ShipmentRecoveryKind>(['DEPOSIT', 'REPAIR', 'OTHER']);
const RECOVERY_STATUSES = new Set<ShipmentRecoveryStatus>(['OPEN', 'PARTIAL', 'RECOVERED', 'WAIVED']);
const RECOVERY_KIND_LABELS: Record<ShipmentRecoveryKind, string> = {
  DEPOSIT: 'tiền cược',
  REPAIR: 'chi phí sửa chữa',
  OTHER: 'khoản khác',
};

function requireRecoveryWriter(actor: Pick<AuthUser, 'role'>): void {
  if (actor.role !== Role.OPS && actor.role !== Role.ADMIN) {
    throw new ApiError(403, 'Chỉ OPS hoặc ADMIN được cập nhật theo dõi thu hồi của lô hàng.');
  }
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, `${field} không hợp lệ.`);
  }
}

function parseVndAmount(value: string, field: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new ApiError(400, `${field} phải là số tiền VND không âm.`);
  }
  return BigInt(value);
}

export function buildShipmentRecoverySourceVersion(expense: {
  updatedAt: Date;
  approvalStatus: string;
  sellAmount: string;
}): string {
  return `expense:${expense.updatedAt.toISOString()}:${expense.approvalStatus}:${Number(expense.sellAmount)}`;
}

function recoveryAmounts(input: {
  expectedAmount: string;
  recoveredAmount: string;
  status: ShipmentRecoveryStatus;
  waiverReason?: string | null;
}) {
  const expected = parseVndAmount(input.expectedAmount, 'Số phải thu hồi');
  const recovered = parseVndAmount(input.recoveredAmount, 'Số đã thu hồi');
  if (recovered > expected) {
    throw new ApiError(400, 'Số đã thu hồi không được vượt quá số phải thu hồi.');
  }

  const waiverReason = input.waiverReason?.trim() || null;
  if (input.status === 'OPEN' && (recovered !== 0n || expected === 0n)) {
    throw new ApiError(400, 'Trạng thái OPEN chỉ hợp lệ khi chưa thu hồi và vẫn còn số phải thu.');
  }
  if (input.status === 'PARTIAL' && (recovered === 0n || recovered >= expected)) {
    throw new ApiError(400, 'Trạng thái PARTIAL chỉ hợp lệ khi đã thu một phần và vẫn còn số phải thu.');
  }
  if (input.status === 'RECOVERED' && recovered !== expected) {
    throw new ApiError(400, 'Trạng thái RECOVERED yêu cầu đã thu đủ số phải thu hồi.');
  }
  if (input.status === 'WAIVED') {
    if (recovered >= expected) {
      throw new ApiError(400, 'Chỉ được miễn thu khi vẫn còn số tiền chưa thu hồi.');
    }
    if (!waiverReason) {
      throw new ApiError(400, 'Miễn thu phải có lý do miễn thu.');
    }
  } else if (waiverReason) {
    throw new ApiError(400, 'Lý do miễn thu chỉ được ghi khi trạng thái là WAIVED.');
  }

  return {
    expectedAmount: expected.toString(),
    recoveredAmount: recovered.toString(),
    outstandingAmount: input.status === 'WAIVED' ? '0' : (expected - recovered).toString(),
    waiverReason,
  };
}

async function loadRecoverySource(tx: Tx, expenseId: number) {
  const [source] = await tx.select({
    expenseId: s.tripExpenses.id,
    expenseVersion: s.tripExpenses.version,
    approvalStatus: s.tripExpenses.approvalStatus,
    sellAmount: s.tripExpenses.sellAmount,
    recoverablePrincipalAmount: s.tripExpenses.recoverablePrincipalAmount,
    expenseUpdatedAt: s.tripExpenses.updatedAt,
    expenseTripContainerId: s.tripExpenses.tripContainerId,
    tripId: s.trips.id,
    shipmentId: s.shipments.id,
    shipmentCode: s.shipments.shipmentCode,
    tripContainerId: s.tripContainers.id,
    sourceShipmentId: s.tripContainers.sourceShipmentId,
    sourceShipmentContainerId: s.tripContainers.sourceShipmentContainerId,
    shipmentContainerId: s.shipmentContainers.id,
  })
    .from(s.tripExpenses)
    .innerJoin(s.trips, and(
      eq(s.tripExpenses.tripId, s.trips.id),
      isNull(s.trips.deletedAt),
    ))
    .innerJoin(s.shipments, and(
      eq(s.trips.shipmentId, s.shipments.id),
      isNull(s.shipments.deletedAt),
    ))
    .leftJoin(s.tripContainers, and(
      eq(s.tripExpenses.tripContainerId, s.tripContainers.id),
      eq(s.tripContainers.tripId, s.trips.id),
    ))
    .leftJoin(s.shipmentContainers, and(
      eq(s.tripContainers.sourceShipmentContainerId, s.shipmentContainers.id),
      eq(s.shipmentContainers.shipmentId, s.shipments.id),
    ))
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1)
    .for('update', { of: s.tripExpenses });

  if (!source) throw new ApiError(404, 'Không tìm thấy chi phí cần theo dõi thu hồi.');
  if (source.approvalStatus !== 'APPROVED') {
    throw new ApiError(409, 'Chỉ được theo dõi thu hồi từ chi phí đã được phê duyệt.');
  }
  if (source.expenseTripContainerId != null && source.tripContainerId == null) {
    throw new ApiError(409, 'Liên kết container của chi phí không còn hợp lệ.');
  }
  const hasShipmentSource = source.sourceShipmentId != null || source.sourceShipmentContainerId != null;
  if (hasShipmentSource && (
    source.sourceShipmentId !== source.shipmentId
    || source.sourceShipmentContainerId == null
    || source.shipmentContainerId == null
  )) {
    throw new ApiError(409, 'Container nguồn của chi phí không thuộc lô hàng này.');
  }
  return source;
}

/**
 * Create or advance the recovery fact for one approved trip expense.
 * The expense row and shipment lock are checked inside the same transaction as
 * the optimistic upsert, so a successful result is safe to expose directly.
 */
export async function recordShipmentRecovery(input: RecordShipmentRecoveryInput) {
  requireRecoveryWriter(input.actor);
  requirePositiveInteger(input.expenseId, 'expenseId');
  requirePositiveInteger(input.expectedExpenseVersion, 'expectedExpenseVersion');
  if (!Number.isInteger(input.expectedRecoveryVersion) || input.expectedRecoveryVersion < 0) {
    throw new ApiError(400, 'expectedRecoveryVersion không hợp lệ.');
  }
  if (typeof input.expectedSourceVersion !== 'string' || !input.expectedSourceVersion.trim()) {
    throw new ApiError(400, 'expectedSourceVersion không hợp lệ.');
  }
  if (!RECOVERY_KINDS.has(input.kind)) {
    throw new ApiError(400, 'Loại thu hồi không hợp lệ.');
  }
  if (!RECOVERY_STATUSES.has(input.status)) {
    throw new ApiError(400, 'Trạng thái thu hồi không hợp lệ.');
  }

  const execute = async (tx: Tx) => {
    const source = await loadRecoverySource(tx, input.expenseId);
    const currentSourceVersion = buildShipmentRecoverySourceVersion({
      updatedAt: source.expenseUpdatedAt,
      approvalStatus: source.approvalStatus,
      sellAmount: source.sellAmount,
    });
    if (
      source.expenseVersion !== input.expectedExpenseVersion
      || currentSourceVersion !== input.expectedSourceVersion
    ) {
      throw new ApiError(409, 'Chi phí vừa thay đổi. Vui lòng tải lại trước khi cập nhật thu hồi.');
    }
    if (source.recoverablePrincipalAmount == null) {
      throw new ApiError(409, 'Chưa phân loại riêng số tiền phải thu hồi của chi phí.');
    }

    const amounts = recoveryAmounts({
      expectedAmount: source.recoverablePrincipalAmount,
      recoveredAmount: input.recoveredAmount,
      status: input.status,
      waiverReason: input.waiverReason,
    });

    const shipment = await assertShipmentAccountingUnlocked(tx, source.shipmentId);

    const [existing] = await tx.select({
      id: s.shipmentRecoveryFacts.id,
      version: s.shipmentRecoveryFacts.version,
    }).from(s.shipmentRecoveryFacts)
      .where(eq(s.shipmentRecoveryFacts.sourceExpenseId, source.expenseId))
      .limit(1)
      .for('update');
    if (
      (existing == null && input.expectedRecoveryVersion !== 0)
      || (existing != null && existing.version !== input.expectedRecoveryVersion)
    ) {
      throw new ApiError(409, 'Theo dõi thu hồi vừa thay đổi. Vui lòng tải lại trước khi cập nhật.');
    }

    const now = new Date();
    const [fact] = await tx.insert(s.shipmentRecoveryFacts).values({
      shipmentId: source.shipmentId,
      shipmentContainerId: source.shipmentContainerId,
      version: 1,
      kind: input.kind,
      status: input.status,
      ...amounts,
      sourceExpenseId: source.expenseId,
      sourceVersion: currentSourceVersion,
      createdBy: input.actor.userId,
      updatedBy: input.actor.userId,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: s.shipmentRecoveryFacts.sourceExpenseId,
      targetWhere: sql`${s.shipmentRecoveryFacts.sourceExpenseId} is not null`,
      set: {
        shipmentId: source.shipmentId,
        shipmentContainerId: source.shipmentContainerId,
        version: sql`${s.shipmentRecoveryFacts.version} + 1`,
        kind: input.kind,
        status: input.status,
        ...amounts,
        sourceVersion: currentSourceVersion,
        updatedBy: input.actor.userId,
        updatedAt: now,
      },
      setWhere: eq(s.shipmentRecoveryFacts.version, input.expectedRecoveryVersion),
    }).returning();

    if (!fact) {
      throw new ApiError(409, 'Theo dõi thu hồi vừa thay đổi. Vui lòng tải lại trước khi cập nhật.');
    }

    const [updatedShipment] = await tx.update(s.shipments).set({
      version: shipment.version + 1,
      updatedBy: input.actor.userId,
      updatedAt: now,
    }).where(and(
      eq(s.shipments.id, shipment.id),
      eq(s.shipments.version, shipment.version),
    )).returning({ version: s.shipments.version });
    if (!updatedShipment) {
      throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi cập nhật thu hồi.');
    }

    await tx.insert(s.auditLogs).values({
      userId: input.actor.userId,
      actorName: input.actor.fullName ?? input.actor.username,
      message: `${input.actor.role === Role.ADMIN ? 'Quản trị viên' : 'Điều vận'} cập nhật thu hồi ${RECOVERY_KIND_LABELS[input.kind]} của lô ${source.shipmentCode ?? `#${source.shipmentId}`}`,
      entityType: 'shipment-recovery-fact',
      entityId: source.shipmentId,
      payload: {
        factId: fact.id,
        sourceExpenseId: source.expenseId,
        sourceVersion: currentSourceVersion,
        previousVersion: input.expectedRecoveryVersion,
        version: fact.version,
        kind: input.kind,
        status: input.status,
        expectedAmount: amounts.expectedAmount,
        recoveredAmount: amounts.recoveredAmount,
        outstandingAmount: amounts.outstandingAmount,
        waiverReason: amounts.waiverReason,
        shipmentContainerId: source.shipmentContainerId,
        resultingShipmentVersion: updatedShipment.version,
      },
    });

    return fact;
  };

  return runInTx(input.transaction, execute);
}
