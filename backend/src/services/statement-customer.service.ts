// Customer (AR) statement assembly: receivable-authority snapshot + ledger
// enrichment with service-fee resolution, plus the customer XLSX/HTML export
// wrappers and the receivables-aging report. Extracted from statement.service.ts
// verbatim (pure code movement); rendering lives in statement-export-render.
import { db } from '../db';
import * as s from '../db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { TxnType, OPS_EXPENSE_TYPE_DEFAULTS } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { getCompanyInfo } from './company-info.service';
import { stampCompanyHeaderXlsx } from './lib/export-company';
import { CustomerAgingListItem } from './aging.service';
import { getCustomerReceivableSnapshot } from './customer-receivable-authority.service';
import { checkCreditLimit } from './credit-limit.service';
import {
  type LedgerRow,
  type EnrichedLedgerRow,
  type CustomerStatementData,
  withReceivableProjectionBalances,
  computePeriodSummary,
  statementPeriodBounds,
} from './statement-shared.service';
import { buildStatementXlsx, buildStatementHtml } from './statement-export-render.service';

const TXN_LABELS: Record<string, string> = {
  TRIP_REVENUE: 'Doanh thu chuyến',
  PAYMENT_RECEIVED: 'Thu tiền',
  PENALTY: 'Phạt',
  MANAGEMENT_FEE: 'Phí quản lý',
  ADJUSTMENT: 'Điều chỉnh',
  DRIVER_SALARY: 'Lương lái xe',
  UNLOCK_REVERSAL: 'Hoàn tác khóa chuyến',
  EXTERNAL_CARRIER_COST: 'Cước thuê ngoài',
  SERVICE_FEE: 'Phí chi hộ',
};

function serviceFeeLabel(expenseType: string, billingLabel?: string | null, name?: string | null): string {
  return (
    billingLabel?.trim()
    || name?.trim()
    || OPS_EXPENSE_TYPE_DEFAULTS[expenseType]?.billingLabel
    || expenseType
  );
}

