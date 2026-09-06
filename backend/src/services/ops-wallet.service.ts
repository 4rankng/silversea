/**
 * Ops wallet summary (docs/prd/OpsVanHanh.md §5.2) — the four dashboard cards.
 *
 *   SỐ DƯ HIỆN TẠI = Σ APPROVED advance_requests − (Σ APPROVED + Σ PENDING expenses)
 *
 * Rejected expenses never touch the balance: rejection moves the amount out of
 * the pending bucket, which restores it to the balance by construction. Sums
 * are all-time per user — settled entries stay counted in "Đã duyệt"
 * ("chưa + đã quyết toán"), so the formula never double-counts.
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
  /** totalAdvance − (approved + pending); may be negative */
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
}): OpsWalletSummary {
  const totalAdvance = sumAmounts(input.approvedAdvanceAmounts);
  const approved = sumAmounts(input.expenseAmounts.APPROVED);
  const pending = sumAmounts(input.expenseAmounts.PENDING);
  const rejected = sumAmounts(input.expenseAmounts.REJECTED);
  const balance = totalAdvance - approved - pending;
  return {
    totalAdvance: totalAdvance.toString(),
    approved: approved.toString(),
    pending: pending.toString(),
    rejected: rejected.toString(),
    balance: balance.toString(),
  };
}

export async function getOpsWalletSummary(userId: number): Promise<OpsWalletSummary> {
  const [advanceRows, expenseRows] = await Promise.all([
    db
      .select({ amount: s.advanceRequests.amount })
      .from(s.advanceRequests)
      .where(and(
        eq(s.advanceRequests.requesterId, userId),
        eq(s.advanceRequests.status, 'APPROVED'),
      )),
    db
      .select({ status: s.opsExpenseEntries.approvalStatus, amount: s.opsExpenseEntries.amount })
      .from(s.opsExpenseEntries)
      .where(eq(s.opsExpenseEntries.paidById, userId)),
  ]);

  return computeOpsWalletSummary({
    approvedAdvanceAmounts: advanceRows.map((row) => row.amount),
    expenseAmounts: {
      PENDING: expenseRows.filter((row) => row.status === 'PENDING').map((row) => row.amount),
      APPROVED: expenseRows.filter((row) => row.status === 'APPROVED').map((row) => row.amount),
      REJECTED: expenseRows.filter((row) => row.status === 'REJECTED').map((row) => row.amount),
    },
  });
}
