/**
 * SIL-638 (id 742) — pure ghép-chuyến (Kẹp / Kết hợp) decision rules.
 *
 * Db-free by the BE unit-only ruling (2026-10-19): backend/src/tests/unit
 * imports this module directly, and the transactional services
 * (trip-pairs.service, dispatch-resource-availability.service) wire the
 * verdicts into their scans. Source of the texts and rules is the owner's
 * DOC logic-hang-kep-kethop (ticket SIL-638 id 742) — the ticket prose is a
 * paraphrase; the DOC texts below are verbatim.
 */
import { localDateInBusinessZone } from '@tingting/shared';

export type ContainerFootClass = '20' | '40';

/** DOC TC6(1) — verbatim refusal text for a non-20ft kẹp pair. */
export const KEP_CONTAINER_SIZE_BLOCK_MESSAGE = 'Cặp kẹp chỉ áp dụng cho đúng 02 container loại 20ft';

/** DOC TC7(1) — verbatim refusal text for mismatched kết hợp sizes. */
export const COMBINED_CONTAINER_SIZE_BLOCK_MESSAGE =
  "Hàng kết hợp yêu cầu 2 lệnh phải có cùng kích cỡ container (cùng 20' hoặc cùng 40')";

/** DOC TC6(2) — verbatim soft-warning text (409 payload + FE toast). */
export const KEP_WEIGHT_WARNING_MESSAGE =
  'Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương tiện, Điều vận vui lòng kiểm tra lại';

/** 409 payload code the FE uses to offer the confirm-and-retry dialog. */
export const KEP_WEIGHT_WARNING_CODE = 'KEP_WEIGHT_WARNING';

/**
 * Length class of a container-type code ("20DV" → 20, "40HC" → 40). Codes
 * outside the two classes (or missing) resolve null — callers decide whether
 * null blocks (kẹp needs proof) or skips (kết hợp cannot prove a mismatch).
 */
export function containerFootClass(code: string | null | undefined): ContainerFootClass | null {
  const trimmed = (code ?? '').trim();
  if (trimmed.startsWith('20')) return '20';
  if (trimmed.startsWith('40')) return '40';
  return null;
}

/**
 * TC6(1) — the kẹp clamp carries exactly two 20ft boxes. Refuses unless BOTH
 * sides prove 20': the pairing gate's existing law already refused a shell
 * with no type code (an unprovable shell cannot be trusted onto a clamp), so
 * missing codes stay blocking — now with the DOC's verbatim text.
 */
export function kepContainerSizeBlockMessage(
  firstCode: string | null | undefined,
  secondCode: string | null | undefined,
): string | null {
  return containerFootClass(firstCode) === '20' && containerFootClass(secondCode) === '20'
    ? null
    : KEP_CONTAINER_SIZE_BLOCK_MESSAGE;
}

/**
 * TC7(1) — kết hợp reuses ONE shell across both orders, so both legs must be
 * the same length class (20+20 and 40+40 both pass — unlike kẹp). A side
 * whose size is not yet known cannot prove a mismatch: the same "bổ sung sau"
 * convention as the pair's container-number rule, so missing codes skip.
 */
export function combinedContainerSizeBlockMessage(
  firstCode: string | null | undefined,
  secondCode: string | null | undefined,
): string | null {
  const first = containerFootClass(firstCode);
  const second = containerFootClass(secondCode);
  if (first == null || second == null) return null;
  return first === second ? null : COMBINED_CONTAINER_SIZE_BLOCK_MESSAGE;
}

/**
 * TC7(2) — when a COMBINED pair forms and Lệnh 2's số container is still
 * blank, it inherits Lệnh 1's shell number (the pair shares one physical
 * shell by definition, and the pair's own number rule enforces equality
 * whenever both sides are filled). Returns null unless the inheritance
 * applies: Lệnh 1 filled, Lệnh 2 blank (whitespace counts as blank).
 */
export function containerNumberToInherit(
  firstNumber: string | null | undefined,
  secondNumber: string | null | undefined,
): string | null {
  const first = (firstNumber ?? '').trim();
  const second = (secondNumber ?? '').trim();
  if (!first || second) return null;
  return first;
}

/**
 * TC6(2) — the kẹp 2×20' weight gate, verbatim semantics of the snippet the
 * trip-side rig guard ran at its three carve sites: the verdict proves
 * overload only when the rig declares a capacity AND both container weights
 * are finite numbers; anything else is unprovable (the check is skipped, the
 * existing missing-capacity advisory owns that case).
 */
