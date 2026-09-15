/**
 * Ops wallet summary (docs/prd/OpsVanHanh.md §5.2) — the four dashboard cards.
 *
 *   SỐ DƯ HIỆN TẠI = Σ APPROVED advance_requests − (Σ APPROVED + Σ PENDING expenses)
 *                     − Σ refundAmount of APPROVED advance_settlements
 *
 * Availability policy: PENDING expenses reserve funds; APPROVED settlement
 * refunds (money returned to the company) reduce available cash — a returned
 * amount is never spendable; REJECTED expenses release their reservation
 * (rejection moves the amount out of the pending bucket, restoring the
 * balance by construction). Each approved settlement's refund counts exactly
 * once. Sums are all-time per user — settled entries stay counted in
 * "Đã duyệt" ("chưa + đã quyết toán"), so the formula never double-counts.
 * The balance may be negative: the card shows the honest debt as-is.
 *
 * numeric(15,0) serializes as strings; math runs on BigInt and the summary
 * returns integer strings to keep VND exact.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, eq } from 'drizzle-orm';

export type OpsMoney = string;

export interface OpsWalletSummary {
  /** Σ APPROVED advance_requests của Ops */
  totalAdvance: OpsMoney;
  /** Σ chi phí APPROVED (chưa + đã quyết toán) */
  approved: OpsMoney;
  /** Σ chi phí PENDING */
  pending: OpsMoney;
  /** Σ chi phí REJECTED */
  rejected: OpsMoney;
  /** Σ refundAmount của advance_settlements ĐÃ DUYỆT — tiền đã trả lại công ty */
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
}): OpsWalletSummary {
  const totalAdvance = sumAmounts(input.approvedAdvanceAmounts);
  const approved = sumAmounts(input.expenseAmounts.APPROVED);
  const pending = sumAmounts(input.expenseAmounts.PENDING);
  const rejected = sumAmounts(input.expenseAmounts.REJECTED);
  const returned = sumAmounts(input.approvedRefundAmounts ?? []);
  const balance = totalAdvance - approved - pending - returned;
  return {
    totalAdvance: totalAdvance.toString(),
    approved: approved.toString(),
    pending: pending.toString(),
    rejected: rejected.toString(),
    returned: returned.toString(),
    balance: balance.toString(),
  };
}

export async function getOpsWalletSummary(userId: number): Promise<OpsWalletSummary> {
  const [advanceRows, expenseRows, refundRows] = await Promise.all([
    db
      .select({ amount: s.advanceRequests.amount })
      .from(s.advanceRequests)
      .where(and(
        eq(s.advanceRequests.requesterId, userId),
        eq(s.advanceRequests.status, 'RECORDED'),
      )),
    db
      .select({ status: s.opsExpenseEntries.approvalStatus, amount: s.opsExpenseEntries.amount })
      .from(s.opsExpenseEntries)
      .where(eq(s.opsExpenseEntries.paidById, userId)),
    // Approved advance-settlement refunds (PT- domain): returned money is no
    // longer spendable. PENDING/REJECTED settlements never deduct here.
    db
      .select({ refundAmount: s.advanceSettlements.refundAmount })
      .from(s.advanceSettlements)
      .where(and(
        eq(s.advanceSettlements.forwarderId, userId),
        eq(s.advanceSettlements.status, 'RECORDED'),
      )),
  ]);

  return computeOpsWalletSummary({
    approvedAdvanceAmounts: advanceRows.map((row) => row.amount),
    expenseAmounts: {
      PENDING: expenseRows.filter((row) => row.status === 'PENDING').map((row) => row.amount),
      APPROVED: expenseRows.filter((row) => (row.status === 'RECORDED' || row.status === 'APPROVED')).map((row) => row.amount),
      REJECTED: expenseRows.filter((row) => (row.status === 'VOIDED' || row.status === 'REJECTED')).map((row) => row.amount),
    },
    approvedRefundAmounts: refundRows.map((row) => row.refundAmount),
  });
}
