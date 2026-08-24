// Shared machinery for the shipment-accounting-lock leaf family: status/kind
// constants, finance-snapshot + proposal-coverage row types, checksums, the
// confirmation-summary mapper, row lockers, and version bumping. Extracted
// from shipment-accounting-lock.service.ts verbatim (pure code movement); the
// snapshot / reads / confirm / custody leaves import these one-way.
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  Role,
  type ShipmentChargeProposalField,
} from '@tingting/shared';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { effectiveAmount } from './billing-document.service';

export const ISSUED_DEBIT_NOTE_STATUSES = new Set([
  'SENT',
  'PENDING_CONFIRM',
  'CONFIRMED',
  'PARTIAL_PAID',
  'PAID',
]);

export const ACTIVE_GOVERNANCE_STATUSES = [
  'PENDING_CHECK',
  'PENDING_APPROVAL',
  'RETURNED_FOR_EVIDENCE',
] as const;

export const SHIPMENT_COST_CONFIRMATION_KIND = 'SHIPMENT_COST_CONFIRMATION' as const;
export const SHIPMENT_PROPOSAL_BILLING_LINK_KIND = 'SHIPMENT_PROPOSAL_BILLING_LINK' as const;
export const SHIPMENT_REOPEN_REQUEST_KIND = 'SHIPMENT_REOPEN_REQUEST' as const;

export const PROPOSAL_FIELD_COLUMN_MAP = {
  OUTBOUND_TRANSPORT: 'outboundTransportAmount',
  OUTBOUND_HANDLING: 'outboundHandlingAmount',
  OUTBOUND_INCIDENTAL: 'outboundIncidentalAmount',
  INBOUND_TRANSPORT: 'inboundTransportAmount',
  INBOUND_HANDLING: 'inboundHandlingAmount',
} as const satisfies Record<ShipmentChargeProposalField, string>;

export type GovernanceRow = typeof s.governanceActions.$inferSelect;

export type ShipmentDocumentCustodyFactRow = {
  id: number;
  shipmentId: number;
  shipmentVersion: number;
  status: string;
  note: string | null;
  changedAt: Date;
  changedByName: string | null;
};

export type FinanceSnapshot = {
  billingDocumentId: number;
  billingDocumentVersion: number;
  billingPeriodSnapshot: {
    rangeFrom: string;
    rangeTo: string;
    issuedAt: string;
  };
  shipmentVersion: number;
  tripClaims: Array<{
    tripId: number;
    financialPostingId: number;
    financialPostingVersion: number;
    postingChecksum: string;
  }>;
  recoverableExpenses: Array<{
    expenseId: number;
    expenseVersion: number;
    sourceVersion: string;
    sellAmount: string;
  }>;
  recoveryFacts: Array<{
    id: number;
    sourceExpenseId: number;
    version: number;
    sourceVersion: string;
    kind: string;
    status: string;
    expectedAmount: string;
    recoveredAmount: string;
    outstandingAmount: string;
  }>;
  chargeProposals: Array<{
    id: number;
    shipmentContainerId: number;
    version: number;
    outboundTransportAmount: string | null;
    outboundHandlingAmount: string | null;
    outboundIncidentalAmount: string | null;
    inboundTransportAmount: string | null;
    inboundHandlingAmount: string | null;
  }>;
  proposalCoverage: Array<{
    actionId: number;
    proposalFactId: number;
    proposalField: ShipmentChargeProposalField;
    proposalVersion: number;
    proposalChecksum: string;
    amount: string;
    decision: 'ACCEPT_LINK' | 'REJECT';
    billingDocumentId: number | null;
    billingDocumentVersion: number | null;
    billingDocumentLineId: number | null;
  }>;
};

export type FinanceSnapshotOptions = {
  lockRows?: boolean;
};

export type ShipmentFinanceConfirmationSummary = {
  status: 'CONFIRMED' | 'STALE' | 'PENDING';
  confirmationId: number | null;
  checksum: string | null;
  billingDocumentId: number | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
};

export const SHIPMENT_ACCOUNTING_LOCKED_MESSAGE =
  'Lô hàng đã được CUS khóa sau khi Kế toán xác nhận. Mọi thay đổi trực tiếp phải đi qua đề nghị điều chỉnh do ADMIN phê duyệt.';

export type ChargeProposalRow = FinanceSnapshot['chargeProposals'][number];
export type ProposalCoverageRow = FinanceSnapshot['proposalCoverage'][number];

