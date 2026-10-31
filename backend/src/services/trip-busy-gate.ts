// Truck-busy gate decision (SIL-474): which IN_TRANSIT rows count as a
// genuinely running truck. Kept as a DB-free leaf so the status machine and
// its unit tests share one source of truth without pulling the database
// client into the test graph.

/**
 * A busy row may only block a new departure on the same truck while its
 * planned departure day has arrived (Asia/Ho_Chi_Minh) or already passed.
 * An early "Xuất phát"/"Nhận lệnh" leaves future-departure trips in
 * IN_TRANSIT days before the truck moves — such a row is planning state,
 * not a running truck, and must not block (SIL-474: TVREQ-LX-C4 departing
 * 28/10 froze its truck from 24/10).
 *
 * Comparisons are lexicographic on canonical YYYY-MM-DD strings, which is
 * order-correct for ISO dates. Missing inputs keep the conservative legacy
 * block: a clock that cannot be read and a row without a departure date
 * both stay blocking, never silently unlock.
 */
export function isTripRunningOnDepartureDay(
  departureDate: string | null | undefined,
  todayInBusinessZone: string | null | undefined,
): boolean {
  if (todayInBusinessZone == null || todayInBusinessZone === '') return true;
  if (departureDate == null || departureDate === '') return true;
  return departureDate <= todayInBusinessZone;
}

/** Shape the busy-trip select in transitionTripStatus already carries. */
export interface TruckBusyCandidateRow {
  id: number;
  driverId: number | null;
}

/**
 * The membership columns of the ACTIVE KEP pair row that owns both legs.
 * SIL-631: the pair ROW is the identity — `trip_pairs.first/second_trip_id`
 * listing both trips proves the pair, while `activeTripPairId` stamps on the
 * trips are pointer bookkeeping that partial/out-of-band writes can lose or
 * drift without breaking the pair itself.
 */
export interface ActiveKepPairMembership {
  firstTripId: number;
  secondTripId: number;
}

/**
 * SIL-602 + SIL-631: the truck-busy exemption for the OTHER leg of the trip's
 * own ACTIVE KEP pair (PRD LoHangKepKetHop §3.2 + §7.3 — "KẸP hợp lệ không tự
 * chặn công việc thứ hai vì xe bận trong chính cặp"). The two 20ft legs ride
 * one rig simultaneously by construction, so the partner's IN_TRANSIT row is
 * the pair running, not a conflicting job.
 *
 * The exemption is the PAIR MEMBERSHIP + the shared driver — nothing else.
 * Superseded clauses, each of which blocked a valid pair in production:
 *  - SIL-602: `trailerId` set and equal on both legs — trailer data is not
 *    part of the pair contract (pairing validates same truck + same driver +
 *    same departure day + two 20ft shells; master-data imports legitimately
 *    leave the mooc unassigned, card 211026152138).
 *  - SIL-631: exact pointer chain (self-stamp resolves a partner AND the
 *    candidate's `activeTripPairId` equals the accepting leg's stamp). A
 *    lost/drifted stamp on either leg unmade a valid pair and 409'd the
 *    second "Nhận lệnh". Membership in the ACTIVE KEP row is the proof; the
 *    stamps are pointers to it.
 *
 * Deliberately NOT exempt: a busy row outside the pair row's membership, a
 * row whose pair is broken or re-paired (the break flow marks the row
 * non-ACTIVE and clears both stamps, so membership no longer proves a live
 * pair), and a partner with a different driver (out-of-band drift stays
 * blocking; the guarded reassign flows keep real pairs in sync). KET_HOP
 * partners never resolve a membership row (the status machine's lookups
 * filter `status='ACTIVE'` + `pairKind='KEP'`), so sequential pairs keep
 * their sequencing gate.
 */
