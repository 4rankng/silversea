# Q23 penalty cancel race

## Executive summary

- Issue: `cancelPenalty()` could append duplicate reversal ledger rows when two callers canceled the same ACTIVE penalty concurrently.
- Impact: one penalty could be reversed twice, leaving the driver ledger over-credited while the penalty row still ended as `CANCELED`.
- Root cause: the service read penalty status before opening the transaction, then later updated the row without an `ACTIVE` predicate. The shared driver advisory lock serialized ledger posting, but it did not revalidate the stale pre-transaction read.
- Fix: move the controlling read into the transaction with `FOR UPDATE`, keep the shared driver ledger lock after the row lock, and claim `ACTIVE -> CANCELED` with a conditional `UPDATE ... RETURNING`. The loser now gets `409` and posts no reversal.

## Evidence and timeline

1. Authority and risk confirmed from `q23-material-write-inventory.md` P0 penalty section: the report already called out penalty cancel as a critical stale-read race.
2. Live code confirmed the report:
   - before fix, `backend/src/services/financial.service.ts` read `penalties.status` outside `db.transaction(...)`;
   - inside the transaction it only took `LedgerService.lockEntity(tx, 'DRIVER', penalty.driverId)`;
   - it then updated `penalties` by `id` only and always posted an `ADJUSTMENT` reversal.
3. Pre-fix reproduction was captured in `qa/2026-07-27_q23-penalty-cancel-pre-fix_backend-test.log`:
   - sequential second cancel returned the already-canceled message with the wrong status code for Q23 (`400`, not `409`);
   - concurrent cancel produced **2 fulfilled calls** instead of one winner/one loser.
4. Post-fix verification was captured in `qa/2026-07-27_q23-penalty-cancel-post-fix_backend-test.log`:
   - sequential duplicate cancel returns `409`;
   - concurrent cancel returns exactly one success and one `409`;
   - exactly one reversal row remains for the penalty and the driver balance returns to zero.

## Hypotheses tested

### H1 — stale pre-transaction status read causes duplicate reversals

- Test: hold the shared driver advisory lock open, then fire two `cancelPenalty()` calls in parallel against the same ACTIVE penalty.
- Result before fix: confirmed.
- Evidence: both calls read ACTIVE before the transaction, both then waited behind the same driver lock, and both fulfilled once the lock was released.

### H2 — duplicate side effects come from the HTTP route / notification layer, not the service

- Test: reproduce directly against `cancelPenalty()` in a focused backend test without routing or notification code.
- Result: eliminated.
- Evidence: the direct service test still produced two fulfilled cancels pre-fix, so the duplication originated inside the service transaction path.

### H3 — the existing driver advisory lock is sufficient to prevent the race

- Test: use the same shared driver advisory lock as the blocker in the focused reproduction.
- Result: eliminated.
- Evidence: the driver lock serialized execution order but did not invalidate the stale read performed before the transaction, so the second caller still posted a second reversal.

## Fix details

- `backend/src/services/financial.service.ts`
  - moved penalty lookup into `db.transaction(...)`;
  - locked the controlling penalty row with `FOR UPDATE`;
  - changed already-canceled behavior to `409`;
  - kept lock order as `penalty row -> driver advisory lock`;
  - changed the update to `WHERE id = ? AND status = 'ACTIVE' RETURNING *`;
  - if no row is claimed, return `409 "Kỷ luật đã bị hủy bởi người khác. Vui lòng tải lại."`;
  - kept the append-only `ADJUSTMENT` reversal logic unchanged for the winner.
- `backend/src/tests/q23-penalty-cancel-race.test.ts`
  - added a sequential duplicate-cancel regression;
  - added a deterministic concurrent-cancel regression using a held driver advisory lock to widen the race window.

## Lock-order / deadlock assessment

- New order in this path: controlling penalty row lock first, then shared driver advisory lock.
- Why this is safe:
  - same-penalty concurrent cancels cannot deadlock; the loser waits on the same penalty row before it can request the driver lock;
  - different penalties for the same driver can each hold their own penalty row and then serialize on the single driver advisory lock, which is contention but not a lock cycle;
  - this path does not introduce any `driver lock -> penalty row` inversion.

## QA

- Pre-fix repro: `qa/2026-07-27_q23-penalty-cancel-pre-fix_backend-test.log`
- Post-fix focused backend test: `qa/2026-07-27_q23-penalty-cancel-post-fix_backend-test.log`
- Targeted lint: `qa/2026-07-27_q23-penalty-cancel_lint.log`
- Backend typecheck snapshot: `qa/2026-07-27_q23-penalty-cancel_backend-typecheck.log`

## Recurrence prevention

- Keep the Q23 rule: controlling business row lock plus conditional state claim must happen inside the same transaction before any append-only reversal.
- Reuse this race-test shape for other stale-read reversal paths called out in the inventory, especially trip cancel and any remaining cancel/reopen flows.

## Unresolved questions

- None in the owned Q23 penalty slice.
