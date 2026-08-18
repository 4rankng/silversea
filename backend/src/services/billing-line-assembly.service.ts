// Billing Line Assembly Service — Wave 2 M3.5.
//
// Assembles billing_document_lines from three sources for a debit note:
//   1. Freight revenue: from each trip's revenue snapshot (pricingSource/formula).
//   2. Approved disbursements: from trip_expenses with approvalStatus=APPROVED
//      (using assembleDisbursementsForPeriod from the prior slice).
//   3. Ancillary revenue: from the ancillary_revenue table within the date range.
//
// Each line carries its source type (TRIP / EXPENSE / ANCILLARY / ADHOC),
// source id, base amount, and a description for the debit-note template.
// The caller (billing-document.service.ts) decides which lines to include.

import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, gte, lte, sql, isNull } from 'drizzle-orm';
import { assembleDisbursementsForPeriod } from './disbursement-assembly.service';

export interface AssembledBillingLine {
  sourceType: 'TRIP' | 'EXPENSE' | 'ANCILLARY';
  sourceId: number;
  lineType: 'FREIGHT' | 'SERVICE_FEE' | 'ANCILLARY';
  typeLabel: string;
  description: string;
  baseAmount: number;
  containerNumbers?: string | null;
  routeName?: string | null;
}

export interface AssemblyResult {
  lines: AssembledBillingLine[];
  pendingDisbursements: Array<{
    id: number; tripId: number; tripCode: string | null;
    expenseType: string; approvalStatus: string;
  }>;
  totalBase: number;
}

/**
 * Assemble billing lines for a customer's debit note covering a date range.
 * Returns freight + approved expenses + ancillary revenue, partitioned by type.
 */
export async function assembleBillingLines(
  customerId: number,
  rangeFrom: string,
  rangeTo: string,
): Promise<AssemblyResult> {
  const lines: AssembledBillingLine[] = [];

  // 1. Freight revenue from trips.
  const trips = await db.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    revenue: s.trips.revenue,
    routeName: s.routes.name,
    pricingSource: s.trips.pricingSource,
    departureDate: s.trips.departureDate,
  })
    .from(s.trips)
    .innerJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .where(and(
      eq(s.trips.customerId, customerId),
      sql`${s.trips.departureDate} >= ${rangeFrom}`,
      sql`${s.trips.departureDate} <= ${rangeTo}`,
      sql`${s.trips.status} NOT IN ('CANCELED', 'CREATED')`,
      isNull(s.trips.deletedAt),
    ));

  for (const trip of trips) {
    const freight = Number(trip.revenue ?? 0);
    if (freight > 0) {
      lines.push({
        sourceType: 'TRIP',
        sourceId: trip.id,
        lineType: 'FREIGHT',
        typeLabel: 'Cước vận chuyển',
        description: `Chuyến ${trip.tripCode} — ${trip.routeName ?? ''} (${trip.departureDate})`,
        baseAmount: freight,
        routeName: trip.routeName,
      });
    }
  }

  // 2. Approved disbursements (uses the M3.5 exclusion service).
  const disbursementResult = await assembleDisbursementsForPeriod(customerId, rangeFrom, rangeTo);
  for (const expense of disbursementResult.approved) {
    lines.push({
      sourceType: 'EXPENSE',
      sourceId: expense.id,
      lineType: 'SERVICE_FEE',
      typeLabel: 'Chi hộ / Phí dịch vụ',
      description: expense.description,
      baseAmount: Number(expense.sellAmount),
    });
  }

  // 3. Ancillary revenue.
  const ancillary = await db.select()
    .from(s.ancillaryRevenue)
    .where(and(
      eq(s.ancillaryRevenue.customerId, customerId),
      gte(s.ancillaryRevenue.date, sql`${rangeFrom}`),
      lte(s.ancillaryRevenue.date, sql`${rangeTo}`),
      isNull(s.ancillaryRevenue.deletedAt),
    ));

  for (const rev of ancillary) {
    const amount = Number(rev.amount);
    lines.push({
      sourceType: 'ANCILLARY',
      sourceId: rev.id,
      lineType: 'ANCILLARY',
      typeLabel: 'Doanh thu phi-vận-tải',
      description: `${rev.type} — ${rev.documentRef ?? 'không có mã'} (${rev.date})`,
      baseAmount: amount,
    });
  }

  // Sort by sourceType then sourceId for stable ordering.
  lines.sort((a, b) => {
    if (a.sourceType !== b.sourceType) return a.sourceType.localeCompare(b.sourceType);
    return a.sourceId - b.sourceId;
  });

  const totalBase = lines.reduce((sum, l) => sum + l.baseAmount, 0);

  return {
    lines,
    pendingDisbursements: disbursementResult.pending.map(p => ({
      id: p.id, tripId: p.tripId, tripCode: p.tripCode,
      expenseType: p.expenseType, approvalStatus: p.approvalStatus,
    })),
    totalBase,
  };
}
