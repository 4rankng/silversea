/**
 * Card 370 (REQ-5.10-02) — the "Tổng quát về tiền" money-alerts snapshot.
 *
 * One aggregated read feeding three overview blocks at once:
 *   1. the fund quick-notice (Quỹ TM + Quỹ công ty + cash-flow reserve line),
 *   2. the 4-group due-debt bar chart,
 *   3. the three always-on alerts — unrefunded container deposits, overdue
 *      debt, negative fund.
 *
 * Contract: GET /api/accounting/money-alerts?asOfDate=YYYY-MM-DD
 * Every money value passes through `round2dp`. Read-only, Drizzle only.
 */
import { round2dp, TxnType } from '@tingting/shared';
import { and, eq, inArray, isNull, like, lt, or, sql } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { computeDueGroups } from './aging.service';
import {
  getCustomerReceivableSnapshots,
  resolveVietnamAsOfCutoff,
} from './customer-receivable-authority.service';
import { getTreasuryPositions } from './treasury.service';

export type MoneyAlertsDueGroupKey =
  | 'dueSoon5d'
  | 'overdue1to10'
  | 'overdue11to30'
  | 'overdue30plus';

export interface MoneyAlertsDueGroup {
  key: MoneyAlertsDueGroupKey;
  label: string;
  amount: number;
  customers: number;
}

export interface MoneyAlertsSummary {
  /** reserve = (tm + company) − payablesDue5d, all round2dp server-side. */
  funds: { tm: number; company: number; reserve: number };
  dueDebtGroups: MoneyAlertsDueGroup[];
  /** deposit_refund_trackers status='CHUA_HOAN_CUOC' rows. */
  unrefundedDeposits: { count: number; amount: number };
  /** Equals the receivables dueGroups.overdue row totals exactly. */
  overdueDebt: { customers: number; amount: number };
  /** The sole 'Quỹ âm' condition: tm < 0 && company < 0 — nothing else. */
  fundNegative: boolean;
}

/** Verbatim chart captions, in the contract's key order. */
const DUE_DEBT_GROUP_TABLE: ReadonlyArray<{ key: MoneyAlertsDueGroupKey; label: string }> = [
  { key: 'dueSoon5d', label: 'Sắp đến hạn (≤ 5 ngày)' },
  { key: 'overdue1to10', label: 'Quá hạn 1–10 ngày' },
  { key: 'overdue11to30', label: 'Quá hạn 30 ngày' },
  { key: 'overdue30plus', label: 'Quá hạn 60 ngày' },
];

const DAY_MS = 86_400_000;

/** YYYY-MM-DD → day index, for whole-calendar-day distance math. */
function dayNumber(isoDate: string): number {
  return Date.UTC(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
  ) / DAY_MS;
}

/**
 * Disjoint group index by calendar-day distance of the effective due date vs
 * the as-of date (positive = overdue):
 *   ≥ 31 → overdue30plus (includes > 60 — never hide debt);
 *   11–30 → overdue11to30; 1–10 → overdue1to10;
 *   −5…0 → dueSoon5d (due today counts, due in ≤ 5 days counts);
 *   ≤ −6 → `null` — due more than 5 days out, never shown (spec lists only
 *   these 4 groups).
 */
function dueDebtGroupIndex(effectiveDueDate: string, asOfDate: string): 0 | 1 | 2 | 3 | null {
  const overdueDays = dayNumber(asOfDate) - dayNumber(effectiveDueDate);
  if (overdueDays >= 31) return 3;
  if (overdueDays >= 11) return 2;
  if (overdueDays >= 1) return 1;
  if (overdueDays >= -5) return 0;
  return null;
}

/**
 * Obligation effective due date — the payment-term authority's own rule (the
 * `effectiveDueDate` helper in customer-receivable-authority.service.ts):
 * processing date wins, then the frozen contractual date. Legacy rows that
 * froze neither fall back to their issue date so un-dated debt still lands in
 * a group (typically overdue30plus) instead of vanishing from the chart.
 */
function effectiveDueDate(
  processingDueDate: string | null,
  originalDueDate: string | null,
  issueDate: string,
): string {
  return processingDueDate ?? originalDueDate ?? issueDate;
}

// ─── Receivables: due-debt chart + overdue-debt alert ────────────────────────

