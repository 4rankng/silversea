import { computeFifoAging } from '@tingting/shared';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';

export type ReceivableAuthorityType = 'TRIP' | 'BILLING_DOCUMENT' | 'SERVICE_FEE' | 'DEBT_OFFSET' | 'OTHER';

export interface ReceivablePaymentHistoryItem {
  id: number;
  amount: number;
  timestamp: string;
  note: string | null;
  sourceTripId: number | null;
}

export interface CustomerReceivableObligation {
  customerId: number;
  authorityType: ReceivableAuthorityType;
  authorityId: number;
  representativeTripId: number | null;
  sourceTripIds: number[];
  sourceExpenseIds: number[];
  totalDebit: number;
  totalCredit: number;
  paid: number;
  outstanding: number;
  issueTimestamp: string;
  originalDueDate: string | null;
  processingDueDate: string | null;
  label: string | null;
  paymentHistory: ReceivablePaymentHistoryItem[];
}

export interface CustomerReceivableSnapshot {
  customerId: number;
  obligations: CustomerReceivableObligation[];
  aging: { current: number; d30: number; d60: number; over90: number };
  totalOutstanding: number;
  maxOverdueDays: number;
}

type DocSeedRow = {
  customerId: number;
  documentId: number;
  totalInclVat: string | null;
  originalDueDate: string | null;
  processingDueDate: string | null;
  issuedAt: Date | null;
  createdAt: Date;
  sourceType: string | null;
  sourceId: number | null;
};

type DirectLedgerRow = {
  id: number;
  customerId: number;
  txnId: number | null;
  txnType: string;
  debit: string | null;
  credit: string | null;
  receiptId: string | null;
  note: string | null;
  timestamp: Date;
  originalDueDate: string | null;
  processingDueDate: string | null;
};

type DirectGroup = {
  customerId: number;
  authorityType: ReceivableAuthorityType;
  authorityId: number;
  representativeTripId: number | null;
  totalDebit: number;
  totalCredit: number;
  issueTimestamp: string | null;
  originalDueDate: string | null;
  processingDueDate: string | null;
  label: string | null;
  paymentHistory: ReceivablePaymentHistoryItem[];
};

