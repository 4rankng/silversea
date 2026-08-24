// The shipment finance snapshot: the authoritative checksummed state (debit
// note + trip claims + recoverable expenses + recovery facts + charge
// proposals + coverage) that financial confirmation and lock activation are
// validated against. Extracted from shipment-accounting-lock.service.ts
// verbatim (pure code movement); a separate leaf so the shared helpers stay
// small.
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { ShipmentChargeProposalField } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  ISSUED_DEBIT_NOTE_STATUSES,
  SHIPMENT_PROPOSAL_BILLING_LINK_KIND,
  PROPOSAL_FIELD_COLUMN_MAP,
  type FinanceSnapshot,
  type GovernanceRow,
  type FinanceSnapshotOptions,
  type ChargeProposalRow,
  type ProposalCoverageRow,
  type ChargeProposalLineRow,
  financialPostingChecksum,
  expenseSourceVersion,
  financeSnapshotChecksum,
  readNumber,
  readString,
  normalizeNumericString,
  proposalKey,
  proposalChecksum,
  proposalAmountForField,
  parseProposalCoverageRow,
  billingLineEffectiveAmount,
  lockShipment,
} from './shipment-accounting-lock-shared.service';

export async function loadCurrentProposalCoverageByShipment(
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

export async function loadCurrentProposalCoverageForDocumentLine(
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

export async function loadChargeProposalFactForUpdate(
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

export async function loadCurrentBillingDocumentLine(
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

export async function loadEligibleDebitNoteForShipment(
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

export async function buildShipmentFinanceSnapshot(
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
