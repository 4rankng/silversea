# Forwarder settlement + terminal-status race diagnosis

Date: 2026-07-28

Scope: diagnose two release blockers without changing product source.

## Executive summary

I confirmed the two blockers were real in the failing design:

1. Revoked forwarder shipment scope did not stop a completed expense from being:
   - returned by `getAdvanceSettlement(...).eligibleExpenses`
   - accepted by preview/create settlement paths through `validateSettlementInputs(...)`

2. The mutable-scope and shipment-assignment validators had a transaction window against terminal shipment/trip transitions:
   - `assertForwarderMutableTripScope(...)` read trip/shipment status before taking only the assignment lock.
   - `validateShipmentIds(...)` validated shipment ids before later syncing `user_shipment_links`, but without holding a row lock on the shipment rows.

While I was investigating, the workspace changed. The current working tree now contains the minimal fix set I would have recommended:

- `backend/src/services/settlement-validation.ts`
- `backend/src/services/advance.service.ts`
- `backend/src/services/forwarder-trip-query.service.ts`
- `backend/src/services/user.service.ts`
- regression coverage in `backend/src/tests/forwarder-settlement-workflow.test.ts`
- regression coverage in `backend/src/tests/forwarder-trip-scope.test.ts`

So the blocker is no longer “what should we change”; it is “finish QA on the current diff and keep it”.

## Evidence gathered

### A. Live repro for the settlement-scope bug

I ran an isolated backend script against the local DB before the current fix landed in the working tree.

Observed result:

```json
{
  "validatedExpenseIds": [17939],
  "detailEligibleIncludesRevokedExpense": true,
  "createdSettlementId": 2700
}
```

What this proves:

- after deleting the forwarder’s `user_shipment_links` row,
- `validateSettlementInputs(...)` still accepted the revoked expense id,
- `getAdvanceSettlement(...)` still exposed that expense in `eligibleExpenses`,
- `createAdvanceSettlement(...)` still created a new settlement using that revoked expense.

This ruled out the hypothesis that the bug was only in the UI or route layer. The root cause was in the shared backend eligibility logic.

### B. Code-path proof for the settlement root cause

Before the fix, the shared validator loaded trip expenses only by id and owner:

- `backend/src/services/settlement-validation.ts`
  - expense fetch at lines 95-99
  - owner check at lines 117-120
  - no current-shipment-scope check

`getAdvanceSettlement(...)` also built `eligibleExpenses` from all forwarder-owned approved/pending expenses, again without current shipment-scope gating:

- `backend/src/services/advance.service.ts:674-733`

That combination explains all three leaking surfaces:

- settlement detail candidate list
- preview export path, because `previewSettlementHtml/Xlsx` relies on `validateSettlementInputs(...)`
- settlement create path, because `createAdvanceSettlement(...)` also relies on `validateSettlementInputs(...)`

### C. Code-path proof for the mutable write race

The original helper shape was:

- read trip + shipment status
- then lock only `user_shipment_links`
- then decide based on the earlier status snapshot

That pattern sits in:

- `backend/src/services/forwarder-trip-query.service.ts:72-107`

The downstream callers prove why stale status matters:

- `backend/src/services/forwarder-container.service.ts:32-70`
  - container create does not re-check trip/shipment terminal state
- `backend/src/services/forwarder.service.ts:96-120`
  - expense-completion re-checks trip status only, not shipment status
- `backend/src/services/forwarder.service.ts:242-271`
  - expense create re-checks trip status only, not shipment status

So the “downstream service will catch it anyway” hypothesis is false for shipment terminality, and false entirely for container create / photo write paths that rely on the helper boundary.

### D. Code-path proof for the shipment-assignment race

`validateShipmentIds(...)` originally validated shipment existence/unit only, then returned. Later in the same user transaction, create/update synced `user_shipment_links`.

Relevant locations:

- validator:
  - `backend/src/services/user.service.ts:263-293`
- create-user path:
  - `backend/src/services/user.service.ts:456-519`
- update-user path:
  - `backend/src/services/user.service.ts:708-760`

Important comparison:

- `validateBusinessUnitIds(...)` already used a share lock to prevent stale activation against concurrent unit retirement.
- shipment validation did not.

Shipment status transitions do take a row update lock and conditional update:

- `backend/src/services/shipment.service.ts:620-648`

Given PostgreSQL `READ COMMITTED`, this means:

