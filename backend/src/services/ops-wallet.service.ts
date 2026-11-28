/**
 * OPS cash position: recorded advances + actual reimbursements - personal OPS
 * expenditure - pending reservations - actual returned advances. Company-paid
 * expenses never consume an employee's wallet. Reconciliation by itself does not
 * create cash; active expense vouchers derive cash from canonical treasury entries.
 * Returned advances ride the SIL-1056 authority: a RECORDED settlement phiếu IS
 * the settlement, so its signed refundAmount is the wallet's returned cash
 * (QA 28/11 finding 13 — the old treasury-movement join was structurally empty).
 * VND sums use BigInt and return integer strings without rounding large balances.
 */
import { sumExcludingNegative } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { getAdvanceFundedAmounts } from './advance-funding.service';
import { getOutstandingAdvanceBalance } from './advance-shared.service';
import { loadExpenseTypeNames, pickExpenseDisplayName } from './expense-type-display';
import { opsExpenseContainerIdList, shipmentContainerNumberMap } from './ops-expenses.service';
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
    // QA 28/11 finding 13 — the wallet credited a settlement only when a
    // POSTED treasuryMovement referenced its ledger entry, but settlement
    // phiếu creation never posts treasury movements (LedgerService.postEntry
    // writes the ledger row only), so this arm was structurally empty: the
    // wallet showed Đã trả lại ₫0 and a stale balance while accounting —
    // which nets RECORDED refundAmount per the SIL-1056 law (a RECORDED
    // settlement phiếu IS the settlement itself, advance-shared.service) —
    // showed ₫0 remaining. Count the phiếu's own signed refundAmount so both
    // roles converge by construction; a voided/reversed phiếu drops out via
    // status = 'RECORDED'.
    executor.select({ refundAmount: s.advanceSettlements.refundAmount }).from(s.advanceSettlements)
      .where(and(eq(s.advanceSettlements.forwarderId, userId), eq(s.advanceSettlements.status, 'RECORDED'))),
    executor.select({ amount: s.treasuryMovements.amount, direction: s.treasuryMovements.direction })
      .from(s.expenseCashVouchers).innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId)).where(and(eq(s.expenseCashVouchers.counterpartyType, 'FORWARDER'),
        eq(s.expenseCashVouchers.counterpartyId, userId), eq(s.expenseCashVouchers.status, 'RECORDED'))),
  ]);

  const funded = await getAdvanceFundedAmounts(executor, advanceRows.map(row => row.id));
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
    approvedRefundAmounts: [...refundRows.map(row => Number(row.refundAmount)), ...expenseCash.filter(row => row.direction === 'IN').map(row => row.amount)],
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
   * window", and with no window the opening is 0 and `periodClosing` equals
   * the whole-history `closing`. `periodOpening` is the cumulative total
   * STRICTLY BEFORE `from`, so `periodOpening + (net in window)` is
   * `periodClosing` and a window can never disagree with the closing it is a
   * slice of.
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
    db.select({ id: s.opsExpenseEntries.id, paidAt: s.opsExpenseEntries.paidAt, expenseTypeCode: s.opsExpenseEntries.expenseTypeCode, expenseTypeName: s.forwarderExpenseTypes.name, feeName: s.opsExpenseEntries.feeName, note: s.opsExpenseEntries.note, amount: s.opsExpenseEntries.amount, shipmentContainerId: s.opsExpenseEntries.shipmentContainerId, shipmentContainerIds: s.opsExpenseEntries.shipmentContainerIds })
      .from(s.opsExpenseEntries)
      // The "Diễn giải" line is read by a person, so it carries the catalog's
      // Vietnamese label — never the machine code. Same rule as the wallet
      // history ("Loại phí"): a custom fee_name wins, but only when it is a
      // real name (rows written before that rule stored the code here).
      .leftJoin(s.forwarderExpenseTypes, eq(s.forwarderExpenseTypes.code, s.opsExpenseEntries.expenseTypeCode))
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
    db.select({ settlementId: s.advanceSettlements.id, amount: s.advanceSettlements.refundAmount, valueDate: s.advanceSettlements.createdAt, settlementCode: s.advanceSettlements.code })
      // Finding 13 — same authority as the wallet summary: the RECORDED phiếu
      // is the settlement (SIL-1056); the movement join starved this arm too.
      .from(s.advanceSettlements)
      .where(and(eq(s.advanceSettlements.forwarderId, userId), eq(s.advanceSettlements.status, 'RECORDED'))),
    db.select({ code: s.expenseCashVouchers.code, createdAt: s.expenseCashVouchers.createdAt, amount: s.treasuryMovements.amount, direction: s.treasuryMovements.direction })
      .from(s.expenseCashVouchers).innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId))
      .where(and(eq(s.expenseCashVouchers.counterpartyType, 'FORWARDER'),
        eq(s.expenseCashVouchers.counterpartyId, userId), eq(s.expenseCashVouchers.status, 'RECORDED'))),
    getOpsWalletSummary(userId),
  ]);

  const funded = await getAdvanceFundedAmounts(db, advanceRows.map((row) => row.id));
  const proxyTypeNames = await loadExpenseTypeNames(proxyRows.map((row) => row.expenseType));
  // P2 QA — the Sổ quỹ "Diễn giải" names the container scope the wallet
  // record holds (the SIL-881 set column; legacy single-id fallback), so the
  // operator can match a cash row to the conts it was spent on. ONE batched
  // id→number query, never N joins. Chung lô rows keep their label unchanged.
  const walletContainerNumbers = await shipmentContainerNumberMap(
    db,
    opsExpenseRows.flatMap((row) => opsExpenseContainerIdList(row)),
  );

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
    const expenseName = row.feeName && row.feeName !== row.expenseTypeCode
      ? row.feeName
      : row.expenseTypeName ?? row.expenseTypeCode;
    const contNumbers = opsExpenseContainerIdList(row)
      .map((id) => walletContainerNumbers.get(id) ?? null)
      .filter((name): name is string => Boolean(name));
    const contSuffix = contNumbers.length > 0 ? ` — ${contNumbers.length === 1 ? 'cont' : `${contNumbers.length} cont`}: ${contNumbers.join(', ')}` : '';
    items.push({ key: `ops-expense-${row.id}`, date: fundBookIsoDate(row.paidAt), kind: 'EXPENSE', label: `Chi phí: ${expenseName}${contSuffix}${row.note ? ` — ${row.note}` : ''}`, reference: null, amount: String(-Math.round(expenseAmount)) });
  }
  for (const row of proxyRows) {
    // Card 20260928_181 — same rule for the trip-expense entries.
    const expenseAmount = Number(row.buyAmount);
    if (expenseAmount <= 0) continue;
    // Card 071026141580: the "Diễn giải" line never prints the machine code —
    // "khai chi hộ" trip rows carry no custom fee name, and the catalog holds
    // the Vietnamese label ("Phí chi hộ khác" for OTHER).
    const label = `Chi phí: ${pickExpenseDisplayName(row.feeName, row.expenseType, proxyTypeNames.get(row.expenseType))}`;
    items.push({ key: `trip-expense-${row.id}`, date: fundBookIsoDate(row.expenseDate ?? row.createdAt), kind: 'EXPENSE', label, reference: null, amount: String(-Math.round(expenseAmount)) });
  }
  for (const row of refundRows) {
    items.push({ key: `refund-${row.settlementId}`, date: fundBookIsoDate(row.valueDate), kind: 'REFUND', label: 'Hoàn tiền về công ty', reference: row.settlementCode, amount: String(-Math.round(Number(row.amount))) });
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
  // Pre-demo audit (sổ quỹ period summary): the opening is the cumulative
  // balance STRICTLY BEFORE `from` (0 when nothing is windowed), and the
  // closing is that opening plus the window's net — i.e. the balance as of the
  // end of `to`. The old pair read the window's NET as the closing and pushed
  // `closing − net` into the opening, so an item dated AFTER `to` was silently
  // counted as opening and "Số dư cuối kỳ" was a net, not a balance.
  // `periodOpening + (window net)` is `periodClosing` by construction, and the
  // closing is `closing` as soon as the window reaches the last item.
  const periodOpeningBig = from === null
    ? 0n
    : items.reduce((total, item) => total + (item.date < from ? BigInt(item.amount) : 0n), 0n);
  const periodClosingBig = periodOpeningBig
    + periodItems.reduce((total, item) => total + BigInt(item.amount), 0n);
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
