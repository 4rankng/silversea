/**
 * OPS cash position: recorded advances + actual reimbursements - personal OPS
 * expenditure - pending reservations - actual returned advances. Company-paid
 * expenses never consume an employee's wallet. Reconciliation by itself does not
 * create cash; active expense vouchers derive cash from canonical treasury entries.
 * Legacy settlement refund fields alone do not prove returned cash.
 * VND sums use BigInt and return integer strings without rounding large balances.
 */
import { TxnType } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { getAdvanceFundedAmounts } from './advance-funding.service';
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
    expenseAmounts: {
      PENDING: expenseRows.filter((row) => row.status === 'PENDING').map((row) => row.amount),
      APPROVED: [...expenseRows, ...proxyRows].filter((row) => (row.status === 'RECORDED' || row.status === 'APPROVED')).map((row) => row.amount),
      REJECTED: expenseRows.filter((row) => (row.status === 'VOIDED' || row.status === 'REJECTED')).map((row) => row.amount),
    },
    approvedRefundAmounts: [...refundRows.map(row => row.amount), ...reversedRefunds.map(row => -Number(row.amount)), ...expenseCash.filter(row => row.direction === 'IN').map(row => row.amount)],
    reimbursementAmounts: expenseCash.filter(row => row.direction === 'OUT').map(row => row.amount),
  });
}
