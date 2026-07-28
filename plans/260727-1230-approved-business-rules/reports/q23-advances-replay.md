# Q23 advance immutable replay and stale versions

**Date:** 2026-07-28  
**Status:** DONE_WITH_CONCERNS  
**Scope:** advance request approval/rejection, advance settlement creation and
review mutations, and forwarder advance request/settlement creation.

## Delivered

- Added `version` columns (default `1`) to advance requests and settlements in
  migration `0144_q23_advance_versions`.
- Advance request approve/reject and settlement update, expense adjustment,
  check, approve, and reject now validate the submitted `expectedVersion`.
  Successful mutations increment the version in the same conditional update.
- Existing row locks, first-valid-state predicates, Q15 actor separation, and
  append-only settlement expense correction history remain intact.
- Advance mutations use the shared atomic idempotency runner. The domain write,
  ledger effects, linked rows, and replay record commit or roll back together.
- Forwarder advance request and settlement creation are now replay-safe and
  return `200` for a successful keyed replay (`201` for the first creation).
- The frontend sends the currently rendered version. The update-then-check flow
  uses the version returned by the update rather than stale page state.

## Focused verification

Evidence: `qa/2026-07-28_q23-advances-replay_focused.log`

- Q23 financial idempotency: 4/4 passed.
- Shared typecheck: passed.
- Backend typecheck: passed.
- Frontend typecheck: passed.
- Existing forwarder settlement workflow: 20/21 passed. The only failure is an
  out-of-scope concurrent Q22 source-authority change requiring an expense
  actual date before late approval:
  `Chi phí #...: ngày chi thực tế là bắt buộc trước khi phê duyệt`.
  All maker/checker/approver, correction, stale-check invalidation, atomic link
  replacement, and duplicate-claim cases passed.

## Concern

The complete repository gate is not claimed green because the concurrent Q22
fixture failure above remains outside this slice. No attempt was made to weaken
or bypass that new production rule.
