import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  NotificationType,
  Role,
  type ShipmentChargeProposalField,
  type ShipmentChargeProposalReviewInput,
  type ShipmentCusDocumentCustodyUpdateInput,
  type ShipmentCusFinanceConfirmationCreateInput,
  type ShipmentCusLockInput,
  type ShipmentCusReopenDecisionInput,
  type ShipmentCusReopenRequestInput,
} from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { lockApplicationOwnedUniquenessSet } from './application-owned-uniqueness.service';
import { effectiveAmount } from './billing-document.service';
import { persistNotificationInTx } from './notification.service';

const ISSUED_DEBIT_NOTE_STATUSES = new Set([
  'SENT',
  'PENDING_CONFIRM',
  'CONFIRMED',
  'PARTIAL_PAID',
  'PAID',
]);

const ACTIVE_GOVERNANCE_STATUSES = [
  'PENDING_CHECK',
  'PENDING_APPROVAL',
  'RETURNED_FOR_EVIDENCE',
] as const;

const SHIPMENT_COST_CONFIRMATION_KIND = 'SHIPMENT_COST_CONFIRMATION' as const;
const SHIPMENT_PROPOSAL_BILLING_LINK_KIND = 'SHIPMENT_PROPOSAL_BILLING_LINK' as const;
const SHIPMENT_REOPEN_REQUEST_KIND = 'SHIPMENT_REOPEN_REQUEST' as const;

const PROPOSAL_FIELD_COLUMN_MAP = {
  OUTBOUND_TRANSPORT: 'outboundTransportAmount',
  OUTBOUND_HANDLING: 'outboundHandlingAmount',
  OUTBOUND_INCIDENTAL: 'outboundIncidentalAmount',
  INBOUND_TRANSPORT: 'inboundTransportAmount',
  INBOUND_HANDLING: 'inboundHandlingAmount',
} as const satisfies Record<ShipmentChargeProposalField, string>;

type GovernanceRow = typeof s.governanceActions.$inferSelect;

type ShipmentDocumentCustodyFactRow = {
  id: number;
  shipmentId: number;
  shipmentVersion: number;
  status: string;
  note: string | null;
  changedAt: Date;
  changedByName: string | null;
};

