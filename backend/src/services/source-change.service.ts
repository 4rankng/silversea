import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import {
  BILLABLE_TRIP_STATUSES,
  NotificationType,
  round2dp,
  TxnType,
  type BillingLineRenderData,
} from '@tingting/shared';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { customerTripReceivableAmount, LedgerService, tripExpenseVendorReceiptId } from './ledger.service';
import type { Tx } from './trip-shared';
import {
  assertDraftDocumentLinesEditable,
  buildExpenseSourceVersionToken,
  buildTripRenderData,
  buildTripSourceVersionToken,
  containerNumbers,
  containerUnit,
  docTotal,
  documentLedgerAdjustment,
  expenseDocumentCode,
  joinContainers,
  loadContainersByTrip,
  loadLegRenderDataByTrip,
  postDebitNoteDelta,
  postingChecksum,
} from './billing-document.service';
import {
  resolveCustomerPaymentDueDate,
  resolveSupplierPaymentDueDate,
  type PaymentDatePolicy,
} from './business-calendar.service';
import { getActiveFinancialPosting } from './financial-posting.service';
import { persistNotificationInTx } from './notification.service';
import { SnapshotServices } from './snapshot-services';

type DraftDocumentRow = typeof s.billingDocuments.$inferSelect;

type MutableLine = {
  id?: number;
  sourceType: 'TRIP' | 'EXPENSE' | 'ADHOC';
  sourceId: number | null;
  financialPostingId?: number | null;
  financialPostingVersion?: number | null;
  postingChecksum?: string | null;
  lineType: 'FREIGHT' | 'SERVICE_FEE' | 'ADHOC';
  typeLabel: string;
  unit: string;
  description: string;
  routeName?: string | null;
  containerNumbers?: string[] | null;
  renderData?: BillingLineRenderData | null;
  baseAmount: number;
  amountOverride?: number | null;
  excluded?: boolean;
  sortOrder: number;
};

function isBillableTripStatus(status: string): boolean {
  return (BILLABLE_TRIP_STATUSES as readonly string[]).includes(status);
}

function lineKey(line: Pick<MutableLine, 'sourceType' | 'sourceId' | 'lineType'>): string {
  return `${line.sourceType}:${line.sourceId ?? 'null'}:${line.lineType}`;
}

async function buildTripDraftLineTx(tx: Tx, tripId: number): Promise<{
  customerId: number;
  businessDate: string;
  line: MutableLine;
} | null> {
  const [trip] = await tx.select({
    id: s.trips.id,
    customerId: s.trips.customerId,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    completionDate: sql<string | null>`to_char(${s.trips.completedAt}, 'YYYY-MM-DD')`,
    revenue: s.trips.revenue,
    fuelSurchargeAmount: s.trips.fuelSurchargeAmount,
    routeName: s.routes.name,
    notes: s.trips.notes,
    truckPlate: s.trucks.licensePlate,
    externalPlateNumber: s.trips.externalPlateNumber,
    version: s.trips.version,
    updatedAt: s.trips.updatedAt,
    status: s.trips.status,
    financialPostingId: s.tripFinancialPostings.id,
    financialPostingVersion: s.tripFinancialPostings.version,
    financialPostingTripVersion: s.tripFinancialPostings.tripVersion,
    financialPostingReason: s.tripFinancialPostings.reason,
    financialPostingEffectiveAt: s.tripFinancialPostings.effectiveAt,
  })
    .from(s.trips)
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .innerJoin(s.tripFinancialPostings, and(
      eq(s.tripFinancialPostings.tripId, s.trips.id),
      eq(s.tripFinancialPostings.status, 'ACTIVE'),
    ))
    .where(and(eq(s.trips.id, tripId), isNull(s.trips.deletedAt)))
    .limit(1);
  if (
    !trip
    || typeof trip.status !== 'string'
    || !isBillableTripStatus(trip.status)
    || customerTripReceivableAmount(trip.revenue, trip.fuelSurchargeAmount) <= 0
  ) {
    return null;
  }
  if (!trip.departureDate || !trip.completionDate) {
    return null;
  }

  const containersByTrip = await loadContainersByTrip([trip.id], tx);
  const legsByTrip = await loadLegRenderDataByTrip([trip.id], tx);
  const containerInfo = containersByTrip.get(trip.id) ?? [];
  const renderData = buildTripRenderData({
    tripId: trip.id,
    trip,
    containers: containerInfo,
    legs: legsByTrip.get(trip.id),
    note: trip.notes ?? null,
  });
  renderData.sourceVersion = buildTripSourceVersionToken(trip.version);
  renderData.sourceChangedAt = trip.updatedAt?.toISOString() ?? null;

  return {
    customerId: trip.customerId,
    businessDate: trip.completionDate,
    line: {
      sourceType: 'TRIP',
      sourceId: trip.id,
      financialPostingId: trip.financialPostingId,
      financialPostingVersion: trip.financialPostingVersion,
      postingChecksum: postingChecksum({
        id: trip.financialPostingId,
        tripId: trip.id,
        version: trip.financialPostingVersion,
        tripVersion: trip.financialPostingTripVersion,
        reason: trip.financialPostingReason,
        effectiveAt: trip.financialPostingEffectiveAt,
      }),
      lineType: 'FREIGHT',
      typeLabel: 'Doanh thu',
      unit: containerUnit(containerInfo),
      description: `Cước vận chuyển${trip.routeName ? ` — ${trip.routeName}` : ''}`,
      routeName: trip.routeName ?? null,
      containerNumbers: containerNumbers(containerInfo),
      renderData,
      baseAmount: customerTripReceivableAmount(trip.revenue, trip.fuelSurchargeAmount),
      amountOverride: null,
      excluded: false,
      sortOrder: 0,
    },
  };
}

