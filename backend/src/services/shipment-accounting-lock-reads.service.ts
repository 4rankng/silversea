// Shipment accounting-lock reads: lock/custody/confirmation summaries
// (single + bounded list projection) and the aggregate write guards.
// Extracted from shipment-accounting-lock.service.ts verbatim (pure code
// movement).
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  ISSUED_DEBIT_NOTE_STATUSES,
  SHIPMENT_COST_CONFIRMATION_KIND,
  SHIPMENT_REOPEN_REQUEST_KIND,
  SHIPMENT_ACCOUNTING_LOCKED_MESSAGE,
  type ShipmentDocumentCustodyFactRow,
  type ShipmentFinanceConfirmationSummary,
  type GovernanceRow,
  nameOrUsername,
  readNumber,
  mapConfirmationSummary,
  lockShipment,
  loadActiveLockForUpdate,
  getLatestShipmentReopenApproval,
  getLatestShipmentFinanceConfirmationRow,
} from './shipment-accounting-lock-shared.service';
import { buildShipmentFinanceSnapshot } from './shipment-finance-snapshot.service';

export async function getShipmentAccountingLock(shipmentId: number, tx?: Tx) {
  const executor = tx ?? db;
  const [row] = await executor.select({
    id: s.shipmentAccountingLocks.id,
    shipmentId: s.shipmentAccountingLocks.shipmentId,
    billingDocumentId: s.shipmentAccountingLocks.billingDocumentId,
    confirmationActionId: s.shipmentAccountingLocks.confirmationActionId,
    activatedAt: s.shipmentAccountingLocks.activatedAt,
    activatedByName: sql<string | null>`coalesce(${s.users.fullName}, ${s.users.username})`,
    reason: s.shipmentAccountingLocks.reason,
  })
    .from(s.shipmentAccountingLocks)
    .leftJoin(s.users, eq(s.users.id, s.shipmentAccountingLocks.activatedBy))
    .where(and(
      eq(s.shipmentAccountingLocks.shipmentId, shipmentId),
      isNull(s.shipmentAccountingLocks.releasedAt),
    ))
    .limit(1);
  return row ?? null;
}

export async function getShipmentAccountingLockSummary(shipmentId: number, tx?: Tx) {
  const lock = await getShipmentAccountingLock(shipmentId, tx);
  if (!lock) return null;
  return {
    id: lock.id,
    billingDocumentId: lock.billingDocumentId,
    activatedAt: lock.activatedAt,
    activatedByName: lock.activatedByName,
    reason: lock.reason,
  };
}

export async function getLatestShipmentDocumentCustody(
  shipmentId: number,
  tx?: Tx,
): Promise<ShipmentDocumentCustodyFactRow | null> {
  const executor = tx ?? db;
  const [row] = await executor.select({
    id: s.shipmentDocumentCustodyFacts.id,
    shipmentId: s.shipmentDocumentCustodyFacts.shipmentId,
    shipmentVersion: s.shipmentDocumentCustodyFacts.shipmentVersion,
    status: s.shipmentDocumentCustodyFacts.status,
    note: s.shipmentDocumentCustodyFacts.note,
    changedAt: s.shipmentDocumentCustodyFacts.changedAt,
    changedByName: sql<string | null>`coalesce(${s.users.fullName}, ${s.users.username})`,
  }).from(s.shipmentDocumentCustodyFacts)
    .leftJoin(s.users, eq(s.users.id, s.shipmentDocumentCustodyFacts.changedBy))
    .where(eq(s.shipmentDocumentCustodyFacts.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentDocumentCustodyFacts.changedAt), desc(s.shipmentDocumentCustodyFacts.id))
    .limit(1);
  return row ?? null;
}

export async function getShipmentFinanceConfirmationSummary(
  shipmentId: number,
  tx?: Tx,
): Promise<ShipmentFinanceConfirmationSummary> {
  const executor = tx ?? db;
  const latestApprovedReopen = await getLatestShipmentReopenApproval(shipmentId, executor as Tx);
  const latestConfirmation = await getLatestShipmentFinanceConfirmationRow(shipmentId, executor as Tx);
  const summary = mapConfirmationSummary(latestConfirmation, latestApprovedReopen?.appliedAt ?? null);
  if (
    summary.status !== 'CONFIRMED'
    || summary.billingDocumentId == null
    || summary.checksum == null
  ) {
    return summary;
  }

  try {
    const { checksum } = await buildShipmentFinanceSnapshot(
      executor as Tx,
      shipmentId,
      summary.billingDocumentId,
      { lockRows: false },
    );
    return checksum === summary.checksum
      ? summary
      : { ...summary, status: 'STALE' };
  } catch (error) {
    if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500) {
      return { ...summary, status: 'STALE' };
    }
    throw error;
  }
}

/**
 * Bounded list projection. Source writers invalidate either shipment.version or
 * the canonical Debit Note authority/version, so list pages can verify every
 * row with fixed-count batch queries. Detail and lock commands still rebuild
 * the complete checksum before exposing/accepting a current confirmation.
 */
