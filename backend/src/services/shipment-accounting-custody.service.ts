// Shipment document custody, accounting-lock activation, and the reopen
// request/decision governance flow (including Debit Note reconciliation on
// reopen). Extracted from shipment-accounting-lock.service.ts verbatim (pure
// code movement).
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { NotificationType, Role } from '@tingting/shared';
import type {
  ShipmentCusDocumentCustodyUpdateInput,
  ShipmentCusLockInput,
  ShipmentCusReopenRequestInput,
  ShipmentCusReopenDecisionInput,
} from '@tingting/shared';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { persistNotificationInTx } from './notification.service';
import {
  SHIPMENT_REOPEN_REQUEST_KIND,
  ACTIVE_GOVERNANCE_STATUSES,
  SHIPMENT_ACCOUNTING_LOCKED_MESSAGE,
  readNumber,
  assertCusShipmentScope,
  lockShipment,
  loadActiveLockForUpdate,
  mapConfirmationSummary,
  bumpShipmentVersion,
  getLatestShipmentReopenApproval,
  getLatestShipmentFinanceConfirmationRow,
} from './shipment-accounting-lock-shared.service';
import { buildShipmentFinanceSnapshot } from './shipment-finance-snapshot.service';
import {
  assertShipmentAccountingUnlocked,
  getShipmentAccountingLock,
} from './shipment-accounting-lock-reads.service';

export async function updateShipmentDocumentCustody(args: {
  shipmentId: number;
  input: ShipmentCusDocumentCustodyUpdateInput;
  actor: AuthUser;
  transaction?: Tx;
}) {
  if (args.actor.role !== Role.CUS) {
    throw new ApiError(403, 'Chỉ CUS được cập nhật trạng thái lưu giữ chứng từ.');
  }

  const execute = async (tx: Tx) => {
    const shipment = await assertShipmentAccountingUnlocked(tx, args.shipmentId);
    assertCusShipmentScope(args.actor, shipment.customerId);
    if (shipment.version !== args.input.expectedShipmentVersion) {
      throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi cập nhật chứng từ.');
    }

    const [fact] = await tx.insert(s.shipmentDocumentCustodyFacts).values({
      shipmentId: shipment.id,
      shipmentVersion: shipment.version,
      status: args.input.status,
      note: args.input.note?.trim() || null,
      changedBy: args.actor.userId,
    }).returning();
    const nextShipmentVersion = await bumpShipmentVersion(
      tx,
      shipment.id,
      shipment.version,
      args.actor.userId,
    );

    return {
      fact,
      shipmentVersion: nextShipmentVersion,
    };
  };
  return runInTx(args.transaction, execute);
}

export async function activateShipmentAccountingLock(args: {
  shipmentId: number;
  input: ShipmentCusLockInput;
  actor: AuthUser;
  transaction?: Tx;
}) {
  if (args.actor.role !== Role.CUS) {
    throw new ApiError(403, 'Chỉ CUS được khóa lô sau khi Kế toán đã xác nhận.');
  }

  const execute = async (tx: Tx) => {
    const shipment = await lockShipment(tx, args.shipmentId);
    assertCusShipmentScope(args.actor, shipment.customerId);
    const existing = await loadActiveLockForUpdate(tx, args.shipmentId);
    if (existing) {
      if (existing.confirmationActionId === args.input.confirmationId) {
        const replayed = await getShipmentAccountingLock(args.shipmentId, tx);
        if (!replayed) throw new ApiError(409, SHIPMENT_ACCOUNTING_LOCKED_MESSAGE);
        return { lock: replayed, replayed: true };
      }
      throw new ApiError(409, SHIPMENT_ACCOUNTING_LOCKED_MESSAGE);
    }
    if (shipment.version !== args.input.expectedVersion) {
      throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi khóa.');
    }

    const latestApprovedReopen = await getLatestShipmentReopenApproval(shipment.id, tx);
    const latestConfirmation = await getLatestShipmentFinanceConfirmationRow(shipment.id, tx);
    const confirmationSummary = mapConfirmationSummary(
      latestConfirmation,
      latestApprovedReopen?.appliedAt ?? null,
    );
    if (
      confirmationSummary.status !== 'CONFIRMED'
      || confirmationSummary.confirmationId !== args.input.confirmationId
      || confirmationSummary.checksum !== args.input.confirmationChecksum
      || confirmationSummary.billingDocumentId == null
    ) {
      throw new ApiError(409, 'Xác nhận kế toán hiện tại không còn hợp lệ để khóa lô.');
    }

    const { document, snapshot, checksum } = await buildShipmentFinanceSnapshot(
      tx,
      shipment.id,
      confirmationSummary.billingDocumentId,
    );
    if (checksum !== args.input.confirmationChecksum) {
      throw new ApiError(409, 'Nguồn tài chính đã thay đổi sau lần xác nhận. Vui lòng yêu cầu Kế toán xác nhận lại.');
    }

    const [lock] = await tx.insert(s.shipmentAccountingLocks).values({
      shipmentId: shipment.id,
      billingDocumentId: document.id,
      confirmationActionId: args.input.confirmationId,
      billingDocumentVersion: document.version,
      billingPeriodSnapshot: snapshot.billingPeriodSnapshot,
      shipmentVersionAtLock: shipment.version,
      reason: args.input.reason,
      activatedBy: args.actor.userId,
    }).returning();

    await bumpShipmentVersion(tx, shipment.id, shipment.version, args.actor.userId);

    await tx.insert(s.auditLogs).values({
      userId: args.actor.userId,
      actorName: args.actor.fullName ?? args.actor.username,
      message: `CUS khóa lô ${shipment.shipmentCode ?? `#${shipment.id}`} theo xác nhận kế toán #${args.input.confirmationId}`,
      entityType: 'shipment-accounting-lock',
      entityId: shipment.id,
      payload: {
        lockId: lock.id,
        confirmationId: args.input.confirmationId,
        checksum,
        billingDocumentId: document.id,
        shipmentVersionAtLock: shipment.version,
        reason: args.input.reason,
      },
    });

    const persisted = await getShipmentAccountingLock(shipment.id, tx);
    if (!persisted) throw new ApiError(500, 'Không thể tải lại bản ghi khóa lô vừa tạo.');
    return { lock: persisted, replayed: false };
  };
  return runInTx(args.transaction, execute);
}