async function computeReceivableBlocks(rawAsOfDate: string | undefined, asOfDate: string) {
  const customerRows = await db.select({ id: s.customers.id })
    .from(s.customers)
    .where(isNull(s.customers.deletedAt));
  // Pass the caller's raw option through so the snapshot cutoff is byte-
  // identical to getReceivablesSummary's — the two must always agree.
  const snapshotMap = await getCustomerReceivableSnapshots(
    customerRows.map((row) => row.id),
    { asOfDate: rawAsOfDate },
  );
  // The SAME row set getReceivablesSummary aggregates (snapshot rows carrying
  // outstanding debt). overdueDebt rides computeDueGroups over these exact
  // rows, so it equals the card-369 dueGroups.overdue by construction —
  // presence-based (any overdue aging portion > 0), amount = Σ(d30+d60+over90).
  const rows = [...snapshotMap.values()].filter((snapshot) => snapshot.totalOutstanding > 0);

  const overdue = computeDueGroups(rows.map((row) => ({
    totalOutstanding: row.totalOutstanding,
    aging: row.aging,
  }))).overdue;

  const groupAmounts = [0, 0, 0, 0];
  const groupCustomers = [new Set<number>(), new Set<number>(), new Set<number>(), new Set<number>()];
  for (const row of rows) {
    for (const obligation of row.obligations) {
      if (!(obligation.outstanding > 0)) continue;
      const index = dueDebtGroupIndex(
        effectiveDueDate(
          obligation.processingDueDate,
          obligation.originalDueDate,
          obligation.issueTimestamp.slice(0, 10),
        ),
        asOfDate,
      );
      if (index == null) continue;
      groupAmounts[index] += obligation.outstanding;
      groupCustomers[index].add(obligation.customerId);
    }
  }

  return {
    dueDebtGroups: DUE_DEBT_GROUP_TABLE.map((group, index) => ({
      key: group.key,
      label: group.label,
      amount: round2dp(groupAmounts[index]),
      customers: groupCustomers[index].size,
    })),
    overdueDebt: { customers: overdue.count, amount: round2dp(overdue.amount) },
  };
}

// ─── Unrefunded container deposits alert ─────────────────────────────────────

/** Always-on: every CHUA_HOAN_CUOC lot regardless of date — the same rows and
 *  the same Number(depositAmount) sum `listDepositTrackers` warns on. */
async function computeUnrefundedDeposits(): Promise<{ count: number; amount: number }> {
  const [row] = await db.select({
    count: sql<number>`count(*)::int`,
    amount: sql<string>`coalesce(sum(${s.depositRefundTrackers.depositAmount}), 0)`,
  })
    .from(s.depositRefundTrackers)
    .where(eq(s.depositRefundTrackers.status, 'CHUA_HOAN_CUOC'));
  return { count: row?.count ?? 0, amount: round2dp(Number(row?.amount ?? 0)) };
}

// ─── Fund balances (Quỹ TM / Quỹ công ty) ────────────────────────────────────

/**
 * Sum of book balances per fundCode over ACTIVE accounts — the exact account
 * set + balance math the /expense-accounting/fund-book read uses
 * (`calculateTreasuryBookBalance` via `getTreasuryPositions`), so this notice
 * can never drift from the sổ quỹ. No parallel balance math here.
 */
async function computeFundBalances(): Promise<{ tm: number; company: number }> {
  const accounts = await db.select({ id: s.treasuryAccounts.id })
    .from(s.treasuryAccounts)
    .where(and(
      eq(s.treasuryAccounts.status, 'ACTIVE'),
      inArray(s.treasuryAccounts.fundCode, ['TM', 'COMPANY']),
    ));
  const positions = await getTreasuryPositions(accounts.map((account) => account.id));
  let tm = 0;
  let company = 0;
  for (const position of positions) {
    if (position.fundCode === 'TM') tm += position.bookBalance;
    else if (position.fundCode === 'COMPANY') company += position.bookBalance;
  }
  return { tm: round2dp(tm), company: round2dp(company) };
}

// ─── payablesDue5d (the reserve drain) ───────────────────────────────────────

interface PayableLedgerRow {
  id: number;
  entityId: number;
  debit: string | null;
  credit: string | null;
  timestamp: Date;
  originalDueDate: string | null;
  processingDueDate: string | null;
}

interface OutstandingPayable {
  amount: number;
  originalDueDate: string | null;
  processingDueDate: string | null;
  issueDate: string;
}

/**
 * Per-entity obligation outstanding under oldest-first settlement: payments
 * pool against the entity's obligations in issue order. This is exactly the
 * distribution the inverted FIFO (`computeAging` with invertSigns) produces
 * for the AP aging — a credit only ever fills the oldest open obligation
 * first — while keeping each obligation's identity for due-date grouping.
 */