export function isActiveKepPairPartner(
  candidate: TruckBusyCandidateRow,
  args: {
    tripId: number;
    tripDriverId: number | null | undefined;
    /** The ACTIVE KEP pair row proving this trip's membership, or null. */
    pair: ActiveKepPairMembership | null | undefined;
  },
): boolean {
  if (args.pair == null) return false;
  if (args.tripDriverId == null) return false;
  if (candidate.id === args.tripId) return false;
  const isMember = candidate.id === args.pair.firstTripId
    || candidate.id === args.pair.secondTripId;
  if (!isMember) return false;
  return candidate.driverId === args.tripDriverId;
}

/**
 * SIL-634: the DECLARED clamp proof — the second exemption shape of the
 * truck-busy gate, for the kẹp pair that was classified and issued but never
 * paired. The issue-time gate (assertResourceAvailability's declared clamp,
 * dispatch-resource-availability.service.ts) releases BOTH legs for issue when
 * both fulfillments are declared Kẹp (`dispatchClassification='DOUBLE'`), same
 * rig, same driver, same day, both 20' shells — the linkage conjunct passes
 * with `partner.activePairId == null`, so `trip_pairs` bookkeeping is optional
 * at issue time (dis-03, card 211026131857: "Pairs are created after both
 * trips exist"). The dispatcher who stops there is the prod case K4K4…/
 * K4K5… (31/10): both legs issued, no pair row, and the second "Nhận lệnh"
 * 409'd because this gate only knew the pair-row proof.
 *
 * The declared shape IS the pair arrangement by the same PRD law the pair-row
 * proof serves (LoHangKepKetHop §3.2/§7.3): two 20' boxes, one rig, one
 * driver, one day — the partner's IN_TRANSIT row is the pair running, not a
 * conflicting job. Mirroring the issue-time clamp, both sides must carry the
 * declaration: a SINGLE busy row stays blocking (SIL-638 TC1 — two plain lots
 * on one truck never ride together), and so does a SINGLE accepting leg.
 *
 * Deliberately NOT part of this proof:
 *  - the mooc/trailer — superseded by SIL-602 (card 211026152138, not part of
 *    the pair contract);
 *  - the 2×20' weight sum — the issue-time clamp owns that gate (it already
 *    passed for both legs to exist); the pair-row proof doesn't re-check it
 *    either;
 *  - a SECOND matching busy row — "a Kẹp release may overlap its one
 *    compatible partner, never a third load": the caller bounds this proof to
 *    exactly one shape-matching candidate, mirroring the issue-time
 *    `conflicts.length === 1` partner pick.
 *
 * `twentyFootShell` flags are the caller's DB probe result: exactly one
 * tripContainers row and its container-type code starts with '20' — the same
 * physical probe the issue-time clamp runs.
 */
export interface DeclaredKepClampCandidateRow {
  id: number;
  driverId: number | null;
  departureDate: string | null;
  /** The candidate fulfillment's own dispatch classification. */
  classification: string | null | undefined;
  /** Caller-proven: this trip carries exactly one 20' shell. */
  twentyFootShell: boolean;
}

export function isDeclaredKepClampPartner(
  candidate: DeclaredKepClampCandidateRow,
  args: {
    tripId: number;
    tripDriverId: number | null | undefined;
    tripDepartureDate: string | null | undefined;
    tripClassification: string | null | undefined;
    /** Caller-proven: the accepting trip carries exactly one 20' shell. */
    tripTwentyFootShell: boolean;
  },
): boolean {
  if (candidate.id === args.tripId) return false;
  if (args.tripClassification !== 'DOUBLE' || candidate.classification !== 'DOUBLE') return false;
  if (!args.tripTwentyFootShell || !candidate.twentyFootShell) return false;
  if (args.tripDriverId == null || candidate.driverId == null) return false;
  if (candidate.driverId !== args.tripDriverId) return false;
  if (args.tripDepartureDate == null || args.tripDepartureDate === '') return false;
  if (candidate.departureDate == null || candidate.departureDate === '') return false;
  return candidate.departureDate === args.tripDepartureDate;
}
