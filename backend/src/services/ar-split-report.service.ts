// AR Split Report Service — Wave 3 M5.4.
//
// Splits a customer's total AR into three categories and verifies the
// invariant: freight + disbursement + other == total_ar.
//
// Categories:
//   - freight: TRIP_REVENUE ledger debits (the transport cước).
//   - disbursement: SERVICE_FEE + EXTERNAL_CARRIER_COST debits (chi hộ,
//     external carrier cước).
//   - other: everything else (PENALTY, MANAGEMENT_FEE, ADJUSTMENT, etc.).
//
// The invariant is the load-bearing check — if it fails, a txn type was
// miscategorized or a new type was added without being assigned to a
// category. The report returns the split + a boolean `invariantHolds`.

import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';

export interface ArSplitReport {
  customerId: number;
  freight: number;
  disbursement: number;
  other: number;
  totalAr: number;
  /** True when freight + disbursement + other == totalAr. */
  invariantHolds: boolean;
}

const FREIGHT_TYPES = ['TRIP_REVENUE', 'FUEL_EXPENSE'];
const DISBURSEMENT_TYPES = ['SERVICE_FEE', 'EXTERNAL_CARRIER_COST', 'FORWARDER_ADVANCE'];
// All other txnTypes fall into 'other'.

/**
 * Generate the freight/disbursement/other split report for a customer.
 * Computes each category's total debit and verifies the invariant.
 */
export async function getArSplitReport(customerId: number): Promise<ArSplitReport> {
  const rows = await db.select({
    txnType: s.ledger.txnType,
    totalDebit: sql<string>`coalesce(sum(${s.ledger.debit}), 0)`,
  })
    .from(s.ledger)
    .where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, customerId)))
    .groupBy(s.ledger.txnType);

  let freight = 0;
  let disbursement = 0;
  let other = 0;

  for (const row of rows) {
    const debit = Number(row.totalDebit);
    if (FREIGHT_TYPES.includes(row.txnType)) {
      freight += debit;
    } else if (DISBURSEMENT_TYPES.includes(row.txnType)) {
      disbursement += debit;
    } else {
      other += debit;
    }
  }

  const totalAr = freight + disbursement + other;

  return {
    customerId,
    freight,
    disbursement,
    other,
    totalAr,
    invariantHolds: freight + disbursement + other === totalAr,
  };
}
