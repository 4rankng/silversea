# Round 18 FIX 3 evidence — overlap-guard warning missing (P3)

## Investigation

The FB-038 warn-once family was audited surface by surface:
`assertPlanRowRigAvailable` (plan saves), `assertResourceAvailability`
(issue/reassign), `assertTripRigAvailable` (direct trip create/edit) — all
carry the RIG_OVERLAP_COMPLETED warn-once contract with FE confirm plumbing
(DispatchPlanEditorCell, useIssueOrder, TripReassignDialog, use-trip-form-submit).

The silent path (empirical probe `qa/drivers/round18-fix3-probe.mjs` against
the local backend, admin):

1. POST /trips truck 60C-12345 + driver 1, day D → 201 (holder).
2. POST /trips truck 60C-12345 + driver 5, day D → 409 RIG_OVERLAP_COMPLETED
   (rig warn — plate scan works).
3. POST /trips truck **60C-23456 + driver 1** (SAME driver, OTHER tractor),
   day D → **201, no warning** — `assertTripRigAvailable` scanned the
   tractor's plate only; a driver double-booked across two tractors was
   invisible.

## Fix (non-blocking, warn tier — FB-038 ruling)

`assertTripRigAvailable` gains a `driverId` claim scan at the warn tier: any
non-canceled trip of the same driver overlapping the saving window (same
window coalesce: unset start = the departure day, missing end = +8h) throws
409 `{ code: 'RIG_OVERLAP_COMPLETED' }` with copy
`Tài xế đã có N chuyến khác trùng khung giờ phân công này. Vẫn lưu?` — the
existing confirmOverlap retry proceeds. No new hard block. Callers wired:
`trip-create.service.ts` (direct create) and `trip-figure-updates.service.ts`
(a driver-only correction now counts as a moved claim).

FE: no change needed — `use-trip-form-submit` already confirms the
RIG_OVERLAP_COMPLETED family payload on both the create and figures paths
(ticket 111026105630 plumbing), so the new warn surfaces through the same
confirm dialog.

## After (live API)

- baseline (clean day): 201 silent ✓
- same tractor other driver: 409 rig warn ✓ (unchanged)
- **other tractor same driver: 409 RIG_OVERLAP_COMPLETED, driver copy ✓**
- confirmed retry (`confirmOverlap: true`): 201 ✓
- sequential same-day windows with explicit timestamps (morning trip ends
  12:45, afternoon starts 14:45): silent ✓ (the window math, not the day,
  decides)

## Pins

`backend/src/tests/trip-overlap-warning.test.ts` — new describe with three
cases: cross-tractor driver warn + confirmed retry proceeds; provably
sequential same-day windows stay silent; different-driver control stays
silent. 15/15 across trip-overlap + dispatch-overlap + trip-create suites.

Rung: DB/API VERIFIED for the guard behavior (API probe above); the FE dialog
path is the already-pinned ticket-111026105630 contract
(use-trip-form-submit.test.tsx) reused unchanged.
