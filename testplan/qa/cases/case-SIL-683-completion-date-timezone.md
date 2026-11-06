# Case SIL-683 — Sổ đối chiếu vận tải ghi completionDate sớm 1 ngày

- **Case ID:** SIL-683 (board id 795)
- **Reported:** 2026-11-06, QA (hoapt/Kế toán, staging build dcaa8295; 4/4 chuyến lệch đúng 1 ngày:
  347/TRP-202611-0109 completedAt 2026-11-06T02:59:44Z → completionDate 11-05; 330 → 11-04;
  331 → 11-04; 335 → 11-04).
- **Surface:** backend completion-business-date derivations:
  `GET /api/finance/billing-documents/transport-register` (`accounting-transport-register.service.ts`),
  debit-note draft day filter + completionDate (`billing-document-draft.service.ts`),
  billing-document invariants (`billing-document-invariants.service.ts`). FE not mutated.
- **Mutation surface:** none — read-only projections/filters.
- **Status:** PREPARED — root cause identified: `trips.completed_at` (and the `trips_composite`
  twin) is a naive `timestamp` storing UTC wall clock. A single `completed_at AT TIME ZONE
  'Asia/Ho_Chi_Minh'` INTERPRETS the stored UTC wall time as +07 local and renders UTC — a net
  −7h shift, so early-morning UTC completions drop to the previous day. The repo law is the double
  chain `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh'` (`reporting-shared.ts`
  `tripCompletionBusinessDateSql`, dashboard-stats, fuel-ap-recon, profit-distribution).

## Steps

1. Complete a trip with `completedAt` early-morning UTC (e.g. 2026-11-06T02:59:44Z = 09:59 VN).
2. GET `/api/finance/billing-documents/transport-register?from=…&to=…` (Kế toán).
3. Compare `completionDate` with the VN business date of `completedAt`.

## Expected

- `completionDate` = the Asia/Ho_Chi_Minh calendar date of the completion instant, for BOTH night
  and morning boundaries:
  - 23:xx boundary: completedAt 2026-11-05T17:30:00Z (= 06/11 00:30 VN) → completionDate
    `2026-11-06` (VN day), not `2026-11-05`.
  - 00:xx boundary: completedAt 2026-11-06T02:59:44Z (= 09:59 VN) → completionDate `2026-11-06`.
- The debit-note draft built from the register row lands in the same VN day range
  (05/11–05/11 vs 06/11 defect on the ticket's 75-debit-draft.png).

## Local rung (2026-11-06, branch fix/sil-be-682-683)

- DB/API VERIFIED (2). Trip 1337 `completed_at='2026-11-06 02:59:44'` (ticket 347's instant).
  BEFORE: register window 11-06 total=0, window 11-05 shows `completionDate=2026-11-05`
  (`qa/2026-11-06-lane-be/driver-sil683-before.log`). AFTER: window 11-06 total=1 with
  `completionDate=2026-11-06`, window 11-05 total=0 (`driver-sil683-after.log`).
- Boundary proof on real Postgres, both session TZs (`driver-sil683-boundary.out`): 23:xx biên đêm
  (23:30 VN 11-05) stays 11-05; 00:xx biên sáng (00:30 VN 11-06) old 11-05 ✘ → new 11-06 ✔;
  new chain identical under session TZ UTC and Asia/Ho_Chi_Minh.
- Not covered: debit-note draft page UI (same shared law; the ::date filter form is covered by the
  boundary table and the debit range unit law).
