// SIL-1094 (KB §3.6.5 K3.87 + §6.3 K6.32) — ONE merge-note law for the
// customer-facing Debit Note (bảng kê thu tiền): a rev-group member lot's
// row cites the merge in the spec wording "Ghép xe cùng Bill [Số Bill Lô 1]"
// (card 161026232439, spec §II.4 + per boss 21/10). Membership and the Lô 1
// reference are read from the LIVE rev group (the same facts the CUS grid
// shows); the Lô 1 reference mirrors lcl-grouping's lotReference:
// Bill → booking → mã lô. Its own module so the trip draft, the frozen
// consolidated issuance and the đợt preview share ONE law with no
// service→service import cycle.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import type { Executor } from './trip-shared';

export const REV_GROUP_MERGE_NOTE = 'Ghép xe cùng Bill';

export type RevGroupMembership = { revGroupId: string; revGroupOrder: number | null };

export interface RevGroupMergeContext {
  membershipByLot: Map<number, RevGroupMembership>;
  principalRefByGroup: Map<string, string>;
}

/** Live rev-group facts for one lot set: who is a member (and at which
 *  order), plus each group's Lô 1 reference (a soft-deleted principal never
 *  shadows a promoted one — only LIVE order-1 rows are read). */
export async function loadRevGroupMergeContext(
  executor: Executor,
  lotIds: readonly number[],
): Promise<RevGroupMergeContext> {
  const membershipByLot = new Map<number, RevGroupMembership>();
  const principalRefByGroup = new Map<string, string>();
  if (lotIds.length === 0) return { membershipByLot, principalRefByGroup };
  const lots = await executor.select({
    id: s.shipments.id,
    revGroupId: s.shipments.revGroupId,
    revGroupOrder: s.shipments.revGroupOrder,
  }).from(s.shipments).where(inArray(s.shipments.id, [...lotIds]));
  for (const lot of lots) {
    if (lot.revGroupId == null) continue;
    membershipByLot.set(lot.id, { revGroupId: lot.revGroupId, revGroupOrder: lot.revGroupOrder });
  }
  const groupIds = [...new Set([...membershipByLot.values()].map((row) => row.revGroupId))];
  if (groupIds.length === 0) return { membershipByLot, principalRefByGroup };
  const principals = await executor.select({
    id: s.shipments.id,
    revGroupId: s.shipments.revGroupId,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    shipmentCode: s.shipments.shipmentCode,
  }).from(s.shipments)
    .where(and(
      inArray(s.shipments.revGroupId, groupIds),
      eq(s.shipments.revGroupOrder, 1),
      isNull(s.shipments.deletedAt),
    ));
  for (const row of principals) {
    if (row.revGroupId == null || principalRefByGroup.has(row.revGroupId)) continue;
    principalRefByGroup.set(row.revGroupId, row.blNumber ?? row.bookingRef ?? row.shipmentCode ?? `Lô #${row.id}`);
  }
  return { membershipByLot, principalRefByGroup };
}

/** The Debit Note's merge note for ONE lot: a rev-group member (order > 1)
 *  carries "Ghép xe cùng Bill [Số Bill Lô 1]"; Lô 1 (order 1) and every
 *  ungrouped lot keep no note — absence is not data. Pure so the wording law
 *  stays unit-pinned. */
export function revGroupMergeNote(
  membership: RevGroupMembership | undefined,
  principalRefByGroup: ReadonlyMap<string, string>,
): string | null {
  if (membership == null || (membership.revGroupOrder ?? 1) <= 1) return null;
  return `${REV_GROUP_MERGE_NOTE} ${principalRefByGroup.get(membership.revGroupId) ?? ''}`.trim();
}