function toIsoTimestamp(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function effectiveDueDate(
  processingDueDate: string | null,
  originalDueDate: string | null,
  issueTimestamp: string,
): string {
  return processingDueDate ?? originalDueDate ?? issueTimestamp.slice(0, 10);
}

function compareDueOrder(
  left: { effectiveDueDate: string; issueTimestamp: string; authorityId: number },
  right: { effectiveDueDate: string; issueTimestamp: string; authorityId: number },
): number {
  if (left.effectiveDueDate !== right.effectiveDueDate) {
    return left.effectiveDueDate.localeCompare(right.effectiveDueDate);
  }
  if (left.issueTimestamp !== right.issueTimestamp) {
    return left.issueTimestamp.localeCompare(right.issueTimestamp);
  }
  return left.authorityId - right.authorityId;
}

function directAuthorityTypeForTxnType(txnType: string): ReceivableAuthorityType | null {
  if (txnType === 'TRIP_REVENUE' || txnType === 'PAYMENT_RECEIVED' || txnType === 'UNLOCK_REVERSAL') {
    return 'TRIP';
  }
  if (txnType === 'SERVICE_FEE') return 'SERVICE_FEE';
  if (txnType === 'ADJUSTMENT') return null;
  if (txnType === 'MANAGEMENT_FEE' || txnType === 'PENALTY') return 'OTHER';
  return null;
}

function isDebtOffsetAdjustmentRow(note: string | null, txnId: number): boolean {
  if (!note) return false;
  return note.includes('bù trừ') || note.includes(`offset #${txnId}`) || note.includes(`offset ${txnId}`);
}

function isServiceFeeAdjustmentRow(note: string | null): boolean {
  if (!note) return false;
  return note.includes('Phí chi hộ') || note.includes('Tạm ứng/nộp hộ');
}

export async function getCustomerReceivableSnapshot(customerId: number): Promise<CustomerReceivableSnapshot> {
  const snapshots = await getCustomerReceivableSnapshots([customerId]);
  return snapshots.get(customerId) ?? {
    customerId,
    obligations: [],
    aging: { current: 0, d30: 0, d60: 0, over90: 0 },
    totalOutstanding: 0,
    maxOverdueDays: 0,
  };
}

export async function getCustomerReceivableSnapshots(
  customerIds: number[],
): Promise<Map<number, CustomerReceivableSnapshot>> {
  const dedupedCustomerIds = [...new Set(customerIds.filter((id) => Number.isInteger(id) && id > 0))];
  const snapshots = new Map<number, CustomerReceivableSnapshot>();
  if (dedupedCustomerIds.length === 0) return snapshots;

  const docSeedRows: DocSeedRow[] = await db.select({
    customerId: s.billingDocuments.entityId,
    documentId: s.billingDocuments.id,
    totalInclVat: s.billingDocuments.totalInclVat,
    originalDueDate: s.billingDocuments.originalDueDate,
    processingDueDate: s.billingDocuments.processingDueDate,
    issuedAt: s.billingDocuments.issuedAt,
    createdAt: s.billingDocuments.createdAt,
    sourceType: s.billingDocumentLines.sourceType,
    sourceId: s.billingDocumentLines.sourceId,
  })
    .from(s.billingDocuments)
    .leftJoin(s.billingDocumentLines, eq(s.billingDocumentLines.documentId, s.billingDocuments.id))
    .where(and(
      eq(s.billingDocuments.entityType, 'CUSTOMER'),
      eq(s.billingDocuments.type, 'DEBIT_NOTE'),
      isNull(s.billingDocuments.deletedAt),
      inArray(s.billingDocuments.entityId, dedupedCustomerIds),
      sql`coalesce(${s.billingDocuments.debitNoteStatus}, 'DRAFT') not in ('DRAFT', 'CANCELED')`,
    ));

  const docIds = [...new Set(docSeedRows.map((row) => row.documentId))];
  const docAdjustmentRows = docIds.length > 0
    ? await db.select({
      documentId: s.governanceActions.subjectId,
      deltaSnapshot: s.governanceActions.deltaSnapshot,
    })
      .from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'BILLING_DOCUMENT'),
        eq(s.governanceActions.actionKind, 'DEBIT_NOTE_ADJUSTMENT'),
        inArray(s.governanceActions.subjectId, docIds),
        inArray(s.governanceActions.status, ['APPROVED', 'APPLIED']),
      ))
    : [];
  const docAllocationRows = docIds.length > 0
    ? await db.select({
      id: s.paymentAllocations.id,
      customerId: s.paymentAllocations.customerId,
      documentId: sql<number>`coalesce(${s.paymentAllocations.billingDocumentId}, ${s.paymentAllocations.targetId})`,
      amount: s.paymentAllocations.amount,
      createdAt: s.paymentAllocations.createdAt,
      receiptId: s.paymentAllocations.receiptId,
      sourceTripId: s.paymentAllocations.sourceTripId,
    })
      .from(s.paymentAllocations)
      .where(and(
        inArray(s.paymentAllocations.customerId, dedupedCustomerIds),
        or(
          and(
            sql`${s.paymentAllocations.billingDocumentId} is not null`,
            inArray(s.paymentAllocations.billingDocumentId, docIds),
          ),
          and(
            eq(s.paymentAllocations.targetType, 'BILLING_DOCUMENT'),
            inArray(s.paymentAllocations.targetId, docIds),
          ),
        )!,
      ))
    : [];

  const docById = new Map<number, {
    customerId: number;
    totalInclVat: number;
    originalDueDate: string | null;
    processingDueDate: string | null;
    issueTimestamp: string;
    sourceTripIds: Set<number>;
    sourceExpenseIds: Set<number>;
    adjustmentDelta: number;
    allocations: ReceivablePaymentHistoryItem[];
  }>();

  for (const row of docSeedRows) {
    const current = docById.get(row.documentId) ?? {
      customerId: row.customerId,
      totalInclVat: Number(row.totalInclVat ?? 0),
      originalDueDate: row.originalDueDate,
      processingDueDate: row.processingDueDate,
      issueTimestamp: toIsoTimestamp(row.issuedAt ?? row.createdAt),
      sourceTripIds: new Set<number>(),
      sourceExpenseIds: new Set<number>(),
      adjustmentDelta: 0,
      allocations: [],
    };
    if (row.sourceType === 'TRIP' && row.sourceId != null) {
      current.sourceTripIds.add(row.sourceId);
    }
    if (row.sourceType === 'EXPENSE' && row.sourceId != null) {
      current.sourceExpenseIds.add(row.sourceId);
    }
    docById.set(row.documentId, current);
  }

  for (const row of docAdjustmentRows) {
    if (row.documentId == null) continue;
    const doc = docById.get(row.documentId);
    if (!doc) continue;
    doc.adjustmentDelta += Number((row.deltaSnapshot as Record<string, unknown> | null)?.adjustmentAmount ?? 0);
  }

  for (const row of docAllocationRows) {
    const doc = docById.get(row.documentId);
    if (!doc) continue;
    doc.allocations.push({
      id: row.id,
      amount: Number(row.amount ?? 0),
      timestamp: toIsoTimestamp(row.createdAt),
      note: row.receiptId ? `Phiếu thu ${row.receiptId}` : null,
      sourceTripId: row.sourceTripId ?? null,
    });
  }

  const issuedTripIdsByCustomer = new Map<number, Set<number>>();
  const issuedExpenseIdsByCustomer = new Map<number, Set<number>>();
  const issuedDocIdsByCustomer = new Map<number, Set<number>>();
  for (const [documentId, doc] of docById.entries()) {
    if (!issuedTripIdsByCustomer.has(doc.customerId)) {
      issuedTripIdsByCustomer.set(doc.customerId, new Set<number>());
    }
    if (!issuedExpenseIdsByCustomer.has(doc.customerId)) {
      issuedExpenseIdsByCustomer.set(doc.customerId, new Set<number>());
    }
    if (!issuedDocIdsByCustomer.has(doc.customerId)) {
      issuedDocIdsByCustomer.set(doc.customerId, new Set<number>());
    }
    issuedDocIdsByCustomer.get(doc.customerId)!.add(documentId);
    for (const tripId of doc.sourceTripIds) {
      issuedTripIdsByCustomer.get(doc.customerId)!.add(tripId);
    }
    for (const expenseId of doc.sourceExpenseIds) {
      issuedExpenseIdsByCustomer.get(doc.customerId)!.add(expenseId);
    }
  }

  const ledgerRows: DirectLedgerRow[] = await db.select({
    id: s.ledger.id,
    customerId: s.ledger.entityId,
    txnId: s.ledger.txnId,
    txnType: s.ledger.txnType,
    debit: s.ledger.debit,
    credit: s.ledger.credit,
    receiptId: s.ledger.receiptId,
    note: s.ledger.note,
    timestamp: s.ledger.timestamp,
    originalDueDate: s.ledger.originalDueDate,
    processingDueDate: s.ledger.processingDueDate,
  })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      inArray(s.ledger.entityId, dedupedCustomerIds),
      sql`${s.ledger.txnId} is not null`,
    ))
    .orderBy(s.ledger.id);

  const unappliedCreditRows = ledgerRows.filter((row) =>
    row.txnType === 'PAYMENT_RECEIVED' && row.txnId === 0 && Number(row.credit ?? 0) > 0,
  );
  const ledgerRowsWithTxnId = ledgerRows.filter((row): row is DirectLedgerRow & { txnId: number } =>
    row.txnId != null,
  );

  const tripKeys = new Set(
    ledgerRowsWithTxnId
      .filter((row) => row.txnId > 0 && (
        row.txnType === 'TRIP_REVENUE'
        || row.txnType === 'PAYMENT_RECEIVED'
        || row.txnType === 'UNLOCK_REVERSAL'
      ))
      .map((row) => `${row.customerId}:${row.txnId}`),
  );
  const serviceFeeKeys = new Set(
    ledgerRowsWithTxnId
      .filter((row) => row.txnId > 0 && row.txnType === 'SERVICE_FEE')
      .map((row) => `${row.customerId}:${row.txnId}`),
  );
  const debtOffsetIds = [...new Set(ledgerRowsWithTxnId.filter((row) => row.txnId > 0).map((row) => row.txnId))];
  const debtOffsetRows = debtOffsetIds.length > 0
    ? await db.select({
      customerId: s.debtOffsets.customerId,
      offsetId: s.debtOffsets.id,
    })
      .from(s.debtOffsets)
      .where(and(
        inArray(s.debtOffsets.customerId, dedupedCustomerIds),
        inArray(s.debtOffsets.id, debtOffsetIds),
      ))
    : [];
  const debtOffsetKeys = new Set(debtOffsetRows.map((row) => `${row.customerId}:${row.offsetId}`));

  const adjustmentRows = ledgerRowsWithTxnId.filter((row) => row.txnType === 'ADJUSTMENT' && row.txnId > 0);
  const tripAdjustmentRows = adjustmentRows.length > 0
    ? await db.select({
      ledgerEntryId: s.governanceActions.ledgerEntryId,
    })
      .from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.actionKind, 'TRIP_AR_ADJUSTMENT'),
        inArray(s.governanceActions.ledgerEntryId, adjustmentRows.map((row) => row.id)),
      ))
    : [];
  const tripAdjustmentIds = new Set(
    tripAdjustmentRows.flatMap((row) => (row.ledgerEntryId == null ? [] : [row.ledgerEntryId])),
  );

  const directGroups = new Map<string, DirectGroup>();
  for (const row of ledgerRowsWithTxnId) {
    if (row.txnId <= 0) continue;

    let authorityType = directAuthorityTypeForTxnType(row.txnType);
    if (row.txnType === 'ADJUSTMENT') {
      const relationKey = `${row.customerId}:${row.txnId}`;
      if (tripAdjustmentIds.has(row.id)) {
        authorityType = 'TRIP';
      } else if (
        row.receiptId === `GBN:${row.txnId}`
        || (issuedDocIdsByCustomer.get(row.customerId)?.has(row.txnId) ?? false)
      ) {
        authorityType = 'BILLING_DOCUMENT';
      } else if (tripKeys.has(relationKey)) {
        authorityType = 'TRIP';
      } else if (isServiceFeeAdjustmentRow(row.note) && serviceFeeKeys.has(relationKey)) {
        authorityType = 'SERVICE_FEE';
      } else if (isDebtOffsetAdjustmentRow(row.note, row.txnId) && debtOffsetKeys.has(relationKey)) {
        authorityType = 'DEBT_OFFSET';
      } else {
        authorityType = 'OTHER';
      }
    }
    if (!authorityType) continue;
    if (authorityType === 'BILLING_DOCUMENT') continue;
    if (authorityType === 'TRIP' && (issuedTripIdsByCustomer.get(row.customerId)?.has(row.txnId) ?? false)) {
      continue;
    }
    if (authorityType === 'SERVICE_FEE' && (issuedExpenseIdsByCustomer.get(row.customerId)?.has(row.txnId) ?? false)) {
      continue;
    }

    const groupKey = `${row.customerId}:${authorityType}:${row.txnId}`;
    const current: DirectGroup = directGroups.get(groupKey) ?? {
      customerId: row.customerId,
      authorityType,
      authorityId: row.txnId,
      representativeTripId: authorityType === 'TRIP' ? row.txnId : null,
      totalDebit: 0,
      totalCredit: 0,
      issueTimestamp: null,
      originalDueDate: null,
      processingDueDate: null,
      label: row.note,
      paymentHistory: [],
    };

    current.totalDebit += Number(row.debit ?? 0);
    current.totalCredit += Number(row.credit ?? 0);

    const candidateTimestamp = toIsoTimestamp(row.timestamp);
    const currentTimestamp = current.issueTimestamp ?? candidateTimestamp;
    const candidateSort = {
      effectiveDueDate: effectiveDueDate(row.processingDueDate, row.originalDueDate, candidateTimestamp),
      issueTimestamp: candidateTimestamp,
      authorityId: row.txnId,
    };
    const currentSort = {
      effectiveDueDate: effectiveDueDate(current.processingDueDate, current.originalDueDate, currentTimestamp),
      issueTimestamp: currentTimestamp,
      authorityId: row.txnId,
    };
    if (current.issueTimestamp == null || compareDueOrder(candidateSort, currentSort) < 0) {
      current.issueTimestamp = candidateTimestamp;
      current.originalDueDate = row.originalDueDate;
      current.processingDueDate = row.processingDueDate;
      if (row.note) current.label = row.note;
    }

    if (row.txnType === 'PAYMENT_RECEIVED' && Number(row.credit ?? 0) > 0) {
      current.paymentHistory.push({
        id: row.id,
        amount: Number(row.credit ?? 0),
        timestamp: candidateTimestamp,
        note: row.note,
        sourceTripId: authorityType === 'TRIP' ? row.txnId : null,
      });
    }

    directGroups.set(groupKey, current);
  }

  for (const customerId of dedupedCustomerIds) {
    const obligations: CustomerReceivableObligation[] = [];

    for (const [documentId, doc] of docById.entries()) {
      if (doc.customerId !== customerId) continue;
      const totalDebit = Math.max(0, doc.totalInclVat + doc.adjustmentDelta);
      const totalCredit = doc.allocations.reduce((sum, item) => sum + item.amount, 0);
      const outstanding = Math.max(0, totalDebit - totalCredit);
      obligations.push({
        customerId,
        authorityType: 'BILLING_DOCUMENT',
        authorityId: documentId,
        representativeTripId: [...doc.sourceTripIds][0] ?? null,
        sourceTripIds: [...doc.sourceTripIds],
        sourceExpenseIds: [...doc.sourceExpenseIds],
        totalDebit,
        totalCredit,
        paid: totalCredit,
        outstanding,
        issueTimestamp: doc.issueTimestamp,
        originalDueDate: doc.originalDueDate,
        processingDueDate: doc.processingDueDate,
        label: `Giấy báo nợ #${documentId}`,
        paymentHistory: [...doc.allocations].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id - right.id),
      });
    }

    for (const group of directGroups.values()) {
      if (group.customerId !== customerId) continue;
      const issueTimestamp = group.issueTimestamp ?? new Date(0).toISOString();
      obligations.push({
        customerId,
        authorityType: group.authorityType,
        authorityId: group.authorityId,
        representativeTripId: group.representativeTripId,
        sourceTripIds: group.representativeTripId != null ? [group.representativeTripId] : [],
        sourceExpenseIds: group.authorityType === 'SERVICE_FEE' ? [group.authorityId] : [],
        totalDebit: group.totalDebit,
        totalCredit: group.totalCredit,
        paid: group.paymentHistory.reduce((sum, item) => sum + item.amount, 0),
        outstanding: Math.max(0, group.totalDebit - group.totalCredit),
        issueTimestamp,
        originalDueDate: group.originalDueDate,
        processingDueDate: group.processingDueDate,
        label: group.label,
        paymentHistory: [...group.paymentHistory].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id - right.id),
      });
    }

    obligations.sort((left, right) => compareDueOrder(
      {
        effectiveDueDate: effectiveDueDate(left.processingDueDate, left.originalDueDate, left.issueTimestamp),
        issueTimestamp: left.issueTimestamp,
        authorityId: left.authorityId,
      },
      {
        effectiveDueDate: effectiveDueDate(right.processingDueDate, right.originalDueDate, right.issueTimestamp),
        issueTimestamp: right.issueTimestamp,
        authorityId: right.authorityId,
      },
    ));

    const syntheticEntries = obligations
      .filter((obligation) => obligation.outstanding > 0)
      .map((obligation) => ({
        timestamp: obligation.issueTimestamp,
        debit: obligation.outstanding,
        credit: 0,
      }));
    for (const row of unappliedCreditRows.filter((item) => item.customerId === customerId)) {
      syntheticEntries.push({
        timestamp: toIsoTimestamp(row.timestamp),
        debit: 0,
        credit: Number(row.credit ?? 0),
      });
    }

    const { aging, openInvoices } = computeFifoAging(syntheticEntries);
    let maxOverdueDays = 0;
    const now = new Date();
    for (const invoice of openInvoices) {
      if (invoice.open <= 0) continue;
      const ageDays = Math.floor((now.getTime() - new Date(invoice.ts).getTime()) / 86400000);
      if (ageDays > maxOverdueDays) maxOverdueDays = ageDays;
    }

    snapshots.set(customerId, {
      customerId,
      obligations,
      aging,
      totalOutstanding: aging.current + aging.d30 + aging.d60 + aging.over90,
      maxOverdueDays,
    });
  }

  return snapshots;
}
