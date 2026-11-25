// SIL-883 (3.2) — the pending-approval fee guard behind the hard block on
// [Khóa lô] / [Chọn Debit] / [Xuất Debit Note]: a lot carrying ≥1 saved fee
// whose accounting-source link has no confirm stamp may not leave the debit
// chain until Kế toán duyệt (or từ chối) every row.
//
// The state machine is the /advances Tab Chi phí Ops axis (OpsAccountantTab):
//   - Duyệt   = `expense_accounting_sources.confirmed_at` set (batch confirm);
//   - Từ chối = `ops_expense_entries.approval_status='REJECTED'` (+ VOIDED
//     source) — such rows are gone from the boards already, not pending;
//   - Chờ duyệt = a RECORDED entry whose OPS source link has confirmed_at NULL.
// VOIDED entries (owner delete) are neither pending nor rejected: they keep
// the chot-debit board's counting law and never block here.
//
// Both reads and guards resolve through THIS module so the red cell the user
// sees (debit-merge) and the 409 the API answers are the same number.
import { and, count, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import * as s from '../db/schema';
import { db } from '../db';
import type { Executor, Tx } from '../db';
import { ApiError } from '../errors';
import { billOrBookNumberFor } from './cus-workspace-mapping.service';

/** Per-lot count of saved fees awaiting Kế toán duyệt. Empty map = nothing
 *  pending; absent key = 0. */
export async function pendingFeeCountsByLot(
  executor: Executor | Tx | typeof db,
  shipmentIds: number[],
): Promise<Map<number, number>> {
  if (shipmentIds.length === 0) return new Map();
  const rows = await executor
    .select({
      shipmentId: s.opsExpenseEntries.shipmentId,
      pending: count(),
    })
    .from(s.opsExpenseEntries)
    .innerJoin(
      s.expenseAccountingSources,
      and(
        eq(s.expenseAccountingSources.sourceKind, 'OPS'),
        eq(s.expenseAccountingSources.sourceId, s.opsExpenseEntries.id),
        isNull(s.expenseAccountingSources.confirmedAt),
      ),
    )
    .where(and(
      inArray(s.opsExpenseEntries.shipmentId, shipmentIds),
      notInArray(s.opsExpenseEntries.approvalStatus, ['REJECTED', 'VOIDED']),
    ))
    .groupBy(s.opsExpenseEntries.shipmentId);
  const byLot = new Map<number, number>();
  for (const row of rows) {
    if (row.shipmentId == null) continue;
    byLot.set(row.shipmentId, Number(row.pending));
  }
  return byLot;
}

/** The user-facing block sentence (SIL-890's exact text, action-prefixed). */
export function pendingFeeBlockMessage(actionLabel: string, billLabel: string, count: number): string {
  return `Không thể ${actionLabel}: Lô ${billLabel} còn ${count} khoản chi phí chưa được Kế toán duyệt.`;
}

/** Guard for the three money actions: 409 naming the FIRST pending lot (by
 *  selection order) with its Số Bill/Booking and its pending count. */
export async function assertNoPendingApprovalFees(
  executor: Executor | Tx | typeof db,
  shipmentIds: number[],
  actionLabel: string,
): Promise<void> {
  const counts = await pendingFeeCountsByLot(executor, shipmentIds);
  const blocked = shipmentIds.filter((id) => (counts.get(id) ?? 0) > 0);
  if (blocked.length === 0) return;
  const first = blocked[0]!;
  const [lot] = await executor
    .select({
      tradeDirection: s.shipments.tradeDirection,
      blNumber: s.shipments.blNumber,
      bookingRef: s.shipments.bookingRef,
    })
    .from(s.shipments)
    .where(eq(s.shipments.id, first))
    .limit(1);
  const billLabel = lot != null
    ? billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef) ?? `#${first}`
    : `#${first}`;
  throw new ApiError(409, pendingFeeBlockMessage(actionLabel, billLabel, counts.get(first)!));
}
