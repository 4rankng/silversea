# Q02/Q04 Boundary and Concurrency Proof

**Date:** 2026-07-28
**Scope:** Accepted Q02 and Q04 proof gaps only.
**Owned files:** `backend/src/tests/m53-credit-limit.test.ts`,
`backend/src/tests/m57-receivable-reminder.test.ts`, and this report.

## Implemented executable evidence

### Q02 — tiered credit-limit approval

Added direct production-service cases proving:

1. A 5% excess whose amount is exactly the configured cap plus one VND requires
   `DIRECTOR`.
2. An excess at exactly 10% and exactly the configured amount cap remains
   `FINANCE_TIER_1`.
3. A one-VND increase above the 10% boundary, while still within the amount
   cap, requires `DIRECTOR`.

The one-VND case derives the boundary ratio from the persisted credit limit and
excess amounts because the audit snapshot column stores the displayed ratio at
four decimal places. Tier selection itself consumes the live, unrounded
calculation.

### Q04 — reminder working window and one-per-day claim

Added direct production-service cases proving:

1. 07:59 does not send; the inclusive 08:00 boundary sends.
2. The inclusive 17:30 boundary sends; 17:31 does not send.
3. An ordinary Saturday with no calendar override does not send.
4. Two simultaneous `runReceivableReminders(now)` calls create exactly one
   customer email log and exactly one customer-scoped notification for the
   eligible customer/day.

The scenarios exercise the database-backed reminder job, advisory claim, email
log, and customer notification paths. No source behavior was changed.

## Verification

Initial Q02 focused run:

```text
cd backend &&
npx tsx --test --test-concurrency=1 \
  src/tests/m53-credit-limit.test.ts \
  src/tests/q01-credit-override-routes.test.ts
```

Result: **11 passed, 1 failed, exit 1**. The new one-VND case incorrectly
expected the four-decimal audit snapshot to preserve seven decimal places.
The assertion was corrected to derive `1,000,001 / 10,000,000 = 0.1000001`
from the persisted authority amounts; no production rule or threshold was
changed.

Q02 rerun, same command:

```text
Result: 12 passed, 0 failed, exit 0.
```

Q04 focused run:

```text
cd backend &&
npx tsx --test --test-concurrency=1 \
  src/tests/m57-receivable-reminder.test.ts
```

```text
Result: 31 passed, 0 failed, exit 0.
```

Backend typecheck:

```text
cd backend && npx tsc --noEmit
```

```text
Initial result during concurrent Q07 work: exit 2.
src/routes/config.ts(707,5): error TS2322:
Type 'string[] | null' is not assignable to type
'SupplierType[] | null | undefined'.
```

That error is in the concurrently owned Q07 route and outside this assignment's
allowed files. It was reported to the controller and was not modified here.
After the controller resolved its Q07 change, the same command was rerun:

```text
Result: exit 0, no output.
```

The controller owns final QA artifacts and broader gate reruns.

## Self-review

- Changes are additive tests only; no application source, handoff, plan state,
  or `qa/` artifact was modified.
- Each Q02 fixture uses a unique customer, preventing repeat-exception state
  from obscuring the ratio/cap branch under test.
- Q04 assertions query only the fixture customer and linked customer user, so
  unrelated reminder fixtures do not satisfy the exact-one claims.
- No skip, TODO, placeholder, relaxed assertion, or test-only production hook
  was introduced.

Status: DONE
Summary: Q02 and Q04 audit proof gaps are closed by focused database-backed
boundary and concurrency tests; both required focused commands and the backend
typecheck are green.
Concerns/Blockers: None within the assigned Q02/Q04 scope.