export type KepPairWeightVerdict = 'pass' | 'unprovable' | 'overload';

export function kepPairWeightVerdict(
  cargoWeightKg: string | number | null | undefined,
  partnerWeightKg: string | number | null | undefined,
  vehicleCapacityKg: string | number | null | undefined,
): KepPairWeightVerdict {
  if (vehicleCapacityKg == null) return 'unprovable';
  const weights = [cargoWeightKg, partnerWeightKg];
  if (!weights.every((weight) => weight != null && Number.isFinite(Number(weight)))) return 'unprovable';
  const sum = weights.reduce<number>((total, weight) => total + Number(weight), 0);
  return sum > Number(vehicleCapacityKg) ? 'overload' : 'pass';
}

/**
 * The DOC soft-warning contract: an overload refuses ONCE (409
 * KEP_WEIGHT_WARNING + DOC text) and the dispatcher's confirmed retry
 * proceeds — never a hard 409, never a silent save. Everything non-overload
 * allows regardless of the flag.
 */
export function kepWeightGuardOutcome(
  verdict: KepPairWeightVerdict,
  confirmed: boolean,
): 'allow' | 'refuse' {
  return verdict === 'overload' && !confirmed ? 'refuse' : 'allow';
}

/**
 * TC1 — the pure law behind the trip-side conflict scan's SQL: a holder with
 * a staged start claims [start, end ?? start + 8h) and blocks an incoming
 * dispatch window only when the two windows strictly overlap. Touching edges
 * are NOT an overlap (the SQL is `holderStart < windowEnd AND holderEnd >
 * windowStart`), so same-day non-overlapping ĐƠN shifts (sáng + chiều) both
 * save — one truck is never "1 lệnh/ngày" — while the same window, or a live
 * CREATED/IN_TRANSIT holder inside the window, blocks. The SQL in
 * assertResourceAvailability and assertPlanRowRigAvailable implements this
 * same law server-side; this mirror exists so the law is unit-pinned.
 */
export const OPEN_ENDED_TRIP_CLAIM_SPAN_HOURS = 8;

export function tripClaimWindowOverlaps(
  holderStartIso: string,
  holderEndIso: string | null | undefined,
  incomingStart: Date,
  incomingEnd: Date,
): boolean {
  const holderStart = new Date(holderStartIso).getTime();
  const stagedEnd = holderEndIso == null ? Number.NaN : new Date(holderEndIso).getTime();
  const holderEnd = Number.isNaN(stagedEnd)
    ? holderStart + OPEN_ENDED_TRIP_CLAIM_SPAN_HOURS * 3_600_000
    : stagedEnd;
  return holderStart < incomingEnd.getTime() && holderEnd > incomingStart.getTime();
}

/** The issuing dispatch-write context the share predicates read. */
export interface KepShareRequest {
  tripId: number | null;
  truckId: number | null;
  trailerId: number | null;
  driverId: number | null;
  kep: {
    issuingContainerIsTwentyFoot: boolean;
    classification: string;
    departureDate: string | null;
  } | null | undefined;
}

/** One blocking holder row of the trip-side conflict scan (narrow view). */
export interface KepSharePartnerRow {
  classification: string | null;
  truckId: number | null;
  trailerId: number | null;
  driverId: number | null;
  plannedStartAt: Date | null;
  activePairId: number | null;
  pairFirstTripId: number | null;
  pairSecondTripId: number | null;
}

/**
 * The issuing leg's declared share mode: Kết hợp → sequential KET_HOP;
 * Kẹp only when the leg is a 20' box (a 40' DOUBLE is not a clamp, so its
 * same-rig overlap keeps the hard tier). Any other classification — including
 * a plain ĐƠN (SINGLE) — resolves null: no carve path exists, so every
 * overlap that holder presents stays blocking (TC2's refusal).
 */
export function declaredKepShareMode(kep: KepShareRequest['kep']): 'KEP' | 'KET_HOP' | null {
  if (kep?.classification === 'COMBINED') return 'KET_HOP';
  return kep?.classification === 'DOUBLE' && kep.issuingContainerIsTwentyFoot ? 'KEP' : null;
}

/**
 * The declared-share carve: the holder is the issuing leg's OWN declared
 * partner — matching classification, the SAME physical rig (truck + trailer +
 * driver), the same Vietnam business day, and not already paired to a third
 * load. Verbatim semantics of the trip-side guard's first carve block.
 */
