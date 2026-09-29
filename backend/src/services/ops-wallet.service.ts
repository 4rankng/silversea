/**
 * OPS cash position: recorded advances + actual reimbursements - personal OPS
 * expenditure - pending reservations - actual returned advances. Company-paid
 * expenses never consume an employee's wallet. Reconciliation by itself does not
 * create cash; active expense vouchers derive cash from canonical treasury entries.
 * Legacy settlement refund fields alone do not prove returned cash.
 * VND sums use BigInt and return integer strings without rounding large balances.
 */
import { TxnType, sumExcludingNegative } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { getAdvanceFundedAmounts } from './advance-funding.service';
import { getOutstandingAdvanceBalance } from './advance-shared.service';
import type { Tx } from './trip-shared';
import { and, eq, isNull, ne, notExists, or, inArray } from 'drizzle-orm';

export type OpsMoney = string;

export interface OpsWalletSummary {
  /** Tiền ứng thực giao có chứng từ quỹ. */
  totalAdvance: OpsMoney;
  /** Σ chi phí APPROVED (chưa + đã quyết toán) */
  approved: OpsMoney;
  /** Σ chi phí PENDING */
  pending: OpsMoney;
  /** Σ chi phí REJECTED */
  rejected: OpsMoney;
  /** Tiền đã trả lại công ty có chứng từ quỹ. */
  returned: OpsMoney;
  /** totalAdvance − (approved + pending) − returned; may be negative */
  balance: OpsMoney;
}

type AmountLike = string | number;

function sumAmounts(values: readonly AmountLike[]): bigint {
  let total = 0n;
  for (const value of values) {
    const parsed = typeof value === 'number' ? value : Number(value);
    const rounded = Math.round(parsed);
    if (!Number.isFinite(rounded)) {
      throw new Error(`Số tiền không hợp lệ: ${String(value)}`);
    }
    total += BigInt(rounded);
  }
  return total;
}

/**
 * Pure form of the wallet formula so the contract is unit-testable without a
 * database (PRD AC 4: "công thức đúng tuyệt đối (test đơn vị)").
 */
export function computeOpsWalletSummary(input: {
  approvedAdvanceAmounts: readonly AmountLike[];
  expenseAmounts: Readonly<Record<'PENDING' | 'APPROVED' | 'REJECTED', readonly AmountLike[]>>;
  approvedRefundAmounts?: readonly AmountLike[];
  reimbursementAmounts?: readonly AmountLike[];
}): OpsWalletSummary {
  const totalAdvance = sumAmounts(input.approvedAdvanceAmounts);
  const approved = sumAmounts(input.expenseAmounts.APPROVED);
  const pending = sumAmounts(input.expenseAmounts.PENDING);
  const rejected = sumAmounts(input.expenseAmounts.REJECTED);
  const returned = sumAmounts(input.approvedRefundAmounts ?? []);
  const balance = totalAdvance + sumAmounts(input.reimbursementAmounts ?? []) - approved - pending - returned;
  return {
    totalAdvance: totalAdvance.toString(),
    approved: approved.toString(),
    pending: pending.toString(),
    rejected: rejected.toString(),
    returned: returned.toString(),
    balance: balance.toString(),
  };
}

