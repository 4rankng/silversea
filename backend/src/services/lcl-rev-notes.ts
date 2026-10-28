// FB-145 (card 231026163927, QA R39) — the REV-group prose notes, split out
// of lcl-grouping.service into a db-free module so the READ boards (and the
// unit tests that pin them) can classify a lot's money notes WITHOUT importing
// the service (whose module graph opens the db pool — banned in the unit tree
// by the 2026-10-19 owner ruling).
//
// One vocabulary, two writers, many readers:
//   - lcl-grouping.service WRITEs these notes onto a lot's money channels
//     (override stamp / snapshot formula) when a REV group merges, promotes,
//     restores or releases a lot;
//   - the debit boards READ a lot's latest money note to decide whether the
//     number behind it is a live price or a group artifact awaiting per-lot
//     re-pricing ("Chưa xác định", never a stale 0₫ — FB-145 acceptance).

/** Every prose note the grouping service writes onto a lot's money. Anything
 *  else on a stamp/snapshot is an operator's own edit and must survive a
 *  tách nhóm. */
export const REV_GROUP_NOTE_PREFIXES = [
  'Ghép cước',
  'Ghép thu cước',
  'Tách khỏi nhóm ghép',
  'Tách nhóm — chuyển',
  'Đón cước chính',
  'Tách nhóm — cước thu',
] as const;

export function isRevGroupNote(note: string | null): boolean {
  return note != null && REV_GROUP_NOTE_PREFIXES.some((prefix) => note.startsWith(prefix));
}

/** The per-lot marker a REV lot carries once it no longer shares a bill and
 *  keeps a non-zero cước of its own (21/10-era groups). */
export const REV_LOT_OWN_CUOC_REASON = 'Tách nhóm — cước thu theo đơn giá khách × tuyến (lô độc lập)';

/** A separated lot with a cited 0₫ awaits per-lot re-pricing (D02: a computed
 *  financial zero is a value — it keeps its reason). On a READ board this
 *  citation means UNSET: the lot shows "Chưa xác định" until CUS re-picks its
 *  per-lot outputs (FB-145 acceptance). */
export const REV_LOT_AWAITING_REPRICE_REASON = 'Tách khỏi nhóm ghép — chờ định giá lại';

// ─── SIL-548 (id 615, QA fail round 3) — the MANUAL price vocabulary ────────
// Spec §4.1 field 2: "Giá cước thu khách — nhập tay = giá thỏa thuận thắng
// giá tra bảng". The negotiated override is never a column: the writer stamps
// it onto the same money channel the boards print (live trip ⇒
// trip_financial_state.revenue override stamp; trip-less ⇒ the shipment-level
// freight snapshot), so REOPENING the per-lot editor can only prefill the
// saved price by classifying that note. One vocabulary, both writers
// (per-lot editor save + the merge's Lô-1 manual), one reader rule.

/** The per-lot editor's manual stamp (`setLclLotRevClass` with
 *  `freightRevenue` — "giá nhập tay (thỏa thuận với khách)"). */
export const REV_LOT_MANUAL_PRICE_REASON = 'Chọn giá cước thu khách — giá nhập tay (thỏa thuận với khách)';

/** The merge writer's Lô-1 manual note (§4.2 field 3), kept beside its
 *  matcher so write and read can never drift. */
const REV_GROUP_MANUAL_PRICE_NOTE_PREFIX = 'Ghép cước thu khách — Lô 1 giữ 100% cước thu nhóm (giá nhập tay';

export function revGroupManualPriceNote(vehicleClassCode: string): string {
  return `${REV_GROUP_MANUAL_PRICE_NOTE_PREFIX}, ${vehicleClassCode})`;
}

/** True when the money behind this note is CUS's typed negotiated price —
 *  never an auto trace (whose note reads "Chọn loại xe tính cước thu khách…")
 *  and never a group artifact (the prefixes above). */
export function isRevManualPriceNote(note: string | null): boolean {
  return note != null && (note === REV_LOT_MANUAL_PRICE_REASON
    || note.startsWith(REV_GROUP_MANUAL_PRICE_NOTE_PREFIX));
}
