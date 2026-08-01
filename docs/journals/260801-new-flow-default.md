# New Flow Only, No Rollback Fantasy

**Date**: 2026-08-01 17:18  
**Severity**: Medium  
**Component**: Workflow rollout removal, backend test hygiene, E2E closeout  
**Status**: Ongoing

## What Happened

We removed the old rollout compatibility layer and made the new customer-service-to-finance flow the only runtime path. That part was straightforward in code but messy in verification because the backend suite exposed a stale test assumption instead of a product bug. The `chiho-reconciliation` teardown needed the `customer_visible_events` cleanup before `shipment_milestones`, and `durable-effect-jobs.test.ts` was asserting a global singleton instead of the row it created.

The first E2E suite16 run also failed for the same kind of reason: the API and rendered UI queue were out of sync, so the run was looking at the wrong surface. Once the rendered UI task/handoff was selected, the focused 47/47 check passed. The full final E2E was still pending when this note was written, so nobody should pretend it is green yet.

## The Brutal Truth

This was not one neat feature change. It was a pile of old assumptions breaking in different places at once. The code change was correct; the test environment was brittle. That is frustrating because it wastes time and makes the signal look worse than the actual product state. But the fix was still real work, not wishful thinking.

## Technical Details

- Rollout compatibility was removed from the runtime and auth/browser contract.
- `chiho-reconciliation.test.ts` needed the foreign-key cleanup order fixed.
- `durable-effect-jobs.test.ts` now scopes the lease assertion to its own `dedupeKey` instead of assuming one active job in the whole database.
- The first E2E suite16 failure came from an API/UI queue mismatch.
- The focused rerun was 47/47 after selecting the rendered UI task/handoff.

## What We Tried

- Removed the rollout flag and all `503` compatibility branches.
- Reran the backend suite to separate product regressions from shared-test pollution.
- Tightened the durable-effect assertion to the job this test owns.
- Reran the focused UI/E2E path against the actual rendered task instead of the wrong queue entry.

## Root Cause Analysis

The root cause was not the new flow itself. The real failure was hidden coupling in the test and verification layers: one stale teardown order, one overly broad singleton assertion, and one UI queue mismatch. The rollout removal exposed that coupling because it forced the system onto one canonical path instead of letting the old compatibility branch mask drift.

## Lessons Learned

- Shared test databases need assertions that prove ownership, not folklore about global uniqueness.
- Teardown order matters when FK chains are involved; cleanup that “usually works” is not enough.
- Verification has to target the rendered surface the user actually sees, not just the queue entry that looked convenient.
- When a compatibility layer disappears, the old tests that depended on it tend to fail in ugly ways. That is the cost of finally deleting the lie.

## Next Steps

- Finish the final E2E run and record the real result.
- Keep the test suite honest about owned rows and cleanup order.
- Do not merge any follow-up that reintroduces rollout compatibility or claims success before the final E2E artifact exists.
