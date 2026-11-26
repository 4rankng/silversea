// SIL-1095 — gather the five-lane status facts of one lot from EXISTING data
// (no new DB state) and hand them to the pure law in
// shipment-status-summary-law. One indexed read per source; the document-set
// summary and the e-POD review items are passed in by the detail assembler so
// nothing is fetched twice.
//
// Fact sources:
//   (1) expense_accounting_sources (live rows per costRowIsLive),
//   (2) the passed document-set summary + e-POD review items + nhận phơi
//       rows (trip_financial_state.phoiTakenDate — the phoi board only knows
//       trips with a financial-state row),
//   (3) trips (direct link or through a fulfillment — shipmentHasLiveTrips law),
//   (4) customer-receivable-authority obligations covering the lot's trips,
//   (5) debit_settlement_round_lots → rounds.periodKey + period_locks
//       (DEBIT_NOTE), plus the Debit Note's billing_document_source_period_locks.

import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  localDateInBusinessZone,
  type ExpenseAccountingEntry,
  type ShipmentDocumentSet,
  type ShipmentLotStatusSummary,
  type TripPodStatus,
} from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { costRowIsLive } from './cost-review.service';
import {
  getCustomerReceivableSnapshots,
  type CustomerReceivableSnapshot,
} from './customer-receivable-authority.service';
import type { ShipmentPodReviewItemView } from './trip-pod.service';
import { buildLotStatusSummary } from './shipment-status-summary-law';

export interface ShipmentStatusSummaryInput {
  shipmentId: number;
  customerId: number | null;
  /** The active accounting lock's Debit Note — the legacy period-lock path. */
  billingDocumentId: number | null;
  documentSet: ShipmentDocumentSet;
  podItems: ShipmentPodReviewItemView[];
}

/** The hydrated owner row carries `approvalStatus` (costRowIsLive reads it
 *  through narrowing), while the books projection does not declare it. */
type CostLiveRow = Pick<ExpenseAccountingEntry, 'status'> & { approvalStatus?: string | null };