type FinanceSnapshot = {
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

type FinanceSnapshotOptions = {
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

type ChargeProposalRow = FinanceSnapshot['chargeProposals'][number];
type ProposalCoverageRow = FinanceSnapshot['proposalCoverage'][number];

type ChargeProposalLineRow = Pick<
  typeof s.billingDocumentLines.$inferSelect,
  'id' | 'documentId' | 'sourceType' | 'excluded' | 'baseAmount' | 'amountOverride' | 'grossAmount'
>;

function financialPostingChecksum(posting: {
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

function expenseSourceVersion(expense: {
  updatedAt: Date;
  approvalStatus: string;
  sellAmount: string;
}) {
  return `expense:${expense.updatedAt.toISOString()}:${expense.approvalStatus}:${Number(expense.sellAmount)}`;
}

function financeSnapshotChecksum(snapshot: FinanceSnapshot): string {
  return createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');
}

function nameOrUsername(row: { fullName: string | null; username: string | null }): string | null {
  return row.fullName ?? row.username ?? null;
}

function readNumber(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function readString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeNumericString(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : null;
}

function proposalKey(proposalFactId: number, proposalField: ShipmentChargeProposalField): string {
  return `${proposalFactId}:${proposalField}`;
}

function proposalChecksum(proposal: ChargeProposalRow): string {
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

function proposalAmountForField(
  proposal: ChargeProposalRow,
  field: ShipmentChargeProposalField,
): string | null {
  const column = PROPOSAL_FIELD_COLUMN_MAP[field] as keyof ChargeProposalRow;
  return normalizeNumericString(proposal[column] as string | number | null | undefined);
}

function parseProposalCoverageRow(action: GovernanceRow): ProposalCoverageRow | null {
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

function billingLineEffectiveAmount(line: ChargeProposalLineRow): string {
  return String(effectiveAmount({
    excluded: line.excluded,
    baseAmount: Number(line.baseAmount ?? 0),
    amountOverride: line.amountOverride == null ? null : Number(line.amountOverride),
    grossAmount: line.grossAmount == null ? null : Number(line.grossAmount),
  }));
}

function assertCusShipmentScope(actor: AuthUser, shipmentCustomerId: number | null) {
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

async function lockShipment(
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

async function getLatestShipmentReopenApproval(
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

async function getLatestShipmentFinanceConfirmationRow(
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

async function loadCurrentProposalCoverageByShipment(
  tx: Tx,
  shipmentId: number,
  options: FinanceSnapshotOptions = {},
): Promise<Map<string, ProposalCoverageRow>> {
  const query = tx.select({
    action: s.governanceActions,
  }).from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, 'SHIPMENT'),
      eq(s.governanceActions.subjectId, shipmentId),
      eq(s.governanceActions.actionKind, SHIPMENT_PROPOSAL_BILLING_LINK_KIND),
      eq(s.governanceActions.status, 'APPROVED'),
      sql`${s.governanceActions.appliedAt} is not null`,
    ))
    .orderBy(desc(s.governanceActions.appliedAt), desc(s.governanceActions.id));
  const rows = await (options.lockRows === false ? query : query.for('update'));
  const coverage = new Map<string, ProposalCoverageRow>();
  for (const row of rows) {
    const parsed = parseProposalCoverageRow(row.action);
    if (!parsed) continue;
    const key = proposalKey(parsed.proposalFactId, parsed.proposalField);
    if (!coverage.has(key)) {
      coverage.set(key, parsed);
    }
  }
  return coverage;
}

async function loadCurrentProposalCoverageForDocumentLine(
  tx: Tx,
  billingDocumentId: number,
  billingDocumentLineId: number,
): Promise<ProposalCoverageRow[]> {
  const rows = await tx.select({
    action: s.governanceActions,
  }).from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, 'SHIPMENT'),
      eq(s.governanceActions.actionKind, SHIPMENT_PROPOSAL_BILLING_LINK_KIND),
      eq(s.governanceActions.status, 'APPROVED'),
      sql`${s.governanceActions.appliedAt} is not null`,
      sql`(${s.governanceActions.afterSnapshot} ->> 'billingDocumentId')::int = ${billingDocumentId}`,
      sql`(${s.governanceActions.afterSnapshot} ->> 'billingDocumentLineId')::int = ${billingDocumentLineId}`,
    ))
    .orderBy(desc(s.governanceActions.appliedAt), desc(s.governanceActions.id));
  const latestByKey = new Map<string, ProposalCoverageRow>();
  for (const row of rows) {
    const parsed = parseProposalCoverageRow(row.action);
    if (!parsed) continue;
    const key = proposalKey(parsed.proposalFactId, parsed.proposalField);
    if (!latestByKey.has(key)) {
      latestByKey.set(key, parsed);
    }
  }
  return [...latestByKey.values()].filter((row) => row.decision === 'ACCEPT_LINK');
}

async function loadChargeProposalFactForUpdate(
  tx: Tx,
  shipmentId: number,
  proposalFactId: number,
): Promise<ChargeProposalRow> {
  const [proposal] = await tx.select({
    id: s.shipmentContainerChargeFacts.id,
    shipmentContainerId: s.shipmentContainerChargeFacts.shipmentContainerId,
    version: s.shipmentContainerChargeFacts.version,
    outboundTransportAmount: s.shipmentContainerChargeFacts.outboundTransportAmount,
    outboundHandlingAmount: s.shipmentContainerChargeFacts.outboundHandlingAmount,
    outboundIncidentalAmount: s.shipmentContainerChargeFacts.outboundIncidentalAmount,
    inboundTransportAmount: s.shipmentContainerChargeFacts.inboundTransportAmount,
    inboundHandlingAmount: s.shipmentContainerChargeFacts.inboundHandlingAmount,
  }).from(s.shipmentContainerChargeFacts)
    .where(and(
      eq(s.shipmentContainerChargeFacts.id, proposalFactId),
      eq(s.shipmentContainerChargeFacts.shipmentId, shipmentId),
    ))
    .limit(1)
    .for('update');
  if (!proposal) {
    throw new ApiError(404, 'Không tìm thấy đề xuất phí thủ công của lô hàng.');
  }
  return proposal;
}

async function loadCurrentBillingDocumentLine(
  tx: Tx,
  billingDocumentId: number,
  billingDocumentLineId: number,
  options: FinanceSnapshotOptions = {},
): Promise<ChargeProposalLineRow | null> {
  const query = tx.select({
    id: s.billingDocumentLines.id,
    documentId: s.billingDocumentLines.documentId,
    sourceType: s.billingDocumentLines.sourceType,
    excluded: s.billingDocumentLines.excluded,
    baseAmount: s.billingDocumentLines.baseAmount,
    amountOverride: s.billingDocumentLines.amountOverride,
    grossAmount: s.billingDocumentLines.grossAmount,
  }).from(s.billingDocumentLines)
    .where(and(
      eq(s.billingDocumentLines.documentId, billingDocumentId),
      eq(s.billingDocumentLines.id, billingDocumentLineId),
    ))
    .limit(1);
  const [line] = await (options.lockRows === false ? query : query.for('update'));
  return line ?? null;
}

async function loadEligibleDebitNoteForShipment(
  tx: Tx,
  shipment: typeof s.shipments.$inferSelect,
  billingDocumentId: number,
): Promise<typeof s.billingDocuments.$inferSelect> {
  const [document] = await tx.select().from(s.billingDocuments)
    .where(and(
      eq(s.billingDocuments.id, billingDocumentId),
      isNull(s.billingDocuments.deletedAt),
    ))
    .limit(1)
    .for('update');
  if (!document) {
    throw new ApiError(404, 'Không tìm thấy Debit Note cần liên kết.');
  }
  if (
    document.type !== 'DEBIT_NOTE'
    || document.issuedAt == null
    || document.authorityState !== 'CURRENT'
    || document.authorityWarningAt != null
    || !ISSUED_DEBIT_NOTE_STATUSES.has(document.debitNoteStatus ?? 'DRAFT')
  ) {
    throw new ApiError(409, 'Debit Note chưa đủ điều kiện hiện hành để liên kết đề xuất phí thủ công.');
  }
  if (document.entityType !== 'CUSTOMER' || document.entityId !== shipment.customerId) {
    throw new ApiError(409, 'Debit Note đã chọn không thuộc đúng khách hàng của lô hàng.');
  }
  return document;
}

async function buildShipmentFinanceSnapshot(
  tx: Tx,
  shipmentId: number,
  billingDocumentId: number,
  options: FinanceSnapshotOptions = {},
) {
  const shipment = await lockShipment(tx, shipmentId, options);

  const documentQuery = tx.select().from(s.billingDocuments)
    .where(and(
      eq(s.billingDocuments.id, billingDocumentId),
      isNull(s.billingDocuments.deletedAt),
    ))
    .limit(1);
  const [document] = await (options.lockRows === false ? documentQuery : documentQuery.for('update'));
  const documentStatus = document?.debitNoteStatus ?? 'DRAFT';
  if (
    !document
    || document.type !== 'DEBIT_NOTE'
    || document.entityType !== 'CUSTOMER'
    || document.entityId !== shipment.customerId
    || document.issuedAt == null
    || document.authorityState !== 'CURRENT'
    || document.authorityWarningAt != null
    || !ISSUED_DEBIT_NOTE_STATUSES.has(documentStatus)
  ) {
    throw new ApiError(409, 'Debit Note chưa đủ điều kiện để xác nhận tài chính cho lô hàng này.');
  }

  const liveTripsQuery = tx.select({ id: s.trips.id, status: s.trips.status })
    .from(s.trips)
    .where(and(
      eq(s.trips.shipmentId, shipment.id),
      ne(s.trips.status, 'CANCELED'),
      isNull(s.trips.deletedAt),
    ))
    .orderBy(asc(s.trips.id));
  const liveTrips = await (options.lockRows === false ? liveTripsQuery : liveTripsQuery.for('update'));
  if (liveTrips.length === 0 || liveTrips.some((trip) => trip.status !== 'COMPLETED')) {
    throw new ApiError(409, 'Chỉ được xác nhận khi mọi chuyến nguồn của lô hàng đã hoàn thành.');
  }

  const claimsQuery = tx.select({
    tripId: s.billingDocumentTripClaims.tripId,
    financialPostingId: s.billingDocumentTripClaims.financialPostingId,
    financialPostingVersion: s.billingDocumentTripClaims.financialPostingVersion,
    postingChecksum: s.billingDocumentTripClaims.postingChecksum,
    postingId: s.tripFinancialPostings.id,
    postingTripId: s.tripFinancialPostings.tripId,
    postingVersion: s.tripFinancialPostings.version,
    postingTripVersion: s.tripFinancialPostings.tripVersion,
    postingReason: s.tripFinancialPostings.reason,
    postingEffectiveAt: s.tripFinancialPostings.effectiveAt,
  })
    .from(s.billingDocumentTripClaims)
    .innerJoin(s.tripFinancialPostings, and(
      eq(s.tripFinancialPostings.id, s.billingDocumentTripClaims.financialPostingId),
      eq(s.tripFinancialPostings.status, 'ACTIVE'),
    ))
    .where(and(
      eq(s.billingDocumentTripClaims.documentId, document.id),
      inArray(s.billingDocumentTripClaims.tripId, liveTrips.map((trip) => trip.id)),
      isNull(s.billingDocumentTripClaims.releasedAt),
    ))
    .orderBy(asc(s.billingDocumentTripClaims.tripId));
  const claims = await (options.lockRows === false ? claimsQuery : claimsQuery.for('update'));
  const claimedTripIds = new Set(claims.map((claim) => claim.tripId));
  if (liveTrips.some((trip) => !claimedTripIds.has(trip.id))) {
    throw new ApiError(409, 'Debit Note chưa bao phủ đầy đủ các chuyến của lô hàng.');
  }
  const staleTripClaim = claims.find((claim) => (
    claim.financialPostingId !== claim.postingId
    || claim.tripId !== claim.postingTripId
    || claim.financialPostingVersion !== claim.postingVersion
    || claim.postingChecksum !== financialPostingChecksum({
      id: claim.financialPostingId,
      tripId: claim.postingTripId,
      version: claim.postingVersion,
      tripVersion: claim.postingTripVersion,
      reason: claim.postingReason,
      effectiveAt: claim.postingEffectiveAt,
    })
  ));
  if (staleTripClaim) {
    throw new ApiError(409, 'Nguồn hạch toán của Debit Note đã thay đổi. Vui lòng xác nhận lại sau khi cập nhật chứng từ.');
  }

  const sourceExpenses = await tx.select({
    id: s.tripExpenses.id,
    version: s.tripExpenses.version,
    approvalStatus: s.tripExpenses.approvalStatus,
    sellAmount: s.tripExpenses.sellAmount,
    updatedAt: s.tripExpenses.updatedAt,
    claimDocumentId: s.billingDocumentRecoverableClaims.documentId,
    claimExpenseVersion: s.billingDocumentRecoverableClaims.expenseVersion,
    claimSourceVersion: s.billingDocumentRecoverableClaims.sourceVersion,
  })
    .from(s.tripExpenses)
    .leftJoin(s.billingDocumentRecoverableClaims, and(
      eq(s.billingDocumentRecoverableClaims.expenseId, s.tripExpenses.id),
      isNull(s.billingDocumentRecoverableClaims.releasedAt),
    ))
    .where(and(
      inArray(s.tripExpenses.tripId, liveTrips.map((trip) => trip.id)),
      ne(s.tripExpenses.sellAmount, '0'),
    ))
    .orderBy(asc(s.tripExpenses.id));
  const unapprovedRequiredExpense = sourceExpenses.find((expense) => expense.approvalStatus !== 'APPROVED');
  if (unapprovedRequiredExpense) {
    throw new ApiError(409, 'Mọi chi phí có số thu khách hàng phải được phê duyệt trước khi xác nhận tài chính.');
  }
  const recoverableExpenses = sourceExpenses;
  const uncoveredRecoverable = recoverableExpenses.find((expense) => (
    expense.claimDocumentId !== document.id
    || expense.claimExpenseVersion !== expense.version
    || expense.claimSourceVersion !== expenseSourceVersion(expense)
  ));
  if (uncoveredRecoverable) {
    throw new ApiError(409, 'Debit Note chưa bao phủ đầy đủ chi phí thu lại khách hàng hoặc nguồn chi phí đã thay đổi.');
  }

  const recoveryFacts = recoverableExpenses.length === 0
    ? []
    : await tx.select({
      id: s.shipmentRecoveryFacts.id,
      sourceExpenseId: s.shipmentRecoveryFacts.sourceExpenseId,
      version: s.shipmentRecoveryFacts.version,
      sourceVersion: s.shipmentRecoveryFacts.sourceVersion,
      kind: s.shipmentRecoveryFacts.kind,
      status: s.shipmentRecoveryFacts.status,
      expectedAmount: s.shipmentRecoveryFacts.expectedAmount,
      recoveredAmount: s.shipmentRecoveryFacts.recoveredAmount,
      outstandingAmount: s.shipmentRecoveryFacts.outstandingAmount,
    }).from(s.shipmentRecoveryFacts)
      .where(and(
        eq(s.shipmentRecoveryFacts.shipmentId, shipment.id),
        inArray(s.shipmentRecoveryFacts.sourceExpenseId, recoverableExpenses.map((expense) => expense.id)),
      ))
      .orderBy(asc(s.shipmentRecoveryFacts.id));
  const expenseById = new Map(recoverableExpenses.map((expense) => [expense.id, expense]));
  if (recoveryFacts.some((fact) => {
    const expense = fact.sourceExpenseId == null ? null : expenseById.get(fact.sourceExpenseId);
    return expense == null || fact.sourceVersion !== expenseSourceVersion(expense);
  })) {
    throw new ApiError(409, 'Theo dõi thu hồi không còn khớp nguồn chi phí. Vui lòng cập nhật trước khi xác nhận tài chính.');
  }

  const chargeProposals = await tx.select({
    id: s.shipmentContainerChargeFacts.id,
    shipmentContainerId: s.shipmentContainerChargeFacts.shipmentContainerId,
    version: s.shipmentContainerChargeFacts.version,
    outboundTransportAmount: s.shipmentContainerChargeFacts.outboundTransportAmount,
    outboundHandlingAmount: s.shipmentContainerChargeFacts.outboundHandlingAmount,
    outboundIncidentalAmount: s.shipmentContainerChargeFacts.outboundIncidentalAmount,
    inboundTransportAmount: s.shipmentContainerChargeFacts.inboundTransportAmount,
    inboundHandlingAmount: s.shipmentContainerChargeFacts.inboundHandlingAmount,
  }).from(s.shipmentContainerChargeFacts)
    .where(eq(s.shipmentContainerChargeFacts.shipmentId, shipment.id))
    .orderBy(asc(s.shipmentContainerChargeFacts.id));
  const proposalCoverageByKey = await loadCurrentProposalCoverageByShipment(tx, shipment.id, options);
  const proposalCoverage: ProposalCoverageRow[] = [];
  for (const proposal of chargeProposals) {
    const proposalChecksumValue = proposalChecksum(proposal);
    for (const proposalField of Object.keys(PROPOSAL_FIELD_COLUMN_MAP) as ShipmentChargeProposalField[]) {
      const amount = proposalAmountForField(proposal, proposalField);
      if (amount == null || Number(amount) === 0) {
        continue;
      }
      const key = proposalKey(proposal.id, proposalField);
      const currentCoverage = proposalCoverageByKey.get(key);
      if (!currentCoverage) {
        throw new ApiError(
          409,
          'Lô còn đề xuất phí thủ công chưa có liên kết nguồn có thẩm quyền trong Debit Note. Vui lòng liên kết đúng dòng Debit Note trước khi xác nhận tài chính.',
        );
      }
      if (currentCoverage.decision !== 'ACCEPT_LINK') {
        throw new ApiError(
          409,
          'Lô còn đề xuất phí thủ công đã bị từ chối liên kết Debit Note. Vui lòng cập nhật đề xuất hoặc liên kết lại trước khi xác nhận tài chính.',
        );
      }
      if (
        currentCoverage.proposalVersion !== proposal.version
        || currentCoverage.proposalChecksum !== proposalChecksumValue
        || currentCoverage.amount !== amount
        || currentCoverage.billingDocumentId !== document.id
        || currentCoverage.billingDocumentVersion !== document.version
        || currentCoverage.billingDocumentLineId == null
      ) {
        throw new ApiError(
          409,
          'Liên kết Debit Note của đề xuất phí thủ công không còn hiện hành. Vui lòng liên kết lại trước khi xác nhận tài chính.',
        );
      }
      proposalCoverage.push(currentCoverage);
    }
  }
  const duplicateProposalLineIds = new Set<number>();
  for (const coverage of proposalCoverage) {
    if (coverage.billingDocumentLineId == null) continue;
    if (duplicateProposalLineIds.has(coverage.billingDocumentLineId)) {
      throw new ApiError(409, 'Một dòng Debit Note chỉ được bao phủ một đề xuất phí thủ công hiện hành.');
    }
    duplicateProposalLineIds.add(coverage.billingDocumentLineId);
  }
  if (proposalCoverage.length > 0) {
    const linkedLineIds = proposalCoverage
      .map((coverage) => coverage.billingDocumentLineId)
      .filter((lineId): lineId is number => lineId != null);
    const linkedLines = linkedLineIds.length === 0
      ? []
      : await tx.select({
        id: s.billingDocumentLines.id,
        documentId: s.billingDocumentLines.documentId,
        sourceType: s.billingDocumentLines.sourceType,
        excluded: s.billingDocumentLines.excluded,
        baseAmount: s.billingDocumentLines.baseAmount,
        amountOverride: s.billingDocumentLines.amountOverride,
        grossAmount: s.billingDocumentLines.grossAmount,
      }).from(s.billingDocumentLines)
        .where(and(
          eq(s.billingDocumentLines.documentId, document.id),
          inArray(s.billingDocumentLines.id, linkedLineIds),
        ))
        .orderBy(asc(s.billingDocumentLines.id));
    const linkedLineById = new Map(linkedLines.map((line) => [line.id, line]));
    for (const coverage of proposalCoverage) {
      const linkedLine = coverage.billingDocumentLineId == null
        ? null
        : linkedLineById.get(coverage.billingDocumentLineId);
      if (!linkedLine || linkedLine.sourceType !== 'ADHOC' || linkedLine.excluded) {
        throw new ApiError(
          409,
          'Liên kết Debit Note của đề xuất phí thủ công không còn trỏ tới dòng thủ công hiện hành. Vui lòng liên kết lại trước khi xác nhận tài chính.',
        );
      }
      if (billingLineEffectiveAmount(linkedLine) !== coverage.amount) {
        throw new ApiError(
          409,
          'Số tiền của dòng Debit Note liên kết không còn khớp đề xuất phí thủ công hiện hành. Vui lòng liên kết lại trước khi xác nhận tài chính.',
        );
      }
    }
  }

  const snapshot: FinanceSnapshot = {
    billingDocumentId: document.id,
    billingDocumentVersion: document.version,
    billingPeriodSnapshot: {
      rangeFrom: document.rangeFrom,
      rangeTo: document.rangeTo,
      issuedAt: document.issuedAt.toISOString(),
    },
    shipmentVersion: shipment.version,
    tripClaims: claims.map((claim) => ({
      tripId: claim.tripId,
      financialPostingId: claim.financialPostingId,
      financialPostingVersion: claim.financialPostingVersion,
      postingChecksum: claim.postingChecksum,
    })),
    recoverableExpenses: recoverableExpenses.map((expense) => ({
      expenseId: expense.id,
      expenseVersion: expense.version,
      sourceVersion: expenseSourceVersion(expense),
      sellAmount: expense.sellAmount,
    })),
    recoveryFacts: recoveryFacts.map((fact) => ({
      id: fact.id,
      sourceExpenseId: fact.sourceExpenseId!,
      version: fact.version,
      sourceVersion: fact.sourceVersion!,
      kind: fact.kind,
      status: fact.status,
      expectedAmount: fact.expectedAmount,
      recoveredAmount: fact.recoveredAmount,
      outstandingAmount: fact.outstandingAmount,
    })),
    chargeProposals,
    proposalCoverage,
  };

  return {
    shipment,
    document,
    snapshot,
    checksum: financeSnapshotChecksum(snapshot),
  };
}

async function loadActiveLockForUpdate(
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

function mapConfirmationSummary(
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

async function bumpShipmentVersion(
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

export async function confirmShipmentFinance(args: {
  shipmentId: number;
  input: ShipmentCusFinanceConfirmationCreateInput;
  actor: AuthUser;
  transaction?: Tx;
}) {
  if (args.actor.role !== Role.ACCOUNTANT) {
    throw new ApiError(403, 'Chỉ Kế toán được xác nhận số liệu tài chính của lô.');
  }

  const execute = async (tx: Tx) => {
    const { shipment, document, snapshot, checksum } = await buildShipmentFinanceSnapshot(
      tx,
      args.shipmentId,
      args.input.billingDocumentId,
    );
    if (shipment.version !== args.input.expectedVersion) {
      throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi xác nhận.');
    }

    const latestApprovedReopen = await getLatestShipmentReopenApproval(shipment.id, tx);
    const latestConfirmation = await getLatestShipmentFinanceConfirmationRow(shipment.id, tx);
    const currentConfirmation = mapConfirmationSummary(
      latestConfirmation,
      latestApprovedReopen?.appliedAt ?? null,
    );
    if (
      currentConfirmation.status === 'CONFIRMED'
      && currentConfirmation.billingDocumentId === document.id
      && currentConfirmation.checksum === checksum
      && currentConfirmation.confirmationId != null
    ) {
      return {
        confirmation: currentConfirmation,
        replayed: true,
      };
    }

    const now = new Date();
    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'SHIPMENT',
      subjectId: shipment.id,
      actionKind: SHIPMENT_COST_CONFIRMATION_KIND,
      status: 'APPROVED',
      reason: args.input.reason,
      originalVersion: shipment.version,
      beforeSnapshot: {
        supersedesConfirmationId: currentConfirmation.confirmationId,
      },
      afterSnapshot: {
        checksum,
        billingDocumentId: document.id,
        billingDocumentVersion: document.version,
        shipmentVersion: shipment.version,
        billingPeriodSnapshot: snapshot.billingPeriodSnapshot,
        tripClaims: snapshot.tripClaims,
        recoverableExpenses: snapshot.recoverableExpenses,
        recoveryFacts: snapshot.recoveryFacts,
        chargeProposals: snapshot.chargeProposals,
      },
      deltaSnapshot: {
        checksum,
      },
      makerId: args.actor.userId,
      makerRole: args.actor.role,
      checkerId: args.actor.userId,
      checkerRole: args.actor.role,
      checkedAt: now,
      approverId: args.actor.userId,
      approverRole: args.actor.role,
      approvedAt: now,
      appliedAt: now,
      applicationResult: {
        checksum,
        billingDocumentId: document.id,
      },
    }).returning();

    return {
      confirmation: {
        status: 'CONFIRMED' as const,
        confirmationId: action.id,
        checksum,
        billingDocumentId: document.id,
        confirmedAt: now.toISOString(),
        confirmedByName: args.actor.fullName ?? args.actor.username,
      },
      replayed: false,
    };
  };
  return args.transaction ? execute(args.transaction) : db.transaction(execute);
}

export async function reviewShipmentChargeProposal(args: {
  shipmentId: number;
  input: ShipmentChargeProposalReviewInput;
  actor: AuthUser;
  transaction?: Tx;
}) {
  if (args.actor.role !== Role.ACCOUNTANT) {
    throw new ApiError(403, 'Chỉ Kế toán được liên kết hoặc từ chối đề xuất phí thủ công.');
  }

  const execute = async (tx: Tx) => {
    const shipment = await lockShipment(tx, args.shipmentId);
    if (shipment.version !== args.input.expectedShipmentVersion) {
      throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi xử lý đề xuất.');
    }

    const proposal = await loadChargeProposalFactForUpdate(tx, shipment.id, args.input.proposalFactId);
    if (proposal.version !== args.input.proposalVersion) {
      throw new ApiError(409, 'Đề xuất phí thủ công vừa thay đổi. Vui lòng tải lại trước khi xử lý.');
    }

    const amount = proposalAmountForField(proposal, args.input.proposalField);
    if (amount == null || Number(amount) === 0) {
      throw new ApiError(409, 'Đề xuất phí thủ công hiện tại không còn số tiền cần liên kết Debit Note.');
    }
    const proposalChecksumValue = proposalChecksum(proposal);
    const currentCoverageByKey = await loadCurrentProposalCoverageByShipment(tx, shipment.id);
    const currentCoverage = currentCoverageByKey.get(proposalKey(proposal.id, args.input.proposalField)) ?? null;

    const uniquenessLocks = [{
      scope: 'shipment-charge-proposal-review',
      parts: [shipment.id, proposal.id, args.input.proposalField],
    }];
    if (args.input.decision === 'ACCEPT_LINK') {
      uniquenessLocks.push({
        scope: 'shipment-charge-proposal-line',
        parts: [args.input.billingDocumentId, args.input.billingDocumentLineId],
      });
    }
    await lockApplicationOwnedUniquenessSet(tx, uniquenessLocks);

    let billingDocumentId: number | null = null;
    let billingDocumentVersion: number | null = null;
    let billingDocumentLineId: number | null = null;

    if (args.input.decision === 'ACCEPT_LINK') {
      const document = await loadEligibleDebitNoteForShipment(
        tx,
        shipment,
        args.input.billingDocumentId,
      );

      const line = await loadCurrentBillingDocumentLine(
        tx,
        document.id,
        args.input.billingDocumentLineId,
      );
      if (!line || line.sourceType !== 'ADHOC' || line.excluded) {
        throw new ApiError(409, 'Chỉ được liên kết đề xuất với dòng thủ công hiện hành trên Debit Note.');
      }
      if (billingLineEffectiveAmount(line) !== amount) {
        throw new ApiError(409, 'Số tiền của dòng Debit Note không khớp chính xác đề xuất phí thủ công hiện hành.');
      }

      const conflictingClaims = await loadCurrentProposalCoverageForDocumentLine(
        tx,
        document.id,
        line.id,
      );
      const conflictingClaim = conflictingClaims.find((claim) => (
        claim.proposalFactId !== proposal.id
        || claim.proposalField !== args.input.proposalField
      ));
      if (conflictingClaim) {
        throw new ApiError(409, 'Dòng Debit Note này đã được liên kết với đề xuất phí thủ công hiện hành khác.');
      }

      billingDocumentId = document.id;
      billingDocumentVersion = document.version;
      billingDocumentLineId = line.id;

      if (
        currentCoverage
        && currentCoverage.decision === 'ACCEPT_LINK'
        && currentCoverage.proposalVersion === proposal.version
        && currentCoverage.proposalChecksum === proposalChecksumValue
        && currentCoverage.amount === amount
        && currentCoverage.billingDocumentId === billingDocumentId
        && currentCoverage.billingDocumentVersion === billingDocumentVersion
        && currentCoverage.billingDocumentLineId === billingDocumentLineId
      ) {
        return {
          review: currentCoverage,
          replayed: true,
          shipmentVersion: shipment.version,
        };
      }
    } else if (
      currentCoverage
      && currentCoverage.decision === 'REJECT'
      && currentCoverage.proposalVersion === proposal.version
      && currentCoverage.proposalChecksum === proposalChecksumValue
      && currentCoverage.amount === amount
    ) {
      return {
        review: currentCoverage,
        replayed: true,
        shipmentVersion: shipment.version,
      };
    }

    const now = new Date();
    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'SHIPMENT',
      subjectId: shipment.id,
      actionKind: SHIPMENT_PROPOSAL_BILLING_LINK_KIND,
      status: 'APPROVED',
      reason: args.input.reason,
      originalVersion: shipment.version,
      beforeSnapshot: currentCoverage == null
        ? {}
        : {
          supersedesActionId: currentCoverage.actionId,
          previousDecision: currentCoverage.decision,
        },
      afterSnapshot: {
        decision: args.input.decision,
        proposalFactId: proposal.id,
        proposalField: args.input.proposalField,
        proposalVersion: proposal.version,
        proposalChecksum: proposalChecksumValue,
        amount,
        billingDocumentId,
        billingDocumentVersion,
        billingDocumentLineId,
      },
      deltaSnapshot: {
        decision: args.input.decision,
        proposalFactId: proposal.id,
        proposalField: args.input.proposalField,
        billingDocumentId,
        billingDocumentLineId,
      },
      makerId: args.actor.userId,
      makerRole: args.actor.role,
      checkerId: args.actor.userId,
      checkerRole: args.actor.role,
      checkedAt: now,
      approverId: args.actor.userId,
      approverRole: args.actor.role,
      approvedAt: now,
      appliedAt: now,
      applicationResult: {
        decision: args.input.decision,
        proposalFactId: proposal.id,
        proposalField: args.input.proposalField,
        billingDocumentId,
        billingDocumentVersion,
        billingDocumentLineId,
      },
    }).returning();

    const nextShipmentVersion = await bumpShipmentVersion(
      tx,
      shipment.id,
      shipment.version,
      args.actor.userId,
    );

    await tx.insert(s.auditLogs).values({
      userId: args.actor.userId,
      actorName: args.actor.fullName ?? args.actor.username,
      message: args.input.decision === 'ACCEPT_LINK'
        ? `Kế toán đã liên kết đề xuất phí thủ công ${proposal.id}/${args.input.proposalField} với dòng Debit Note ${billingDocumentLineId}.`
        : `Kế toán đã từ chối liên kết đề xuất phí thủ công ${proposal.id}/${args.input.proposalField}.`,
      entityType: 'shipment-charge-proposal-link',
      entityId: shipment.id,
      payload: {
        actionId: action.id,
        decision: args.input.decision,
        proposalFactId: proposal.id,
        proposalField: args.input.proposalField,
        proposalVersion: proposal.version,
        proposalChecksum: proposalChecksumValue,
        amount,
        billingDocumentId,
        billingDocumentVersion,
        billingDocumentLineId,
        shipmentVersionBeforeReview: shipment.version,
        shipmentVersionAfterReview: nextShipmentVersion,
        reason: args.input.reason,
      },
    });

    const review = parseProposalCoverageRow(action);
    if (!review) {
      throw new ApiError(500, 'Không thể đọc lại kết quả xử lý đề xuất phí thủ công.');
    }
    return {
      review,
      replayed: false,
      shipmentVersion: nextShipmentVersion,
    };
  };

  return args.transaction ? execute(args.transaction) : db.transaction(execute);
}

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
  return args.transaction ? execute(args.transaction) : db.transaction(execute);
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
  return args.transaction ? execute(args.transaction) : db.transaction(execute);
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
  return args.transaction ? execute(args.transaction) : db.transaction(execute);
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
  return args.transaction ? execute(args.transaction) : db.transaction(execute);
}