export async function requestShipmentReopen(args: {
  shipmentId: number;
  input: ShipmentCusReopenRequestInput;
  actor: AuthUser;
  transaction?: Tx;
}) {
  if (args.actor.role !== Role.CUS) {
    throw new ApiError(403, 'Chỉ CUS được gửi đề nghị điều chỉnh lô đã khóa.');
  }

  const execute = async (tx: Tx) => {
    const shipment = await lockShipment(tx, args.shipmentId);
    assertCusShipmentScope(args.actor, shipment.customerId);
    if (shipment.version !== args.input.expectedShipmentVersion) {
      throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi gửi đề nghị.');
    }

    const activeLock = await loadActiveLockForUpdate(tx, shipment.id);
    if (!activeLock || activeLock.id !== args.input.activeLockId) {
      throw new ApiError(409, 'Khóa lô hiện hành không còn hợp lệ. Vui lòng tải lại.');
    }

    const [pending] = await tx.select().from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'SHIPMENT'),
        eq(s.governanceActions.subjectId, shipment.id),
        eq(s.governanceActions.actionKind, SHIPMENT_REOPEN_REQUEST_KIND),
        inArray(s.governanceActions.status, [...ACTIVE_GOVERNANCE_STATUSES]),
      ))
      .orderBy(desc(s.governanceActions.id))
      .limit(1)
      .for('update');
    if (pending) {
      return { action: pending, replayed: true };
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'SHIPMENT',
      subjectId: shipment.id,
      actionKind: SHIPMENT_REOPEN_REQUEST_KIND,
      status: 'PENDING_APPROVAL',
      reason: args.input.reason,
      originalVersion: shipment.version,
      beforeSnapshot: {
        activeLockId: activeLock.id,
        confirmationActionId: activeLock.confirmationActionId,
        billingDocumentId: activeLock.billingDocumentId,
      },
      afterSnapshot: {
        state: 'REOPEN_REQUESTED',
      },
      deltaSnapshot: {
        activeLockId: activeLock.id,
      },
      makerId: args.actor.userId,
      makerRole: args.actor.role,
    }).returning();
    return { action, replayed: false };
  };
  return runInTx(args.transaction, execute);
}