async function buildExpenseDraftLineTx(tx: Tx, expenseId: number): Promise<{
  customerId: number;
  businessDate: string;
  line: MutableLine;
} | null> {
  const [expense] = await tx.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    approvalStatus: s.tripExpenses.approvalStatus,
    sellAmount: s.tripExpenses.sellAmount,
    expenseDate: s.tripExpenses.expenseDate,
    expenseType: s.tripExpenses.expenseType,
    invoiceNumber: s.tripExpenses.invoiceNumber,
    declarationNumber: s.tripExpenses.declarationNumber,
    updatedAt: s.tripExpenses.updatedAt,
    billingLabel: s.forwarderExpenseTypes.billingLabel,
    name: s.forwarderExpenseTypes.name,
    customerId: s.trips.customerId,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    routeName: s.routes.name,
    notes: s.trips.notes,
    truckPlate: s.trucks.licensePlate,
    externalPlateNumber: s.trips.externalPlateNumber,
    tripStatus: s.trips.status,
  })
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);
  if (
    !expense
    || expense.approvalStatus !== 'APPROVED'
    || typeof expense.tripStatus !== 'string'
    || !isBillableTripStatus(expense.tripStatus)
    || Number(expense.sellAmount ?? 0) <= 0
  ) {
    return null;
  }
  if (!expense.departureDate || !expense.expenseDate) {
    return null;
  }

  const containersByTrip = await loadContainersByTrip([expense.tripId], tx);
  const legsByTrip = await loadLegRenderDataByTrip([expense.tripId], tx);
  const containerInfo = containersByTrip.get(expense.tripId) ?? [];
  const renderData = buildTripRenderData({
    tripId: expense.tripId,
    trip: {
      tripCode: expense.tripCode,
      departureDate: expense.departureDate,
      routeName: expense.routeName,
      notes: expense.notes,
      truckPlate: expense.truckPlate,
      externalPlateNumber: expense.externalPlateNumber,
    },
    containers: containerInfo,
    legs: legsByTrip.get(expense.tripId),
    note: expense.billingLabel ?? expense.name ?? expense.expenseType,
  });
  renderData.documentCode = expenseDocumentCode(expense);
  renderData.sourceVersion = buildExpenseSourceVersionToken(expense);
  renderData.sourceChangedAt = expense.updatedAt?.toISOString() ?? null;

  return {
    customerId: expense.customerId,
    businessDate: expense.expenseDate,
    line: {
      sourceType: 'EXPENSE',
      sourceId: expense.id,
      lineType: 'SERVICE_FEE',
      typeLabel: 'Phí chi hộ',
      unit: containerUnit(containerInfo),
      description: expense.billingLabel ?? expense.name ?? expense.expenseType,
      routeName: expense.routeName ?? null,
      containerNumbers: containerNumbers(containerInfo),
      renderData,
      baseAmount: Number(expense.sellAmount ?? 0),
      amountOverride: null,
      excluded: false,
      sortOrder: 0,
    },
  };
}

