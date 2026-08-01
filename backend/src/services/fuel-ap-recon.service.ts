/**
 * Wave 3 M6.1 (slice 1) — Fuel-AP reconciliation report.
 *
 * Compares the COMPUTED fuel payable (auto-posted to each fuel supplier's
 * VENDOR ledger when trips lock — sum of trips.totalFuelCost) against the
 * INVOICED fuel cost (sum of trip_expenses rows where the expenseType
 * indicates fuel and the supplier matches). Per-(supplier × truck × period)
 * variance flags surprises so accountants can request explanations before
 * approving the supplier's invoice.
 *
 * Status flag:
 *   - 'OK'       — |variancePct| ≤ threshold (default 5%) OR both sides zero
 *   - 'VARIANCE' — |variancePct| > threshold, or expected=0 but invoiced>0
 *
 * The follow-up approval-block slice (M6.1 slice 2) will call this service
 * from the expense-approval flow and reject the approval when status='VARIANCE'
 * without a recorded explanation.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { TripStatus } from '@tingting/shared';
import { tripCompletionBusinessDateSql } from './reporting-shared';
import { listFuelInvoices } from './fuel-invoice.service';

export type ReconStatus = 'OK' | 'VARIANCE';

export interface TruckReconRow {
  truckId: number | null;
  truckPlate: string | null;
  tripCount: number;
  expectedFuelCost: number;
  invoicedFuelCost: number;
  variance: number;
  variancePct: number | null;
  status: ReconStatus;
}

export interface SupplierReconRow {
  supplierId: number;
  supplierName: string;
  expectedFuelCost: number;
  invoicedFuelCost: number;
  variance: number;
  variancePct: number | null;
  status: ReconStatus;
  perTruck: TruckReconRow[];
}

export interface FuelApReconReport {
  from: string;
  to: string;
  thresholdPct: number;
  suppliers: SupplierReconRow[];
  totals: {
    expectedFuelCost: number;
    invoicedFuelCost: number;
    variance: number;
  };
}

export interface FuelApReconInput {
  from: string;            // ISO date (YYYY-MM-DD)
  to: string;              // ISO date (YYYY-MM-DD)
  supplierId?: number | null; // optional filter
  thresholdPct?: number;   // default 0.05 (5%)
}

/**
 * Build the reconciliation report. Two-pass:
 *   1. Aggregate expected (computed trip fuel) per (supplier, truck).
 *   2. Aggregate invoiced (trip_expenses fuel rows) per supplier.
 *   3. Outer-join the two on supplierId, compute variance, attach per-truck.
 */
