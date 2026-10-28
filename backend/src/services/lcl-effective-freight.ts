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
//      AND whose amount is ZERO reads UNSET (merge member-zero tail, the
//      "chờ định giá lại" citation the unmerge writes for a lot that never
//      had a price, the moved-out "chuyển 100%" tail). The lot went back to
//      "từng xe riêng" — its price comes back only through the per-lot
//      outputs (§4.1) or a re-materialized pre-merge snapshot (whose note
//      "Tách nhóm — trở về cước thu trước ghép" is NOT a citation of a dead
//      group state and keeps its amount). A cited NON-ZERO is the writer's
//      real money — the FB-095 promote's "Đón cước chính … — 100% cước thu"
//      the crown left behind, or a kept own-cước marker — and reads
//      (SIL-489/SIL-490: hiding it made the merge/unmerge toasts lie).
//   2. An override whose reason is the awaiting-reprice citation reads UNSET
//      for the same reason (single-lot unmerge "1 lô về riêng" with a live
//      trip: revenue stays 0₫ citing the wait — QA must read "Chưa xác
//      định", the trip money is untouched for the reprice).
//
// D02 stays honored: the writers keep citing 0₫ WITH its reason (a computed
// zero is a value); this rule only governs what a BOARD prints from it.
import { isRevGroupNote, isRevManualPriceNote, REV_LOT_AWAITING_REPRICE_REASON } from './lcl-rev-notes';

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
  // FCL lots never followed the group law — byte-for-byte snapshot channel.
  if (facts.cargoMode !== 'LCL') {
    return { value: facts.snapshotChannel?.total ?? null, reason: null };
  }
  const qualified = facts.revGroupId != null || (facts.override?.stamped ?? false);
  if (!qualified) {
    // FB-145 rule 1 — a cited ZERO behind an ungrouped lot is a group
    // artifact (the merge's member-zero tail, the "chờ định giá lại"
    // citation, the moved-out "chuyển 100%" tail): "Chưa xác định", never a
    // stale 0₫. A cited NON-ZERO is real money the service just moved or
    // kept on the lot (the FB-095 promote's "Đón cước chính … — 100% cước
    // thu", the 21/10-era own-cước marker) — it reads (SIL-490: the
    // promotee's inherited 100% must reach the board or the toast lies).
    if (facts.snapshotChannel != null
      && facts.snapshotChannel.total === 0
      && isRevGroupNote(facts.snapshotChannel.formulaNote)) {
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
  // snapshot channel — INCLUDING the merge's own materialized rows. Their
  // citation prose is the ACTIVE group's price state (Lô 1's 100%, the
  // members' cited 0₫ — D02), not a dead-group artifact: while the group
  // stands those rows ARE the live board price (SIL-489 — the FB-145
  // citation filter's scope is the UNGROUPED lot, rule 1 verbatim; it never
  // reached a still-grouped lot). Still null when neither channel holds a
  // number ("Chưa xác định" — never a fabricated 0).
  return {
    value: facts.override?.total ?? facts.snapshotChannel?.total ?? null,
    reason: facts.override?.reason ?? memberNote,
  };
}

/**
 * SIL-548 (id 615, QA fail round 3) — the lot's SAVED manual "Giá cước thu
 * khách" (spec §4.1 field 2: "nhập tay = giá thỏa thuận thắng giá tra bảng"),
 * classified from the SAME channels `effectiveLclFreight` reads (never a
 * parallel one): the winning channel's writer note decides — a typed
 * negotiated price (`isRevManualPriceNote`) reads back as the number CUS
 * saved so the per-lot editor can prefill it on reopen; anything else (auto
 * trace, group artifact, nothing saved) reads null = the editor's blank
 * "Bỏ trống = tự tra" state. Channel precedence mirrors the money board
 * byte-for-byte: the override channel wins for a qualified lot (rev-grouped
 * or stamped), the snapshot channel otherwise.
 */
export function revManualPrice(facts: LclFreightChannelFacts): number | null {
  const qualified = facts.revGroupId != null || (facts.override?.stamped ?? false);
  const winner = qualified && facts.override?.total != null
    ? { value: facts.override.total, note: facts.override.reason }
    : facts.snapshotChannel == null
      ? null
      : { value: facts.snapshotChannel.total, note: facts.snapshotChannel.formulaNote };
  return winner != null && isRevManualPriceNote(winner.note) ? winner.value : null;
}
