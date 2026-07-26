/**
 * Wave 3 M6.3 — AP aging detail (mirror of AR).
 *
 * Sits on top of the existing aging.service primitives (which own the FIFO
 * bucket math) and adds three things the M6.3 spec calls out:
 *
 *   (a) Partial payments — per-supplier totalPayable vs totalPaid split.
 *   (b) Duplicate payment-ref detection — flag VENDOR_PAYMENT entries whose
 *       receiptId appears on more than one entry globally. A real receipt
 *       can't legitimately be used twice; surfacing the duplicates lets the
 *       accountant reconcile. (Enforcement belongs in the post path.)
 *   (c) Overpayment — when totalPaid > totalPayable, the surplus is reported
 *       as `overpayment` (a supplier credit) rather than silently netted.
 *
 * "Mirror of AR": same per-entity structure + aging buckets as
 * getCustomerAgingList, but for VENDOR entries. AP convention: payable
 * side = credit on VENDOR ledger (vendor expense increases payable);
 * payment side = debit on VENDOR ledger (VENDOR_PAYMENT reduces payable).
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';

const PAYABLE_TXN_TYPES: TxnType[] = [
  TxnType.VENDOR_EXPENSE,
  TxnType.FUEL_EXPENSE,
  TxnType.COMMISSION,
];

export interface ApPaymentEntry {
  ledgerId: number;
  receiptId: string | null;
  amount: number;
  timestamp: string;
  isDuplicateRef: boolean;
}

export interface ApAgingSupplierRow {
  supplierId: number;
  supplierName: string;
  totalPayable: number;
  totalPaid: number;
  outstanding: number;
  overpayment: number;
  aging: { current: number; d30: number; d60: number; over90: number };
  maxOverdueDays: number;
  payments: ApPaymentEntry[];
  duplicateRefCount: number;
}

export interface ApDuplicateRef {
  receiptId: string;
  entryCount: number;
  totalAmount: number;
  supplierIds: number[];
}

export interface ApAgingDetail {
  asOf: string;
  suppliers: ApAgingSupplierRow[];
  totals: {
    totalPayable: number;
    totalPaid: number;
    outstanding: number;
    overpayment: number;
  };
  duplicateRefs: ApDuplicateRef[];
}

/**
 * Per-supplier AP aging with partial payments, duplicate-ref flags, and
 * overpayment surfacing.
 *
 * Optional `supplierId` narrows to one supplier. `asOfDate` (YYYY-MM-DD)
 * caps the entry window; NULL = through now.
 */