export async function getOpsWalletSummary(userId: number, executor: typeof db | Tx = db): Promise<OpsWalletSummary> {
  const [advanceRows, expenseRows, proxyRows, refundRows, expenseCash] = await Promise.all([
    executor
      .select({ id: s.advanceRequests.id })
      .from(s.advanceRequests)
      .where(and(
        eq(s.advanceRequests.requesterId, userId),
        eq(s.advanceRequests.status, 'RECORDED'),
      )),
    executor
      .select({ status: s.opsExpenseEntries.approvalStatus, amount: s.opsExpenseEntries.amount })
      .from(s.opsExpenseEntries)
      .where(and(eq(s.opsExpenseEntries.paidById, userId), or(isNull(s.opsExpenseEntries.payerKind), ne(s.opsExpenseEntries.payerKind, 'COMPANY')))),
    // Historical accounting proxies stay in their original source table. Exclude
    // every native-source billing mirror so an expense consumes the wallet once.
    executor.select({ status: s.tripExpenses.approvalStatus, amount: s.tripExpenses.buyAmount }).from(s.tripExpenses)
      .where(and(eq(s.tripExpenses.forwarderId, userId), eq(s.tripExpenses.settlementMethod, 'OPS_ADVANCE'),
        inArray(s.tripExpenses.approvalStatus, ['RECORDED', 'APPROVED']),
        notExists(executor.select({ id: s.expenseAccountingSources.id }).from(s.expenseAccountingSources)
          .where(and(eq(s.expenseAccountingSources.linkedTripExpenseId, s.tripExpenses.id),
            or(ne(s.expenseAccountingSources.sourceKind, 'TRIP'), eq(s.expenseAccountingSources.status, 'VOIDED'))))))),
    // A legacy settlement records how much should be returned, not cash itself.
    executor.select({ id: s.treasuryMovements.id, amount: s.treasuryMovements.amount }).from(s.advanceSettlements)
      .innerJoin(s.ledger, and(eq(s.ledger.txnType, TxnType.OPS_SETTLEMENT), eq(s.ledger.txnId, s.advanceSettlements.id),
        eq(s.ledger.entityType, 'FORWARDER'), eq(s.ledger.entityId, userId)))
      .innerJoin(s.treasuryMovements, and(eq(s.treasuryMovements.ledgerEntryId, s.ledger.id), eq(s.treasuryMovements.direction, 'IN'),
        eq(s.treasuryMovements.status, 'POSTED'), isNull(s.treasuryMovements.reversalOfId)))
      .where(eq(s.advanceSettlements.forwarderId, userId)),
    executor.select({ amount: s.treasuryMovements.amount, direction: s.treasuryMovements.direction })
      .from(s.expenseCashVouchers).innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId)).where(and(eq(s.expenseCashVouchers.counterpartyType, 'FORWARDER'),
        eq(s.expenseCashVouchers.counterpartyId, userId), eq(s.expenseCashVouchers.status, 'RECORDED'))),
  ]);

  const funded = await getAdvanceFundedAmounts(executor, advanceRows.map(row => row.id));
  const reversedRefunds = refundRows.length ? await executor.select({ amount: s.treasuryMovements.amount }).from(s.treasuryMovements)
    .where(and(inArray(s.treasuryMovements.reversalOfId, refundRows.map(row => row.id)), eq(s.treasuryMovements.status, 'POSTED'))) : [];
  return computeOpsWalletSummary({
    approvedAdvanceAmounts: [...funded.values()],
    // Card 20260928_181 — a negative expense row behaves as if it did not
    // exist, so the wallet's expense side excludes it. The rule lives in
    // sumExcludingNegative; the figure feeds the BigInt formula as one amount.
    expenseAmounts: {
      PENDING: [sumExcludingNegative(expenseRows.filter((row) => row.status === 'PENDING'), (row) => row.amount)],
      APPROVED: [sumExcludingNegative(
        [...expenseRows, ...proxyRows].filter((row) => (row.status === 'RECORDED' || row.status === 'APPROVED')),
        (row) => row.amount,
      )],
      REJECTED: [sumExcludingNegative(expenseRows.filter((row) => row.status === 'VOIDED' || row.status === 'REJECTED'), (row) => row.amount)],
    },
    approvedRefundAmounts: [...refundRows.map(row => row.amount), ...reversedRefunds.map(row => -Number(row.amount)), ...expenseCash.filter(row => row.direction === 'IN').map(row => row.amount)],
    reimbursementAmounts: expenseCash.filter(row => row.direction === 'OUT').map(row => row.amount),
  });
}

