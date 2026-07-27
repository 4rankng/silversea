import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { TxnType, computeFifoAging, FORWARDER_EXPENSE_TYPE_DEFAULTS } from '@tingting/shared';
import type { PeriodSummary } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import { escapeHtml } from '../lib/format';
import { getCompanyInfo } from './company-info.service';
import { stampCompanyHeaderXlsx, companyHeaderHtml, loadLogoDataUrl } from './lib/export-company';
import { CustomerAgingListItem } from './aging.service';

type LedgerRow = typeof s.ledger.$inferSelect;
// Ledger rows enriched with related trip context for customer and supplier displays.
export type EnrichedLedgerRow = LedgerRow & {
  routeName?: string | null;
  containerNumbers?: string[];
  tripId?: number | null;
  tripCode?: string | null;
  serviceFeeLabel?: string | null;
  fuelDetails?: {
    departureDate: string;
    truckPlate: string | null;
    routeName: string | null;
    liters: string | null;
    unitPrice: string | null;
    amount: string;
  } | null;
  expenseDetails?: {
    expenseDate: string;
    vehiclePlate: string | null;
    vehicleComponent: 'TRUCK' | 'TRAILER' | null;
    categoryName: string;
    amount: string;
  } | null;
};

export interface FuelTripStatementRow {
  id: number;
  tripCode: string | null;
  departureDate: string;
  truckPlate: string | null;
  routeName: string | null;
  fuelLiters: string | null;
  fuelActualUnitPrice: string | null;
  fuelPriceApplied: string | null;
  totalFuelCost: string | null;
}

export interface SupplierExpenseStatementRow {
  id: number;
  supplierId: number;
  expenseDate: string;
  vehiclePlate: string | null;
  vehicleComponent: 'TRUCK' | 'TRAILER' | null;
  categoryName: string;
  amount: string;
  createdAt: Date | string;
}

export interface CustomerStatementData {
  customer: { id: number; name: string; contactInfo: string | null; debitNoteMode?: string | null; isCarrier?: boolean };
  ledgerRows: EnrichedLedgerRow[];
  totalOutstanding: number;
  unpaidTrips: Array<{
    tripId: number;
    date: string;
    outstanding: number;
    note: string;
    originalDueDate: string | null;
    processingDueDate: string | null;
    dueDateAdjusted: boolean;
  }>;
  agingBuckets: Array<{ range: string; amount: number }>;
  periodSummary?: PeriodSummary;
}

export interface SupplierStatementData {
  supplier: { id: number; name: string; phone: string | null; contactPerson: string | null };
  ledgerRows: EnrichedLedgerRow[];
  totalOutstanding: number;
  agingBuckets: Array<{ range: string; amount: number }>;
  periodSummary?: PeriodSummary;
}

export function withPayableProjectionBalances(rows: EnrichedLedgerRow[]): EnrichedLedgerRow[] {
  let balance = 0;
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map(row => {
      balance += Number(row.credit ?? 0) - Number(row.debit ?? 0);
      return { ...row, balance: String(balance) };
    })
    .reverse();
}

export function withReceivableProjectionBalances(rows: EnrichedLedgerRow[]): EnrichedLedgerRow[] {
  let balance = 0;
  return [...rows]
    .sort((a, b) => a.id - b.id)
    .map(row => {
      balance += Number(row.debit ?? 0) - Number(row.credit ?? 0);
      return { ...row, balance: String(balance) };
    })
    .reverse();
}

export function attachFuelDetailsToLedgerRows(
  ledgerRows: EnrichedLedgerRow[],
  trips: FuelTripStatementRow[],
): EnrichedLedgerRow[] {
  const tripById = new Map(trips.map(trip => [trip.id, trip]));
  return ledgerRows.map(row => {
    if (row.txnType !== TxnType.FUEL_EXPENSE || !row.txnId) return row;
    const trip = tripById.get(row.txnId);
    if (!trip) return { ...row, tripCode: null, fuelDetails: null };
    return {
      ...row,
      tripCode: trip.tripCode,
      fuelDetails: {
        departureDate: trip.departureDate,
        truckPlate: trip.truckPlate,
        routeName: trip.routeName,
        liters: trip.fuelLiters,
        unitPrice: trip.fuelActualUnitPrice ?? trip.fuelPriceApplied,
        amount: trip.totalFuelCost ?? row.credit ?? '0',
      },
    };
  });
}

/**
 * Resolves payable expense rows to their operational vehicle context.
 *
 * New ledger rows carry the expense id in txnId. Legacy rows predate that
 * linkage, so they are resolved only when the match is deterministic: the
 * same supplier and amount plus an identical creation timestamp, or a single
 * unique supplier/amount candidate. Ambiguous rows intentionally stay blank.
 */