function matchesCustomerDraftDocument(
  document: DraftDocumentRow,
  customerId: number,
  businessDate: string,
): boolean {
  return document.type === 'DEBIT_NOTE'
    && document.entityType === 'CUSTOMER'
    && document.entityId === customerId
    && document.rangeFrom <= businessDate
    && document.rangeTo >= businessDate
    && (document.debitNoteStatus ?? 'DRAFT') === 'DRAFT'
    && document.deletedAt == null;
}

async function loadMutableLinesTx(tx: Tx, documentId: number): Promise<MutableLine[]> {
  const rows = await tx.select()
    .from(s.billingDocumentLines)
    .where(eq(s.billingDocumentLines.documentId, documentId))
    .orderBy(s.billingDocumentLines.sortOrder, s.billingDocumentLines.id);
  return rows.map((row) => {
    const explicitSourceVersion = typeof row.sourceVersion === 'string' && row.sourceVersion.trim()
      ? row.sourceVersion.trim()
      : null;
    const explicitSourceChangedAt = row.sourceChangedAt
      ? row.sourceChangedAt.toISOString()
      : null;
    const renderData = (row.renderData as BillingLineRenderData | null) ?? null;
    return {
    id: row.id,
    sourceType: row.sourceType as MutableLine['sourceType'],
    sourceId: row.sourceId ?? null,
    financialPostingId: row.financialPostingId ?? null,
    financialPostingVersion: row.financialPostingVersion ?? null,
    postingChecksum: row.postingChecksum ?? null,
    lineType: row.lineType as MutableLine['lineType'],
    typeLabel: row.typeLabel,
    unit: row.unit,
    description: row.description,
    routeName: row.routeName,
    containerNumbers: row.containerNumbers ? row.containerNumbers.split(',').map((part) => part.trim()).filter(Boolean) : null,
    renderData: renderData
      ? {
          ...renderData,
          ...(explicitSourceVersion ? { sourceVersion: explicitSourceVersion } : {}),
          ...(explicitSourceChangedAt ? { sourceChangedAt: explicitSourceChangedAt } : {}),
        }
      : (
          explicitSourceVersion || explicitSourceChangedAt
            ? {
                ...(explicitSourceVersion ? { sourceVersion: explicitSourceVersion } : {}),
                ...(explicitSourceChangedAt ? { sourceChangedAt: explicitSourceChangedAt } : {}),
              } as BillingLineRenderData
            : null
        ),
    baseAmount: Number(row.baseAmount),
      amountOverride: row.amountOverride != null ? Number(row.amountOverride) : null,
      excluded: row.excluded,
      sortOrder: row.sortOrder,
    };
  });
}

async function persistMutableLinesTx(tx: Tx, documentId: number, lines: MutableLine[]): Promise<void> {
  await tx.delete(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, documentId));
  if (lines.length === 0) return;
  await tx.insert(s.billingDocumentLines).values(lines.map((line, index) => ({
    documentId,
    sourceType: line.sourceType,
    sourceId: line.sourceId,
    financialPostingId: line.sourceType === 'TRIP' ? (line.financialPostingId ?? null) : null,
    financialPostingVersion: line.sourceType === 'TRIP' ? (line.financialPostingVersion ?? null) : null,
    postingChecksum: line.sourceType === 'TRIP' ? (line.postingChecksum ?? null) : null,
    sourceVersion: typeof line.renderData?.sourceVersion === 'string'
      ? line.renderData.sourceVersion
      : null,
    sourceChangedAt: typeof line.renderData?.sourceChangedAt === 'string'
      ? new Date(line.renderData.sourceChangedAt)
      : null,
    lineType: line.lineType,
    typeLabel: line.typeLabel,
    unit: line.unit,
    description: line.description,
    routeName: line.routeName ?? null,
    containerNumbers: joinContainers(line.containerNumbers),
    renderData: line.renderData ? { ...line.renderData } : null,
    baseAmount: String(line.baseAmount),
    amountOverride: line.amountOverride != null ? String(line.amountOverride) : null,
    excluded: line.excluded ?? false,
    sortOrder: line.sortOrder ?? index,
  })));
}