export async function getApAgingDetail(opts: {
  supplierId?: number;
  asOfDate?: string;
} = {}): Promise<ApAgingDetail> {
  const asOf = opts.asOfDate ?? new Date().toISOString().slice(0, 10);
  // Drizzle's and() joins clauses with AND; supplierFilter is rendered as
  // a raw SQL fragment (no leading AND) so we can pass it in cleanly.
  const supplierFilter = opts.supplierId
    ? eq(s.ledger.entityId, opts.supplierId)
    : sql`TRUE`;

  // ── 1. Pull all VENDOR ledger rows for the payable + payment types ──
  // Single query: entityId is selected so we can group by supplier in JS.
  const rows = await db.select({
    id: s.ledger.id,
    entityId: s.ledger.entityId,
    txnType: s.ledger.txnType,
    receiptId: s.ledger.receiptId,
    debit: s.ledger.debit,
    credit: s.ledger.credit,
    timestamp: s.ledger.timestamp,
  })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'VENDOR'),
      sql`DATE(${s.ledger.timestamp}) <= ${asOf}::date`,
      inArray(s.ledger.txnType, [...PAYABLE_TXN_TYPES, TxnType.VENDOR_PAYMENT]),
      sql`${supplierFilter}`,
    ));

  // ── 2. Detect duplicate receiptIds across the entire VENDOR_PAYMENT set ──
  // A duplicate is a receiptId used on >1 entry. NULL/empty receiptIds are
  // not considered (a missing ref is a data-quality issue, not a duplicate).
  const refCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.txnType !== TxnType.VENDOR_PAYMENT) continue;
    const ref = (r.receiptId ?? '').trim();
    if (!ref) continue;
    refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
  }
  const duplicateRefSet = new Set<string>();
  for (const [ref, count] of refCounts) if (count > 1) duplicateRefSet.add(ref);

  // ── 3. Build per-supplier aggregates ──
  interface Acc {
    supplierId: number;
    totalPayable: number;
    totalPaid: number;
    payments: ApPaymentEntry[];
    duplicateRefCount: number;
    // FIFO aging buckets — debits create "current"; aging advances with time.
    // We track net entries with their timestamp to bucket them.
    entries: Array<{ amount: number; timestamp: Date; isPayable: boolean }>;
  }
  const bySupplier = new Map<number, Acc>();

  for (const r of rows) {
    const sid = r.entityId;
    if (!bySupplier.has(sid)) {
      bySupplier.set(sid, {
        supplierId: sid, totalPayable: 0, totalPaid: 0,
        payments: [], duplicateRefCount: 0, entries: [],
      });
    }
    const acc = bySupplier.get(sid)!;
    const isPayment = r.txnType === TxnType.VENDOR_PAYMENT;
    const amount = isPayment ? Number(r.debit ?? 0) : Number(r.credit ?? 0);
    if (amount === 0) continue;

    if (isPayment) {
      acc.totalPaid += amount;
      const ref = (r.receiptId ?? '').trim() || null;
      const isDup = ref !== null && duplicateRefSet.has(ref);
      acc.payments.push({
        ledgerId: r.id,
        receiptId: ref,
        amount,
        timestamp: r.timestamp.toISOString(),
        isDuplicateRef: isDup,
      });
      if (isDup) acc.duplicateRefCount += 1;
    } else {
      acc.totalPayable += amount;
    }
    acc.entries.push({ amount, timestamp: r.timestamp, isPayable: !isPayment });
  }

  // ── 4. Compute aging buckets per supplier ──
  // Bucket assignment: each payable entry ages forward from its timestamp
  // to asOf; payments reduce the oldest payables first (FIFO). What's left
  // outstanding at asOf is bucketed by the ORIGINAL payable entry's age.
  const asOfMs = new Date(asOf).getTime();
  const DAY = 24 * 60 * 60 * 1000;

  // Resolve supplier names in one query.
  const supplierIds = [...bySupplier.keys()];
  const supplierNames = new Map<number, string>();
  if (supplierIds.length > 0) {
    const supRows = await db.select({ id: s.suppliers.id, name: s.suppliers.name })
      .from(s.suppliers)
      .where(inArray(s.suppliers.id, supplierIds));
    for (const r of supRows) supplierNames.set(r.id, r.name);
  }

  const supplierRows: ApAgingSupplierRow[] = [];
  let totalPayable = 0;
  let totalPaid = 0;

  for (const [sid, acc] of bySupplier) {
    // Skip suppliers with zero payable AND zero payment (no AP activity).
    if (acc.totalPayable === 0 && acc.totalPaid === 0) continue;

    totalPayable += acc.totalPayable;
    totalPaid += acc.totalPaid;

    // Bucket the payable entries by age; payments net against the OLDEST first.
    const payables = acc.entries
      .filter(e => e.isPayable)
      .map(e => ({
        amount: e.amount,
        ageDays: Math.max(0, Math.floor((asOfMs - e.timestamp.getTime()) / DAY)),
        remaining: e.amount,
      }))
      .sort((a, b) => a.ageDays - b.ageDays);

    let paymentRemaining = acc.totalPaid;
    for (const p of payables) {
      if (paymentRemaining <= 0) break;
      const applied = Math.min(p.remaining, paymentRemaining);
      p.remaining -= applied;
      paymentRemaining -= applied;
    }

    const aging = { current: 0, d30: 0, d60: 0, over90: 0 };
    for (const p of payables) {
      if (p.remaining <= 0) continue;
      if (p.ageDays <= 30) aging.current += p.remaining;
      else if (p.ageDays <= 60) aging.d30 += p.remaining;
      else if (p.ageDays <= 90) aging.d60 += p.remaining;
      else aging.over90 += p.remaining;
    }

    // maxOverdueDays = longest age among entries still partially unpaid.
    let maxOverdueDays = 0;
    for (const p of payables) {
      if (p.remaining > 0 && p.ageDays > 30) {
        maxOverdueDays = Math.max(maxOverdueDays, p.ageDays);
      }
    }

    const outstanding = acc.totalPayable - acc.totalPaid;
    const overpayment = Math.max(0, -outstanding);

    supplierRows.push({
      supplierId: sid,
      supplierName: supplierNames.get(sid) ?? `Nhà cung cấp #${sid}`,
      totalPayable: acc.totalPayable,
      totalPaid: acc.totalPaid,
      outstanding,
      overpayment,
      aging,
      maxOverdueDays,
      payments: acc.payments.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      duplicateRefCount: acc.duplicateRefCount,
    });
  }

  supplierRows.sort((a, b) => Math.abs(b.outstanding) - Math.abs(a.outstanding));

  // ── 5. Aggregate the global duplicate refs (with their supplier spread) ──
  const duplicateRefs: ApDuplicateRef[] = [];
  for (const ref of duplicateRefSet) {
    const matches = rows.filter(r =>
      r.txnType === TxnType.VENDOR_PAYMENT && (r.receiptId ?? '').trim() === ref
    );
    const supplierIdSet = new Set(matches.map(m => m.entityId));
    duplicateRefs.push({
      receiptId: ref,
      entryCount: matches.length,
      totalAmount: matches.reduce((sum, m) => sum + Number(m.debit ?? 0), 0),
      supplierIds: [...supplierIdSet].sort((a, b) => a - b),
    });
  }
  duplicateRefs.sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    asOf,
    suppliers: supplierRows,
    totals: {
      totalPayable,
      totalPaid,
      outstanding: totalPayable - totalPaid,
      overpayment: supplierRows.reduce((sum, r) => sum + r.overpayment, 0),
    },
    duplicateRefs,
  };
}