export function attachSupplierExpenseDetailsToLedgerRows(
  ledgerRows: EnrichedLedgerRow[],
  expenses: SupplierExpenseStatementRow[],
): EnrichedLedgerRow[] {
  const expenseById = new Map(expenses.map(expense => [expense.id, expense]));
  const expensesBySupplierAmount = new Map<string, SupplierExpenseStatementRow[]>();
  for (const expense of expenses) {
    const key = `${expense.supplierId}|${Number(expense.amount)}`;
    const candidates = expensesBySupplierAmount.get(key) ?? [];
    candidates.push(expense);
    expensesBySupplierAmount.set(key, candidates);
  }

  return ledgerRows.map(row => {
    if (row.txnType !== TxnType.VENDOR_EXPENSE) return row;

    let expense = row.txnId ? expenseById.get(row.txnId) : undefined;
    if (!expense) {
      const candidates = expensesBySupplierAmount.get(
        `${row.entityId}|${Number(row.credit ?? 0)}`,
      ) ?? [];
      const rowTimestamp = new Date(row.timestamp).getTime();
      const timestampMatches = candidates.filter(candidate =>
        Math.abs(new Date(candidate.createdAt).getTime() - rowTimestamp) < 1_000,
      );
      expense = timestampMatches.length === 1
        ? timestampMatches[0]
        : candidates.length === 1
          ? candidates[0]
          : undefined;
    }

    if (!expense) return { ...row, expenseDetails: null };
    return {
      ...row,
      expenseDetails: {
        expenseDate: expense.expenseDate,
        vehiclePlate: expense.vehiclePlate,
        vehicleComponent: expense.vehicleComponent,
        categoryName: expense.categoryName,
        amount: expense.amount,
      },
    };
  });
}

interface StatementExportConfig {
  heading: string;
  sheetName?: string;
  entityLabel: string;
  entityName: string;
  contactLines: string[];
  txnLabels: Record<string, string>;
  ledgerRows: EnrichedLedgerRow[];
  totalOutstanding: number;
  agingBuckets: Array<{ range: string; amount: number }>;
  unpaidTrips?: CustomerStatementData['unpaidTrips'];
}

export function safeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (c) => c === 'đ' ? 'd' : 'D')
    .replace(/[^a-zA-Z0-9 ._-]/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'statement';
}

export function attachmentDisposition(filename: string): string {
  const fallback = safeFilename(filename);
  const encoded = encodeURIComponent(filename)
    .replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Parse a `YYYY-MM-DD` query param. Returns `undefined` for missing/invalid
 * values so malformed inputs degrade to "no filter" instead of producing
 * NaN-based comparisons that silently yield wrong totals. */
function parseIsoDateParam(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Strict YYYY-MM-DD check (the format the frontend date inputs emit).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const t = new Date(raw + 'T00:00:00').getTime();
  return Number.isFinite(t) ? raw : undefined;
}

export function normalizeDateParam(raw: string | undefined): string | undefined {
  return parseIsoDateParam(raw);
}

/**
 * Computes the AR/AP period summary (số dư đầu kỳ / phát sinh trong kỳ / số dư
 * cuối kỳ) for the period filter on the detail pages.
 *
 * Sign convention matches `LedgerService.postEntry`:
 *   - CUSTOMER (AR): outstanding grows with debit, shrinks with credit.
 *     `periodActivity = debitTotal − creditTotal`.
 *   - VENDOR (AP): outstanding grows with credit, shrinks with debit.
 *     `periodActivity = creditTotal − debitTotal`.
 *
 * Opening balance is derived from every debit/credit strictly before
 * `dateFrom`. It deliberately does not trust the stored running balance:
 * backdated payments have a business timestamp earlier than rows inserted
 * before them, while the stored balance necessarily follows insertion order.
 *
 * Returns `null` when neither bound is supplied — the caller then omits the
 * field entirely and the frontend renders a loading skeleton.
 */
export function computePeriodSummary(
  rows: Array<{ id: number; timestamp: Date | string; debit: string | null; credit: string | null; balance: string }>,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  entityType: 'CUSTOMER' | 'VENDOR',
): PeriodSummary | null {
  if (!dateFrom && !dateTo) return null;

  const fromTs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
  const toTs = dateTo ? new Date(dateTo + 'T23:59:59.999').getTime() : null;

  let openingBalance = 0;
  let debitTotal = 0;
  let creditTotal = 0;

  for (const r of rows) {
    const t = new Date(r.timestamp).getTime();
    const debit = Number(r.debit ?? 0) || 0;
    const credit = Number(r.credit ?? 0) || 0;

    if (fromTs !== null && t < fromTs) {
      openingBalance += entityType === 'CUSTOMER'
        ? debit - credit
        : credit - debit;
    } else if ((fromTs === null || t >= fromTs) && (toTs === null || t <= toTs)) {
      debitTotal += debit;
      creditTotal += credit;
    }
  }

  const periodActivity = entityType === 'CUSTOMER'
    ? debitTotal - creditTotal
    : creditTotal - debitTotal;
  const closingBalance = openingBalance + periodActivity;

  return {
    openingBalance,
    closingBalance,
    periodActivity,
    debitTotal,
    creditTotal,
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
  };
}

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
    || FORWARDER_EXPENSE_TYPE_DEFAULTS[expenseType]?.billingLabel
    || expenseType
  );
}

