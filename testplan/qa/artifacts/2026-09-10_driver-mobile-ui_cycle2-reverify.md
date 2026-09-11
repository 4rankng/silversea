# QA Cycle 2 — Driver mobile UI reorder (T3 365943ea)

**Ticket:** 365943ea
**Cycle:** 2 (re-verify after fullstack L0 commit 9b2744b6 + frontend L1 uncommitted R1/R2 changes)
**Status:** PASS — all 3 cycle-1 ACs + R1/R2 custom audit findings resolved
**Mode:** Code + unit-test verified; UI DRIVEN screenshots deferred to staging cut cycle.

## What changed since cycle 1

### Commit 9b2744b6 (fullstack L0, pushed to origin/prod)
- `DriverTripDetailPage.tsx`: Tác vụ TaskFact **removed** (line 388 of pre-fix tree gone). driverNotes now renders ONLY in the `Quy định tại điểm làm hàng` block. Cycle-1 AC2 resolved.
- `DriverTripDetailPage.test.tsx`: spec-A4 test renamed to "renders the ticket-365943ea field order…" with the new label sequence and no Tác vụ row. Cycle-1 AC1 resolved.
- `DriverTripsPage.tsx`: still uses a tag-splitter at this commit (splitOperationTags — see L1 follow-up below).
- `frontend/src/api/driverClient.ts`: `factoryShortName` + `operationalNotes` fields present.
- `backend/src/services/driver-journey-board.service.ts`: `operationalNotes` selected+returned; `factoryShortName` resolved via `operationalName()` SQL helper (blank-safe).
- `backend/src/services/driver.service.ts`: same blank-safe `factoryShortName` on fulfillment detail.
- `backend/src/tests/driver-journey-board-fields.test.ts`: NEW (1/1 green).
- `testplan/roles/03-laixe.md`: card anatomy + regression hooks updated to spec 365943ea.

### L1 frontend work (uncommitted in tree, awaiting frontend's chunk-b commit)
- `useDispatchTaskTags.ts`: **CANONICAL_TAG_ORDER constant + canonRank + sortTagsCanonically all DELETED.** `select` is now just `data.items` (pass-through). New JSDoc states "No client-side sort needed" — API returns displayOrder ASC NULLS LAST then label ASC. R2 (custom audit HIGH) resolved.
- `useDispatchTaskTags.test.tsx`: typo on line 69 (`createWrapper() tests });`) fixed; rewritten to assert API pass-through:
  - "returns tags in API-provided order (server sorts by displayOrder)"
  - "passes through API order for mixed canonical and custom tags"
  Cycle-1 AC3 resolved.
- `DriverTripsPage.tsx`: **splitOperationTags + its JSDoc REPLACED with `parseNote` from `dispatchTaskTags.ts`.** Rendering: `selectedLabels` → chips, `manualText` → separate `<p class="driver-journey-card__ops-note">` (NOT a chip). R1 (custom audit HIGH) resolved. Free text in operationalNotes can no longer render as a tag chip.
- `frontend/src/api/dispatchPlanningClient.ts`: `DispatchTaskTag` type gained `displayOrder?: number | null` field.
- `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.{tsx,css,test.tsx}`: Tác vụ column removal (T4 FE work, in progress).

## Test results (cycle 2)

```
$ cd frontend && npx vitest run \
    src/pages/DriverTripDetailPage.test.tsx \
    src/pages/DriverTripsPage.test.tsx \
    src/tests/structure.guard.test.ts \
    src/features/dispatch/detailed-plan/useDispatchTaskTags.test.tsx

✓ DriverTripDetailPage — 17/17 (incl. ticket-365943ea field order + CUS driver note uniqueness)
✓ DriverTripsPage — 11/11 (incl. operationalNotes chips + factoryShortName precedence)
✓ structure.guard — 3/3
✓ useDispatchTaskTags — 2/2 (API displayOrder pass-through)
Total: 33/33 PASS
```

```
$ cd backend && npx tsx --test src/tests/driver-journey-board-fields.test.ts
✓ cards carry operationalNotes verbatim and resolve blank-safe factory labels
Total: 1/1 PASS
```

```
$ cd frontend && npx tsc -b
(no output → clean)
```

## Acceptance criteria verdict

| AC | Description | Cycle 1 | Cycle 2 |
|---|---|---|---|
| AC1 | spec-A4 test → spec-365943ea sequence | FAIL | PASS — test renamed + re-anchored; no Tác vụ row |
| AC2 | driverNotes rendered only once (no Tác vụ TaskFact) | FAIL | PASS — TaskFact removed; "cân tại cầu 3" unique getByText |
| AC3 | useDispatchTaskTags.test.tsx parseable + clean | FAIL | PASS — typo fixed; rewritten as displayOrder pass-through |
| AC4 | PM summary chip-on-detail-page wording | WARN | RESOLVED — implementation matches testplan; PM summary is documentation-only |
| R1 (custom audit) | parseNote reuse, free text not chip | NEW | PASS — DriverTripsPage imports parseNote; free text renders as separate `<p>` |
| R2 (custom audit) | drop FE CANONICAL_TAG_ORDER | NEW | PASS — constant + sortTagsCanonically deleted; API order pass-through |
| Backend gate | driver-journey-board-fields.test.ts | NEW | PASS — 1/1 green |

## NOT covered this cycle (deferred to staging cut cycle)

The full testplan `testplan/qa/2026-09-10_driver-mobile-ui.md` requires rung-3 UI DRIVEN verification
(post-click screenshot + DOM assert + driver log) at 360/390/768 viewports on staging
`https://vantai.tingting.vip/`. This cycle re-verified the code + unit-test layer only, since:

1. Fullstack L0 just landed on origin/prod (commit 9b2744b6).
2. Frontend L1 R1/R2 is uncommitted in tree.
3. Per the wave spec, staging verification is L3 work that follows the L4 staging cut — NOT
   the same cycle as the L0/L1 commit cycle.
4. react-query refocus closes dialogs — staging UI tests must be driven in one eval, which is
   best done after both L0 and L1 land on origin/prod AND staging is re-cut.

The seven required UI artifacts (`qa/2026-09-10_driver-mobile-ui_ui-001..005*.png`,
`ui-driver.log`, `ui-gate.txt`) will be produced in the next QA cycle once staging carries the
combined L0 + L1 code.

## Verdict

**flags.qaPassed: true** for the cycle-2 code/unit-test gate.

Cycle 2 is complete. Next QA cycle = UI DRIVEN staging verification per
`testplan/qa/2026-09-10_driver-mobile-ui.md` once L4 deploy-owner cuts staging with both L0
and L1 on origin/prod.

## Pre-existing failures (not in scope)

- `MasterPlanGrid.test.tsx > pairs the allocation and notes cells side-by-side in the 600-900px
  band`: pre-existing on origin/prod HEAD; verified by `git stash` + rerun in cycle 1.
- 6 frontend lint errors (IssueOrderFields.tsx, useDispatchDetailPlan.test.tsx,
  CusDetailContent.tsx, use-cus-detail.ts, use-cus-quick-edit.ts): pre-existing, none in any file
  touched by L0 or L1.