export async function getShipmentStatusSummary(
  input: ShipmentStatusSummaryInput,
): Promise<ShipmentLotStatusSummary> {
  const { shipmentId } = input;

  const [costRows, tripRows, roundLots] = await Promise.all([
    db.select({
      status: s.expenseAccountingSources.status,
      confirmedAt: s.expenseAccountingSources.confirmedAt,
      reconciliationId: s.expenseAccountingSources.reconciliationId,
      approvalStatus: s.opsExpenseEntries.approvalStatus,
    })
      .from(s.expenseAccountingSources)
      .leftJoin(s.opsExpenseEntries, and(
        eq(s.expenseAccountingSources.sourceKind, 'OPS'),
        eq(s.expenseAccountingSources.sourceId, s.opsExpenseEntries.id),
      ))
      .where(eq(s.expenseAccountingSources.shipmentId, shipmentId)),
    db.select({ id: s.trips.id, status: s.trips.status })
      .from(s.trips)
      .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
      .where(and(
        isNull(s.trips.deletedAt),
        or(
          eq(s.trips.shipmentId, shipmentId),
          eq(s.shipmentFulfillments.shipmentId, shipmentId),
        ),
      )),
    db.select({ periodKey: s.debitSettlementRounds.periodKey })
      .from(s.debitSettlementRoundLots)
      .innerJoin(s.debitSettlementRounds, eq(s.debitSettlementRounds.id, s.debitSettlementRoundLots.roundId))
      .where(eq(s.debitSettlementRoundLots.shipmentId, shipmentId))
      .limit(1),
  ]);

  const liveCostRows = costRows.filter((row) => {
    const hydrated: CostLiveRow = { status: row.status, approvalStatus: row.approvalStatus };
    return costRowIsLive(hydrated);
  });
  const liveTrips = tripRows.filter((row) => row.status !== 'CANCELED');
  const liveTripIds = liveTrips.map((row) => row.id);
  const roundPeriodKey = roundLots[0]?.periodKey ?? null;

  const emptyPhoi = Promise.resolve([] as Array<{ phoiTakenDate: string | null }>);
  const emptySnapshots = Promise.resolve(new Map<number, CustomerReceivableSnapshot>());
  const emptyLockRows = Promise.resolve([] as Array<{ status: string }>);
  const emptySourceLocks = Promise.resolve([] as Array<{ periodKey: string; status: string }>);
  const [phoiRows, paymentSnapshot, roundLockRows, sourceLockRows] = await Promise.all([
    liveTripIds.length > 0
      ? db.select({ phoiTakenDate: s.tripFinancialState.phoiTakenDate })
        .from(s.tripFinancialState)
        .where(inArray(s.tripFinancialState.tripId, liveTripIds))
      : emptyPhoi,
    input.customerId != null
      ? getCustomerReceivableSnapshots([input.customerId])
      : emptySnapshots,
    roundPeriodKey != null && input.customerId != null
      ? db.select({ status: s.periodLocks.status })
        .from(s.periodLocks)
        .where(and(
          eq(s.periodLocks.domain, 'DEBIT_NOTE'),
          eq(s.periodLocks.scopeType, 'CUSTOMER'),
          eq(s.periodLocks.scopeId, input.customerId),
          eq(s.periodLocks.periodKey, roundPeriodKey),
        ))
        .limit(1)
      : emptyLockRows,
    input.billingDocumentId != null
      ? db.select({ periodKey: s.periodLocks.periodKey, status: s.periodLocks.status })
        .from(s.periodLocks)
        .innerJoin(s.billingDocumentSourcePeriodLocks,
          eq(s.billingDocumentSourcePeriodLocks.periodLockId, s.periodLocks.id))
        .where(eq(s.billingDocumentSourcePeriodLocks.documentId, input.billingDocumentId))
      : emptySourceLocks,
  ]);

  const tripIdSet = new Set(tripRows.map((row) => row.id));
  const obligations = input.customerId != null
    ? (paymentSnapshot.get(input.customerId)?.obligations ?? [])
      .filter((obligation) => obligation.sourceTripIds.some((tripId) => tripIdSet.has(tripId)))
      .map((obligation) => ({
        outstanding: obligation.outstanding,
        effectiveDueDate: obligation.processingDueDate ?? obligation.originalDueDate,
      }))
    : [];

  const roundLockStatus = roundLockRows[0]?.status;
  const podStatuses: Array<TripPodStatus | null> = input.podItems
    .filter((item) => item.required && item.canceledAt == null)
    .map((item) => item.currentSubmission?.status ?? null);

  return buildLotStatusSummary({
    cost: {
      total: liveCostRows.length,
      unconfirmed: liveCostRows.filter((row) => row.confirmedAt == null).length,
      vouchered: liveCostRows.filter((row) => row.reconciliationId != null).length,
    },
    documents: {
      documentSet: {
        status: input.documentSet.status,
        missingDocuments: input.documentSet.missingDocuments,
      },
      podStatuses,
      phoiRows,
    },
    transport: {
      liveTrips: liveTrips.length,
      completedTrips: liveTrips.filter((row) => row.status === 'COMPLETED').length,
    },
    payment: {
      obligations,
      // localDateInBusinessZone returns string | null (a null Date input);
      // the clock is real here, so null can only mean a parse guard — fall
      // back to the UTC date rather than failing the lane.
      asOfDate: localDateInBusinessZone(new Date()) ?? new Date().toISOString().slice(0, 10),
    },
    period: {
      roundPeriodKey,
      roundLockStatus: roundLockStatus === 'CLOSED' || roundLockStatus === 'REOPENED'
        ? roundLockStatus
        : null,
      sourceLocks: sourceLockRows
        .filter((row) => row.status === 'CLOSED' || row.status === 'REOPENED')
        .map((row) => ({ periodKey: row.periodKey, status: row.status as 'CLOSED' | 'REOPENED' })),
    },
  });
}