async function saveDraftDocumentLinesTx(
  tx: Tx,
  document: DraftDocumentRow,
  nextLines: MutableLine[],
): Promise<void> {
  const total = docTotal(nextLines);
  const desiredAdjustment = document.type === 'DEBIT_NOTE' && document.entityType === 'CUSTOMER'
    ? documentLedgerAdjustment(nextLines)
    : 0;

  await tx.update(s.billingDocuments)
    .set({
      totalInclVat: String(total),
      ledgerAdjustmentAmount: String(desiredAdjustment),
      authorityState: 'CURRENT',
      authorityWarningReason: null,
      authorityWarningAt: null,
      updatedAt: new Date(),
    })
    .where(eq(s.billingDocuments.id, document.id));
  await persistMutableLinesTx(tx, document.id, nextLines);
  if (document.type === 'DEBIT_NOTE' && document.entityType === 'CUSTOMER') {
    await postDebitNoteDelta(tx, {
      documentId: document.id,
      customerId: document.entityId,
      delta: desiredAdjustment - Number(document.ledgerAdjustmentAmount ?? 0),
      originalDueDate: document.originalDueDate,
      processingDueDate: document.processingDueDate,
      paymentTermDaysApplied: document.paymentTermDaysApplied,
      paymentDatePolicyApplied: document.paymentDatePolicyApplied as PaymentDatePolicy | null,
    });
  }
}

async function markIssuedDocumentSourceDriftTx(
  tx: Tx,
  documentId: number,
  message: string,
): Promise<void> {
  const [document] = await tx.select({
    id: s.billingDocuments.id,
    entityId: s.billingDocuments.entityId,
    authorityState: s.billingDocuments.authorityState,
  })
    .from(s.billingDocuments)
    .where(and(eq(s.billingDocuments.id, documentId), isNull(s.billingDocuments.deletedAt)))
    .limit(1)
    .for('update');
  if (!document) return;

  await tx.update(s.billingDocuments)
    .set({
      authorityState: 'ADJUSTMENT_REQUIRED',
      authorityWarningReason: message,
      authorityWarningAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(s.billingDocuments.id, document.id));

  if (document.authorityState !== 'ADJUSTMENT_REQUIRED') {
    await persistNotificationInTx(tx, {
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'Giấy báo nợ cần điều chỉnh theo nguồn',
      message,
      relatedEntityType: 'billing_documents',
      relatedEntityId: document.id,
    });
  }
}

async function syncSingleSourceDraftDocumentTx(
  tx: Tx,
  documentId: number,
  sourceType: 'TRIP' | 'EXPENSE',
  sourceId: number,
  desired: { customerId: number; businessDate: string; line: MutableLine } | null,
): Promise<void> {
  const [document] = await tx.select()
    .from(s.billingDocuments)
    .where(and(eq(s.billingDocuments.id, documentId), isNull(s.billingDocuments.deletedAt)))
    .limit(1)
    .for('update');
  if (!document) return;
  assertDraftDocumentLinesEditable(document.debitNoteStatus);

  const existingLines = await loadMutableLinesTx(tx, document.id);
  const untouchedLines = existingLines.filter((line) => !(line.sourceType === sourceType && line.sourceId === sourceId));
  const existingLine = existingLines.find((line) => line.sourceType === sourceType && line.sourceId === sourceId) ?? null;

  let nextLines = untouchedLines;
  if (desired && matchesCustomerDraftDocument(document, desired.customerId, desired.businessDate)) {
    const preserved = existingLine
      ? {
          ...desired.line,
          amountOverride: existingLine.amountOverride ?? null,
          excluded: existingLine.excluded ?? false,
          sortOrder: existingLine.sortOrder,
        }
      : {
          ...desired.line,
          sortOrder: existingLines.length,
        };
    nextLines = [...untouchedLines, preserved];
  }

  nextLines = [...nextLines].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return lineKey(left).localeCompare(lineKey(right));
  }).map((line, index) => ({ ...line, sortOrder: index }));

  await saveDraftDocumentLinesTx(tx, document, nextLines);
}

