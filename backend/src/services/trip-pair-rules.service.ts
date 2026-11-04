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
import { localDateInBusinessZone, resolveTripDriverSalary } from '@tingting/shared';

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
 * proceeds — never a hard 409, never a silent save.
 *
 * SIL-638 TC6(2) v2 (owner DOC 31/10 + QA repro 02/11, build ed0056e1): the
 * warning ALSO covers the DOC's missing-data branch — "cont chưa có dữ liệu
 * tải trọng / xe chưa cấu hình tải moóc". The old `unprovable → allow` let a
 * 2×20' 60t pair issue silently (no capacity to prove the sum against) and
 * the then-live auto-pair wiring (removed by SIL-668) created the pair row
 * with no warning and no confirm; a silent save is exactly what the DOC's
 * soft-warning contract forbids. A proven PASS still saves clean, and every
 * refusal is once-only (the confirmed retry proceeds — the dispatcher can
 * always phát lệnh kịp thời).
 */
export function kepWeightGuardOutcome(
  verdict: KepPairWeightVerdict,
  confirmed: boolean,
): 'allow' | 'refuse' {
  if (verdict === 'pass') return 'allow';
  return confirmed ? 'allow' : 'refuse';
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

/**
 * TC2 đợt 2 (QA 01/11) — the classification-mismatch share refusal. The
 * holder leg on this tractor is a DECLARED pair leg (DOUBLE/Kẹp or
 * COMBINED/Kết hợp) while the leg being assigned/issued is a plain ĐƠN: the
 * rig can only be shared when both containers declare the same pair kind, so
 * the mismatch text names the fix instead of the generic "trùng lịch" toast.
 *
 * SIL-638 TC2 round 3 (QA 03/11, staging da2e6fc2): the refusal is SYMMETRIC —
 * gán 2 cont cùng xe khi phân loại KHÔNG đồng nhất (KẸP + ĐƠN) phải bị từ
 * chối CẢ HAI CHIỀU (KẸP→ĐƠN và ĐƠN→KẸP) với cùng message. The reverse arm
 * (a declared leg onto an explicit ĐƠN holder → the same message) lives in
 * the function below; the trip-issue Kẹp-issuing path keeps its dis-03
 * confirmable warn tier (owner ruling card 211026131857 — unchanged, see
 * isMixedDeclarationKepCandidate). Undeclared holders ("bổ sung sau", null)
 * and other cargo-mode values (LCL) stay null — the generic overlap law owns
 * those shapes.
 */
export const CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE =
  'Cần cả 2 cont cùng khai báo KẸP mới cho đi chung xe';

/**
 * SIL-638 TC2 (QA 01/11) — the reverse direction's confirmable tier copy: a
 * KẸP leg issuing onto a ĐƠN holder rides the FB-012 warn-once contract
 * (RIG_OVERLAP_COMPLETED code, confirm proceeds) but must carry the DOC's
 * wording, not the generic "đã được gán cho lô/tác vụ khác" toast — the
 * message still names the fix (declare both KẸP) while "Vẫn lưu?" offers the
 * deliberate-share confirm.
 */
export const MIXED_DECLARATION_KEP_WARN_MESSAGE =
  `${CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE} Vẫn lưu?`;

export function classificationMismatchShareBlockMessage(
  issuingClassification: string | null | undefined,
  holderClassification: string | null | undefined,
): string | null {
  const holder = (holderClassification ?? '').trim();
  const issuing = (issuingClassification ?? '').trim();
  const issuingDeclared = issuing === 'DOUBLE' || issuing === 'COMBINED';
  const holderDeclared = holder === 'DOUBLE' || holder === 'COMBINED';
  // KẸP/Kết hợp holder vs plain ĐƠN issuing leg — the landed direction.
  if (holderDeclared && !issuingDeclared) return CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE;
  // SIL-638 TC2 round 3 — the symmetric arm: a declared leg onto an explicit
  // ĐƠN holder refuses with the SAME message (QA 03/11: the KẸP row used to
  // save silently over the sitting ĐƠN). Only an explicit SINGLE counts; an
  // undeclared holder keeps "bổ sung sau" and LCL keeps the generic law.
  if (issuingDeclared && holder === 'SINGLE') return CLASSIFICATION_MISMATCH_SHARE_BLOCK_MESSAGE;
  return null;
}

/**
 * TC1 đợt 2 (QA 01/11) — the issue-time rig-claim window is the OPERATOR'S
 * DECLARED window. The route-duration autofill used to OVERRIDE the entered
 * "Giờ kết thúc", so a ca sáng 08:00–12:00 leg stored a ~12h claim
 * (08:00 + route duration) and the availability guard then refused the
 * unrelated ca chiều 14:00–18:00 leg on the same tractor. The declared end
 * wins; the route duration only fills a payload that omits it (legacy
 * callers); null when neither exists (the caller owns the
 * endTimeConfirmed gate for that shape).
 */
export function issueClaimWindowEnd(
  declaredEndAt: Date | null,
  plannedStartAt: Date,
  routeDistanceKm: number | null | undefined,
): Date | null {
  if (declaredEndAt != null && !Number.isNaN(declaredEndAt.getTime())) return declaredEndAt;
  const durationMinutes = routeServiceDurationMinutes(routeDistanceKm);
  return durationMinutes == null
    ? null
    : new Date(plannedStartAt.getTime() + durationMinutes * 60_000);
}

/** Route-duration autofill the window law falls back to — verbatim the
 *  dispatch-planning-utils constants, mirrored here so this module stays
 *  db-free and unit-pinnable without importing the utils graph. */
function routeServiceDurationMinutes(distanceKm: number | null | undefined): number | null {
  const DEFAULT_ROUTE_SERVICE_SPEED_KPH = 35;
  const DEFAULT_ROUTE_SERVICE_BUFFER_MINUTES = 30;
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return null;
  }
  return Math.ceil((distanceKm / DEFAULT_ROUTE_SERVICE_SPEED_KPH) * 60) + DEFAULT_ROUTE_SERVICE_BUFFER_MINUTES;
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
 *
 * SIL-638 31/10 (QA TC7): the trailer conjunct follows the SIL-602 pair law —
 * the mooc is NOT part of the pair contract (master-data imports legitimately
 * leave it unassigned, card 211026152138). Two legs that DECLARE a mooc and
 * declare DIFFERENT ones are a foreign claim (never carved); equal moocs — or
 * either side with none — share the truck by the declaration alone.
 */
export function isDeclaredKepSharePartner(
  req: KepShareRequest,
  partner: KepSharePartnerRow,
  mode: 'KEP' | 'KET_HOP' | null,
): boolean {
  if (req.kep == null || mode == null || req.kep.departureDate == null) return false;
  if (partner.classification !== (mode === 'KEP' ? 'DOUBLE' : 'COMBINED')) return false;
  if (req.truckId == null || partner.truckId !== req.truckId) return false;
  const trailerMismatch = req.trailerId != null && partner.trailerId != null
    && req.trailerId !== partner.trailerId;
  if (trailerMismatch) return false;
  return req.driverId != null && partner.driverId === req.driverId
    && partner.plannedStartAt != null
    && localDateInBusinessZone(partner.plannedStartAt) === req.kep.departureDate
    && (partner.activePairId == null || (req.tripId != null
      && (partner.pairFirstTripId === req.tripId || partner.pairSecondTripId === req.tripId)));
}

/** The two pairing sides the declared Kết hợp carve reads (trip-side facts). */
export interface DeclaredCombinedPairSide {
  /** The trip's fulfillment dispatch classification. */
  classification: string | null | undefined;
  truckId: number | null;
  driverId: number | null;
  departureDate: string | null;
}

/**
 * SIL-638 TC7 (QA 31/10) — the declared Kết hợp pair carve for the pairing
 * gate: both legs DECLARE Kết hợp (COMBINED) on ONE rig (same truck, same
 * driver, same business day). The declaration IS the pair arrangement — the
 * dispatcher already committed the two orders to one shell-reuse run — so the
 * sequential-only plumbing (OVERLAP / IMPOSSIBLE_REPOSITION /
 * INSUFFICIENT_TRAVEL_BUFFER) must not dead-end a pair whose planned windows
 * coincide (QA plans both legs on the lot's shared appointment slot). The
 * same-size shell gate is NOT part of this carve: it is independent owner law
 * (TC7(1)) and keeps blocking a proven 20'-vs-40' mismatch. Anything else —
 * a non-COMBINED side, different truck/driver/day, a missing day — stays with
 * the full sequential rule set.
 */
export function declaredCombinedPairCarve(
  first: DeclaredCombinedPairSide,
  second: DeclaredCombinedPairSide,
): boolean {
  if (first.classification !== 'COMBINED' || second.classification !== 'COMBINED') return false;
  if (first.truckId == null || second.truckId == null || first.truckId !== second.truckId) return false;
  if (first.driverId == null || second.driverId == null || first.driverId !== second.driverId) return false;
  if (first.departureDate == null || first.departureDate === '') return false;
  return first.departureDate === second.departureDate;
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

// ─── Wave 7 (SIL-676 / SIL-638 TC3-T3) — completed-leg economics laws ──────
//
// QA pair 29 (trips 320+321, both COMPLETED) showed tollCost 0/null and
// driverSalary null on BOTH legs: the only salary/toll writers lived in the
// dispatcher figures-save path (updateTripFigures) and the pairing
// transaction, so a pair closed purely through the driver app completed with
// unmaterialed economics. These db-free laws define what a COMPLETED leg
// must carry; the tx writer is trip-completion-economics.service.
//
// r4 (QA pair 30, staging e9afda3f): a route WITHOUT toll stations settled
// VETC as a silent null — tollOnceLeg null, no reason anywhere. The owner law
// (card 20261002_293, D02) applies: a computed financial zero is a value.
// The VETC record materializes once per pair ALWAYS; an unconfigured route
// carries amount 0 PLUS an explicit reason marker.

/** Why a completed leg's VETC net is 0 (surfaced verbatim on economics). */
export const VETC_ROUTE_UNCONFIGURED_REASON = 'route_chua_cau_hinh_tram' as const;
export type VetcZeroReason = typeof VETC_ROUTE_UNCONFIGURED_REASON;

/** The warning economics surfaces for that reason — verbatim owner copy. */
export const VETC_ROUTE_UNCONFIGURED_WARNING =
  'Route chưa cấu hình trạm thu VETC — cần nhập để tính';

/** Facts a completed leg carries for the once-per-pair VETC law (TC3). */
export interface CompletedLegTollFacts {
  tollsStations: number | string | null;
  tollPerStationApplied: number | string | null;
  tollDeduction: number | string | null;
  reconciledTollCost: number | string | null;
}

export interface CompletedLegTollLaw {
  /** Net toll this leg owes after the pair dedup (or driver reconciliation). */
  tollCost: number;
  /** Gross stations × rate before any dedup/reconciliation. */
  grossToll: number;
  tollDeduction: number;
  /** True when a driver-claimed TOLL row (reconciledTollCost) wins. */
  reconciled: boolean;
  /** Why the net is 0 — `route_chua_cau_hinh_tram` when the route has no
   *  toll stations configured (never on a reconciled claim). */
  tollZeroReason: VetcZeroReason | null;
}

/**
 * Net toll for one completed leg: a reconciled driver claim wins verbatim;
 * otherwise stations × per-station rate minus this leg's pair dedup, clamped
 * ≥ 0. A route without stations honestly computes 0 — never a null — and
 * names the reason (`route_chua_cau_hinh_tram`) so the economics surface can
 * say what is missing instead of staying silently empty.
 */
export function netTollForCompletedLeg(facts: CompletedLegTollFacts): CompletedLegTollLaw {
  const stations = Math.max(0, Math.trunc(Number(facts.tollsStations ?? 0)) || 0);
  const rate = Math.max(0, Number(facts.tollPerStationApplied ?? 0) || 0);
  const grossToll = stations * rate;
  const deduction = Math.max(0, Number(facts.tollDeduction ?? 0) || 0);
  if (facts.reconciledTollCost != null && Number.isFinite(Number(facts.reconciledTollCost))) {
    return {
      tollCost: Math.max(0, Math.round(Number(facts.reconciledTollCost))),
      grossToll,
      tollDeduction: deduction,
      reconciled: true,
      tollZeroReason: null,
    };
  }
  return {
    tollCost: Math.max(0, grossToll - deduction),
    grossToll,
    tollDeduction: deduction,
    reconciled: false,
    tollZeroReason: stations === 0 ? VETC_ROUTE_UNCONFIGURED_REASON : null,
  };
}

/** Facts the completion-time salary law reads (TC3: lương = cơ bản + phụ phí). */
export interface CompletedLegSalaryFacts {
  storedDriverSalary: number | string | null;
  driverBaseSalary: number | string | null;
  routeDriverSalary: number | string | null;
  storedTripWageDays: number | string | null;
  departureDate: string;
  completedAt: Date;
  pair: { order: 1 | 2; active: boolean; surcharge: number } | null;
}

export interface CompletedLegSalaryLaw {
  /** True when this completion transition writes a salary (stored was unset). */
  applied: boolean;
  source: 'stored' | 'pair_surcharge' | 'base_allocation' | 'route_default' | 'none';
  /** The effective wage this leg carries after the law. */
  driverSalary: number;
  tripWageDays: number;
  /** The configured pair-surtax component this leg's wage carries (0 otherwise). */
  surchargeApplied: number;
}

/**
 * Wage days for a completed cuốc — verbatim the updateTripFigures rule:
 * stored override wins; otherwise departure → completion inclusive
 * (`new Date(departureDate)` parses a date-only string as UTC midnight —
 * the same anchor the figures path uses; same-day morning completion = 1
 * day, each started additional day adds 1).
 */
export function completedTripWageDays(
  stored: number | string | null,
  departureDate: string,
  completedAt: Date,
): number {
  const storedDays = Number(stored);
  if (Number.isFinite(storedDays) && storedDays > 0) return Math.trunc(storedDays);
  const dep = new Date(departureDate);
  if (Number.isNaN(dep.getTime())) return 1;
  const diffMs = completedAt.getTime() - dep.getTime();
  return Math.max(1, Math.round(diffMs / 86_400_000) + 1);
}

function pairSurchargeComponent(pair: CompletedLegSalaryFacts['pair']): number {
  return pair?.active && pair.order === 2 && pair.surcharge > 0 ? pair.surcharge : 0;
}

/**
 * Completion-time salary law — the same precedence updateTripFigures applies,
 * moved to the completion moment so a driver-app close materializes the wage:
 * stored (governed/earlier) wins → leg 2 of a configured ACTIVE pair carries
 * exactly the phụ phí → otherwise the standard base allocation
 * (drivers.baseSalary / 26 × days, route default fallback). An unconfigured
 * surcharge (0) leaves the standard allocation, never a zeroed wage.
 */
export function completedLegSalaryLaw(facts: CompletedLegSalaryFacts): CompletedLegSalaryLaw {
  const tripWageDays = completedTripWageDays(facts.storedTripWageDays, facts.departureDate, facts.completedAt);
  const stored = Number(facts.storedDriverSalary ?? 0);
  if (Number.isFinite(stored) && stored > 0) {
    return {
      applied: false,
      source: 'stored',
      driverSalary: Math.round(stored),
      tripWageDays,
      surchargeApplied: pairSurchargeComponent(facts.pair),
    };
  }
  const surcharge = pairSurchargeComponent(facts.pair);
  if (surcharge > 0) {
    return { applied: true, source: 'pair_surcharge', driverSalary: surcharge, tripWageDays, surchargeApplied: surcharge };
  }
  const baseSalary = Number(facts.driverBaseSalary ?? 0) || 0;
  const allocated = resolveTripDriverSalary(
    baseSalary,
    tripWageDays,
    Number(facts.routeDriverSalary ?? 0) || 0,
  );
  return {
    applied: allocated > 0,
    source: allocated > 0 ? (baseSalary > 0 ? 'base_allocation' : 'route_default') : 'none',
    driverSalary: allocated,
    tripWageDays,
    surchargeApplied: 0,
  };
}

/** One leg's explicit cost breakdown — the numbers a "Chi phí" panel reads. */
export interface TripCostBreakdown {
  /** Cước chuyến (revenue). */
  freight: number;
  /** VETC net for THIS leg (pair: the carrying leg once, the other 0). */
  tolls: number;
  /** Why the VETC net is 0 (`route_chua_cau_hinh_tram`), null otherwise. */
  tollZeroReason: VetcZeroReason | null;
  /** Lương tài xế (base allocation or pair surcharge). */
  salary: number;
  /** Phụ phí Kẹp component (0 when unconfigured — explicit, not missing). */
  surcharge: number;
  /** Chi phí dầu. */
  fuel: number;
  /** Tiền đường. */
  allowance: number;
  totalCost: number;
}

export interface TripCostBreakdownFacts {
  revenue: number | string | null;
  driverSalary: number | string | null;
  totalFuelCost: number | string | null;
  totalRoadAllowance: number | string | null;
  totalCost: number | string | null;
  tollsStations: number | string | null;
  tollPerStationApplied: number | string | null;
  tollDeduction: number | string | null;
  reconciledTollCost: number | string | null;
  pair: { order: 1 | 2; active: boolean; surcharge: number } | null;
}

function vnd(value: number | string | null | undefined): number {
  const parsed = Math.round(Number(value ?? 0));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Explicit per-leg cost breakdown. Every number is present — a route without
 * toll stations shows `tolls: 0` plus the `route_chua_cau_hinh_tram` reason,
 * an unconfigured phụ phí shows `surcharge: 0` — so "0" is always an honest
 * computed value, never a gap.
 */
export function tripCostBreakdown(facts: TripCostBreakdownFacts): TripCostBreakdown {
  const toll = netTollForCompletedLeg(facts);
  return {
    freight: vnd(facts.revenue),
    tolls: toll.tollCost,
    tollZeroReason: toll.tollZeroReason,
    salary: vnd(facts.driverSalary),
    surcharge: pairSurchargeComponent(facts.pair),
    fuel: vnd(facts.totalFuelCost),
    allowance: vnd(facts.totalRoadAllowance),
    totalCost: vnd(facts.totalCost),
  };
}

/** Pair-level settlement economics — the record a completed pair surfaces. */
export interface PairSettlementEconomics {
  /** Which leg carries the once-per-pair VETC record — ALWAYS set (the
   *  record materializes even when the amount is 0; default carrier leg 1). */
  tollOnceLeg: 1 | 2;
  /** The once-per-pair toll amount (sum of both legs' nets). */
  tollAmount: number;
  /** Why the amount is 0 (`route_chua_cau_hinh_tram`), null otherwise. */
  tollZeroReason: VetcZeroReason | null;
  /** Lương cơ bản (leg 1's wage). */
  baseSalary: number;
  /** Phụ phí Kẹp (leg 2's configured component). */
  surcharge: number;
  /** Base + surcharge — the driver's pair wage, never two single cuốc. */
  totalSalary: number;
  /** Toll + total salary. */
  totalAmount: number;
}

/**
 * TC3 economics across the pair: VETC counted once (never doubled), wage =
 * base cuốc + phụ phí. Leg 1 normally carries the toll record; a
 * reconciled-claim rewrite can leave it on leg 2 — the law reads the actual
 * stored nets. A route without stations keeps the record on leg 1 with
 * amount 0 + the `route_chua_cau_hinh_tram` reason — never a silent null.
 */
export function pairSettlementEconomics(
  first: TripCostBreakdown,
  second: TripCostBreakdown,
): PairSettlementEconomics {
  const tollAmount = first.tolls + second.tolls;
  const tollOnceLeg: 1 | 2 = first.tolls > 0 ? 1 : second.tolls > 0 ? 2 : 1;
  const tollZeroReason: VetcZeroReason | null = tollAmount === 0
    ? (first.tollZeroReason ?? second.tollZeroReason ?? VETC_ROUTE_UNCONFIGURED_REASON)
    : null;
  const totalSalary = first.salary + second.salary;
  return {
    tollOnceLeg,
    tollAmount,
    tollZeroReason,
    baseSalary: first.salary,
    surcharge: second.surcharge,
    totalSalary,
    totalAmount: tollAmount + totalSalary,
  };
}

/**
 * SIL-638 TC1 (QA 02/11, build ed0056e1) — the "xe đang bận thực hiện lệnh
 * chưa hoàn tất" tier. An IN_TRANSIT trip holds its rig for its WHOLE Vietnam
 * business day: the run may overrun its planned end, and only the COMPLETED
 * transition releases the rig, so the plan-save that edges past the holder's
 * [start, end) claim (QA's ca-tối 18:00 vs a 14:00–18:00 IN_TRANSIT leg)
 * saved silently — the exact "khối IN_TRANSIT chưa sống" hole. The pure law
 * below is the mirror the SQL in assertPlanRowRigAvailable implements
 * server-side (same-day comparison in Asia/Ho_Chi_Minh), unit-pinned here.
 * The warn rides the family's confirmable contract: the dispatcher confirms
 * the deliberate share and rotation ("chạy xoay vòng ca sáng/chiều") stays
 * possible — but never silently while the truck is out running.
 */
export function busyDayClaimOverlaps(
  holderStartAt: Date,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  const holderDay = localDateInBusinessZone(holderStartAt);
  if (holderDay == null || !/^\d{4}-\d{2}-\d{2}$/.test(holderDay)) return false;
  const claimStart = new Date(`${holderDay}T00:00:00+07:00`).getTime();
  const claimEnd = claimStart + 24 * 3_600_000;
  return claimStart < windowEnd.getTime() && claimEnd > windowStart.getTime();
}

/** TC1 — the warn-once text: names the rig and the DOC's busy-truck reason. */
export function busyRigWarnMessage(plate: string): string {
  return `Đầu xe ${plate} đang bận thực hiện lệnh chưa hoàn tất. Vẫn lưu?`;
}

/**
 * SIL-638 TC4(BE) / TC8 / TC9 — the Kết hợp sequential gating law, mirrored
 * from the three db-bound sites that implement it:
 *
 * - TC8 (board): `driverBoardPairLocked` is the pairLocked computation of
 *   driver-journey-board.service.ts — Lệnh 2 of an ACTIVE KET_HOP pair is
 *   read-only with the DOC message while Lệnh 1 is unfinished.
 * - TC8 (write): `ketHopSequenceGateVerdict` is
 *   assertKetHopSequencingAllowedTx in driver-fulfillment.service.ts — the
 *   driver's start/progress on Lệnh 2 is refused with the sequencing
 *   message until Lệnh 1 finishes.
 * - TC9: `firstKetHopLegFinished` + `completionEvidenceReady` pin the unlock
 *   law — Lệnh 1 is "finished" when its trip is COMPLETED or its completion
 *   evidence is ready, and evidence readiness is the delivered milestone
 *   ONLY: e-POD photos are optional (owner ruling card 261022213755a,
 *   TC9's v2 "KHÔNG chặn vì thiếu ảnh e-POD/phiếu hạ bãi"), so completing
 *   Lệnh 1 with zero uploads unlocks Lệnh 2 immediately.
 * - TC4 (BE half): a KEP pair NEVER gates — the kẹp clamp carries both boxes
 *   simultaneously, so the order-2 card stays active and the write gate
 *   never refuses a Kẹp leg (the app surface itself is ruled separately).
 *
 * "Unfinished" intentionally includes a MISSING first-trip row for the write
 * gate (its load reads `first?.status` and blocks when the row is absent),
 * while the board requires `firstTripId != null` before it can lock — the
 * two callers pass `hasFirstTrip` accordingly.
 */

/** TC8 board message — verbatim (FE driver-trip-model carries the same twin). */
export const PAIR_LOCKED_MESSAGE = 'Cần hoàn thành trả hàng lệnh trước để mở khóa';

/** TC8 write-gate message — verbatim assertKetHopSequencingAllowedTx copy. */
export const KET_HOP_SEQUENCE_BLOCK_MESSAGE =
  'Đây là Lệnh 2 của cặp kết hợp: hãy hoàn thành trả hàng Lệnh 1 trước khi bắt đầu lệnh này.';

/** The facts both gate sites read off the pair + Lệnh 1 (narrow view). */
export interface KetHopGateFacts {
  pairStatus: string | null | undefined;
  pairKind: string | null | undefined;
  pairOrder: 1 | 2 | null | undefined;
  /** The board requires a resolvable first-trip row before locking; the
   *  write gate passes true (a missing row reads unfinished → block). */
  hasFirstTrip: boolean;
  firstTripStatus: string | null | undefined;
  /** The first leg's completion-evidence readiness (trip-pod's signal). */
  firstEvidenceReady: boolean;
}

/** TC9 — Lệnh 1 is finished when COMPLETED or its completion evidence is ready. */
export function firstKetHopLegFinished(facts: Pick<KetHopGateFacts, 'firstTripStatus' | 'firstEvidenceReady'>): boolean {
  return facts.firstTripStatus === 'COMPLETED' || facts.firstEvidenceReady;
}

/** TC9 — completion readiness is the delivered milestone ONLY (e-POD optional). */
export function completionEvidenceReady(facts: { hasDeliveredMilestone: boolean }): boolean {
  return facts.hasDeliveredMilestone;
}

/**
 * TC4(BE)/TC8 — the sequencing gate verdict for Lệnh 2 of a declared pair.
 * Only an ACTIVE KET_HOP pair's order-2 leg with an unfinished, present
 * first trip blocks; everything else — Kẹp pairs, order-1 legs, unpaired
 * trips, dissolved pairs, a finished Lệnh 1 — allows.
 */
export function ketHopSequenceGateVerdict(facts: KetHopGateFacts): 'allow' | 'block' {
  if (facts.pairStatus !== 'ACTIVE' || facts.pairKind !== 'KET_HOP') return 'allow';
  if (facts.pairOrder !== 2 || !facts.hasFirstTrip) return 'allow';
  return firstKetHopLegFinished(facts) ? 'allow' : 'block';
}

/** TC8 — the driver-app board lock (boolean form of the same law). */
export function driverBoardPairLocked(facts: KetHopGateFacts): boolean {
  return ketHopSequenceGateVerdict(facts) === 'block';
}

/**
 * SIL-666 (id 762) — the rig-conflict busy message family. QA 03/11: a real
 * conflict on 15H-061.14 answered
 * `{"error":"Đầu xe 15H-061.14 đã được gán cho lô/tác vụ khác trong khung giờ
 * trùng lặp:."}` — an EMPTY reference after the colon. The two rig guards'
 * hard/warn tiers rendered only their plan-row holder list, while the blocking
 * row was a DISPATCHED TRIP (a fulfillment-less BULK task has no plan row at
 * all), so the customer saw the refusal without the one thing it must name:
 * WHAT holds the rig. The message template now renders BOTH conflict sources —
 * plan rows ("Lô …") and dispatched trips ("Lô <lot>" or, for fulfillment-less
 * tasks, "Lệnh <tripCode>") — and never emits an empty reference.
 *
 * Pure law (db-free per the BE unit-only ruling): the transactional guards
 * (dispatch-plan-conflict-scan.service, dispatch-planning-detail-plan.service)
 * select the facts and call these helpers.
 */

/** One blocking plan-row holder — the facts the label law reads (narrow view;
 *  structurally the rig guards' RigHolderFacts). */
export interface RigConflictRowRef {
  shipmentId: number;
  shipmentCode: string | null;
  blNumber: string | null;
  bookingRef: string | null;
  slotAt: Date | string | null;
}

/** One blocking dispatched trip — the trip's own identity plus its origin
 *  lot's references (nulls when the trip has no fulfillment, e.g. BULK tasks). */
export interface RigConflictTripRef {
  tripId: number;
  tripCode: string | null;
  plannedStartAt: Date | string | null;
  shipmentId: number | null;
  shipmentCode: string | null;
  blNumber: string | null;
  bookingRef: string | null;
}

/** The scan's slot coalesce mixes timestamptz columns with day-claim
 *  expressions; drivers may hand back a Date or a naive wall-time string.
 *  Naive strings are already Asia/Ho_Chi_Minh wall time (the SQL shifted
 *  them) — anchor them there, never in the server's zone. Returns null for
 *  anything unparseable ("no window" renders no suffix). */
export function rigConflictSlotDate(value: Date | string | null): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) return null;
  const anchored = text.includes('+') || text.endsWith('Z')
    ? text.replace(' ', 'T')
    : `${text.replace(' ', 'T')}+07:00`;
  const parsed = new Date(anchored);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const viInstant = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** " (từ 26/08 07:00)" — the claimed-window suffix the refusal shows. */
export function rigHolderSlotSuffix(value: Date | string | null): string {
  const slot = rigConflictSlotDate(value);
  return slot ? ` (từ ${viInstant.format(slot)})` : '';
}

/** "Lô BLCUSa29BD" / "Lô SHP-2610-01349" / "Lô #61959" — the reference the
 *  dispatcher reads in the grid, best available first. */
export function rigHolderLabel(holder: Pick<RigConflictRowRef, 'shipmentId' | 'shipmentCode' | 'blNumber' | 'bookingRef'>): string {
  const ref = holder.shipmentCode?.trim() || holder.blNumber?.trim() || holder.bookingRef?.trim();
  return ref ? `Lô ${ref}` : `Lô #${holder.shipmentId}`;
}

/** The dispatched-trip variant of the label law: a trip conflicts through its
 *  origin lot when one is resolvable (the same reference the grid shows) or,
 *  for a fulfillment-less task (BULK runs), through its own trip code — the
 *  "tác vụ khác" half of the message copy. */
export function rigTripHolderLabel(trip: RigConflictTripRef): string {
  const ref = trip.shipmentCode?.trim() || trip.blNumber?.trim() || trip.bookingRef?.trim();
  if (ref) return `Lô ${ref}${rigHolderSlotSuffix(trip.plannedStartAt)}`;
  const code = trip.tripCode?.trim();
  return code ? `Lệnh ${code}${rigHolderSlotSuffix(trip.plannedStartAt)}` : `Lệnh #${trip.tripId}`;
}

/** Both conflict sources in one reference list, plan rows first. Empty only
 *  when both scans came back empty. */
export function describeRigConflicts(rows: readonly RigConflictRowRef[], trips: readonly RigConflictTripRef[]): string {
  const rowLabels = rows.map((holder) => {
    const ref = holder.shipmentCode?.trim() || holder.blNumber?.trim() || holder.bookingRef?.trim();
    return `${ref ? `Lô ${ref}` : `Lô #${holder.shipmentId}`}${rigHolderSlotSuffix(holder.slotAt)}`;
  });
  return [...rowLabels, ...trips.map(rigTripHolderLabel)].join(', ');
}

/**
 * The busy copy both rig guards throw. When a real conflict exists the
 * message NAMES it ("…trùng lặp: Lệnh BULK-TR-0180 (từ 26/08 07:00)."); when
 * no reference can be built the colon is dropped instead of hanging an empty
 * string after it ("…trùng lặp." — never the reported "…trùng lặp:.").
 * `suffix` carries the tier: the hard tier ends "." and the warn-once tier
 * ends ". Vẫn lưu?" — both keep the family's verbatim prefix.
 */
export function rigConflictBusyMessage(
  plate: string,
  rows: readonly RigConflictRowRef[],
  trips: readonly RigConflictTripRef[],
  suffix = '.',
): string {
  const refs = describeRigConflicts(rows, trips);
  return refs
    ? `Đầu xe ${plate} đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp: ${refs}${suffix}`
    : `Đầu xe ${plate} đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp${suffix}`;
}