// ─── Sổ quỹ OPS (card 20260923_13, ADR 2026-09-24-ops-fund-book-scoped-read) ──
// Read-only, self-scoped fund book: the caller's own tạm ứng/hoàn ứng cash
// events from the SAME authorities the wallet summary reads, so the closing
// reconciles by construction. Entries are signed from the employee's fund
// perspective (+ received, − spent/returned). DB ids never leave as display
// references — user-facing codes only (settlement/voucher codes).

export type OpsFundBookEntryKind = 'ADVANCE' | 'EXPENSE' | 'REFUND' | 'REFUND_REVERSAL' | 'REIMBURSEMENT';

export interface OpsFundBookEntry {
  key: string;
  date: string;
  kind: OpsFundBookEntryKind;
  label: string;
  /** User-facing document code (phiếu quyết toán / phiếu thu chi) or null. */
  reference: string | null;
  /** Signed VND integer string: + nhận, − chi/hoàn. */
  amount: OpsMoney;
}

export interface OpsFundBook {
  items: OpsFundBookEntry[];
  /** Σ(items.amount) — equals walletBalance when the book reconciles. */
  closing: OpsMoney;
  /** Wallet formula authority (getOpsWalletSummary().balance). */
  walletBalance: OpsMoney;
  /** Kế toán's "Còn phải hoàn ứng" authority (unspent recorded advances). */
  outstandingAdvanceBalance: OpsMoney;
  /** The acceptance doc's khớp check: book closing vs accountant figure. */
  matches: boolean;
  /**
   * Card 20260928_168, PM ruling 2026-09-29 câu 2: "Sổ quỹ PHẢI lọc theo kỳ."
   * Everything above stays the WHOLE-HISTORY truth — `closing` is what
   * `matches` compares and what the reconciliation report's "Còn phải hoàn ứng"
   * is checked against, so redefining it to mean "this month" would change
   * what an existing column says. These are additive: null bounds mean "no
   * window", and with no window every period figure equals the whole-history
   * one. `periodOpening` is the cumulative total up to `from`, NOT a
   * re-derived balance, so a window can never disagree with the closing it
   * is a slice of.
   */
  period: { from: string | null; to: string | null };
  periodOpening: OpsMoney;
  periodIn: OpsMoney;
  periodOut: OpsMoney;
  periodClosing: OpsMoney;
}

export interface OpsFundBookQuery {
  from?: string;
  to?: string;
}

function inWindow(date: string, from: string | null, to: string | null): boolean {
  // Items are ISO dates, so plain string compare is the same as a date compare
  // and keeps the boundaries inclusive on both ends.
  return (from === null || date >= from) && (to === null || date <= to);
}

const FUND_BOOK_KIND_WEIGHT: Record<OpsFundBookEntryKind, number> = {
  ADVANCE: 0, REIMBURSEMENT: 1, EXPENSE: 2, REFUND: 3, REFUND_REVERSAL: 4,
};

function fundBookIsoDate(value: string | Date | null): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return (value ?? '').slice(0, 10);
}