async function collectDraftDocumentIdsForSourceTx(
  tx: Tx,
  sourceType: 'TRIP' | 'EXPENSE',
  sourceId: number,
  customerId: number | null,
  businessDate: string | null,
): Promise<number[]> {
  const fromLineRows = await tx.select({ documentId: s.billingDocumentLines.documentId })
    .from(s.billingDocumentLines)
    .innerJoin(s.billingDocuments, eq(s.billingDocuments.id, s.billingDocumentLines.documentId))
    .where(and(
      eq(s.billingDocumentLines.sourceType, sourceType),
      eq(s.billingDocumentLines.sourceId, sourceId),
      or(
        isNull(s.billingDocuments.debitNoteStatus),
        eq(s.billingDocuments.debitNoteStatus, 'DRAFT'),
      ),
      isNull(s.billingDocuments.deletedAt),
    ));

  const fromPeriodRows = customerId != null && businessDate != null
    ? await tx.select({ id: s.billingDocuments.id })
      .from(s.billingDocuments)
      .where(and(
        eq(s.billingDocuments.type, 'DEBIT_NOTE'),
        eq(s.billingDocuments.entityType, 'CUSTOMER'),
        eq(s.billingDocuments.entityId, customerId),
        gte(s.billingDocuments.rangeTo, businessDate),
        lte(s.billingDocuments.rangeFrom, businessDate),
        or(
          isNull(s.billingDocuments.debitNoteStatus),
          eq(s.billingDocuments.debitNoteStatus, 'DRAFT'),
        ),
        isNull(s.billingDocuments.deletedAt),
      ))
    : [];

  return [...new Set([
    ...fromLineRows.map((row) => row.documentId),
    ...fromPeriodRows.map((row) => row.id),
  ])];
}

async function syncSourceAcrossDraftDocumentsTx(
  tx: Tx,
  sourceType: 'TRIP' | 'EXPENSE',
  sourceId: number,
  desired: { customerId: number; businessDate: string; line: MutableLine } | null,
): Promise<void> {
  const documentIds = await collectDraftDocumentIdsForSourceTx(
    tx,
    sourceType,
    sourceId,
    desired?.customerId ?? null,
    desired?.businessDate ?? null,
  );
  for (const documentId of documentIds) {
    await syncSingleSourceDraftDocumentTx(tx, documentId, sourceType, sourceId, desired);
  }
}

async function collectIssuedDocumentIdsForSourceTx(
  tx: Tx,
  sourceType: 'TRIP' | 'EXPENSE',
  sourceId: number,
): Promise<number[]> {
  const rows = await tx.select({ documentId: s.billingDocumentLines.documentId })
    .from(s.billingDocumentLines)
    .innerJoin(s.billingDocuments, eq(s.billingDocuments.id, s.billingDocumentLines.documentId))
    .where(and(
      eq(s.billingDocumentLines.sourceType, sourceType),
      eq(s.billingDocumentLines.sourceId, sourceId),
      isNull(s.billingDocuments.deletedAt),
      sql`coalesce(${s.billingDocuments.debitNoteStatus}, 'DRAFT') <> 'DRAFT'`,
    ));
  return [...new Set(rows.map((row) => row.documentId))];
}