function outstandingPayables(rows: PayableLedgerRow[]): OutstandingPayable[] {
  const byEntity = new Map<number, PayableLedgerRow[]>();
  for (const row of rows) {
    const list = byEntity.get(row.entityId);
    if (list) list.push(row);
    else byEntity.set(row.entityId, [row]);
  }
  const result: OutstandingPayable[] = [];
  for (const entityRows of byEntity.values()) {
    const obligations = entityRows
      .filter((row) => Number(row.credit ?? 0) > 0)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id - b.id);
    let payments = entityRows.reduce((sum, row) => sum + Number(row.debit ?? 0), 0);
    for (const obligation of obligations) {
      const amount = Number(obligation.credit ?? 0);
      const applied = Math.min(amount, payments);
      payments -= applied;
      const outstanding = amount - applied;
      if (outstanding <= 0) continue;
      result.push({
        amount: outstanding,
        originalDueDate: obligation.originalDueDate,
        processingDueDate: obligation.processingDueDate,
        issueDate: obligation.timestamp.toISOString().slice(0, 10),
      });
    }
  }
  return result;
}

/**
 * payablesDue5d = Σ outstanding of payable obligations (VENDOR/CARRIER) whose
 * effective due date falls in [asOf, asOf+5].
 *
 * Source choice (card 370 investigation): scheduled payables live on the
 * VENDOR/CARRIER ledger rows that carry the frozen payment-term snapshot —
 * O2C rev1 §B0 `buildSupplierDueDateFields`/`buildCarrierDueDateFields` stamp
 * originalDueDate/processingDueDate from `resolveSupplierPaymentDueDate`
 * (CHI_HO / CUOC terms) at post time. billingDocuments hold due dates only for
 * customer debit notes (DEBIT_NOTE is customer-facing AR only), and
 * paymentAllocations.originalDueDateSnapshot belongs to customer receipts —
 * neither represents scheduled payables, so the ledger rows are the source.
 *
 * Scope mirrors getPayablesSummary's two projections exactly (all VENDOR rows;
 * the payable-only CUSTOMER/CARRIER carrier projection), snapshotted at the
 * same Vietnam end-exclusive cutoff as every other block.
 */
async function computePayablesDue5d(asOfDate: string, cutoffEndExclusive: Date): Promise<number> {
  const windowStart = dayNumber(asOfDate);
  const windowEnd = windowStart + 5;
  const columns = {
    id: s.ledger.id,
    entityId: s.ledger.entityId,
    debit: s.ledger.debit,
    credit: s.ledger.credit,
    timestamp: s.ledger.timestamp,
    originalDueDate: s.ledger.originalDueDate,
    processingDueDate: s.ledger.processingDueDate,
  };
  const beforeCutoff = lt(s.ledger.timestamp, cutoffEndExclusive);
  const [vendorRows, carrierRows] = await Promise.all([
    db.select(columns).from(s.ledger).where(and(
      eq(s.ledger.entityType, 'VENDOR'),
      beforeCutoff,
    )),
    db.select(columns).from(s.ledger).where(and(
      inArray(s.ledger.entityType, ['CUSTOMER', 'CARRIER']),
      or(
        inArray(s.ledger.txnType, [TxnType.EXTERNAL_CARRIER_COST, TxnType.VENDOR_PAYMENT]),
        and(eq(s.ledger.txnType, TxnType.UNLOCK_REVERSAL), like(s.ledger.note, 'Cước thuê ngoài%')),
      )!,
      beforeCutoff,
    )),
  ]);

  let total = 0;
  for (const rows of [vendorRows, carrierRows]) {
    for (const obligation of outstandingPayables(rows)) {
      const dueDay = dayNumber(effectiveDueDate(
        obligation.processingDueDate,
        obligation.originalDueDate,
        obligation.issueDate,
      ));
      if (dueDay >= windowStart && dueDay <= windowEnd) total += obligation.amount;
    }
  }
  return round2dp(total);
}

// ─── Aggregated snapshot ─────────────────────────────────────────────────────

export async function getMoneyAlertsSummary(
  opts: { asOfDate?: string } = {},
): Promise<MoneyAlertsSummary> {
  const cutoff = resolveVietnamAsOfCutoff(opts.asOfDate);
  const asOfDate = cutoff.businessDate;
  const [funds, payablesDue5d, receivables, unrefundedDeposits] = await Promise.all([
    computeFundBalances(),
    computePayablesDue5d(asOfDate, cutoff.endExclusive),
    computeReceivableBlocks(opts.asOfDate, asOfDate),
    computeUnrefundedDeposits(),
  ]);
  return {
    funds: { tm: funds.tm, company: funds.company, reserve: round2dp(funds.tm + funds.company - payablesDue5d) },
    dueDebtGroups: receivables.dueDebtGroups,
    unrefundedDeposits,
    overdueDebt: receivables.overdueDebt,
    fundNegative: funds.tm < 0 && funds.company < 0,
  };
}