export async function getOpsFundBook(userId: number, query: OpsFundBookQuery = {}): Promise<OpsFundBook> {
  const from = query.from ?? null;
  const to = query.to ?? null;
  const [advanceRows, opsExpenseRows, proxyRows, refundRows, voucherRows, wallet] = await Promise.all([
    db.select({ id: s.advanceRequests.id, createdAt: s.advanceRequests.createdAt, reason: s.advanceRequests.reason })
      .from(s.advanceRequests)
      .where(and(eq(s.advanceRequests.requesterId, userId), eq(s.advanceRequests.status, 'RECORDED'))),
    db.select({ id: s.opsExpenseEntries.id, paidAt: s.opsExpenseEntries.paidAt, expenseTypeCode: s.opsExpenseEntries.expenseTypeCode, note: s.opsExpenseEntries.note, amount: s.opsExpenseEntries.amount })
      .from(s.opsExpenseEntries)
      .where(and(
        eq(s.opsExpenseEntries.paidById, userId),
        or(isNull(s.opsExpenseEntries.payerKind), ne(s.opsExpenseEntries.payerKind, 'COMPANY')),
        inArray(s.opsExpenseEntries.approvalStatus, ['PENDING', 'RECORDED', 'APPROVED']),
      )),
    db.select({ id: s.tripExpenses.id, expenseDate: s.tripExpenses.expenseDate, createdAt: s.tripExpenses.createdAt, feeName: s.tripExpenses.feeName, expenseType: s.tripExpenses.expenseType, buyAmount: s.tripExpenses.buyAmount })
      .from(s.tripExpenses)
      .where(and(
        eq(s.tripExpenses.forwarderId, userId),
        eq(s.tripExpenses.settlementMethod, 'OPS_ADVANCE'),
        inArray(s.tripExpenses.approvalStatus, ['RECORDED', 'APPROVED']),
        notExists(db.select({ id: s.expenseAccountingSources.id }).from(s.expenseAccountingSources)
          .where(and(eq(s.expenseAccountingSources.linkedTripExpenseId, s.tripExpenses.id),
            or(ne(s.expenseAccountingSources.sourceKind, 'TRIP'), eq(s.expenseAccountingSources.status, 'VOIDED'))))),
      )),
    db.select({ movementId: s.treasuryMovements.id, amount: s.treasuryMovements.amount, valueDate: s.treasuryMovements.valueDate, settlementCode: s.advanceSettlements.code })
      .from(s.advanceSettlements)
      .innerJoin(s.ledger, and(eq(s.ledger.txnType, TxnType.OPS_SETTLEMENT), eq(s.ledger.txnId, s.advanceSettlements.id),
        eq(s.ledger.entityType, 'FORWARDER'), eq(s.ledger.entityId, userId)))
      .innerJoin(s.treasuryMovements, and(eq(s.treasuryMovements.ledgerEntryId, s.ledger.id),
        eq(s.treasuryMovements.direction, 'IN'), eq(s.treasuryMovements.status, 'POSTED'), isNull(s.treasuryMovements.reversalOfId)))
      .where(eq(s.advanceSettlements.forwarderId, userId)),
    db.select({ code: s.expenseCashVouchers.code, createdAt: s.expenseCashVouchers.createdAt, amount: s.treasuryMovements.amount, direction: s.treasuryMovements.direction })
      .from(s.expenseCashVouchers).innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId))
      .where(and(eq(s.expenseCashVouchers.counterpartyType, 'FORWARDER'),
        eq(s.expenseCashVouchers.counterpartyId, userId), eq(s.expenseCashVouchers.status, 'RECORDED'))),
    getOpsWalletSummary(userId),
  ]);

  const funded = await getAdvanceFundedAmounts(db, advanceRows.map((row) => row.id));
  const refundReversals = refundRows.length ? await db.select({ movementId: s.treasuryMovements.id, amount: s.treasuryMovements.amount, valueDate: s.treasuryMovements.valueDate })
    .from(s.treasuryMovements)
    .where(and(inArray(s.treasuryMovements.reversalOfId, refundRows.map((row) => row.movementId)), eq(s.treasuryMovements.status, 'POSTED'))) : [];

  const items: OpsFundBookEntry[] = [];
  for (const row of advanceRows) {
    const amount = funded.get(row.id) ?? 0;
    if (amount > 0) {
      items.push({ key: `advance-${row.id}`, date: fundBookIsoDate(row.createdAt), kind: 'ADVANCE', label: `Tạm ứng: ${row.reason}`, reference: null, amount: String(Math.round(amount)) });
    }
  }
  for (const row of opsExpenseRows) {
    // Card 20260928_181 — a negative expense row behaves as if it did not
    // exist: the fund book emits no entry for it. Emitting one would flip the
    // sign (the entry is stored as -amount) and RAISE the closing balance.
    const expenseAmount = Number(row.amount);
    if (expenseAmount <= 0) continue;
    items.push({ key: `ops-expense-${row.id}`, date: fundBookIsoDate(row.paidAt), kind: 'EXPENSE', label: `Chi phí: ${row.expenseTypeCode}${row.note ? ` — ${row.note}` : ''}`, reference: null, amount: String(-Math.round(expenseAmount)) });
  }
  for (const row of proxyRows) {
    // Card 20260928_181 — same rule for the trip-expense entries.
    const expenseAmount = Number(row.buyAmount);
    if (expenseAmount <= 0) continue;
    const label = `Chi phí: ${row.feeName ?? row.expenseType}`;
    items.push({ key: `trip-expense-${row.id}`, date: fundBookIsoDate(row.expenseDate ?? row.createdAt), kind: 'EXPENSE', label, reference: null, amount: String(-Math.round(expenseAmount)) });
  }
  for (const row of refundRows) {
    items.push({ key: `refund-${row.movementId}`, date: fundBookIsoDate(row.valueDate), kind: 'REFUND', label: 'Hoàn tiền về công ty', reference: row.settlementCode, amount: String(-Math.round(Number(row.amount))) });
  }
  for (const row of refundReversals) {
    items.push({ key: `refund-reversal-${row.movementId}`, date: fundBookIsoDate(row.valueDate), kind: 'REFUND_REVERSAL', label: 'Hủy hoàn tiền', reference: null, amount: String(Math.round(Number(row.amount))) });
  }
  for (const row of voucherRows) {
    if (row.direction === 'IN') {
      items.push({ key: `voucher-${row.code}`, date: fundBookIsoDate(row.createdAt), kind: 'REFUND', label: 'Nộp lại tiền mặt', reference: row.code, amount: String(-Math.round(Number(row.amount))) });
    } else {
      items.push({ key: `voucher-${row.code}`, date: fundBookIsoDate(row.createdAt), kind: 'REIMBURSEMENT', label: 'Công ty chi bù tiền mặt', reference: row.code, amount: String(Math.round(Number(row.amount))) });
    }
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || FUND_BOOK_KIND_WEIGHT[a.kind] - FUND_BOOK_KIND_WEIGHT[b.kind] || a.key.localeCompare(b.key));
  const closing = items.reduce((total, item) => total + BigInt(item.amount), 0n);
  const closingText = closing.toString();
  const periodItems = from === null && to === null
    ? items
    : items.filter((item) => inWindow(item.date, from, to));
  const periodClosingBig = periodItems.reduce((total, item) => total + BigInt(item.amount), 0n);
  // The opening is the WHOLE-HISTORY closing minus the window, not a second
  // independent balance: a slice can then never disagree with the book it was
  // cut from, and with no window it is exactly zero.
  const periodOpeningBig = closing - periodClosingBig;
  const periodInBig = periodItems.reduce(
    (total, item) => total + (BigInt(item.amount) > 0n ? BigInt(item.amount) : 0n), 0n);
  const periodOutBig = periodItems.reduce(
    (total, item) => total + (BigInt(item.amount) < 0n ? -BigInt(item.amount) : 0n), 0n);
  const outstanding = String(Math.round(await getOutstandingAdvanceBalance(userId)));
  return {
    // The ROWS are windowed too, not just the summary. Returning the whole
    // history here would let the table show 09-29 activity under a 09-28
    // filter while the summary counted only 09-28 — the display divergence
    // this change exists to remove. With no window, periodItems IS items.
    items: periodItems,
    closing: closingText,
    walletBalance: wallet.balance,
    outstandingAdvanceBalance: outstanding,
    matches: closingText === outstanding,
    period: { from, to },
    periodOpening: periodOpeningBig.toString(),
    periodIn: periodInBig.toString(),
    periodOut: periodOutBig.toString(),
    periodClosing: periodClosingBig.toString(),
  };
}
