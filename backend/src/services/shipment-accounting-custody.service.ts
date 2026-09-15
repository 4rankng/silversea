// Shipment document custody, accounting-lock activation, and the reopen
// request/decision governance flow (including Debit Note reconciliation on
// reopen). Extracted from shipment-accounting-lock.service.ts verbatim (pure
// code movement).
import { eq, sql } from 'drizzle-orm';
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
  SHIPMENT_ACCOUNTING_LOCKED_MESSAGE,
  readNumber,
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
    throw new ApiError(403, 'Chỉ CUS được mở lại lô đã khóa trong phạm vi được phân công.');
  }

  // 2026-09-10 user directive: the phê duyệt step is removed — a reopen
  // request takes effect immediately. The lock release, Debit Note
  // reconciliation flag, audit log, and notification mirror what the old
  // ADMIN approval used to apply; audit history rides on the released lock
  // row and the audit-log entry below.
  const execute = async (tx: Tx) => {
    const shipment = await lockShipment(tx, args.shipmentId);
    if (shipment.version !== args.input.expectedShipmentVersion) {
      throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi mở lại.');
    }

    const activeLock = await loadActiveLockForUpdate(tx, shipment.id);
    if (!activeLock || activeLock.id !== args.input.activeLockId) {
      throw new ApiError(409, 'Khóa lô hiện hành không còn hợp lệ. Vui lòng tải lại.');
    }

    const now = new Date();
    await tx.update(s.shipmentAccountingLocks).set({
      releasedAt: now,
      releasedBy: args.actor.userId,
      releaseReason: args.input.reason,
    }).where(eq(s.shipmentAccountingLocks.id, activeLock.id));

    const reopenedBy = args.actor.fullName ?? args.actor.username ?? 'CUS';
    const reconciliationReason = `Lô ${shipment.shipmentCode ?? `#${shipment.id}`} đã được mở lại theo yêu cầu của ${reopenedBy}. Debit Note cần đối soát lại trước khi xác nhận tài chính mới.`;
    const [reconciliationDocument] = await tx.update(s.billingDocuments).set({
      version: sql`version + 1`,
      authorityState: 'ADJUSTMENT_REQUIRED',
      authorityWarningReason: reconciliationReason,
      authorityWarningAt: now,
      updatedAt: now,
    }).where(
      eq(s.billingDocuments.id, activeLock.billingDocumentId),
    ).returning({
      id: s.billingDocuments.id,
      version: s.billingDocuments.version,
      authorityState: s.billingDocuments.authorityState,
    });
    if (!reconciliationDocument) {
      throw new ApiError(409, 'Debit Note của khóa lô không còn tồn tại để tạo đối soát.');
    }

    await tx.insert(s.auditLogs).values({
      userId: args.actor.userId,
      actorName: reopenedBy,
      message: reconciliationReason,
      entityType: 'billing-document-source-change',
      entityId: reconciliationDocument.id,
      payload: {
        sourceType: 'SHIPMENT_REOPEN',
        shipmentId: shipment.id,
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

    return {
      reopened: true,
      releasedLockId: activeLock.id,
      invalidatedConfirmationId: activeLock.confirmationActionId,
      resultingShipmentVersion: nextShipmentVersion,
      reconciliation: {
        billingDocumentId: reconciliationDocument.id,
        billingDocumentVersion: reconciliationDocument.version,
        authorityState: reconciliationDocument.authorityState,
        reason: reconciliationReason,
      },
    };
  };
  return runInTx(args.transaction, execute);
}