async function appendLateApprovedServiceFeeTx(tx: Tx, expenseId: number): Promise<void> {
  const [expense] = await tx.select({
    expenseId: s.tripExpenses.id,
    customerId: s.trips.customerId,
    tripId: s.tripExpenses.tripId,
    tripCode: s.trips.tripCode,
    tripStatus: s.trips.status,
    expenseDate: s.tripExpenses.expenseDate,
    sellAmount: s.tripExpenses.sellAmount,
  })
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);
  if (
    !expense
    || expense.tripStatus !== 'COMPLETED'
    || Number(expense.sellAmount ?? 0) <= 0
  ) {
    return;
  }
  if (!expense.expenseDate) {
    throw new ApiError(400, 'Ngày chi thực tế là bắt buộc trước khi phê duyệt chi phí');
  }

  const existingRows = await tx.select({
    id: s.ledger.id,
    debit: s.ledger.debit,
    credit: s.ledger.credit,
    originalDueDate: s.ledger.originalDueDate,
    processingDueDate: s.ledger.processingDueDate,
    paymentTermDaysApplied: s.ledger.paymentTermDaysApplied,
    paymentDatePolicyApplied: s.ledger.paymentDatePolicyApplied,
  })
    .from(s.ledger)
    .where(and(eq(s.ledger.txnType, TxnType.SERVICE_FEE), eq(s.ledger.txnId, expenseId)));
  const posted = existingRows.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0);
  const delta = round2dp(Number(expense.sellAmount ?? 0) - posted);
  if (delta === 0) return;

  const existingAuthority = [...existingRows]
    .sort((left, right) => right.id - left.id)
    .find((row) => row.originalDueDate && row.processingDueDate);
  const resolvedAuthority = existingAuthority
    ? null
    : await resolveCustomerPaymentDueDate(tx, expense.customerId, expense.expenseDate);
  const dueDateFields = existingAuthority
    ? {
        originalDueDate: existingAuthority.originalDueDate,
        processingDueDate: existingAuthority.processingDueDate,
        paymentTermDaysApplied: existingAuthority.paymentTermDaysApplied,
        paymentDatePolicyApplied:
          existingAuthority.paymentDatePolicyApplied as PaymentDatePolicy | null,
      }
    : {
        originalDueDate: resolvedAuthority!.originalDate,
        processingDueDate: resolvedAuthority!.processingDate,
        paymentTermDaysApplied: resolvedAuthority!.paymentTermDays,
        paymentDatePolicyApplied: resolvedAuthority!.policy,
      };

  await LedgerService.postEntry(tx, {
    txnType: existingRows.length === 0 ? TxnType.SERVICE_FEE : TxnType.ADJUSTMENT,
    txnId: expense.expenseId,
    entityType: 'CUSTOMER',
    entityId: expense.customerId,
    debit: delta > 0 ? delta : 0,
    credit: delta < 0 ? Math.abs(delta) : 0,
    note: `Điều chỉnh phí chi hộ chuyến ${expense.tripCode ?? ''}`.trim(),
    ...dueDateFields,
  });
}

async function appendLateApprovedVendorExpenseTx(tx: Tx, expenseId: number): Promise<void> {
  const [expense] = await tx.select({
    expenseId: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    supplierId: s.tripExpenses.supplierId,
    buyAmount: s.tripExpenses.buyAmount,
    settlementMethod: s.tripExpenses.settlementMethod,
    approvalStatus: s.tripExpenses.approvalStatus,
    tripCode: s.trips.tripCode,
    tripStatus: s.trips.status,
    departureDate: s.trips.departureDate,
  })
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);
  if (
    !expense
    || expense.tripStatus !== 'COMPLETED'
    || expense.approvalStatus !== 'APPROVED'
    || expense.supplierId == null
    || expense.settlementMethod !== 'COMPANY_DIRECT'
    || Number(expense.buyAmount ?? 0) <= 0
  ) {
    return;
  }
  if (!expense.departureDate) {
    throw new ApiError(400, 'Ngày khởi hành là bắt buộc trước khi ghi nhận công nợ NCC cho chi phí đã duyệt');
  }

  const sourceReceiptId = tripExpenseVendorReceiptId(expenseId);
  const existingRows = await tx.select({
    id: s.ledger.id,
    debit: s.ledger.debit,
    credit: s.ledger.credit,
    originalDueDate: s.ledger.originalDueDate,
    processingDueDate: s.ledger.processingDueDate,
    paymentTermDaysApplied: s.ledger.paymentTermDaysApplied,
    paymentDatePolicyApplied: s.ledger.paymentDatePolicyApplied,
  })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'VENDOR'),
      eq(s.ledger.entityId, expense.supplierId),
      eq(s.ledger.receiptId, sourceReceiptId),
    ));
  const posted = existingRows.reduce((sum, row) => sum + Number(row.credit) - Number(row.debit), 0);
  const delta = round2dp(Number(expense.buyAmount ?? 0) - posted);
  if (delta === 0) return;

  const basisDate = String(expense.departureDate).slice(0, 10);
  const existingAuthority = [...existingRows]
    .sort((left, right) => right.id - left.id)
    .find((row) => row.originalDueDate && row.processingDueDate);
  const resolvedAuthority = existingAuthority
    ? null
    : await resolveSupplierPaymentDueDate(tx, expense.supplierId, 'CHI_HO', basisDate);
  const dueDateFields = existingAuthority
    ? {
        originalDueDate: existingAuthority.originalDueDate,
        processingDueDate: existingAuthority.processingDueDate,
        paymentTermDaysApplied: existingAuthority.paymentTermDaysApplied,
        paymentDatePolicyApplied:
          existingAuthority.paymentDatePolicyApplied as PaymentDatePolicy | null,
      }
    : (
        resolvedAuthority
          ? {
              originalDueDate: resolvedAuthority.originalDate,
              processingDueDate: resolvedAuthority.processingDate,
              paymentTermDaysApplied: resolvedAuthority.paymentTermDays,
              paymentDatePolicyApplied: resolvedAuthority.policy,
            }
          : {}
      );
  const activeFinancialPosting = await getActiveFinancialPosting(tx, expense.tripId);

  await LedgerService.postEntry(tx, {
    txnType: existingRows.length === 0 ? TxnType.VENDOR_EXPENSE : TxnType.ADJUSTMENT,
    txnId: expense.expenseId,
    entityType: 'VENDOR',
    entityId: expense.supplierId,
    debit: delta < 0 ? Math.abs(delta) : 0,
    credit: delta > 0 ? delta : 0,
    note: existingRows.length === 0
      ? `Chi hộ NCC chuyến ${expense.tripCode ?? ''}`.trim()
      : `Điều chỉnh chi hộ NCC chuyến ${expense.tripCode ?? ''}`.trim(),
    receiptId: sourceReceiptId,
    ...dueDateFields,
    financialPostingId: activeFinancialPosting?.id ?? null,
  });
}