export type ChargeProposalLineRow = Pick<
  typeof s.billingDocumentLines.$inferSelect,
  'id' | 'documentId' | 'sourceType' | 'excluded' | 'baseAmount' | 'amountOverride' | 'grossAmount'
>;

export function financialPostingChecksum(posting: {
  id: number;
  tripId: number;
  version: number;
  tripVersion: number;
  reason: string;
  effectiveAt: Date;
}) {
  return createHash('sha256').update(JSON.stringify({
    id: posting.id,
    tripId: posting.tripId,
    version: posting.version,
    tripVersion: posting.tripVersion,
    reason: posting.reason,
    effectiveAt: posting.effectiveAt.toISOString(),
  })).digest('hex');
}

export function expenseSourceVersion(expense: {
  updatedAt: Date;
  approvalStatus: string;
  sellAmount: string;
}) {
  return `expense:${expense.updatedAt.toISOString()}:${expense.approvalStatus}:${Number(expense.sellAmount)}`;
}

export function financeSnapshotChecksum(snapshot: FinanceSnapshot): string {
  return createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');
}

export function nameOrUsername(row: { fullName: string | null; username: string | null }): string | null {
  return row.fullName ?? row.username ?? null;
}

export function readNumber(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function readString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function normalizeNumericString(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : null;
}

export function proposalKey(proposalFactId: number, proposalField: ShipmentChargeProposalField): string {
  return `${proposalFactId}:${proposalField}`;
}

export function proposalChecksum(proposal: ChargeProposalRow): string {
  return createHash('sha256').update(JSON.stringify({
    id: proposal.id,
    shipmentContainerId: proposal.shipmentContainerId,
    version: proposal.version,
    outboundTransportAmount: normalizeNumericString(proposal.outboundTransportAmount),
    outboundHandlingAmount: normalizeNumericString(proposal.outboundHandlingAmount),
    outboundIncidentalAmount: normalizeNumericString(proposal.outboundIncidentalAmount),
    inboundTransportAmount: normalizeNumericString(proposal.inboundTransportAmount),
    inboundHandlingAmount: normalizeNumericString(proposal.inboundHandlingAmount),
  })).digest('hex');
}

export function proposalAmountForField(
  proposal: ChargeProposalRow,
  field: ShipmentChargeProposalField,
): string | null {
  const column = PROPOSAL_FIELD_COLUMN_MAP[field] as keyof ChargeProposalRow;
  return normalizeNumericString(proposal[column] as string | number | null | undefined);
}

export function parseProposalCoverageRow(action: GovernanceRow): ProposalCoverageRow | null {
  const after = action.afterSnapshot as Record<string, unknown> | null;
  const proposalField = readString(after, 'proposalField');
  const decision = readString(after, 'decision');
  const amount = normalizeNumericString(readString(after, 'amount'));
  if (
    proposalField == null
    || !Object.hasOwn(PROPOSAL_FIELD_COLUMN_MAP, proposalField)
    || (decision !== 'ACCEPT_LINK' && decision !== 'REJECT')
    || amount == null
  ) {
    return null;
  }
  const proposalFactId = readNumber(after, 'proposalFactId');
  const proposalVersion = readNumber(after, 'proposalVersion');
  const proposalChecksumValue = readString(after, 'proposalChecksum');
  if (proposalFactId == null || proposalVersion == null || proposalChecksumValue == null) {
    return null;
  }
  return {
    actionId: action.id,
    proposalFactId,
    proposalField: proposalField as ShipmentChargeProposalField,
    proposalVersion,
    proposalChecksum: proposalChecksumValue,
    amount,
    decision,
    billingDocumentId: readNumber(after, 'billingDocumentId'),
    billingDocumentVersion: readNumber(after, 'billingDocumentVersion'),
    billingDocumentLineId: readNumber(after, 'billingDocumentLineId'),
  };
}

export function billingLineEffectiveAmount(line: ChargeProposalLineRow): string {
  return String(effectiveAmount({
    excluded: line.excluded,
    baseAmount: Number(line.baseAmount ?? 0),
    amountOverride: line.amountOverride == null ? null : Number(line.amountOverride),
    grossAmount: line.grossAmount == null ? null : Number(line.grossAmount),
  }));
}

export function assertCusShipmentScope(actor: AuthUser, shipmentCustomerId: number | null) {
  if (actor.role !== Role.CUS) return;
  if (shipmentCustomerId == null) {
    throw new ApiError(404, 'Không tìm thấy lô hàng');
  }
  if (actor.customerIds?.length) {
    if (actor.customerIds.includes(shipmentCustomerId)) return;
    throw new ApiError(404, 'Không tìm thấy lô hàng');
  }
  if (actor.customerId != null && actor.customerId === shipmentCustomerId) return;
  throw new ApiError(404, 'Không tìm thấy lô hàng');
}

export async function lockShipment(
  tx: Tx,
  shipmentId: number,
  options: FinanceSnapshotOptions = {},
) {
  const query = tx.select().from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  const [shipment] = await (options.lockRows === false ? query : query.for('update'));
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
  return shipment;
}

export async function getLatestShipmentReopenApproval(
  shipmentId: number,
  tx: Tx,
) {
  const [row] = await tx.select({
    id: s.governanceActions.id,
    appliedAt: s.governanceActions.appliedAt,
  }).from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, 'SHIPMENT'),
      eq(s.governanceActions.subjectId, shipmentId),
      eq(s.governanceActions.actionKind, SHIPMENT_REOPEN_REQUEST_KIND),
      eq(s.governanceActions.status, 'APPROVED'),
      sql`${s.governanceActions.appliedAt} is not null`,
    ))
    .orderBy(desc(s.governanceActions.appliedAt), desc(s.governanceActions.id))
    .limit(1);
  return row ?? null;
}

