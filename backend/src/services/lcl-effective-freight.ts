// F-2 (card 161026113900, owner ruling b) + FB-145 (card 231026163927, QA
// R39) — ONE pure rule for what the money boards print as a lot's CƯỚC VẬN
// TẢI (AUTO): which money channel wins, and when a number behind a group
// citation must read UNSET ("Chưa xác định") instead of a stale 0₫.
//
// Split out of shipment-debit-summary.service as a PURE function so the unit
// tree can pin the law without a db import (2026-10-19 owner ruling), the
// same seam as lcl-grouping-law.
//
// Channels (F-2, unchanged):
//   override ⇔ an LCL lot that is REV-grouped (revGroupId set) OR whose live
//   trip carries a revenue-override stamp (FB-095 re-stamps can leave the
//   survivor of a dissolved 2-lot group UNGROUPED). Value = Σ live-trip
//   revenue, falling back to the snapshot channel when the override channel
//   holds no number (merged trip-less lot).
//   snapshot ⇔ everyone else: the latest trip-NULL freightRateSnapshot.
//
// FB-145 additions — a group artifact is NOT a live price:
//   1. An UNGROUPED lot whose latest snapshot note is a rev-group citation
//      citing NO money (total 0 — the merge member-zero tail, or the "chờ
//      định giá lại" citation the unmerge writes for a lot that never had a
//      price) reads UNSET. The lot went back to "từng xe riêng" — its price
//      comes back only through the per-lot outputs (§4.1) or a re-materialized
//      pre-merge snapshot (whose note "Tách nhóm — trở về cước thu trước ghép"
//      is NOT a citation of a dead group state and keeps its amount).
//      SIL-491: a citation carrying a NON-zero amount is live money, never an
//      artifact — the FB-095 crown inheritance ("Đón cước chính khi tách nhóm
//      (từ Bill X) — 100% cước thu": the group's whole cước thu follows the
//      promoted lot, the group never falls to 0₫) and the lot's own re-cited
//      price (REV_LOT_OWN_CUOC_REASON) must print, not mask. Writer invariant
//      (D02): lost money is re-cited as a 0₫ WITH its reason, so a non-zero
//      citation is by construction a real transfer/own price.
//   2. An override whose reason is the awaiting-reprice citation reads UNSET
//      for the same reason (single-lot unmerge "1 lô về riêng" with a live
//      trip: revenue stays 0₫ citing the wait — QA must read "Chưa xác
//      định", the trip money is untouched for the reprice).
//
// D02 stays honored: the writers keep citing 0₫ WITH its reason (a computed
// zero is a value); this rule only governs what a BOARD prints from it.
import { isRevGroupNote, REV_LOT_AWAITING_REPRICE_REASON } from './lcl-rev-notes';

export interface LclFreightChannelFacts {
  /** The snapshot channel as the boards read it: Σ active trip-leg freezes
   *  (real prices, formulaNote null) or the latest trip-NULL intake row with
   *  its formula note (null when the lot has no snapshot row at all). */
  snapshotChannel: { total: number; formulaNote: string | null } | null;
  /** Override-channel facts (Σ live-trip revenue, first stamp, any-stamp
   *  flag); null when the lot has no live trip. */
  override: { total: number | null; reason: string | null; stamped: boolean } | null;
  /** shipments.rev_group_id — null once the lot leaves its group. */
  revGroupId: string | null;
  /** shipments.rev_group_order (Lô 1 = 1). */
  revGroupOrder: number | null;
  /** Số Bill/Booking of the group's Lô 1 (member note copy). */
  revPrincipalRef?: string | null;
  /** shipments.cargoMode ('LCL' | 'FCL'; null on legacy rows ⇒ snapshot
   *  channel, same as the pre-FB-145 inline rule). */
  cargoMode: string | null;
}

export interface EffectiveLclFreight {
  value: number | null;
  reason: string | null;
}

export function effectiveLclFreight(facts: LclFreightChannelFacts): EffectiveLclFreight {
  // A group citation is a dead-group artifact only when it cites NO money
  // (D02 zeros). A non-zero citation is live money — the FB-095 crown
  // inheritance or the lot's own re-cited price (SIL-491).
  const deadGroupCitation = facts.snapshotChannel != null
    && facts.snapshotChannel.total === 0
    && isRevGroupNote(facts.snapshotChannel.formulaNote);
  // FCL lots never followed the group law — byte-for-byte snapshot channel.
  if (facts.cargoMode !== 'LCL') {
    return { value: facts.snapshotChannel?.total ?? null, reason: null };
  }
  const qualified = facts.revGroupId != null || (facts.override?.stamped ?? false);
  if (!qualified) {
    // FB-145 rule 1: the latest snapshot being a group citation citing no
    // money means the lot's own price is GONE with the group — "Chưa xác
    // định", never the cited 0₫ (or the merge's member-zero tail).
    if (deadGroupCitation) {
      return { value: null, reason: null };
    }
    return { value: facts.snapshotChannel?.total ?? null, reason: null };
  }
  // FB-145 rule 2: awaiting-reprice citation on the override channel — unset.
  if (facts.override?.reason === REV_LOT_AWAITING_REPRICE_REASON) {
    return { value: null, reason: REV_LOT_AWAITING_REPRICE_REASON };
  }
  const memberNote = (facts.revGroupOrder ?? 1) > 1
    ? `Ghép cước cùng Bill ${facts.revPrincipalRef ?? ''}`.trim()
    : null;
  // F-2: override first; a merged lot with no live trip falls back to the
  // snapshot channel (the merge materialized each lot's own lane price).
  // Still null when neither channel holds a number ("Chưa xác định" — never
  // a fabricated 0). The fallback snapshot, too, must not be a group
  // citation citing no money (FB-145 rule 1 applies to both paths; SIL-491
  // keeps a non-zero crown snapshot printable for the promoted Lô 1 of a
  // still-live group).
  const fallback = deadGroupCitation
    ? null
    : facts.snapshotChannel?.total ?? null;
  return {
    value: facts.override?.total ?? fallback,
    reason: facts.override?.reason ?? memberNote,
  };
}