export async function propagateTripFinancialSourceChange(tx: Tx, input: {
  tripId: number;
}): Promise<void> {
  const desired = await buildTripDraftLineTx(tx, input.tripId);
  await syncSourceAcrossDraftDocumentsTx(tx, 'TRIP', input.tripId, desired);
  const issuedDocumentIds = await collectIssuedDocumentIdsForSourceTx(tx, 'TRIP', input.tripId);
  for (const documentId of issuedDocumentIds) {
    await markIssuedDocumentSourceDriftTx(
      tx,
      documentId,
      'Nguồn chuyến đã thay đổi sau khi phát hành giấy báo nợ. Vui lòng lập điều chỉnh hoặc hoàn tác theo quy trình.',
    );
  }
}

export async function propagateExpenseApproval(tx: Tx, input: {
  expenseId: number;
}): Promise<void> {
  const [expense] = await tx.select({
    tripId: s.tripExpenses.tripId,
    tripStatus: s.trips.status,
  })
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .where(eq(s.tripExpenses.id, input.expenseId))
    .limit(1);
  await appendLateApprovedServiceFeeTx(tx, input.expenseId);
  await appendLateApprovedVendorExpenseTx(tx, input.expenseId);
  if (expense?.tripStatus === 'COMPLETED') {
    await SnapshotServices.markBothDirty(expense.tripId, tx);
  }
  // O2C Bước 4 "Ranh giới Tạm ứng": auto-offset the forwarder's advance the
  // moment a chi hộ fee is approved (PRD: "ngay khi phí chi hộ được Kế toán
  // duyệt, hệ thống tự động sinh bút toán cấn trừ"). Lazy import avoids the
  // advance.service ↔ source-change.service module cycle; the function is
  // internally guarded against double-posting (manual batch flow uses the same
  // hook) and skips non-OPS_ADVANCE / driver expenses.
  const { autoOffsetExpenseApproval } = await import('./advance.service.js');
  await autoOffsetExpenseApproval(tx, input.expenseId);
  const desired = await buildExpenseDraftLineTx(tx, input.expenseId);
  await syncSourceAcrossDraftDocumentsTx(tx, 'EXPENSE', input.expenseId, desired);
  const issuedDocumentIds = await collectIssuedDocumentIdsForSourceTx(tx, 'EXPENSE', input.expenseId);
  for (const documentId of issuedDocumentIds) {
    await markIssuedDocumentSourceDriftTx(
      tx,
      documentId,
      'Chi phí đã thay đổi sau khi phát hành giấy báo nợ. Vui lòng lập điều chỉnh hoặc hoàn tác theo quy trình.',
    );
  }
}

export async function propagateExpenseApprovals(tx: Tx, expenseIds: readonly number[]): Promise<void> {
  for (const expenseId of [...new Set(expenseIds)]) {
    await propagateExpenseApproval(tx, { expenseId });
  }
}