export async function getShipmentFinanceConfirmationSummaries(
  shipmentIds: readonly number[],
  tx?: Tx,
): Promise<Map<number, ShipmentFinanceConfirmationSummary>> {
  const ids = [...new Set(shipmentIds)];
  const summaries = new Map<number, ShipmentFinanceConfirmationSummary>();
  if (ids.length === 0) return summaries;
  const executor = tx ?? db;
  const [confirmationRows, reopenRows, shipmentRows] = await Promise.all([
    executor.select({
      action: s.governanceActions,
      fullName: s.users.fullName,
      username: s.users.username,
    }).from(s.governanceActions)
      .leftJoin(s.users, eq(s.users.id, s.governanceActions.approverId))
      .where(and(
        eq(s.governanceActions.subjectType, 'SHIPMENT'),
        inArray(s.governanceActions.subjectId, ids),
        eq(s.governanceActions.actionKind, SHIPMENT_COST_CONFIRMATION_KIND),
        eq(s.governanceActions.status, 'APPROVED'),
        sql`${s.governanceActions.appliedAt} is not null`,
      ))
      .orderBy(desc(s.governanceActions.appliedAt), desc(s.governanceActions.id)),
    executor.select({
      shipmentId: s.governanceActions.subjectId,
      appliedAt: s.governanceActions.appliedAt,
    }).from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'SHIPMENT'),
        inArray(s.governanceActions.subjectId, ids),
        eq(s.governanceActions.actionKind, SHIPMENT_REOPEN_REQUEST_KIND),
        eq(s.governanceActions.status, 'APPROVED'),
        sql`${s.governanceActions.appliedAt} is not null`,
      ))
      .orderBy(desc(s.governanceActions.appliedAt), desc(s.governanceActions.id)),
    executor.select({ id: s.shipments.id, version: s.shipments.version })
      .from(s.shipments)
      .where(and(inArray(s.shipments.id, ids), isNull(s.shipments.deletedAt))),
  ]);

  const latestConfirmationByShipment = new Map<number, GovernanceRow & { approverName: string | null }>();
  for (const row of confirmationRows) {
    if (row.action.subjectId == null || latestConfirmationByShipment.has(row.action.subjectId)) continue;
    latestConfirmationByShipment.set(row.action.subjectId, {
      ...row.action,
      approverName: nameOrUsername(row),
    });
  }
  const latestReopenByShipment = new Map<number, Date>();
  for (const row of reopenRows) {
    if (row.shipmentId == null || row.appliedAt == null || latestReopenByShipment.has(row.shipmentId)) continue;
    latestReopenByShipment.set(row.shipmentId, row.appliedAt);
  }
  const shipmentVersionById = new Map(shipmentRows.map((row) => [row.id, row.version]));

  const documentIds: number[] = [];
  for (const shipmentId of ids) {
    const summary = mapConfirmationSummary(
      latestConfirmationByShipment.get(shipmentId) ?? null,
      latestReopenByShipment.get(shipmentId) ?? null,
    );
    summaries.set(shipmentId, summary);
    if (summary.status === 'CONFIRMED' && summary.billingDocumentId != null) {
      documentIds.push(summary.billingDocumentId);
    }
  }
  const documentRows = documentIds.length === 0
    ? []
    : await executor.select({
      id: s.billingDocuments.id,
      version: s.billingDocuments.version,
      type: s.billingDocuments.type,
      debitNoteStatus: s.billingDocuments.debitNoteStatus,
      issuedAt: s.billingDocuments.issuedAt,
      authorityState: s.billingDocuments.authorityState,
      authorityWarningAt: s.billingDocuments.authorityWarningAt,
    }).from(s.billingDocuments)
      .where(and(inArray(s.billingDocuments.id, [...new Set(documentIds)]), isNull(s.billingDocuments.deletedAt)));
  const documentById = new Map(documentRows.map((row) => [row.id, row]));

  for (const shipmentId of ids) {
    const summary = summaries.get(shipmentId)!;
    if (summary.status !== 'CONFIRMED' || summary.billingDocumentId == null) continue;
    const row = latestConfirmationByShipment.get(shipmentId)!;
    const after = row.afterSnapshot as Record<string, unknown> | null;
    const document = documentById.get(summary.billingDocumentId);
    const currentShipmentVersion = shipmentVersionById.get(shipmentId);
    const expectedShipmentVersion = readNumber(after, 'shipmentVersion');
    const expectedDocumentVersion = readNumber(after, 'billingDocumentVersion');
    const documentStatus = document?.debitNoteStatus ?? 'DRAFT';
    if (
      currentShipmentVersion == null
      || expectedShipmentVersion == null
      || currentShipmentVersion !== expectedShipmentVersion
      || document == null
      || expectedDocumentVersion == null
      || document.version !== expectedDocumentVersion
      || document.type !== 'DEBIT_NOTE'
      || document.issuedAt == null
      || document.authorityState !== 'CURRENT'
      || document.authorityWarningAt != null
      || !ISSUED_DEBIT_NOTE_STATUSES.has(documentStatus)
    ) {
      summaries.set(shipmentId, { ...summary, status: 'STALE' });
    }
  }
  return summaries;
}

/**
 * Aggregate write guard. Call inside the same transaction and before the first
 * mutation. Locking the shipment row serializes active-lock checks against
 * operational writes that follow this contract.
 */
export async function assertShipmentAccountingUnlocked(tx: Tx, shipmentId: number) {
  const shipment = await lockShipment(tx, shipmentId);
  const lock = await loadActiveLockForUpdate(tx, shipmentId);
  if (lock) throw new ApiError(409, SHIPMENT_ACCOUNTING_LOCKED_MESSAGE);
  return shipment;
}

export async function assertTripShipmentAccountingUnlocked(tx: Tx, tripId: number) {
  const [trip] = await tx.select({ shipmentId: s.trips.shipmentId })
    .from(s.trips)
    .where(and(eq(s.trips.id, tripId), isNull(s.trips.deletedAt)))
    .limit(1);
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
  if (trip.shipmentId != null) {
    await assertShipmentAccountingUnlocked(tx, trip.shipmentId);
  }
  return trip.shipmentId;
}