export async function decideShipmentReopen(args: {
  shipmentId: number;
  actionId: number;
  input: ShipmentCusReopenDecisionInput;
  actor: AuthUser;
  transaction?: Tx;
}) {
  if (args.actor.role !== Role.ADMIN) {
    throw new ApiError(403, 'Chỉ ADMIN được xử lý đề nghị điều chỉnh lô đã khóa.');
  }

  const execute = async (tx: Tx) => {
    const [action] = await tx.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, args.actionId))
      .limit(1)
      .for('update');
    if (
      !action
      || action.subjectType !== 'SHIPMENT'
      || action.subjectId !== args.shipmentId
      || action.actionKind !== SHIPMENT_REOPEN_REQUEST_KIND
    ) {
      throw new ApiError(404, 'Không tìm thấy đề nghị điều chỉnh của lô hàng');
    }
    if (action.version !== args.input.expectedVersion) {
      throw new ApiError(409, 'Đề nghị đã được người khác xử lý. Vui lòng tải lại.');
    }
    if (action.status !== 'PENDING_APPROVAL') {
      throw new ApiError(409, 'Đề nghị không còn ở trạng thái chờ ADMIN xử lý.');
    }

    const now = new Date();
    if (args.input.decision === 'REJECT') {
      const [rejected] = await tx.update(s.governanceActions).set({
        status: 'REJECTED',
        rejectedBy: args.actor.userId,
        rejectedRole: args.actor.role,
        rejectedAt: now,
        rejectionReason: args.input.reason,
        updatedAt: now,
        version: sql`${s.governanceActions.version} + 1`,
      }).where(and(
        eq(s.governanceActions.id, action.id),
        eq(s.governanceActions.status, 'PENDING_APPROVAL'),
        eq(s.governanceActions.version, args.input.expectedVersion),
      )).returning();
      if (!rejected) {
        throw new ApiError(409, 'Đề nghị đã được người khác xử lý. Vui lòng tải lại.');
      }
      return rejected;
    }

    const shipment = await lockShipment(tx, args.shipmentId);
    if (shipment.version !== action.originalVersion) {
      throw new ApiError(409, 'Lô hàng đã thay đổi sau khi gửi đề nghị. Vui lòng tạo lại đề nghị mới.');
    }
    const activeLock = await loadActiveLockForUpdate(tx, shipment.id);
    const before = action.beforeSnapshot as Record<string, unknown> | null;
    const expectedLockId = readNumber(before, 'activeLockId');
    if (!activeLock || expectedLockId == null || activeLock.id !== expectedLockId) {
      throw new ApiError(409, 'Khóa lô hiện hành không còn khớp với đề nghị điều chỉnh.');
    }

    await tx.update(s.shipmentAccountingLocks).set({
      releasedAt: now,
      releasedBy: args.actor.userId,
      releaseGovernanceActionId: action.id,
      releaseReason: args.input.reason,
    }).where(eq(s.shipmentAccountingLocks.id, activeLock.id));

    const reconciliationReason = `Lô ${shipment.shipmentCode ?? `#${shipment.id}`} đã được ADMIN mở lại theo đề nghị #${action.id}. Debit Note cần đối soát lại trước khi xác nhận tài chính mới.`;
    const [reconciliationDocument] = await tx.update(s.billingDocuments).set({
      version: sql`${s.billingDocuments.version} + 1`,
      authorityState: 'ADJUSTMENT_REQUIRED',
      authorityWarningReason: reconciliationReason,
      authorityWarningAt: now,
      updatedAt: now,
    }).where(and(
      eq(s.billingDocuments.id, activeLock.billingDocumentId),
      isNull(s.billingDocuments.deletedAt),
    )).returning({
      id: s.billingDocuments.id,
      version: s.billingDocuments.version,
      authorityState: s.billingDocuments.authorityState,
    });
    if (!reconciliationDocument) {
      throw new ApiError(409, 'Debit Note của khóa lô không còn tồn tại để tạo đối soát.');
    }

    await tx.insert(s.auditLogs).values({
      userId: args.actor.userId,
      actorName: args.actor.fullName ?? args.actor.username,
      message: reconciliationReason,
      entityType: 'billing-document-source-change',
      entityId: reconciliationDocument.id,
      payload: {
        sourceType: 'SHIPMENT_REOPEN',
        shipmentId: shipment.id,
        governanceActionId: action.id,
        releasedLockId: activeLock.id,
        invalidatedConfirmationId: activeLock.confirmationActionId,
        billingDocumentVersion: reconciliationDocument.version,
        authorityState: reconciliationDocument.authorityState,
      },
    });
    await persistNotificationInTx(tx, {
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'Debit Note cần đối soát sau khi mở lại lô',
      message: reconciliationReason,
      relatedEntityType: 'billing_documents',
      relatedEntityId: reconciliationDocument.id,
    });
    const nextShipmentVersion = await bumpShipmentVersion(
      tx,
      shipment.id,
      shipment.version,
      args.actor.userId,
    );

    const [approved] = await tx.update(s.governanceActions).set({
      status: 'APPROVED',
      approverId: args.actor.userId,
      approverRole: args.actor.role,
      approvedAt: now,
      appliedAt: now,
      applicationResult: {
        releasedLockId: activeLock.id,
        invalidatedConfirmationId: activeLock.confirmationActionId,
        resultingShipmentVersion: nextShipmentVersion,
        reconciliation: {
          billingDocumentId: reconciliationDocument.id,
          billingDocumentVersion: reconciliationDocument.version,
          authorityState: reconciliationDocument.authorityState,
          reason: reconciliationReason,
        },
      },
      updatedAt: now,
      version: sql`${s.governanceActions.version} + 1`,
    }).where(and(
      eq(s.governanceActions.id, action.id),
      eq(s.governanceActions.status, 'PENDING_APPROVAL'),
      eq(s.governanceActions.version, args.input.expectedVersion),
    )).returning();
    if (!approved) {
      throw new ApiError(409, 'Đề nghị đã được người khác xử lý. Vui lòng tải lại.');
    }
    return approved;
  };
  return runInTx(args.transaction, execute);
}
