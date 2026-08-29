// Total AR Report Service — Wave 3 M5.5.
//
// Produces a per-customer AR aging report: opening balance, period activity
// (new charges), receipts (payments received), adjustments, and closing
// balance for a date range. Also includes zero-activity customers who still
// have an outstanding balance (M5.5 §1: "zero-activity-with-balance still
// appears").
//
// The ledger aggregation runs as two grouped passes (opening + period
// activity), not 2 queries per customer — cost is O(ledger rows), independent
// of customer count.

import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, gte, lte, sql, isNull } from 'drizzle-orm';

export interface CustomerArReportItem {
  customerId: number;
  customerName: string;
  openingBalance: number;
  newCharges: number;
  receipts: number;
  adjustments: number;
  closingBalance: number;
}

export interface TotalArReport {
  asOf: string;
  rangeFrom: string;
  rangeTo: string;
  customers: CustomerArReportItem[];
  totals: {
    openingBalance: number;
    newCharges: number;
    receipts: number;
    adjustments: number;
    closingBalance: number;
  };
}

export async function getTotalArReport(
  rangeFrom: string,
  rangeTo: string,
): Promise<TotalArReport> {
  const [customerRows, openingRows, activityRows] = await Promise.all([
    db.select({ id: s.customers.id, name: s.customers.name })
      .from(s.customers)
      .where(isNull(s.customers.deletedAt)),

    // Opening = sum of all debits - credits BEFORE rangeFrom, per customer.
    db.select({
      entityId: s.ledger.entityId,
      balance: sql<string>`coalesce(sum(${s.ledger.debit} - ${s.ledger.credit}), 0)`,
    })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'CUSTOMER'),
        sql`${s.ledger.timestamp} < ${rangeFrom}::date`,
      ))
      .groupBy(s.ledger.entityId),

    // Activity within the period, per customer.
    db.select({
      entityId: s.ledger.entityId,
      newCharges: sql<string>`coalesce(sum(case when ${s.ledger.txnType} NOT IN ('PAYMENT_RECEIVED', 'ADJUSTMENT', 'UNLOCK_REVERSAL') then ${s.ledger.debit} else 0 end), 0)`,
      receipts: sql<string>`coalesce(sum(case when ${s.ledger.txnType} = 'PAYMENT_RECEIVED' then ${s.ledger.credit} else 0 end), 0)`,
      adjustments: sql<string>`coalesce(sum(case when ${s.ledger.txnType} IN ('ADJUSTMENT', 'UNLOCK_REVERSAL') then ${s.ledger.credit} - ${s.ledger.debit} else 0 end), 0)`,
    })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'CUSTOMER'),
        gte(s.ledger.timestamp, sql`${rangeFrom}::date`),
        lte(s.ledger.timestamp, sql`${rangeTo}::date`),
      ))
      .groupBy(s.ledger.entityId),
  ]);

  const openingById = new Map(openingRows.map((row) => [row.entityId, Number(row.balance)]));
  const activityById = new Map(activityRows.map((row) => [row.entityId, {
    newCharges: Number(row.newCharges),
    receipts: Number(row.receipts),
    adjustments: Number(row.adjustments),
  }]));

  const items: CustomerArReportItem[] = [];
  for (const c of customerRows) {
    const openingBalance = openingById.get(c.id) ?? 0;
    const activity = activityById.get(c.id);
    const newCharges = activity?.newCharges ?? 0;
    const receipts = activity?.receipts ?? 0;
    const adjustments = activity?.adjustments ?? 0;

    // Include if opening ≠ 0 OR any period activity.
    if (openingBalance !== 0 || newCharges !== 0 || receipts !== 0 || adjustments !== 0) {
      items.push({
        customerId: c.id,
        customerName: c.name,
        openingBalance,
        newCharges,
        receipts,
        adjustments,
        closingBalance: openingBalance + newCharges - receipts + adjustments,
      });
    }
  }

  const totals = items.reduce((acc, i) => ({
    openingBalance: acc.openingBalance + i.openingBalance,
    newCharges: acc.newCharges + i.newCharges,
    receipts: acc.receipts + i.receipts,
    adjustments: acc.adjustments + i.adjustments,
    closingBalance: acc.closingBalance + i.closingBalance,
  }), { openingBalance: 0, newCharges: 0, receipts: 0, adjustments: 0, closingBalance: 0 });

  return {
    asOf: new Date().toISOString().slice(0, 10),
    rangeFrom,
    rangeTo,
    customers: items,
    totals,
  };
}
