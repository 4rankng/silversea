# CUS Shipment Closeout and the QA Concurrency Trap

**Date**: 2026-08-04 19:20
**Severity**: Medium
**Component**: CUS shipment workspace, repo-wide QA, shared test database
**Status**: Ongoing

## What Happened

We delivered the customer-spec CUS shipment workspace changes: the seven-tab strip, the required operational columns, the missing-date warning, and the inline expected-delivery edit path. The independent review cycle also did its job and forced the product code to be corrected instead of hand-waved.

The closeout got messy because broad verification was running in the same workspace at the same time. One full backend pass rebuilt `shared/dist`, which in turn triggered the watch process to restart while E2E was still using the app. That did not prove a product bug. It proved we had created our own moving target.

## The Brutal Truth

This was frustrating because the feature itself was not the problem anymore. The problem was us trying to prove it too aggressively, too concurrently, and then reading the resulting noise like it meant something about the implementation. It wasted time and made the repo look broken when the underlying issue was verification hygiene.

## Technical Details

- Customer-facing fixes landed for the CUS shipment surface and the persisted authority path.
- Reviewer rerun removed the actual product bugs from the shipment path.
- Broad backend QA rebuilt `shared/dist` during `pnpm test`, which is enough to disturb a running `tsx-watch` app.
- That interference invalidated the E2E signal because the browser run no longer had a stable backend to exercise.

## What We Tried

- Ran focused shipment tests first to separate product failure from unrelated suite noise.
- Reran the full backend suite to see whether the earlier red gate was real or just shared-state drift.
- Kept E2E serialized after backend work instead of overlapping the two gates.

## Root Cause Analysis

The root cause was not the CUS feature. It was test orchestration. Broad QA was allowed to collide with a live app process that depended on the same build artifacts, so the backend test run and the E2E run were fighting over the same workspace state.

## Lessons Learned

- A green focused suite is not enough when the full suite can rebuild shared artifacts.
- Do not run broad backend QA and browser QA against the same live workspace at the same time.
- If a verification run restarts the app process, treat any overlapping E2E result as contaminated.

## Next Steps

- Keep broad QA serialized: backend first, then E2E, then browser/manual checks.
- If the backend suite touches shared build output again, isolate it before any browser verification starts.
- Use the saved QA artifacts as the source of truth, not the transient state of a half-restarted dev server.
