---
name: "load-failure-retry-duplication"
description: "15+ duplicated 'Không tải được + Thử lại' affordances across the frontend; should be extracted to a single LoadFailureRetry primitive before more call-sites are added (audit 2026-09-11)"
folder: "global / pitfalls"
tags: ["pitfall", "frontend", "duplication", "primitive", "retry"]
updatedAt: "2026-09-11T02:08:34.818Z"
author: "Agent"
---

# Load-failure retry UI duplication (audit 2026-09-11)

## Symptom

The 'Không tải được <thing>. ... Thử lại' affordance is duplicated 15+ times across the frontend. Each call-site copies the same shape (a small <p role="status"> or role="alert", a button, optional className differences), drifting in copy + button style. Drift is already visible:

- `dispatch-assignment-dialog__error` (2 new sites in DispatchPlanEditorCell.tsx added 2026-09-11 for ticket 8afc13a9 — carrierError + vehicleError retry blocks, both 'btn btn--ghost btn--sm')
- `TripReassignDialog.tsx` ('btn btn--secondary btn--sm', 'style={{ margin: 0 }}')
- `MasterPlanFilters.tsx` ('role="status"', 'master-plan-filters__zones-error' — no button, just text)
- `DispatchAllocationPopover.tsx` (UUIButton color="secondary")
- `DispatchTaskTagEditor.tsx` ('role="alert"', no retry button)
- `AccountingTransportRegister.tsx` ('accounting-alert' role="alert", onRetry prop)
- `FinancePolicySection.tsx` (inline string fallback, no retry)
- `TripEditPage.tsx` (inline 'role="alert"' + 'btn btn--secondary btn--sm')
- `DriverTripPodPage.tsx` (full-page AlertTriangle card)
- `GovernanceActionsPage.tsx` (generic 'Không tải được hàng chờ quản trị')
- `CreditOverrideQueuePage.tsx` (same generic pattern)
- `payables-fuel-invoices.tsx` (setSubmitError variant)

## Cost

- 12+ JSX patterns that look similar but use 4 different button classes, 3 different alert/status roles, and 5 different Vietnamese copy conventions.
- Each new fetch error site = ~6-12 LOC of inline JSX + boilerplate state.
- The frontend-architecture rule says: 'Add a primitive when: same JSX shape duplicated 3+ files, no business logic (props-driven), testable in isolation'. That bar is FAR exceeded here.
- QA agents must re-write the same retry affordance in each new test (see DispatchPlanEditorCell.test.tsx:569, TripReassignDialog.test.tsx:56, TripEditPage.test.tsx:89, DispatchAllocationPopover.test.tsx:266).

## Recommended primitive

```tsx
// src/design-system/LoadFailureRetry.tsx
interface LoadFailureRetryProps {
  message: string;          // "Không tải được danh sách xe."
  onRetry: () => void;
  variant?: 'inline' | 'block'; // inline = next to label; block = own row
  role?: 'status' | 'alert';
  buttonLabel?: string;     // default "Thử lại"
}
```

Then `useFleetFetch` / `useDetailQuery` wrappers surface the error state + retry fn uniformly; the consumer renders `<LoadFailureRetry message={...} onRetry={refetch} />`.

## Migration sequence (de-risk, don't break trunk)

1. Add the primitive under `src/design-system/LoadFailureRetry.tsx` (+ a 4-test unit file).
2. Migrate DispatchPlanEditorCell.tsx (the diff that added the duplication this cycle) — this PR retroactively folds the new lines into the primitive and proves the pattern.
3. Migrate TripReassignDialog.tsx + DispatchAllocationPopover.tsx + DispatchTaskTagEditor.tsx (dispatch cluster; same dir as the source).
4. Migrate the master-plan filters + accounting surfaces.
5. Migrate the full-page variants (TripEditPage, DriverTripPodPage) by giving them a `<LoadFailureCard variant="block" />` shape.
6. Optional: design-system guard test that bans inline 'role="alert"/"status"' + 'Thử lại' combinations outside the primitive (formatter-clone ban is the existing pattern).

## Why now

2026-09-11 carrier-less patch (commit pending — `8afc13a9` Option B) added 2 new instances to DispatchPlanEditorCell.tsx (carrierError + vehicleError retry blocks), pushing the count to 15+ and the file to 789 LOC (was 745). The pattern is accelerating; one more wave and it will be a measurable tax.

## Owners / scope

- Frontend (architecture layer): propose the primitive, write the unit test, do the migration in 5-7 small commits.
- QA: when a new 'Không tải được' + 'Thử lại' pattern appears in a code review, flag it as 'should use LoadFailureRetry' — keep the testplan regression stable across migrations.

## Linked artifacts

- Spec: `testplan/qa/2026-09-10_dispatch-detailed-plan.md` (8afc13a9 — the carrier-less scope)
- Source files: see `grep -rln 'Không tải được' frontend/src/` (≈12 files)
- Related note: [[frontend-architecture]] (primitive-creation rule)
