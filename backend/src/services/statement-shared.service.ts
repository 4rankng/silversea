// Shared statement-domain helpers: enriched-ledger row types, running-balance
// projections, fuel/expense context attachment, filename/disposition helpers,
// and the Vietnam-business-day period-bounds + AR/AP period-summary math.
// Extracted from statement.service.ts verbatim (pure code movement); the
// customer / supplier / render leaves import these one-way.
import * as s from '../db/schema';
import { TxnType } from '@tingting/shared';
import type { PeriodSummary } from '@tingting/shared';
import { resolveVietnamAsOfCutoff } from './customer-receivable-authority.service';

export type LedgerRow = typeof s.ledger.$inferSelect;
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
  customer: {
    id: number; name: string; contactInfo: string | null;
    debitNoteMode?: string | null; isCarrier?: boolean;
    /** Q01: credit limit + early-warning threshold (0–1, e.g. 0.80 = 80%). */
    creditLimit?: string | null;
    creditWarningThreshold?: string | null;
  };
  ledgerRows: EnrichedLedgerRow[];
  totalOutstanding: number;
  /** Q01: authoritative current exposure, including approved-but-uncollected commitments. */
  approvedUncollected: number;
  totalExposure: number;
  utilization: number | null;
  availableCapacity: number | null;
  unpaidTrips: Array<{
    tripId: number;
    tripCode: string | null;
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
  try {
    resolveVietnamAsOfCutoff(raw);
    return raw;
  } catch {
    return undefined;
  }
}

export function normalizeDateParam(raw: string | undefined): string | undefined {
  return parseIsoDateParam(raw);
}

/** Vietnam business-day bounds represented as UTC instants. */
export function statementPeriodBounds(dateFrom?: string, dateTo?: string): {
  fromInclusive: number | null;
  toExclusive: number | null;
} {
  const fromInclusive = dateFrom
    ? resolveVietnamAsOfCutoff(dateFrom).endExclusive.getTime() - 24 * 60 * 60 * 1000
    : null;
  const toExclusive = dateTo
    ? resolveVietnamAsOfCutoff(dateTo).endExclusive.getTime()
    : null;
  return { fromInclusive, toExclusive };
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

  const { fromInclusive: fromTs, toExclusive: toTs } = statementPeriodBounds(dateFrom, dateTo);

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
    } else if ((fromTs === null || t >= fromTs) && (toTs === null || t < toTs)) {
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