export async function getLatestShipmentFinanceConfirmationRow(
  shipmentId: number,
  tx: Tx,
) {
  const [row] = await tx.select({
    action: s.governanceActions,
    fullName: s.users.fullName,
    username: s.users.username,
  }).from(s.governanceActions)
    .leftJoin(s.users, eq(s.users.id, s.governanceActions.approverId))
    .where(and(
      eq(s.governanceActions.subjectType, 'SHIPMENT'),
      eq(s.governanceActions.subjectId, shipmentId),
      eq(s.governanceActions.actionKind, SHIPMENT_COST_CONFIRMATION_KIND),
      eq(s.governanceActions.status, 'APPROVED'),
      sql`${s.governanceActions.appliedAt} is not null`,
    ))
    .orderBy(desc(s.governanceActions.appliedAt), desc(s.governanceActions.id))
    .limit(1);
  if (!row) return null;
  return {
    ...row.action,
    approverName: nameOrUsername(row),
  };
}
export async function loadActiveLockForUpdate(
  tx: Tx,
  shipmentId: number,
) {
  const [lock] = await tx.select().from(s.shipmentAccountingLocks)
    .where(and(
      eq(s.shipmentAccountingLocks.shipmentId, shipmentId),
      isNull(s.shipmentAccountingLocks.releasedAt),
    ))
    .limit(1)
    .for('update');
  return lock ?? null;
}

export function mapConfirmationSummary(
  row: (GovernanceRow & { approverName?: string | null }) | null,
  latestApprovedReopenAt: Date | null,
): ShipmentFinanceConfirmationSummary {
  if (!row) {
    return {
      status: 'PENDING',
      confirmationId: null,
      checksum: null,
      billingDocumentId: null,
      confirmedAt: null,
      confirmedByName: null,
    };
  }
  const after = row.afterSnapshot as Record<string, unknown> | null;
  const confirmedAt = row.appliedAt ?? row.approvedAt ?? row.createdAt;
  const stale = latestApprovedReopenAt != null && confirmedAt != null && latestApprovedReopenAt > confirmedAt;
  return {
    status: stale ? 'STALE' : 'CONFIRMED',
    confirmationId: row.id,
    checksum: readString(after, 'checksum'),
    billingDocumentId: readNumber(after, 'billingDocumentId'),
    confirmedAt: confirmedAt?.toISOString() ?? null,
    confirmedByName: row.approverName ?? null,
  };
}

export async function bumpShipmentVersion(
  tx: Tx,
  shipmentId: number,
  currentVersion: number,
  actorId: number,
) {
  const [updated] = await tx.update(s.shipments).set({
    version: currentVersion + 1,
    updatedBy: actorId,
    updatedAt: new Date(),
  }).where(and(
    eq(s.shipments.id, shipmentId),
    eq(s.shipments.version, currentVersion),
  )).returning({ version: s.shipments.version });
  if (!updated) {
    throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại và thử lại.');
  }
  return updated.version;
}