function isLegacyServiceFeeRevenueRow(row: LedgerRow): boolean {
  if (row.txnType !== TxnType.TRIP_REVENUE || !row.note) return false;
  return row.note.includes('Tạm ứng/nộp hộ') || row.note.includes('Phí chi hộ');
}
export async function getStatementData(customerId: number, dateFrom?: string, dateTo?: string): Promise<CustomerStatementData | null> {
  const [customer] = await db.select().from(s.customers).where(eq(s.customers.id, customerId)).limit(1);
  if (!customer) return null;
  const [receivableSnapshot, creditExposure] = await Promise.all([
    getCustomerReceivableSnapshot(customerId, { asOfDate: dateTo }),
    checkCreditLimit(customerId),
  ]);

  let ledgerRows = withReceivableProjectionBalances(
    (await LedgerService.getEntriesByEntity('CUSTOMER', customerId))
      .filter(row =>
        row.txnType !== TxnType.EXTERNAL_CARRIER_COST
        && row.txnType !== TxnType.VENDOR_PAYMENT
        && !(
          row.txnType === TxnType.UNLOCK_REVERSAL
          && row.note?.startsWith('Cước thuê ngoài')
        )
      ),
  );

  // Period summary (đầu kỳ / phát sinh / cuối kỳ) is computed BEFORE the
  // date filter so we can read the stored `balance` of the last pre-period row.
  const periodSummary = computePeriodSummary(ledgerRows, dateFrom, dateTo, 'CUSTOMER');

  // Optional date range filter — used by frontend /debt/:id "Bộ lọc khoảng thời gian"
  // (Flow 04 §2.4.1 + PRODUCT-SPECS §4.10: "Bộ lọc khoảng thời gian: 2 ô date picker")
  if (dateFrom || dateTo) {
    const { fromInclusive: fromTs, toExclusive: toTs } = statementPeriodBounds(dateFrom, dateTo);
    ledgerRows = ledgerRows.filter((r) => {
      const t = new Date(r.timestamp).getTime();
      if (fromTs !== null && t < fromTs) return false;
      if (toTs !== null && t >= toTs) return false;
      return true;
    });
  }

  // Fetch routes/container numbers for trip-backed ledger rows. SERVICE_FEE
  // rows store trip_expenses.id in txnId, so resolve those fee ids back to
  // their trip and configured billing label first. EXTERNAL_CARRIER_COST
  // (cước thuê ngoài) also stores the trip id in txnId, so it gets the same
  // route/container enrichment as a regular trip revenue row.
  const directlyLinkedTripIds = Array.from(new Set(
    ledgerRows
      .filter((r) => r.txnId && (
        r.txnType === TxnType.TRIP_REVENUE
        || r.txnType === TxnType.UNLOCK_REVERSAL
        || r.txnType === TxnType.PAYMENT_RECEIVED
        || r.txnType === TxnType.EXTERNAL_CARRIER_COST
      ))
      .map((r) => r.txnId as number)
  ));

  const serviceFeeIds = Array.from(new Set(
    ledgerRows
      .filter((r) => r.txnId && r.txnType === TxnType.SERVICE_FEE)
      .map((r) => r.txnId as number)
  ));

  const serviceFeeMap = new Map<number, { tripId: number; label: string; containerNumber: string | null }>();
  if (serviceFeeIds.length > 0) {
    const feeRows = await db.select({
      feeId: s.tripExpenses.id,
      tripId: s.tripExpenses.tripId,
      expenseType: s.tripExpenses.expenseType,
      billingLabel: s.forwarderExpenseTypes.billingLabel,
      typeName: s.forwarderExpenseTypes.name,
      containerNumber: sql<string | null>`COALESCE(${s.tripContainers.containerNumber}, ${s.tripExpenses.containerNumber})`,
    })
      .from(s.tripExpenses)
      .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
      .leftJoin(s.tripContainers, eq(s.tripExpenses.tripContainerId, s.tripContainers.id))
      .where(inArray(s.tripExpenses.id, serviceFeeIds));

    for (const fee of feeRows) {
      serviceFeeMap.set(fee.feeId, {
        tripId: fee.tripId,
        label: serviceFeeLabel(fee.expenseType, fee.billingLabel, fee.typeName),
        containerNumber: fee.containerNumber ?? null,
      });
    }
  }

  const tripIds = Array.from(new Set([
    ...directlyLinkedTripIds,
    ...Array.from(serviceFeeMap.values()).map((fee) => fee.tripId),
  ]));

  const legacyFeeCandidates = new Map<string, Array<{ tripId: number; label: string; containerNumber: string | null }>>();
  if (directlyLinkedTripIds.length > 0) {
    const feeRows = await db.select({
      tripId: s.tripExpenses.tripId,
      sellAmount: s.tripExpenses.sellAmount,
      expenseType: s.tripExpenses.expenseType,
      billingLabel: s.forwarderExpenseTypes.billingLabel,
      typeName: s.forwarderExpenseTypes.name,
      containerNumber: sql<string | null>`COALESCE(${s.tripContainers.containerNumber}, ${s.tripExpenses.containerNumber})`,
    })
      .from(s.tripExpenses)
      .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
      .leftJoin(s.tripContainers, eq(s.tripExpenses.tripContainerId, s.tripContainers.id))
      .where(inArray(s.tripExpenses.tripId, directlyLinkedTripIds));

    for (const fee of feeRows) {
      const amount = Number(fee.sellAmount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const key = `${fee.tripId}|${amount}`;
      const existing = legacyFeeCandidates.get(key) ?? [];
      existing.push({
        tripId: fee.tripId,
        label: serviceFeeLabel(fee.expenseType, fee.billingLabel, fee.typeName),
        containerNumber: fee.containerNumber ?? null,
      });
      legacyFeeCandidates.set(key, existing);
    }
  }

  const tripDetailsMap = new Map<number, {
    tripCode: string | null;
    routeName: string | null;
    departureDate: string | null;
    containerNumbers: string[];
  }>();
  if (tripIds.length > 0) {
    const tripRows = await db.select({
      tripId: s.trips.id,
      tripCode: s.trips.tripCode,
      departureDate: s.trips.departureDate,
      routeName: s.routes.name,
    }).from(s.trips)
      .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
      .where(inArray(s.trips.id, tripIds));

    const containerRows = await db.select({
      tripId: s.tripContainers.tripId,
      containerNumber: s.tripContainers.containerNumber,
    }).from(s.tripContainers)
      .where(inArray(s.tripContainers.tripId, tripIds));

    const containersByTrip = new Map<number, string[]>();
    for (const c of containerRows) {
      if (!c.containerNumber) continue;
      if (!containersByTrip.has(c.tripId)) {
        containersByTrip.set(c.tripId, []);
      }
      containersByTrip.get(c.tripId)!.push(c.containerNumber);
    }

    for (const t of tripRows) {
      tripDetailsMap.set(t.tripId, {
        tripCode: t.tripCode,
        routeName: t.routeName,
        departureDate: t.departureDate,
        containerNumbers: containersByTrip.get(t.tripId) ?? [],
      });
    }
  }

  const enrichedLedgerRows = ledgerRows.map((r) => {
    const feeDetails = r.txnType === TxnType.SERVICE_FEE && r.txnId
      ? serviceFeeMap.get(r.txnId)
      : undefined;
    const directTripId = r.txnId && (
      r.txnType === TxnType.TRIP_REVENUE
      || r.txnType === TxnType.UNLOCK_REVERSAL
      || r.txnType === TxnType.PAYMENT_RECEIVED
      || r.txnType === TxnType.EXTERNAL_CARRIER_COST
    )
      ? r.txnId
      : null;
    const legacyFeeDetails = directTripId && isLegacyServiceFeeRevenueRow(r)
      ? legacyFeeCandidates.get(`${directTripId}|${Number(r.debit)}`)?.shift()
      : undefined;
    const tripId = feeDetails?.tripId ?? legacyFeeDetails?.tripId ?? directTripId;
    const details = tripId ? tripDetailsMap.get(tripId) : undefined;
    const feeContainerNumber = feeDetails?.containerNumber ?? legacyFeeDetails?.containerNumber ?? null;
    return {
      ...r,
      routeName: details?.routeName ?? null,
      containerNumbers: feeContainerNumber
        ? [feeContainerNumber]
        : details?.containerNumbers ?? [],
      tripId,
      tripCode: details?.tripCode ?? null,
      serviceFeeLabel: feeDetails?.label ?? legacyFeeDetails?.label ?? null,
    };
  });

  const aging = receivableSnapshot.aging;
  const totalOutstanding = receivableSnapshot.totalOutstanding;

  const revenueEntries = enrichedLedgerRows.filter((r) => r.txnType === TxnType.TRIP_REVENUE);
  const tripNotes = new Map<number, string>();
  const revenueAuthorityByTrip = new Map<number, EnrichedLedgerRow>();
  const statementDueSortKey = (row: Pick<EnrichedLedgerRow, 'processingDueDate' | 'originalDueDate' | 'timestamp'>) =>
    row.processingDueDate
    ?? row.originalDueDate
    ?? new Date(row.timestamp).toISOString().slice(0, 10);
  for (const entry of revenueEntries) {
    if (entry.txnId && !tripNotes.has(entry.txnId)) {
      tripNotes.set(entry.txnId, entry.note || '');
    }
    if (entry.txnId) {
      const current = revenueAuthorityByTrip.get(entry.txnId);
      if (
        !current
        || statementDueSortKey(entry).localeCompare(statementDueSortKey(current)) < 0
        || (
          statementDueSortKey(entry) === statementDueSortKey(current)
          && new Date(entry.timestamp).toISOString().localeCompare(new Date(current.timestamp).toISOString()) < 0
        )
      ) {
        revenueAuthorityByTrip.set(entry.txnId, entry);
      }
    }
  }

  const unpaidTrips = receivableSnapshot.obligations
    .filter((obligation) =>
      obligation.outstanding > 0
      && (obligation.authorityType === 'TRIP' || obligation.authorityType === 'BILLING_DOCUMENT'),
    )
    .map((obligation) => {
      const tripId = obligation.representativeTripId
        ?? obligation.sourceTripIds[0]
        ?? obligation.authorityId;
      const directRevenue = revenueAuthorityByTrip.get(tripId);
      const note = obligation.authorityType === 'BILLING_DOCUMENT'
        ? obligation.label ?? 'Giấy báo nợ chưa có số chứng từ'
        : tripNotes.get(tripId) || directRevenue?.note || '';
      return {
        tripId,
        tripCode: tripDetailsMap.get(tripId)?.tripCode ?? null,
        date: obligation.issueTimestamp.slice(0, 10),
        issueTimestamp: obligation.issueTimestamp,
        outstanding: obligation.outstanding,
        note,
        originalDueDate: obligation.originalDueDate,
        processingDueDate: obligation.processingDueDate,
        dueDateAdjusted: obligation.originalDueDate != null
          && obligation.processingDueDate != null
          && obligation.originalDueDate !== obligation.processingDueDate,
      };
    });
  unpaidTrips.sort((a, b) => {
    const aDueKey = a.processingDueDate ?? a.originalDueDate ?? a.issueTimestamp.slice(0, 10);
    const bDueKey = b.processingDueDate ?? b.originalDueDate ?? b.issueTimestamp.slice(0, 10);
    if (aDueKey !== bDueKey) {
      return aDueKey.localeCompare(bDueKey);
    }
    if (a.issueTimestamp !== b.issueTimestamp) {
      return a.issueTimestamp.localeCompare(b.issueTimestamp);
    }
    return a.tripId - b.tripId;
  });

  return {
    customer: {
      id: customer.id, name: customer.name, contactInfo: customer.contactInfo,
      debitNoteMode: customer.debitNoteMode ?? 'MONTHLY', isCarrier: customer.isCarrier,
      // Q01 — surface credit-limit + threshold so the frontend can render
      // the 80%/100% warning badges on the customer detail page.
      creditLimit: customer.creditLimit ?? null,
      creditWarningThreshold: customer.creditWarningThreshold ?? null,
    },
    ledgerRows: enrichedLedgerRows,
    totalOutstanding,
    approvedUncollected: creditExposure.approvedUncollected,
    totalExposure: creditExposure.totalExposure,
    utilization: creditExposure.utilization,
    availableCapacity: creditExposure.creditLimit == null
      ? null
      : Math.max(0, creditExposure.creditLimit - creditExposure.totalExposure),
    unpaidTrips,
    agingBuckets: [
      { range: '0-30 ngày', amount: aging.current },
      { range: '31-60 ngày', amount: aging.d30 },
      { range: '61-90 ngày', amount: aging.d60 },
      { range: 'Trên 90 ngày', amount: aging.over90 },
    ],
    ...(periodSummary ? { periodSummary } : null),
  };
}

export async function exportStatementXlsx(data: CustomerStatementData, dateStr: string, writable: import('stream').Writable): Promise<void> {
  return buildStatementXlsx({
    heading: 'Sao kê công nợ',
    sheetName: 'Sao kê công nợ',
    entityLabel: 'Khách hàng',
    entityName: data.customer.name,
    contactLines: [`Liên hệ: ${data.customer.contactInfo || '—'}`],
    txnLabels: TXN_LABELS,
    ledgerRows: data.ledgerRows,
    totalOutstanding: data.totalOutstanding,
    agingBuckets: data.agingBuckets,
    unpaidTrips: data.unpaidTrips,
  }, dateStr, writable);
}

export async function exportStatementHtml(data: CustomerStatementData, dateStr: string): Promise<string> {
  return buildStatementHtml({
    heading: 'Sao kê công nợ',
    entityLabel: 'Khách hàng',
    entityName: data.customer.name,
    contactLines: [`Liên hệ: ${data.customer.contactInfo || '—'}`],
    txnLabels: TXN_LABELS,
    ledgerRows: data.ledgerRows,
    totalOutstanding: data.totalOutstanding,
    agingBuckets: data.agingBuckets,
    unpaidTrips: data.unpaidTrips,
  }, dateStr);
}
// escapeHtml imported from lib/format

export async function exportReceivablesAgingXlsx(data: CustomerAgingListItem[], dateStr: string, writable: import('stream').Writable): Promise<void> {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Công nợ phải thu');

  // Enable grid lines
  sheet.views = [{ showGridLines: true }];

  // Border style
  const borderStyle = {
    top: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
    left: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
    right: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } }
  };

  // Company letterhead (configured on /config/company-info) — rows 1..4.
  const company = await getCompanyInfo();
  const afterHeader = await stampCompanyHeaderXlsx(workbook, sheet, company, { lastCol: 8 });

  // Header/Title Row
  const titleRow = afterHeader + 1;
  sheet.mergeCells(titleRow, 1, titleRow, 8);
  const titleCell = sheet.getCell(titleRow, 1);
  titleCell.value = 'BÁO CÁO CÔNG NỢ PHẢI THU';
  titleCell.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00702F' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(titleRow).height = 36;

  // Export date
  const dateRow = titleRow + 2;
  sheet.getCell(dateRow, 1).value = `Ngày xuất: ${dateStr}`;
  sheet.getCell(dateRow, 1).font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(dateRow, 1, dateRow, 8);
  sheet.getRow(dateRow).height = 20;

  let currentOffset = dateRow + 2;

  // Table header row
  const tableHeaderRow = currentOffset;
  const headers = ['Khách hàng', 'Tổng nợ (VND)', 'Trong hạn (VND)', '31-60 ngày (VND)', '61-90 ngày (VND)', 'Trên 90 ngày (VND)', 'Phải trả l.kết (VND)', 'Nợ ròng (VND)'];
  headers.forEach((h, i) => {
    const cell = sheet.getCell(tableHeaderRow, i + 1);
    cell.value = h;
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF374151' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: i === 0 ? 'left' : 'right',
    };
    cell.border = borderStyle;
  });
  sheet.getRow(tableHeaderRow).height = 24;
  currentOffset++;

  let sumTotal = 0;
  let sumCurrent = 0;
  let sumD30 = 0;
  let sumD60 = 0;
  let sumOver90 = 0;
  let sumApBalance = 0;
  let sumNetBalance = 0;

  // Populate data rows
  data.forEach((row, i: number) => {
    const r = tableHeaderRow + 1 + i;
    
    const customerNameCell = sheet.getCell(r, 1);
    customerNameCell.value = row.customerName;
    customerNameCell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF111827' } };
    customerNameCell.alignment = { vertical: 'middle', horizontal: 'left' };
    customerNameCell.border = borderStyle;

    const totalCell = sheet.getCell(r, 2);
    totalCell.value = row.totalOutstanding || 0;
    totalCell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF111827' } };
    totalCell.numFmt = '#,##0';
    totalCell.alignment = { vertical: 'middle', horizontal: 'right' };
    totalCell.border = borderStyle;

    const currentCell = sheet.getCell(r, 3);
    currentCell.value = row.aging.current || 0;
    currentCell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF4B5563' } };
    currentCell.numFmt = '#,##0';
    currentCell.alignment = { vertical: 'middle', horizontal: 'right' };
    currentCell.border = borderStyle;

    const d30Cell = sheet.getCell(r, 4);
    d30Cell.value = row.aging.d30 || 0;
    d30Cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF4B5563' } };
    d30Cell.numFmt = '#,##0';
    d30Cell.alignment = { vertical: 'middle', horizontal: 'right' };
    d30Cell.border = borderStyle;

    const d60Cell = sheet.getCell(r, 5);
    d60Cell.value = row.aging.d60 || 0;
    d60Cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF4B5563' } };
    d60Cell.numFmt = '#,##0';
    d60Cell.alignment = { vertical: 'middle', horizontal: 'right' };
    d60Cell.border = borderStyle;

    const over90Cell = sheet.getCell(r, 6);
    over90Cell.value = row.aging.over90 || 0;
    over90Cell.font = { name: 'Segoe UI', size: 10, color: row.aging.over90 > 0 ? { argb: 'FFDC2626' } : { argb: 'FF4B5563' } };
    over90Cell.numFmt = '#,##0';
    over90Cell.alignment = { vertical: 'middle', horizontal: 'right' };
    over90Cell.border = borderStyle;

    const apBalanceCell = sheet.getCell(r, 7);
    apBalanceCell.value = row.linkedSupplierApBalance || 0;
    apBalanceCell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF4B5563' } };
    apBalanceCell.numFmt = '#,##0';
    apBalanceCell.alignment = { vertical: 'middle', horizontal: 'right' };
    apBalanceCell.border = borderStyle;

    const netBalanceCell = sheet.getCell(r, 8);
    netBalanceCell.value = row.netBalance || 0;
    netBalanceCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF00702F' } };
    netBalanceCell.numFmt = '#,##0';
    netBalanceCell.alignment = { vertical: 'middle', horizontal: 'right' };
    netBalanceCell.border = borderStyle;

    sheet.getRow(r).height = 20;

    sumTotal += row.totalOutstanding || 0;
    sumCurrent += row.aging.current || 0;
    sumD30 += row.aging.d30 || 0;
    sumD60 += row.aging.d60 || 0;
    sumOver90 += row.aging.over90 || 0;
    sumApBalance += row.linkedSupplierApBalance || 0;
    sumNetBalance += row.netBalance || 0;

    currentOffset++;
  });

  // Total row
  const totalRowIdx = currentOffset + 1;
  const labelCell = sheet.getCell(totalRowIdx, 1);
  labelCell.value = 'TỔNG CỘNG';
  labelCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF111827' } };
  labelCell.alignment = { vertical: 'middle', horizontal: 'left' };
  labelCell.border = borderStyle;

  const totalCols = [
    { col: 2, val: sumTotal },
    { col: 3, val: sumCurrent },
    { col: 4, val: sumD30 },
    { col: 5, val: sumD60 },
    { col: 6, val: sumOver90, isRed: true },
    { col: 7, val: sumApBalance },
    { col: 8, val: sumNetBalance, isBold: true }
  ];

  totalCols.forEach(tc => {
    const cell = sheet.getCell(totalRowIdx, tc.col);
    cell.value = tc.val;
    cell.font = {
      name: 'Segoe UI',
      size: 10,
      bold: true,
      color: tc.isRed ? { argb: 'FFDC2626' } : { argb: 'FF111827' }
    };
    cell.numFmt = '#,##0';
    cell.alignment = { vertical: 'middle', horizontal: 'right' };
    cell.border = borderStyle;
  });

  sheet.getRow(totalRowIdx).height = 22;

  // Set widths
  sheet.columns.forEach((col, i) => {
    let maxLen = headers[i] ? headers[i].length : 0;
    sheet.getColumn(i + 1).eachCell({ includeEmpty: true }, (cell) => {
      const len = String(cell.value || '').length;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.max(maxLen + 4, 12);
  });

  await workbook.xlsx.write(writable);
}