1. tx1 validates shipment id
2. tx2 transitions shipment to terminal and commits
3. tx1 still inserts `user_shipment_links` / activates the user

Atomic user transaction alone does not close that window. The missing shipment-row lock is the issue.

## Hypotheses tested

### Hypothesis 1

“Settlement exposure is only a frontend/detail-page bug.”

Result: rejected.

Why:

- live repro showed `createAdvanceSettlement(...)` still succeeded after revocation
- shared backend validator was missing current shipment-scope enforcement

### Hypothesis 2

“The mutable-scope helper is fine because downstream services re-check status.”

Result: rejected.

Why:

- container create relies on the helper gate and does not re-check terminality
- expense create and completion re-check trip status, but not shipment status
- helper status snapshot was stale if a terminal transition committed after the initial read

### Hypothesis 3

“User assignment is safe because create/update runs in one DB transaction.”

Result: rejected.

Why:

- transaction atomicity does not prevent stale validation under `READ COMMITTED`
- shipment rows were not locked during validation
- the later link sync therefore could commit against a shipment that turned terminal after validation

## Minimal fix set

These are the minimal, contract-preserving fixes. The current workspace already contains them.

### Required 1 — gate settlement expense eligibility by current shipment assignment

File:

- `backend/src/services/settlement-validation.ts`

Function:

- `validateSettlementInputs(...)`

Fix:

- join selected expense ids through `trips -> user_shipment_links`
- require a current assignment for the same forwarder
- reject revoked expenses with a clear 400
- when `checkAlreadyLinked` is true, hold a row lock on the assignment rows during the same transaction

Current workspace status:

- present

### Required 2 — remove revoked expenses from settlement detail candidate lists

File:

- `backend/src/services/advance.service.ts`

Function:

- `getAdvanceSettlement(...)`

Fix:

- add current `user_shipment_links` scope gating to `expenseCandidates`
- keep historical linked expenses untouched; only candidate selection should shrink

Current workspace status:

- present

### Required 3 — lock mutable scope against terminal trip/shipment transitions

File:

- `backend/src/services/forwarder-trip-query.service.ts`

Function:

- `assertForwarderMutableTripScope(...)`

Fix:

- lock the trip/shipment status rows before allowing the write path to continue
- keep the assignment lock
- evaluate terminality from the locked rows, not an unlocked earlier snapshot

Current workspace status:

- present as a row-share lock on the trip/shipment read plus assignment `FOR UPDATE`

Note:

- this is sufficient if retained and tested. If future review wants stricter ordering, the only refinement I would consider is explicit row-by-row locking order, not a broader redesign.

### Required 4 — lock shipment rows during forwarder/clerk shipment assignment validation

File:

- `backend/src/services/user.service.ts`

Function:

- `validateShipmentIds(...)`

Fix:

- include shipment status in the validator
- reject terminal shipments
- take a share lock on validated shipment rows until the user transaction finishes

Current workspace status:

- present

## Regression coverage required

The current workspace also includes the right regression coverage shape.

### Present in current diff

- `backend/src/tests/forwarder-settlement-workflow.test.ts`
  - revoked shipment assignment removes an expense from `eligibleExpenses`
  - `validateSettlementInputs(...)` rejects the revoked expense

- `backend/src/tests/forwarder-trip-scope.test.ts`
  - terminal shipment denies mutable scope
  - active forwarder creation on terminal shipment rejects
  - concurrent terminal shipment transition is blocked while mutable scope is held

### Still required from the controller

Run these tests and keep the artifacts:

1. targeted backend tests for the two modified suites
2. full backend tests
3. full E2E if the controller decides the changed scope can affect authenticated workflow behavior

## Required vs nonblocking

### Required before release

- keep the current fixes in the four service files above
- keep the two regression test additions
- run backend QA on the current diff

### Nonblocking / optional

- centralize the “current forwarder shipment scope” predicate so `validateSettlementInputs(...)` and `getAdvanceSettlement(...)` cannot drift later
- add a route-level E2E specifically for revoked settlement eligibility if the team wants browser-level proof, but this is not required for the backend correctness fix

## Recommendation

Do not design a new approach. The current working tree already matches the smallest correct fix set.

Controller next step:

1. run the updated backend suites
2. if green, preserve the current diff exactly
3. include the new tests in the release evidence

## Unresolved questions

None for the fix itself.
