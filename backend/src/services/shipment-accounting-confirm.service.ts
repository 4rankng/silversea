// Shipment financial confirmation + manual charge-proposal review: the
// accountant-issued confirmation snapshot action and the accept-link/reject
// review of manual charge proposals against Debit Note lines. Extracted from
// shipment-accounting-lock.service.ts verbatim (pure code movement).
import { and, desc, eq, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import type {
  ShipmentChargeProposalReviewInput,
  ShipmentCusFinanceConfirmationCreateInput,
} from '@tingting/shared';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { lockApplicationOwnedUniquenessSet } from './application-owned-uniqueness.service';
import {
  SHIPMENT_COST_CONFIRMATION_KIND,
  SHIPMENT_PROPOSAL_BILLING_LINK_KIND,
  proposalKey,
  proposalChecksum,
  proposalAmountForField,
  parseProposalCoverageRow,
  billingLineEffectiveAmount,
  lockShipment,
  mapConfirmationSummary,
  bumpShipmentVersion,
  getLatestShipmentReopenApproval,
  getLatestShipmentFinanceConfirmationRow,
} from './shipment-accounting-lock-shared.service';
import {
  buildShipmentFinanceSnapshot,
  loadCurrentProposalCoverageByShipment,
  loadCurrentProposalCoverageForDocumentLine,
  loadChargeProposalFactForUpdate,
  loadCurrentBillingDocumentLine,
  loadEligibleDebitNoteForShipment,
} from './shipment-finance-snapshot.service';

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
  return runInTx(args.transaction, execute);
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

  return runInTx(args.transaction, execute);
}
