// Supplier (AP) and carrier-payable statement assembly: ledger enrichment with
// fuel/expense operational context, FIFO aging, and the XLSX/HTML export
// wrappers. Extracted from statement.service.ts verbatim (pure code movement);
// rendering lives in statement-export-render.
import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { TxnType, computeFifoAging } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import { resolveVietnamAsOfCutoff } from './customer-receivable-authority.service';
import {
  type EnrichedLedgerRow,
  type SupplierStatementData,
  withPayableProjectionBalances,
  attachFuelDetailsToLedgerRows,
  attachSupplierExpenseDetailsToLedgerRows,
  computePeriodSummary,
  statementPeriodBounds,
} from './statement-shared.service';
import { buildStatementXlsx, buildStatementHtml } from './statement-export-render.service';

const VENDOR_TXN_LABELS: Record<string, string> = {
  VENDOR_EXPENSE: 'Ghi nhận chi phí',
  VENDOR_PAYMENT: 'Thanh toán công nợ',
  FUEL_EXPENSE: 'Chi phí nhiên liệu',
  COMMISSION: 'Hoa hồng',
  EXTERNAL_CARRIER_COST: 'Cước thuê ngoài',
  ADJUSTMENT: 'Điều chỉnh',
  UNLOCK_REVERSAL: 'Hoàn tác khóa chuyến',
};
export async function getSupplierStatement(supplierId: number, dateFrom?: string, dateTo?: string): Promise<SupplierStatementData> {
  const [supplier] = await db.select({
    id: s.suppliers.id,
    name: s.suppliers.name,
    phone: s.suppliers.phone,
    contactPerson: s.suppliers.contactPerson,
  }).from(s.suppliers).where(eq(s.suppliers.id, supplierId)).limit(1);

  if (!supplier) throw new ApiError(404, 'Không tìm thấy nhà cung cấp');

  let ledgerRows: EnrichedLedgerRow[] = await LedgerService.getEntriesByEntity('VENDOR', supplierId);
  const agingRows = dateTo
    ? ledgerRows.filter(row => row.timestamp.getTime() < resolveVietnamAsOfCutoff(dateTo).endExclusive.getTime())
    : ledgerRows;
  const periodSummary = computePeriodSummary(ledgerRows, dateFrom, dateTo, 'VENDOR');
  if (dateFrom || dateTo) {
    const { fromInclusive: fromTs, toExclusive: toTs } = statementPeriodBounds(dateFrom, dateTo);
    ledgerRows = ledgerRows.filter((r) => {
      const t = new Date(r.timestamp).getTime();
      if (fromTs !== null && t < fromTs) return false;
      if (toTs !== null && t >= toTs) return false;
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
      fuelLiters: s.tripsComposite.fuelLiters,
      fuelActualUnitPrice: s.tripsComposite.fuelActualUnitPrice,
      fuelPriceApplied: s.tripsComposite.fuelPriceApplied,
      totalFuelCost: s.tripsComposite.totalFuelCost,
    })
      .from(s.tripsComposite)
      .leftJoin(s.trucks, eq(s.tripsComposite.truckId, s.trucks.id))
      .leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
      .where(inArray(s.tripsComposite.id, fuelTripIds));
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

  const now = dateTo ? resolveVietnamAsOfCutoff(dateTo).referenceDate : new Date();
  const { aging } = computeFifoAging(
    agingRows.map((r) => ({
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
  const allRows = dateTo
    ? ledgerRows.filter(row => row.timestamp.getTime() < resolveVietnamAsOfCutoff(dateTo).endExclusive.getTime())
    : ledgerRows;
  if (dateFrom || dateTo) {
    const { fromInclusive: fromTs, toExclusive: toTs } = statementPeriodBounds(dateFrom, dateTo);
    ledgerRows = ledgerRows.filter(row => {
      const timestamp = new Date(row.timestamp).getTime();
      return (fromTs === null || timestamp >= fromTs) && (toTs === null || timestamp < toTs);
    });
  }

  const { aging } = computeFifoAging(
    allRows.map(row => ({
      timestamp: row.timestamp.toISOString(),
      debit: row.credit ?? '0',
      credit: row.debit ?? '0',
    })),
    dateTo ? resolveVietnamAsOfCutoff(dateTo).referenceDate : new Date(),
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