export function isDeclaredKepSharePartner(
  req: KepShareRequest,
  partner: KepSharePartnerRow,
  mode: 'KEP' | 'KET_HOP' | null,
): boolean {
  if (req.kep == null || mode == null || req.kep.departureDate == null) return false;
  return partner.classification === (mode === 'KEP' ? 'DOUBLE' : 'COMBINED')
    && req.truckId != null && partner.truckId === req.truckId
    && req.trailerId != null && partner.trailerId === req.trailerId
    && req.driverId != null && partner.driverId === req.driverId
    && partner.plannedStartAt != null
    && localDateInBusinessZone(partner.plannedStartAt) === req.kep.departureDate
    && (partner.activePairId == null || (req.tripId != null
      && (partner.pairFirstTripId === req.tripId || partner.pairSecondTripId === req.tripId)));
}

/**
 * dis-03 (card 211026131857) — the mixed-declaration kẹp candidate: the
 * issuing leg declares Kẹp (20') and the one same-rig same-day holder was
 * issued without the Kẹp declaration. The share is the dispatcher's
 * deliberate arrangement, so it rides the FB-012 warn-once contract
 * (confirmable) instead of dead-ending on the hard tier; the weight gate
 * still applies. A ĐƠN ISSUING onto a kẹp holder never lands here (the
 * issuing classification resolves no KEP mode) — that direction keeps the
 * hard refusal, which is TC2's contract.
 */
export function isMixedDeclarationKepCandidate(
  req: KepShareRequest,
  partner: KepSharePartnerRow,
): boolean {
  if (declaredKepShareMode(req.kep) !== 'KEP') return false;
  if (req.kep == null || req.kep.departureDate == null) return false;
  return partner.classification !== 'DOUBLE'
    && req.truckId != null && partner.truckId === req.truckId
    && req.trailerId != null && partner.trailerId === req.trailerId
    && req.driverId != null && partner.driverId === req.driverId
    && partner.plannedStartAt != null
    && localDateInBusinessZone(partner.plannedStartAt) === req.kep.departureDate;
}

/**
 * O2C "kẹp hàng" backhaul toll dedup (TC3 / TC7 — VETC once per pair). A
 * paired two-way run physically pays the closed-loop VETC toll once, so the
 * second trip carries a `tollDeduction` equal to its gross toll. Returns the
 * derived-field delta to persist on the second trip so its stored `tollCost`
 * and `totalCost` stay consistent with computeTripTotals (net =
 * max(0, gross − ded)). Trip 1 keeps its full toll (the pair bears the toll
 * once across both trips). Kind-agnostic: the pairing flow applies it to KEP
 * and KET_HOP alike (both share one physical run's toll).
 */
export interface BackhaulTollTrip {
  tollsStations: number | null;
  tollPerStationApplied: string | number | null;
  tollDeduction: string | number | null;
  tollCost: string | number | null;
  reconciledTollCost: string | number | null;
}

export function backhaulTollDeductionForSecond(trip: BackhaulTollTrip): {
  tollDeduction: string;
  tollCost: string;
  totalCostDelta: number;
} {
  const grossToll = (trip.tollsStations ?? 0) * Number(trip.tollPerStationApplied ?? 0);
  const previousNetToll = Number(trip.tollCost ?? 0);
  const newNetToll = trip.reconciledTollCost == null ? 0 : Number(trip.reconciledTollCost);
  return {
    tollDeduction: String(grossToll),
    tollCost: String(newNetToll),
    totalCostDelta: newNetToll - previousNetToll,
  };
}

/**
 * Pair salary (TC3 / TC7 — lương cặp = cuốc cơ bản + phụ phí, moved verbatim
 * from pair-salary-settings.service so the rule is unit-pinnable; that module
 * re-exports it). With no surcharge configured (0) the rule stays inactive —
 * pairing must not silently zero an existing wage before kế toán has set a
 * real phụ phí.
 */
export interface PairSalarySettings {
  /** Surcharge (VND) added to the base cuốc for a KEP pair. */
  kepSurcharge: number;
  /** Surcharge (VND) added to the base cuốc for a KET_HOP pair. */
  ketHopSurcharge: number;
}

/** The single read point for "what surcharge does this pair kind pay". */
export function pairSurchargeFor(
  kind: 'KEP' | 'KET_HOP',
  settings: PairSalarySettings,
): number {
  return kind === 'KEP' ? settings.kepSurcharge : settings.ketHopSurcharge;
}
