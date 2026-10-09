# Case: card 091026164500 — Kẹp 2×20 blocked at Phát lệnh by exact-match trailer gate

- Case ID: 2026-10-09-card091026164500
- Reported: 09/10/2026 16:45 (round-10 batch 2, dispatcher, staging)
- Status: FIXED (commit 80c94347, landing 2026-10-09)

## Reproduction (pre-fix)

1. Dispatcher (dungnv) on staging, dispatch detailed plan.
2. Lot with 2×20DC containers (e.g. QADV-R10-B001: QADV1234577 + QADV1234561).
3. Phát lệnh for one 20DC onto a tractor whose moóc is 40FT → 409 `Rơ-moóc không phù hợp với loại container.`
4. Consequence: the sibling never gets its lệnh, so 'Lệnh ghép cùng' (which lists issued, unpaired, non-external, non-canceled rows — same-lot first) stays empty of the sibling → Kẹp 2×20 unexecutable.

Expected: a 20' load rides a 40' moóc legally (Kẹp clamp hardware); only a provably undersized moóc (40' requirement on 20FT) blocks.

## Root cause

`issueOrderCreateOrUpdate` (backend/src/services/dispatch-planning-commands.service.ts) exact-matched `resolvedTrailerType !== requiredTrailerTypeForFulfillment(...)`. The container-code inference returns `20FT` for any 20' code unless classification is LCL_PICKUP/DOUBLE, and the schema default classification is SINGLE — so an unclassified 20DC could never board a 40FT moóc. Exact-match semantics since 8f2182b5 (null-safened 1a3f9780); NOT the 463712eb availability change (verified — its diff touches only the plannedEndAt scan).

## Fix + regression pins

Length-floor comparison (`TRAILER_LENGTH_RANK: 20FT=1, 40FT=2`): block only when the resolved moóc is strictly shorter than the requirement. Missing moóc type still does not block (master-data imports leave Loại Moóc blank).

Pinned by `backend/src/tests/dispatch-issue-trailer-compat.test.ts` (drives the real issue path):
- T1 SINGLE 20DC + 40FT rig issues (was the card's exact 409 — observed red).
- T2 declared DOUBLE pair end-to-end.
- T3 40HC on 20FT still 409 (undersized stays blocked).
- T5 DOUBLE/LCL_PICKUP on 20FT still 409 (40' minimums intact).
- T4 undeclared same-rig same-day second load still 409 `trùng lịch` (occupancy law intact).
- T6 open-ended partner (plannedEndAt null) still occupies the rig within the 8-hour bound (round-8 law pinned through the issue path).

Sibling regression suites green post-fix: kep-kethop matrix 11, card353 3, trip-factory-snapshot 8, pair-ket-hop-gating 3, rig-conflict 5, dispatch-fulfillment 46, lcl-classification 4, lcl-rig 5.

Known cosmetic follow-up (carded separately): the FE advisory in `frontend/src/lib/trailerFit.ts` still hints "cần 20FT" for a legal 20DC-on-40FT pick — advisory-only, does not block.
