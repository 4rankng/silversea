# Red-at-base wave 2 — Cluster C dispatch planning suites (regression case)

Case ID: TC-REDSW2-C1 (fixture idempotency) / TC-REDSW2-C2 (ops duplicate guard)
Feature: backend suite health at base `c1f412f8` — cluster C scoped to
`dispatch-detail-plan.test.ts` (4 red), `ops-no-invoice-charge-pair.test.ts`
(1 red), `ad-hoc-orders.test.ts` (1 red in the orchestrator's full-suite run;
green in isolation).

## Diagnosis (verified, not inferred)

### TC-REDSW2-C1 — dispatch-detail-plan.test.ts
NOT a plate-normalization or carrier-link code defect. The resolution paths
under test (`resolveCarrierByPlate`, the dispatch-fleet normalized-plate search,
`buildZoneTruckSuggestions`, the plate-assign overlap guard) behaved correctly
against every row set they were given. The reds were **non-idempotent test
fixtures on a shared dev DB**:

1. A run killed before `after()` (the 2026-10-18 ~11:26 UTC run, suffix
   `1792322777298`) stranded whole fixture trees. Evidence: shipments
   `DTL-1792322777298-…-26/-27` holding plates `51H-888.88` / `30A 999.99`
   (fulfillment ids 72778/72779), trucks `51C-14n5l4…` (id 19018) with two
   `SGE-1792322777298-…` LH-evidence lots.
2. The stranded plate holders tripped the overlap guard (card-class hard 409
   "Đầu xe … đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp") on the
   "EXTERNAL catalog pick" and carrier-link tests — a different leg failed on
   every rerun as each purge exposed the next leftover.
3. The stranded LH-evidence lots kept old trucks in the rank-0 suggestion
   bucket for D=2026-08-20; `suggestedItems[0]` then depended on
   `plateNumber.localeCompare` against those ghosts (19018 beat the fresh
   truck whenever its plate sorted earlier).
4. Fixed fixture names/plates made every collision permanent:
   `createCustomer('Fleet link carrier')` / `'Fleet search carrier'` (unique
   active-name index), truck plates `15E-100.26` / `30D-200.77` (globally
   unique `license_plate`), vehicle plate `51H-888.88`, free-text plate
   `30A 999.99`, probe plate `99B-000.99`.
5. Amplifier: `after()` teardown was one sequential `try` — the first failed
   delete skipped every later step, so one bad row stranded the whole tree.

### TC-REDSW2-C2 — ops-no-invoice-charge-pair.test.ts
Same defect class wave 1's cluster B documented for card197, missed there
because this suite was outside its sweep: card 141026230720 (`030e8e42`,
2026-10-16) added the duplicate-entry guard — an unconfirmed save of the SAME
expense type on the SAME lot scope bounces 409 `OPS_EXPENSE_DUPLICATE`. The
"dispatch plan note path" test posts two OTHER-type rows to one lot (charged +
uncharged), so the second save has bounced 409 ever since the guard landed.
Product invariant intact; the suite predated the guard.

## Fix
Test-side only; no product code changed.
- `dispatch-detail-plan.test.ts`:
  - run-unique fixture plates/names via `runPlateSeed` (punctuation shapes
    kept, so plate-normalization paths stay exercised);
  - `before()` self-heal sweep of this file's `DTL-/SUG-/SGE-` fixture trees
    older than 10 minutes (a full file pass takes ~20s, so a concurrent fresh
    run keeps its live fixtures; killed runs are swept on the next run);
  - `after()` teardown per-step best effort — one failed delete no longer
    strands the rest;
  - the unknown-plate probe is run-unique too (stale trucks can't masquerade
    as "unknown").
- `ops-no-invoice-charge-pair.test.ts`: the second same-scope row carries the
  guard's documented `duplicateConfirmed: true` — the same pattern card197's
  repaired suites and `ops-module-routes.test.ts` use.

## Repro
1. `cd backend && npx tsx --test --test-concurrency=1 src/tests/dispatch-detail-plan.test.ts`
   at base with the shared dev DB containing the 11:26 UTC leftovers — 4 fail.
2. `cd backend && npx tsx --test --test-concurrency=1 src/tests/ops-no-invoice-charge-pair.test.ts`
   at base — "charged no-invoice fees surface by fee name…" 409 ≠ 201.

## Expected
- dispatch-detail-plan: 84/84, twice back-to-back (idempotency proof).
- ops-no-invoice-charge-pair: 7/7 with the projection assertions unchanged
  ("Thu khách: Phí xe nâng QA" surfaces; the uncharged amount never enters
  the plan).
