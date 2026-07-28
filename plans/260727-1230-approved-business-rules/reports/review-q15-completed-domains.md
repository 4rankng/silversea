# Independent review — Q15 completed domains

**Status:** DONE_WITH_CONCERNS  
**Release verdict:** BLOCKED  
**Scope:** trip financial governance, salary authority, profit distribution, official identity snapshots. Material-config work was excluded.

## Executive result

Trip governance and salary authority satisfy the reviewed actor/action/payload/version/idempotency/no-pre-effect contracts. The official-identity export override defect found during review has been patched so issued documents prefer their frozen snapshot, and a focused issued-override regression was added.

Profit distribution is not ready:

1. approval recomputes source authority outside its locked transaction, leaving a financial race;
2. the exact non-forced focused test failed its applied-audit assertion and did not exit naturally.

The full evidence and line-level assessment are in:

- `qa/2026-07-28_q15-completed-domains_review.md`
- `qa/2026-07-28_q15-completed-domains_profit-natural-exit.log`

## Blocking recommendations

### Profit source authority

Refactor `computeDistribution()` to read through the approval transaction and introduce a serialization/locking protocol shared with trip-close and cap-table writers. Merely passing `tx` under default read-committed isolation is insufficient for new qualifying-row phantoms. Prove behavior with a test that changes a locked-trip/cap-table source concurrently with approval.

### Profit test reliability

Fix the missing `PROFIT_DISTRIBUTED` audit observation and the pending/open handle. Acceptance requires:

`cd backend && npx tsx --test --test-concurrency=1 src/tests/q15-profit-distribution-governance.test.ts`

to pass all tests and terminate by itself with exit 0.

## Plan follow-up

- Keep the overall Q15 phase open.
- Do not mark profit distribution complete from force-exit artifacts.
- Official identity can remain provisionally complete after the controller's focused green run, but include it in the final integrated DB/type/lint/build gates.
- Trip and salary completed-domain status can remain green, subject to the final integrated suite.

Status: DONE_WITH_CONCERNS  
Summary: Independent review completed; two profit blockers remain, and the issued-export identity bypass was patched and regression-covered.  
Concerns/Blockers: Profit plan computation is not transaction-consistent; the natural test run failed audit proof and hung.
