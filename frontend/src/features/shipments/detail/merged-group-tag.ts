/**
 * SIL-1166 (KB K3.79/K4.31) — the PHÂN LOẠI "Ghép (k/N)" tag of a merged LCL
 * lot, shared by the /shipments-detail ledger and the chi tiết lô pair-facts
 * block so the two surfaces can never disagree.
 *
 * k = the lot's 1-based group order, N = the group's LIVE member count
 * (soft-deleted members excluded — the read side computes it).
 *
 * W3A precedence (the master-plan chip's law, lclLotFlag/SIL-972): the COST
 * side (Ghép trả ĐV) leads when the lot is in a cost group, otherwise the
 * REV side (Gộp hàng — Ghép thu cước). A grouped lot on a wire that predates
 * the counts degrades to a bare "Ghép" — never fabricate a k/N.
 */

export interface MergedGroupFacts {
  costGroupId?: string | null;
  costGroupOrder?: number | null;
  costGroupMemberCount?: number | null;
  revGroupId?: string | null;
  revGroupOrder?: number | null;
  revGroupMemberCount?: number | null;
}

export function mergedGroupTag(facts: MergedGroupFacts): string | null {
  const costSide = facts.costGroupId != null;
  const groupId = costSide ? facts.costGroupId : facts.revGroupId;
  if (groupId == null) return null;
  const order = costSide ? facts.costGroupOrder : facts.revGroupOrder;
  const count = costSide ? facts.costGroupMemberCount : facts.revGroupMemberCount;
  return order != null && count != null ? `Ghép (${order}/${count})` : 'Ghép';
}