function isLegacyServiceFeeRevenueRow(row: LedgerRow): boolean {
  if (row.txnType !== TxnType.TRIP_REVENUE || !row.note) return false;
  return row.note.includes('Tạm ứng/nộp hộ') || row.note.includes('Phí chi hộ');
}

const VENDOR_TXN_LABELS: Record<string, string> = {
  VENDOR_EXPENSE: 'Ghi nhận chi phí',
  VENDOR_PAYMENT: 'Thanh toán công nợ',
  FUEL_EXPENSE: 'Chi phí nhiên liệu',
  COMMISSION: 'Hoa hồng',
  EXTERNAL_CARRIER_COST: 'Cước thuê ngoài',
  ADJUSTMENT: 'Điều chỉnh',
  UNLOCK_REVERSAL: 'Hoàn tác khóa chuyến',
};

const SHARED_CSS = `body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1f2937; max-width: 900px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 13px; margin-bottom: 16px; }
  .total { font-size: 16px; font-weight: 700; color: #111827; margin: 12px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12.5px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { background: #f3f4f6; font-weight: 700; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .aging { width: auto; margin-top: 8px; }
  .aging td { padding: 4px 12px 4px 0; }
  @media print { body { margin: 0; } }`;

export async function getStatementData(customerId: number, dateFrom?: string, dateTo?: string): Promise<CustomerStatementData | null> {
  const [customer] = await db.select().from(s.customers).where(eq(s.customers.id, customerId)).limit(1);
  if (!customer) return null;

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
    const fromTs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
    const toTs = dateTo ? new Date(dateTo + 'T23:59:59.999').getTime() : null;
    ledgerRows = ledgerRows.filter((r) => {
      const t = new Date(r.timestamp).getTime();
      if (fromTs !== null && t < fromTs) return false;
      if (toTs !== null && t > toTs) return false;
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

  const now = new Date();
  const { aging, openInvoices } = computeFifoAging(
    enrichedLedgerRows.map((r) => ({
      timestamp: r.timestamp.toISOString(),
      debit: r.debit ?? '0',
      credit: r.credit ?? '0',
    })),
    now,
  );

  const totalOutstanding = aging.current + aging.d30 + aging.d60 + aging.over90;

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

  const tsToTripId = new Map<string, number>();
  for (const entry of revenueEntries) {
    if (entry.txnId && entry.timestamp) {
      tsToTripId.set(new Date(entry.timestamp).toISOString(), entry.txnId);
    }
  }

  const tripOutstanding = new Map<number, {
    tripId: number;
    date: string;
    issueTimestamp: string;
    outstanding: number;
    note: string;
    originalDueDate: string | null;
    processingDueDate: string | null;
  }>();
  for (const inv of openInvoices) {
    if (inv.open <= 0) continue;
    const tsRaw: unknown = inv.ts;
    if (tsRaw == null) continue;
    const tsKey = tsRaw instanceof Date ? tsRaw.toISOString() : String(tsRaw);
    const tripId = tsToTripId.get(tsKey) ?? 0;
    if (!tripId) continue;
    const existing = tripOutstanding.get(tripId);
    if (existing) {
      existing.outstanding += inv.open;
    } else {
      tripOutstanding.set(tripId, {
        tripId,
        date: tsKey.slice(0, 10),
        issueTimestamp: tsKey,
        outstanding: inv.open,
        note: tripNotes.get(tripId) || '',
        originalDueDate: revenueAuthorityByTrip.get(tripId)?.originalDueDate ?? null,
        processingDueDate: revenueAuthorityByTrip.get(tripId)?.processingDueDate ?? null,
      });
    }
  }

  const unpaidTrips = Array.from(tripOutstanding.values()).map((item) => ({
    ...item,
    dueDateAdjusted: item.originalDueDate != null
      && item.processingDueDate != null
      && item.originalDueDate !== item.processingDueDate,
  }));
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
    customer: { id: customer.id, name: customer.name, contactInfo: customer.contactInfo, debitNoteMode: customer.debitNoteMode ?? 'MONTHLY', isCarrier: customer.isCarrier },
    ledgerRows: enrichedLedgerRows,
    totalOutstanding,
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

export async function getSupplierStatement(supplierId: number, dateFrom?: string, dateTo?: string): Promise<SupplierStatementData> {
  const [supplier] = await db.select({
    id: s.suppliers.id,
    name: s.suppliers.name,
    phone: s.suppliers.phone,
    contactPerson: s.suppliers.contactPerson,
  }).from(s.suppliers).where(eq(s.suppliers.id, supplierId)).limit(1);

  if (!supplier) throw new ApiError(404, 'Không tìm thấy nhà cung cấp');

  let ledgerRows: EnrichedLedgerRow[] = await LedgerService.getEntriesByEntity('VENDOR', supplierId);
  const periodSummary = computePeriodSummary(ledgerRows, dateFrom, dateTo, 'VENDOR');
  if (dateFrom || dateTo) {
    const fromTs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
    const toTs = dateTo ? new Date(dateTo + 'T23:59:59.999').getTime() : null;
    ledgerRows = ledgerRows.filter((r) => {
      const t = new Date(r.timestamp).getTime();
      if (fromTs !== null && t < fromTs) return false;
      if (toTs !== null && t > toTs) return false;
      return true;
    });
  }

  // Fuel expenses point at a trip internally. Resolve the immutable trip fuel
  // snapshot and vehicle context so the statement can be audited operationally
  // without exposing the internal txnId.
  const fuelTripIds = Array.from(new Set(
    ledgerRows
      .filter((row) => row.txnType === TxnType.FUEL_EXPENSE && row.txnId)
      .map((row) => row.txnId as number),
  ));
  if (fuelTripIds.length > 0) {
    const tripRows = await db.select({
      id: s.trips.id,
      tripCode: s.trips.tripCode,
      departureDate: s.trips.departureDate,
      truckPlate: s.trucks.licensePlate,
      routeName: s.routes.name,
      fuelLiters: s.trips.fuelLiters,
      fuelActualUnitPrice: s.trips.fuelActualUnitPrice,
      fuelPriceApplied: s.trips.fuelPriceApplied,
      totalFuelCost: s.trips.totalFuelCost,
    })
      .from(s.trips)
      .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
      .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
      .where(inArray(s.trips.id, fuelTripIds));
    ledgerRows = attachFuelDetailsToLedgerRows(ledgerRows, tripRows);
  }

  if (ledgerRows.some(row => row.txnType === TxnType.VENDOR_EXPENSE)) {
    const expenseLedgerRows = ledgerRows.filter(row => row.txnType === TxnType.VENDOR_EXPENSE);
    const linkedExpenseIds = Array.from(new Set(
      expenseLedgerRows.flatMap(row => row.txnId ? [row.txnId] : []),
    ));
    const legacyTimestamps = expenseLedgerRows
      .filter(row => !row.txnId)
      .map(row => new Date(row.timestamp).getTime())
      .filter(Number.isFinite);
    const candidateScopes = [];
    if (linkedExpenseIds.length > 0) {
      candidateScopes.push(inArray(s.expenses.id, linkedExpenseIds));
    }
    if (legacyTimestamps.length > 0) {
      const minTimestamp = new Date(Math.min(...legacyTimestamps) - 999);
      const maxTimestamp = new Date(Math.max(...legacyTimestamps) + 999);
      candidateScopes.push(and(
        gte(s.expenses.createdAt, minTimestamp),
        lte(s.expenses.createdAt, maxTimestamp),
      ));
    }
    const expenseRows = await db.select({
      id: s.expenses.id,
      supplierId: s.expenses.supplierId,
      expenseDate: s.expenses.expenseDate,
      vehiclePlate: sql<string | null>`coalesce(${s.trucks.licensePlate}, ${s.trailers.licensePlate})`,
      vehicleComponent: s.expenses.vehicleComponent,
      categoryName: s.expenseCategories.name,
      amount: s.expenses.amount,
      createdAt: s.expenses.createdAt,
    })
      .from(s.expenses)
      .innerJoin(s.expenseCategories, eq(s.expenses.categoryId, s.expenseCategories.id))
      .leftJoin(
        s.trucks,
        and(eq(s.expenses.truckId, s.trucks.id), eq(s.expenses.vehicleComponent, 'TRUCK')),
      )
      .leftJoin(
        s.trailers,
        and(eq(s.expenses.truckId, s.trailers.id), eq(s.expenses.vehicleComponent, 'TRAILER')),
      )
      .where(and(
        eq(s.expenses.supplierId, supplierId),
        or(...candidateScopes),
      ));
    ledgerRows = attachSupplierExpenseDetailsToLedgerRows(ledgerRows, expenseRows);
  }

  const now = new Date();
  const { aging } = computeFifoAging(
    ledgerRows.map((r) => ({
      timestamp: r.timestamp.toISOString(),
      debit: r.credit ?? '0',
      credit: r.debit ?? '0',
    })),
    now,
  );

  const totalOutstanding = aging.current + aging.d30 + aging.d60 + aging.over90;

  return {
    supplier,
    ledgerRows,
    totalOutstanding,
    agingBuckets: [
      { range: '0-30 ngày', amount: aging.current },
      { range: '31-60 ngày', amount: aging.d30 },
      { range: '61-90 ngày', amount: aging.d60 },
      { range: 'Trên 90 ngày', amount: aging.over90 },
    ],
    ...(periodSummary ? { periodSummary } : null),
  };
}

export async function getCarrierPayableStatement(
  carrierId: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<SupplierStatementData> {
  const [carrier] = await db.select({
    id: s.customers.id,
    name: s.customers.name,
    phone: s.customers.phone,
    contactPerson: s.customers.contactInfo,
  }).from(s.customers).where(eq(s.customers.id, carrierId)).limit(1);

  if (!carrier) throw new ApiError(404, 'Không tìm thấy nhà vận chuyển');

  const historicalRows = await LedgerService.getEntriesByEntity('CUSTOMER', carrierId);
  const currentRows = await LedgerService.getEntriesByEntity('CARRIER', carrierId);
  let ledgerRows: EnrichedLedgerRow[] = [...historicalRows, ...currentRows]
    .filter(row =>
      row.txnType === TxnType.EXTERNAL_CARRIER_COST
      || row.txnType === TxnType.VENDOR_PAYMENT
      || (
        row.txnType === TxnType.UNLOCK_REVERSAL
        && row.note?.startsWith('Cước thuê ngoài')
      )
    );

  const tripIds = Array.from(new Set(
    ledgerRows
      .filter(row => row.txnType === TxnType.EXTERNAL_CARRIER_COST && row.txnId)
      .map(row => row.txnId as number),
  ));
  const tripById = new Map<number, { tripCode: string | null; routeName: string | null }>();
  if (tripIds.length > 0) {
    const tripRows = await db.select({
      id: s.trips.id,
      tripCode: s.trips.tripCode,
      routeName: s.routes.name,
    }).from(s.trips)
      .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
      .where(inArray(s.trips.id, tripIds));
    for (const trip of tripRows) tripById.set(trip.id, trip);
  }

  ledgerRows = withPayableProjectionBalances(ledgerRows).map(row => {
    const trip = row.txnId ? tripById.get(row.txnId) : undefined;
    return {
      ...row,
      tripId: trip ? row.txnId : null,
      tripCode: trip?.tripCode ?? null,
      routeName: trip?.routeName ?? null,
    };
  });

  const periodSummary = computePeriodSummary(ledgerRows, dateFrom, dateTo, 'VENDOR');
  const allRows = ledgerRows;
  if (dateFrom || dateTo) {
    const fromTs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
    const toTs = dateTo ? new Date(dateTo + 'T23:59:59.999').getTime() : null;
    ledgerRows = ledgerRows.filter(row => {
      const timestamp = new Date(row.timestamp).getTime();
      return (fromTs === null || timestamp >= fromTs) && (toTs === null || timestamp <= toTs);
    });
  }

  const { aging } = computeFifoAging(
    allRows.map(row => ({
      timestamp: row.timestamp.toISOString(),
      debit: row.credit ?? '0',
      credit: row.debit ?? '0',
    })),
    new Date(),
  );
  const totalOutstanding = aging.current + aging.d30 + aging.d60 + aging.over90;

  return {
    supplier: carrier,
    ledgerRows,
    totalOutstanding,
    agingBuckets: [
      { range: '0-30 ngày', amount: aging.current },
      { range: '31-60 ngày', amount: aging.d30 },
      { range: '61-90 ngày', amount: aging.d60 },
      { range: 'Trên 90 ngày', amount: aging.over90 },
    ],
    ...(periodSummary ? { periodSummary } : null),
  };
}

export async function exportSupplierStatementXlsx(
  data: SupplierStatementData,
  dateStr: string,
  writable: import('stream').Writable,
): Promise<void> {
  return buildStatementXlsx({
    heading: 'Sao kê công nợ nhà cung cấp',
    sheetName: 'Sao kê công nợ NCC',
    entityLabel: 'Nhà cung cấp',
    entityName: data.supplier.name,
    contactLines: [
      `Liên hệ: ${data.supplier.phone || '—'}`,
      `Người liên hệ: ${data.supplier.contactPerson || '—'}`,
    ],
    txnLabels: VENDOR_TXN_LABELS,
    ledgerRows: data.ledgerRows,
    totalOutstanding: data.totalOutstanding,
    agingBuckets: data.agingBuckets,
  }, dateStr, writable);
}

export async function exportSupplierStatementHtml(
  data: SupplierStatementData,
  dateStr: string,
): Promise<string> {
  return buildStatementHtml({
    heading: 'Sao kê công nợ nhà cung cấp',
    entityLabel: 'Nhà cung cấp',
    entityName: data.supplier.name,
    contactLines: [
      `Liên hệ: ${data.supplier.phone || '—'}`,
      `Người liên hệ: ${data.supplier.contactPerson || '—'}`,
    ],
    txnLabels: VENDOR_TXN_LABELS,
    ledgerRows: data.ledgerRows,
    totalOutstanding: data.totalOutstanding,
    agingBuckets: data.agingBuckets,
  }, dateStr);
}

async function buildStatementXlsx(config: StatementExportConfig, dateStr: string, writable: import('stream').Writable): Promise<void> {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(config.sheetName);

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
  titleCell.value = config.heading.toUpperCase();
  titleCell.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00702F' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(titleRow).height = 36;

  // Partner Info
  const partnerRow = titleRow + 2;
  sheet.getCell(partnerRow, 1).value = `${config.entityLabel}:`;
  sheet.getCell(partnerRow, 1).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF374151' } };
  sheet.getCell(partnerRow, 2).value = config.entityName;
  sheet.getCell(partnerRow, 2).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF111827' } };
  sheet.mergeCells(partnerRow, 2, partnerRow, 8);
  sheet.getRow(partnerRow).height = 20;

  // Contact Info
  let currentOffset = partnerRow + 1;
  config.contactLines.forEach((line) => {
    sheet.getCell(`A${currentOffset}`).value = line;
    sheet.getCell(`A${currentOffset}`).font = { name: 'Segoe UI', size: 10, color: { argb: 'FF4B5563' } };
    sheet.mergeCells(`A${currentOffset}:H${currentOffset}`);
    sheet.getRow(currentOffset).height = 18;
    currentOffset++;
  });

  // Export date
  sheet.getCell(`A${currentOffset}`).value = `Ngày xuất: ${dateStr}`;
  sheet.getCell(`A${currentOffset}`).font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(`A${currentOffset}:H${currentOffset}`);
  sheet.getRow(currentOffset).height = 18;
  currentOffset++;

  // Total Outstanding Row
  const outstandingRow = currentOffset;
  sheet.getCell(`A${outstandingRow}`).value = 'TỔNG CỘNG NỢ HIỆN TẠI:';
  sheet.getCell(`A${outstandingRow}`).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFDC2626' } };
  sheet.mergeCells(`A${outstandingRow}:D${outstandingRow}`);

  sheet.getCell(`E${outstandingRow}`).value = config.totalOutstanding;
  sheet.getCell(`E${outstandingRow}`).font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FFDC2626' } };
  sheet.getCell(`E${outstandingRow}`).numFmt = '#,##0" đ"';
  sheet.mergeCells(`E${outstandingRow}:H${outstandingRow}`);
  sheet.getRow(outstandingRow).height = 22;
  currentOffset++;

  // Space
  currentOffset++;

  // Aging header row
  const agingHeaderRow = currentOffset;
  sheet.mergeCells(`A${agingHeaderRow}:H${agingHeaderRow}`);
  const agingHeaderCell = sheet.getCell(`A${agingHeaderRow}`);
  agingHeaderCell.value = 'PHÂN TÍCH TUỔI NỢ';
  agingHeaderCell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF00702F' } };
  agingHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' } };
  agingHeaderCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(agingHeaderRow).height = 24;
  currentOffset++;

  // Aging columns: horizontal grid
  const agingLabelRow = currentOffset;
  const agingValueRow = agingLabelRow + 1;

  config.agingBuckets.forEach((b, i) => {
    const colIdx = i + 1; // A, B, C, D
    const labelCell = sheet.getCell(agingLabelRow, colIdx);
    labelCell.value = b.range;
    labelCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF374151' } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'center' };
    labelCell.border = borderStyle;

    const valCell = sheet.getCell(agingValueRow, colIdx);
    valCell.value = b.amount;
    valCell.font = { name: 'Segoe UI', size: 10, color: b.amount > 0 ? { argb: 'FFDC2626' } : { argb: 'FF9CA3AF' } };
    valCell.numFmt = '#,##0';
    valCell.alignment = { vertical: 'middle', horizontal: 'center' };
    valCell.border = borderStyle;
  });

  // Aging Total Column (Columns 5 to 8 merged)
  const totalLabelCell = sheet.getCell(agingLabelRow, 5);
  totalLabelCell.value = 'Tổng cộng';
  totalLabelCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  totalLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00702F' } };
  totalLabelCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.mergeCells(agingLabelRow, 5, agingLabelRow, 8);
  for (let c = 5; c <= 8; c++) {
    sheet.getCell(agingLabelRow, c).border = borderStyle;
  }

  const totalValueCell = sheet.getCell(agingValueRow, 5);
  totalValueCell.value = config.totalOutstanding;
  totalValueCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF00702F' } };
  totalValueCell.numFmt = '#,##0';
  totalValueCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.mergeCells(agingValueRow, 5, agingValueRow, 8);
  for (let c = 5; c <= 8; c++) {
    sheet.getCell(agingValueRow, c).border = borderStyle;
  }

  sheet.getRow(agingLabelRow).height = 20;
  sheet.getRow(agingValueRow).height = 20;
  currentOffset += 2;

  // Space
  currentOffset++;

  if (config.unpaidTrips && config.unpaidTrips.length > 0) {
    sheet.mergeCells(currentOffset, 1, currentOffset, 8);
    const dueHeader = sheet.getCell(currentOffset, 1);
    dueHeader.value = 'HẠN THANH TOÁN CÁC KHOẢN CHƯA THU';
    dueHeader.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF00702F' } };
    dueHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' } };
    currentOffset++;

    const dueHeaders = ['Chuyến', 'Ngày phát sinh', 'Hạn hợp đồng', 'Ngày xử lý', 'Còn phải thu'];
    dueHeaders.forEach((label, index) => {
      const cell = sheet.getCell(currentOffset, index + 1);
      cell.value = label;
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF374151' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      cell.border = borderStyle;
    });
    currentOffset++;

    for (const item of config.unpaidTrips) {
      const values = [
        `#${item.tripId}`,
        item.date,
        item.originalDueDate ?? 'Chưa có dữ liệu lịch sử',
        item.processingDueDate ?? 'Chưa có dữ liệu lịch sử',
        item.outstanding,
      ];
      values.forEach((value, index) => {
        const cell = sheet.getCell(currentOffset, index + 1);
        cell.value = value;
        cell.border = borderStyle;
        if (index === 4) cell.numFmt = '#,##0';
      });
      currentOffset++;
    }
    currentOffset++;
  }

  // Transaction Detail Header (Row 13+)
  const transHeaderRow = currentOffset;
  sheet.mergeCells(`A${transHeaderRow}:H${transHeaderRow}`);
  const transHeaderCell = sheet.getCell(`A${transHeaderRow}`);
  transHeaderCell.value = 'CHI TIẾT CÁC GIAO DỊCH';
  transHeaderCell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  transHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00702F' } };
  transHeaderCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(transHeaderRow).height = 24;
  currentOffset++;

  // Table header row
  const tableHeaderRow = currentOffset;
  const headers = ['Ngày', 'Tuyến đường', 'Số Container', 'Loại giao dịch', 'Nợ (VND)', 'Có (VND)', 'Số dư (VND)', 'Ghi chú'];
  headers.forEach((h, i) => {
    const cell = sheet.getCell(tableHeaderRow, i + 1);
    cell.value = h;
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF374151' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: i === 0 ? 'center' : (i >= 4 && i <= 6 ? 'right' : 'left'),
    };
    cell.border = borderStyle;
  });
  sheet.getRow(tableHeaderRow).height = 22;
  currentOffset++;

  // Populate data rows
  config.ledgerRows.forEach((row, i: number) => {
    const r = tableHeaderRow + 1 + i;
    const debit = parseFloat(row.debit || '0');
    const credit = parseFloat(row.credit || '0');
    const balance = parseFloat(row.balance || '0');

    const dateCell = sheet.getCell(r, 1);
    dateCell.value = row.timestamp ? new Date(row.timestamp).toISOString().slice(0, 10) : '';
    dateCell.alignment = { vertical: 'middle', horizontal: 'center' };

    const routeCell = sheet.getCell(r, 2);
    routeCell.value = row.routeName || '—';
    routeCell.alignment = { vertical: 'middle', horizontal: 'left' };

    const contCell = sheet.getCell(r, 3);
    contCell.value = row.containerNumbers && row.containerNumbers.length > 0
      ? row.containerNumbers.join(', ')
      : '—';
    contCell.alignment = { vertical: 'middle', horizontal: 'left' };

    const typeCell = sheet.getCell(r, 4);
    typeCell.value = config.txnLabels[row.txnType] || 'Khác';
    typeCell.alignment = { vertical: 'middle', horizontal: 'left' };

    const debitCell = sheet.getCell(r, 5);
    debitCell.value = debit || '';
    debitCell.numFmt = '#,##0';
    debitCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const creditCell = sheet.getCell(r, 6);
    creditCell.value = credit || '';
    creditCell.numFmt = '#,##0';
    creditCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const balCell = sheet.getCell(r, 7);
    balCell.value = balance;
    balCell.numFmt = '#,##0';
    balCell.alignment = { vertical: 'middle', horizontal: 'right' };
    balCell.font = { name: 'Segoe UI', size: 10, bold: true, color: balance > 0 ? { argb: 'FFDC2626' } : { argb: 'FF10B981' } };

    const noteCell = sheet.getCell(r, 8);
    noteCell.value = row.note || '';
    noteCell.alignment = { vertical: 'middle', horizontal: 'left' };

    // Zebra striping and standard styling
    const zebraColor = i % 2 === 0 ? 'FFFFFFFF' : 'FFF9FBF9';
    for (let c = 1; c <= 8; c++) {
      const cell = sheet.getCell(r, c);
      if (c !== 7) {
        cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF1F2937' } };
      }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebraColor } };
      cell.border = borderStyle;
    }

    sheet.getRow(r).height = 20;
  });

  // Set column widths
  sheet.getColumn(1).width = 14; // Ngày (a bit wider — header label "Ngày" + ISO dates need breathing room)
  sheet.getColumn(2).width = 28; // Tuyến đường
  sheet.getColumn(3).width = 22; // Số Container
  sheet.getColumn(4).width = 22; // Loại giao dịch
  sheet.getColumn(5).width = 16; // Nợ
  sheet.getColumn(6).width = 16; // Có
  sheet.getColumn(7).width = 18; // Số dư
  sheet.getColumn(8).width = 35; // Ghi chú

  await workbook.xlsx.write(writable);
}

async function buildStatementHtml(config: StatementExportConfig, dateStr: string): Promise<string> {
  const company = await getCompanyInfo();
  const logoDataUrl = await loadLogoDataUrl(company.logoStorageKey);
  const header = companyHeaderHtml(company, logoDataUrl);
  const rows = config.ledgerRows.map((row) => {
    const debit = parseFloat(row.debit || '0');
    const credit = parseFloat(row.credit || '0');
    const balance = parseFloat(row.balance || '0');
    const date = row.timestamp ? new Date(row.timestamp).toISOString().slice(0, 10) : '';
    const routeName = row.routeName || '—';
    const containerNumbers = row.containerNumbers && row.containerNumbers.length > 0
      ? row.containerNumbers.join(', ')
      : '—';
    return `<tr>
      <td>${date}</td>
      <td>${escapeHtml(routeName)}</td>
      <td>${escapeHtml(containerNumbers)}</td>
      <td>${escapeHtml(config.txnLabels[row.txnType] || 'Khác')}</td>
      <td class="num">${debit ? debit.toLocaleString('vi-VN') : ''}</td>
      <td class="num">${credit ? credit.toLocaleString('vi-VN') : ''}</td>
      <td class="num">${balance.toLocaleString('vi-VN')}</td>
      <td>${escapeHtml(row.note || '')}</td>
    </tr>`;
  }).join('');

  const agingRows = config.agingBuckets.map(b =>
    `<tr><td>${b.range}</td><td class="num">${b.amount.toLocaleString('vi-VN')} ₫</td></tr>`
  ).join('');

  const contactHtml = config.contactLines.map(l => escapeHtml(l)).join('<br>\n  ');
  const dueDateRows = (config.unpaidTrips ?? []).map(item => `<tr>
    <td>#${item.tripId}</td>
    <td>${escapeHtml(item.date)}</td>
    <td>${escapeHtml(item.originalDueDate ?? 'Chưa có dữ liệu lịch sử')}</td>
    <td>${escapeHtml(item.processingDueDate ?? 'Chưa có dữ liệu lịch sử')}</td>
    <td class="num">${item.outstanding.toLocaleString('vi-VN')} ₫</td>
  </tr>`).join('');
  const dueDateTable = dueDateRows
    ? `<h2>Hạn thanh toán các khoản chưa thu</h2>
<table>
  <thead><tr><th>Chuyến</th><th>Ngày phát sinh</th><th>Hạn hợp đồng</th><th>Ngày xử lý</th><th class="num">Còn phải thu</th></tr></thead>
  <tbody>${dueDateRows}</tbody>
</table>`
    : '';

  return `<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8">
<title>${escapeHtml(config.heading)} — ${escapeHtml(config.entityName)}</title>
<style>
  ${SHARED_CSS}
</style>
</head><body>
${header}
<h1>${escapeHtml(config.heading)}</h1>
<div class="meta">
  ${config.entityLabel}: <strong>${escapeHtml(config.entityName)}</strong><br>
  ${contactHtml}<br>
  Ngày xuất: ${dateStr}
</div>
<div class="total">Tổng nợ: ${config.totalOutstanding.toLocaleString('vi-VN')} ₫</div>
<table class="aging">${agingRows}</table>
${dueDateTable}
<table>
  <thead><tr><th>Ngày</th><th>Tuyến</th><th>Số Cont</th><th>Loại GD</th><th class="num">Nợ</th><th class="num">Có</th><th class="num">Số dư</th><th>Ghi chú</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
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

// escapeHtml imported from lib/format
