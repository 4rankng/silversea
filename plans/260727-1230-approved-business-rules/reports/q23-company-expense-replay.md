# Q23 company-expense replay and stale-write closure

**Date:** 2026-07-28  
**Status:** DONE

## Delivered

- Company-expense create/update/delete require a material command key and
  persist immutable replay results with the business write in one transaction.
- Update/delete require the version last read by the caller. The service locks
  the expense, rejects stale writers, and prevents duplicate reversal/repost
  ledger effects.
- Receipt-photo uploads use a deterministic storage key derived from the
  command key plus an immutable processed-file hash. A crash or retry
  overwrites the same external object and commits only one photo row.
- Same-key/different-file reuse returns 409.
- Photo deletion locks and deletes one row inside the replay transaction;
  exact replay does not repeat the external storage deletion.
- Existing frontend list/detail reads automatically supply the row version
  through the shared API transport.

## Proof

- `qa/2026-07-28_q23-expense-replay_backend-test.log`
  - missing key rejected;
  - create replay exact with one expense/ledger effect;
  - concurrent stale updates produce one 200 and one 409;
  - exact update replay adds no ledger entries;
  - stale delete rejected;
  - exact delete replay adds one reversal only;
  - photo upload/delete replay produces one DB row and one external side effect.

The integrated repository typecheck/test/build/E2E gates remain controller
owned after the concurrent Q15 governance sessions settle.
