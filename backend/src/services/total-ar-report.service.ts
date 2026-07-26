// Total AR Report Service — Wave 3 M5.5.
//
// Produces a per-customer AR aging report: opening balance, period activity
// (new charges), receipts (payments received), adjustments, and closing
// balance for a date range. Also includes zero-activity customers who still
// have an outstanding balance (M5.5 §1: "zero-activity-with-balance still
// appears").

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
  // Get ALL customers with any ledger activity (opening or within period).
  const customerRows = await db.select({
    id: s.customers.id,
    name: s.customers.name,
  })
    .from(s.customers)
    .where(isNull(s.customers.deletedAt));

  const items: CustomerArReportItem[] = [];

  for (const c of customerRows) {
    // Opening = sum of all debits - credits BEFORE rangeFrom.
    const [openingRow] = await db.select({
      balance: sql<string>`coalesce(sum(${s.ledger.debit} - ${s.ledger.credit}), 0)`,
    })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'CUSTOMER'),
        eq(s.ledger.entityId, c.id),
        sql`${s.ledger.timestamp} < ${rangeFrom}::date`,
      ));

    // Activity within the period.
    const [activityRow] = await db.select({
      newCharges: sql<string>`coalesce(sum(case when ${s.ledger.txnType} NOT IN ('PAYMENT_RECEIVED', 'ADJUSTMENT', 'UNLOCK_REVERSAL') then ${s.ledger.debit} else 0 end), 0)`,
      receipts: sql<string>`coalesce(sum(case when ${s.ledger.txnType} = 'PAYMENT_RECEIVED' then ${s.ledger.credit} else 0 end), 0)`,
      adjustments: sql<string>`coalesce(sum(case when ${s.ledger.txnType} IN ('ADJUSTMENT', 'UNLOCK_REVERSAL') then ${s.ledger.credit} - ${s.ledger.debit} else 0 end), 0)`,
    })
      .from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'CUSTOMER'),
        eq(s.ledger.entityId, c.id),
        gte(s.ledger.timestamp, sql`${rangeFrom}::date`),
        lte(s.ledger.timestamp, sql`${rangeTo}::date`),
      ));

    const openingBalance = Number(openingRow?.balance ?? 0);
    const newCharges = Number(activityRow?.newCharges ?? 0);
    const receipts = Number(activityRow?.receipts ?? 0);
    const adjustments = Number(activityRow?.adjustments ?? 0);
    const closingBalance = openingBalance + newCharges - receipts + adjustments;

    // Include if opening > 0 OR any activity in the period.
    if (openingBalance !== 0 || newCharges !== 0 || receipts !== 0 || adjustments !== 0) {
      items.push({
        customerId: c.id,
        customerName: c.name,
        openingBalance,
        newCharges,
        receipts,
        adjustments,
        closingBalance,
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