export async function getFuelApReconciliation(input: FuelApReconInput): Promise<FuelApReconReport> {
  const thresholdPct = input.thresholdPct ?? 0.05;
  const completionBusinessDate = tripCompletionBusinessDateSql();
  const approvedSettlementAdjustedBuyAmount = sql<string | null>`(
    SELECT se.adjusted_buy_amount::text
    FROM ${s.settlementExpenses} se
    INNER JOIN ${s.advanceSettlements} aset ON aset.id = se.settlement_id
    WHERE se.trip_expense_id = ${s.tripExpenses.id}
      AND aset.status = 'APPROVED'
    ORDER BY coalesce(aset.approved_at, aset.updated_at) DESC, se.id DESC
    LIMIT 1
  )`;

  // ── Pass 1: expected fuel cost per (supplier, truck) ─────────────────
  // Trips that locked their fuel cost onto a supplier's VENDOR ledger.
  // In-progress trips stay out of the official monthly fuel cohort.
  const expectedRows = await db.select({
    supplierId: s.trips.fuelSupplierId,
    truckId: s.trips.truckId,
    truckPlate: s.trucks.licensePlate,
    tripCount: sql<number>`count(*)::int`,
    expectedFuelCost: sql<string>`coalesce(sum(${s.trips.totalFuelCost}), 0)`,
  })
    .from(s.trips)
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .where(and(
      sql`${s.trips.fuelSupplierId} IS NOT NULL`,
      sql`${s.trips.completedAt} is not null`,
      inArray(s.trips.status, [TripStatus.COMPLETED, TripStatus.LOCKED]),
      gte(completionBusinessDate, input.from),
      lte(completionBusinessDate, input.to),
      isNull(s.trips.deletedAt),
      input.supplierId ? eq(s.trips.fuelSupplierId, input.supplierId) : sql`TRUE`,
    ))
    .groupBy(s.trips.fuelSupplierId, s.trips.truckId, s.trucks.licensePlate);

  // expectedBySupplier: supplierId → { total, perTruck: Map<truckId, row> }
  const expectedBySupplier = new Map<number, { total: number; perTruck: Map<number | null, TruckReconRow> }>();
  for (const r of expectedRows) {
    const sid = r.supplierId as number;
    if (!expectedBySupplier.has(sid)) {
      expectedBySupplier.set(sid, { total: 0, perTruck: new Map() });
    }
    const entry = expectedBySupplier.get(sid)!;
    const cost = Number(r.expectedFuelCost);
    entry.total += cost;
    entry.perTruck.set(r.truckId, {
      truckId: r.truckId,
      truckPlate: r.truckPlate,
      tripCount: Number(r.tripCount),
      expectedFuelCost: cost,
      invoicedFuelCost: 0, // filled in pass 2 if a matching expense exists
      variance: 0,
      variancePct: null,
      status: 'OK',
    });
  }

  // ── Pass 2a: approved fuel-invoice allocations per (supplier, truck) ──
  // This is the accepted Q06 model: one invoice header, many truck lines,
  // each line backed by actual voucher/log litres and priced at the invoice
  // unit price. Only APPROVED headers contribute to invoiced totals.
  const effectiveApprovedInvoices = [];
  let fuelInvoiceCursor: string | undefined;
  do {
    const page = await listFuelInvoices({
      status: 'APPROVED',
      limit: 100,
      cursor: fuelInvoiceCursor,
    });
    effectiveApprovedInvoices.push(...page.items);
    fuelInvoiceCursor = page.nextCursor ?? undefined;
  } while (fuelInvoiceCursor);
  const effectiveApprovedInvoicesInRange = effectiveApprovedInvoices
    .filter((invoice) =>
      invoice.invoiceDate >= input.from
      && invoice.invoiceDate <= input.to
      && (input.supplierId == null || invoice.supplierId === input.supplierId),
    );
  const approvedInvoiceBySupplierTruck = new Map<string, {
    supplierId: number;
    truckId: number | null;
    invoicedFuelCost: number;
  }>();
  for (const invoice of effectiveApprovedInvoicesInRange) {
    for (const allocation of invoice.allocations) {
      const truckId = allocation.truckId ?? null;
      const key = `${invoice.supplierId}:${truckId ?? 'none'}`;
      const current = approvedInvoiceBySupplierTruck.get(key);
      approvedInvoiceBySupplierTruck.set(key, {
        supplierId: invoice.supplierId,
        truckId,
        invoicedFuelCost: (current?.invoicedFuelCost ?? 0) + Number(allocation.amount),
      });
    }
  }
  const approvedInvoiceRows = [...approvedInvoiceBySupplierTruck.values()];

  // ── Pass 2b: legacy one-trip fuel expenses not yet linked to an invoice ──
  // Keep the existing single-trip rows in the report until they are backfilled
  // into fuel_invoice_allocations. Once a trip_expense is linked to an
  // allocation, only the approved invoice header counts to avoid double totals.
  const legacyExpenseRows = await db.select({
    supplierId: s.tripExpenses.supplierId,
    truckId: s.trips.truckId,
    invoicedFuelCost: sql<string>`coalesce(sum(coalesce(${approvedSettlementAdjustedBuyAmount}::numeric, ${s.tripExpenses.buyAmount})), 0)`,
  })
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .leftJoin(s.fuelInvoiceAllocations, eq(s.fuelInvoiceAllocations.tripExpenseId, s.tripExpenses.id))
    .where(and(
      sql`${s.tripExpenses.supplierId} IS NOT NULL`,
      sql`${s.fuelInvoiceAllocations.id} IS NULL`,
      sql`lower(${s.tripExpenses.expenseType}) LIKE '%fuel%'`,
      eq(s.tripExpenses.approvalStatus, 'APPROVED'),
      or(
        and(
          sql`${s.tripExpenses.invoiceDate} IS NOT NULL`,
          gte(s.tripExpenses.invoiceDate, input.from),
          lte(s.tripExpenses.invoiceDate, input.to),
        ),
        and(
          sql`${s.tripExpenses.invoiceDate} IS NULL`,
          gte(sql`${s.tripExpenses.createdAt}::date`, input.from),
          lte(sql`${s.tripExpenses.createdAt}::date`, input.to),
        ),
      ),
      input.supplierId ? eq(s.tripExpenses.supplierId, input.supplierId) : sql`TRUE`,
    ))
    .groupBy(s.tripExpenses.supplierId, s.trips.truckId);

  // invoicedBySupplier: supplierId → { total, perTruck: Map<truckId, amount> }
  const invoicedBySupplier = new Map<number, { total: number; perTruck: Map<number | null, number> }>();
  for (const r of [...approvedInvoiceRows, ...legacyExpenseRows]) {
    const sid = r.supplierId as number;
    if (!invoicedBySupplier.has(sid)) {
      invoicedBySupplier.set(sid, { total: 0, perTruck: new Map() });
    }
    const entry = invoicedBySupplier.get(sid)!;
    const amt = Number(r.invoicedFuelCost);
    entry.total += amt;
    entry.perTruck.set(r.truckId, (entry.perTruck.get(r.truckId) ?? 0) + amt);
  }

  // ── Pass 3: outer-join suppliers + compute variance ─────────────────
  const allSupplierIds = new Set<number>([
    ...expectedBySupplier.keys(),
    ...invoicedBySupplier.keys(),
  ]);

  // Pull supplier names in one query.
  const supplierNames = new Map<number, string>();
  if (allSupplierIds.size > 0) {
    const rows = await db.select({ id: s.suppliers.id, name: s.suppliers.name })
      .from(s.suppliers)
      .where(sql`${s.suppliers.id} IN (${sql.join([...allSupplierIds].map(id => sql`${id}`), sql`, `)})`);
    for (const r of rows) supplierNames.set(r.id, r.name);
  }

  const supplierRows: SupplierReconRow[] = [];
  let totalExpected = 0;
  let totalInvoiced = 0;

  for (const sid of [...allSupplierIds].sort((a, b) => a - b)) {
    const exp = expectedBySupplier.get(sid) ?? { total: 0, perTruck: new Map() };
    const inv = invoicedBySupplier.get(sid) ?? { total: 0, perTruck: new Map() };

    // Acceptance criterion #3: skip suppliers with no fuel activity in range
    // (zero on both sides). They appear in the GROUP BY because a trip with a
    // fuelSupplierId exists, but contribute no signal to the reconciliation.
    if (exp.total === 0 && inv.total === 0) continue;

    const variance = inv.total - exp.total;
    const variancePct = exp.total > 0 ? variance / exp.total : null;
    const status: ReconStatus = computeStatus(exp.total, inv.total, variancePct, thresholdPct);

    // Merge per-truck rows: every truck in either side appears.
    const allTruckIds = new Set<number | null>([...exp.perTruck.keys(), ...inv.perTruck.keys()]);
    const perTruck: TruckReconRow[] = [];
    for (const truckId of [...allTruckIds]) {
      const e = exp.perTruck.get(truckId) ?? {
        truckId, truckPlate: null, tripCount: 0,
        expectedFuelCost: 0, invoicedFuelCost: 0, variance: 0, variancePct: null, status: 'OK' as ReconStatus,
      };
      const invoicedForTruck = inv.perTruck.get(truckId) ?? 0;
      const tVar = invoicedForTruck - e.expectedFuelCost;
      const tPct = e.expectedFuelCost > 0 ? tVar / e.expectedFuelCost : null;
      perTruck.push({
        ...e,
        invoicedFuelCost: invoicedForTruck,
        variance: tVar,
        variancePct: tPct,
        status: computeStatus(e.expectedFuelCost, invoicedForTruck, tPct, thresholdPct),
      });
    }
    perTruck.sort((a, b) => (b.expectedFuelCost + b.invoicedFuelCost) - (a.expectedFuelCost + a.invoicedFuelCost));

    supplierRows.push({
      supplierId: sid,
      supplierName: supplierNames.get(sid) ?? 'Nhà cung cấp chưa xác định',
      expectedFuelCost: exp.total,
      invoicedFuelCost: inv.total,
      variance,
      variancePct,
      status,
      perTruck,
    });

    totalExpected += exp.total;
    totalInvoiced += inv.total;
  }

  supplierRows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  return {
    from: input.from,
    to: input.to,
    thresholdPct,
    suppliers: supplierRows,
    totals: {
      expectedFuelCost: totalExpected,
      invoicedFuelCost: totalInvoiced,
      variance: totalInvoiced - totalExpected,
    },
  };
}

/**
 * Status rule:
 *   - both sides zero       → OK
 *   - expected=0, invoiced>0 → VARIANCE (invoiced without computed basis)
 *   - |variancePct| > threshold → VARIANCE
 *   - otherwise              → OK
 */
function computeStatus(expected: number, invoiced: number, variancePct: number | null, thresholdPct: number): ReconStatus {
  if (expected === 0 && invoiced === 0) return 'OK';
  if (expected === 0 && invoiced > 0) return 'VARIANCE';
  if (variancePct === null) return 'OK';
  return Math.abs(variancePct) > thresholdPct ? 'VARIANCE' : 'OK';
}
