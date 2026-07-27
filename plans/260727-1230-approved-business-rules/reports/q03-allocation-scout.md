# Q03 payment allocation implementation scout

**Date:** 2026-07-27  
**Mode:** read-only production-path scout  
**Scope:** Q03 only, while preserving Q19 immutable due-date authority and Q23 request idempotency  
**Expected output:** smallest backward-compatible API/service/schema change after migration `0137` that makes the live receipt path honor explicit instructions, default to oldest immutable due date, persist excess as customer unapplied credit, and replay receipts exactly under retries and concurrency.

## Accepted authority and acceptance criteria

Q03 is accepted in `docs/prd/business-logic-qa-proposals.md:54-61`:

- explicit customer payment instructions take priority;
- without instructions, allocate by oldest due date;
- same due date breaks ties by oldest issue date;
- do not default to proportional or freight-first allocation;
- excess remains customer unapplied credit and is refunded only by a later requested/approved flow.

The phase plan requires immutable-due-date allocation, database-safe receipt
replay, and retained unapplied excess
(`phase-03-ar-credit-and-reminders.md:29-35,41,53`). The coverage baseline
correctly marks Q03 `PARTIAL`: the current service exists, but it orders by the
wrong field and receipt replay is not database-safe
(`reports/coverage-baseline.md:12`).

Acceptance for the implementation slice:

1. Existing callers that send `payments[]` continue to work; those rows are
   treated as explicit instructions.
2. A caller may instead send `amount` without `payments`; the server allocates
   by frozen `processingDueDate`, then immutable ledger issue timestamp, then a
   stable ID tie-breaker.
3. An explicit instruction is either honored exactly or the whole request is
   rejected. It is never silently clamped or redirected.
4. `receivedAmount - allocatedTotal` is persisted as customer unapplied credit
   in the same transaction.
5. Same receipt ID + same canonical payload returns the stored receipt result
   without another receipt, allocation, or ledger row. Same receipt ID with a
   different customer or payload returns `409`.
6. Concurrent first submissions have the same behavior as sequential replay.
7. The production `DebtDetailPage` calls this canonical path and lets the
   server decide default allocation.

## Actual production path

### Route and contract

- `backend/src/index.ts:208-213` mounts the financial router at `/api` behind
  JWT authentication and `casbinAuthz('financial')`.
- `backend/src/routes/financial/index.ts:13-15,31-39` registers
  `POST /api/payments/receive` for audit and mounts `payments.routes.ts`.
- `backend/src/routes/financial/payments.routes.ts:26-41` parses
  `createPaymentSchema`, calls `financialService.recordPayment`, invalidates
  reports, emits a notification, and returns only `{ ok: true }`.
- `shared/src/schemas/index.ts:207-214` requires:
  `customerId`, `receiptId`, and a non-empty
  `payments: [{ tripId, amount }]`. It has no total receipt amount, no
  unspecified/default mode, and no receipt result contract.

The live route never calls `allocatePayment`. The production API therefore
does not use the allocator that the Q03 baseline cites.

### Frontend caller

`frontend/src/pages/DebtDetailPage.tsx:277-308`:

- parses the entered amount;
- rejects customers with no `unpaidTrips`;
- caps the receipt at `totalOutstanding`;
- distributes that capped value across `unpaidTrips` in browser order;
- sends the resulting explicit `payments[]` to `/payments/receive`.

The list comes from `statement.service.ts`, which sorts `unpaidTrips` by the
ledger issue date string, not due date
(`backend/src/services/statement.service.ts:540-598`). The UI copy explicitly
says FIFO/oldest trip (`DebtDetailPage.tsx:733-735`). Because the UI caps the
amount, a real overpayment cannot reach the backend from this production
surface.

The frontend transport now adds an `Idempotency-Key` to every mutation
(`frontend/src/lib/api/client.ts:13-29,60-76`), but it generates a new key for
each `api.post` call. `DebtDetailPage` does not retain a key across a
network-error retry.

### Current direct posting service

`backend/src/services/financial.service.ts:17-96` opens a transaction and:

1. loads trip labels before taking the customer lock;
2. locks the customer;
3. computes each trip's revenue less payments;
4. silently clamps an instructed amount to outstanding;
5. posts the remainder as a customer-level ledger credit with `txnId: 0`.

Consequences:

- it does not validate that each instructed trip belongs to the customer;
- duplicate trip instructions are not rejected;
- repeated receipt IDs post again;
- a repeated receipt after the debt is paid becomes additional customer
  credit;
- it writes no `payment_allocations`, so payment-term/governance consumers
  cannot trace production receipt allocations;
- its return value contains no replayable allocation result.

### Current unused allocation service

`backend/src/services/payment-allocation.service.ts:81-187` does serialize by
customer and atomically writes allocation plus ledger rows, but:

- default order is `trips.departureDate`, then trip ID
  (`:109-127`), not immutable due date then issue timestamp;
- excess is only returned (`:145-146`), never posted or persisted as unapplied
  customer credit;
- `receiptId` is not checked before writes;
- a second same-receipt call allocates again against the remaining debt;
- `MANUAL` silently clamps an instruction instead of honoring/rejecting it.

The existing test describes the defect as expected behavior:
`m56-payment-allocation.test.ts:248-269` expects the second same receipt to
post another 2,000,000 VND. That is not Q03/Q23 idempotency.

### Existing persistence

- `payment_allocations.receipt_id` is nullable and only indexed, not unique
  (`backend/src/db/schema.ts:2113-2134`). Multiple allocation rows per receipt
  are valid, so uniqueness cannot be added directly to this column.
- The customer ledger has a text `receipt_id` and Q19 snapshots
  `original_due_date`, `processing_due_date`, applied term, and applied policy
  (`backend/src/db/schema.ts:642-678`).
- Q19 migration `0133` backfilled and froze those values for trip revenue,
  service fees, documents, and document adjustments. New trip revenue is
  stamped once by `LedgerService.postTripLock`
  (`ledger.service.ts:211-251`).
- `idempotency_keys` and `runIdempotent` already implement Q23's
  `(endpoint, key)` payload-hash conflict policy and concurrent-first-submit
  advisory lock (`idempotency.service.ts:97-160`). The payment endpoint is not
  registered in `IDEMPOTENCY_ENDPOINTS`.
- The audit middleware already records successful `replayed` responses and
  `409` conflicts (`middleware/audit.ts:159-181,232-253`).

## Recommended smallest backward-compatible design

### Shared request/response contract

Extend, do not replace, `createPaymentSchema`:

```ts
{
  customerId: positive integer,
  receiptId: trimmed string, 1..100,
  amount?: positive VND integer,
  payments?: Array<{
    tripId: positive integer,
    amount: positive VND integer,
  }> // non-empty when present; unique tripId
}
```

Normalization rules:

- `payments` present means explicit customer instructions.
- Legacy payload (`payments` present, `amount` absent) remains valid and
  derives `receivedAmount = sum(payments.amount)`.
- New explicit payload may include `amount`; require
  `sum(payments.amount) <= amount`. The difference is unapplied, not
  automatically redirected to other debts.
- No `payments` requires `amount`; this is the server-default
  `OLDEST_DUE` path.
- Require integer VND values after coercion. Reject duplicate trip IDs.
- Canonical payload hashing uses parsed/coerced values and trimmed receipt ID,
  not the raw JSON, so `"1000"` and `1000` do not create a false conflict.

Suggested shared types:

```ts
type PaymentAllocationMethod = 'OLDEST_DUE' | 'EXPLICIT';

interface PaymentReceiptResult {
  id: number;
  receiptId: string;
  customerId: number;
  receivedAmount: number;
  allocations: Array<{
    tripId: number;
    amount: number;
    processingDueDate: string | null;
    issueTimestamp: string;
  }>;
  allocatedTotal: number;
  unappliedAmount: number;
  allocationMethod: PaymentAllocationMethod;
  createdAt: string;
}

interface PaymentReceiptResponse {
  result: PaymentReceiptResult; // identical on first result and replay
  replayed: boolean;            // transport/audit metadata
}
```

Return `201` on first creation and `200` on replay. `result` must be byte-for-
byte equivalent after JSON normalization; only the top-level `replayed`
metadata changes.

### Migration `0138` suggestion

Create the next journaled migration after the current Q17 migration
`0137_salty_black_crow.sql`:

`0138_q03_payment_receipts.sql`

Add a receipt header because neither a ledger row nor one allocation row can
represent a multi-target receipt with zero or more allocations and an
unapplied remainder:

```text
payment_receipts
  id                  serial primary key
  receipt_id          varchar(100) not null
  customer_id         integer not null references customers(id)
  received_amount     numeric(15,0) not null
  allocated_total     numeric(15,0) not null
  unapplied_amount    numeric(15,0) not null
  allocation_method   varchar(20) not null
  request_hash        varchar(64) not null
  created_by          integer null references users(id)
  created_at          timestamp not null default now()
```

Constraints/indexes:

- unique `payment_receipts(receipt_id)`; this deliberately makes a receipt ID
  global so reuse for another customer is a conflict;
- check all three monetary columns are non-negative;
- check `received_amount = allocated_total + unapplied_amount`;
- check method in `('OLDEST_DUE', 'EXPLICIT')`;
- index `(customer_id, created_at)`.

Extend `payment_allocations` with nullable, backward-compatible fields:

```text
payment_receipt_id integer null references payment_receipts(id)
allocation_order  integer null
```

Add:

- unique `(payment_receipt_id, allocation_order)` where
  `payment_receipt_id is not null`;
- unique `(payment_receipt_id, target_type, target_id)` where
  `payment_receipt_id is not null`;
- checks that new allocation order is positive and amounts are positive.

Keep the legacy `receipt_id` column populated on new rows because current
reads/tests and operational traceability use it. Do not rewrite old ledger or
allocation rows. Historical duplicate or nullable receipt IDs mean an honest
exact-result backfill is not generally possible. Before creating a new header,
the service should reject a receipt ID already present in legacy ledger or
allocation rows but absent from `payment_receipts`, with a clear `409`; it must
not guess a historical payload/result.

No Q19 column is changed or recomputed by `0138`.

### Canonical service

Replace both `financialService.recordPayment` and the unused allocator write
logic with one service operation, for example
`recordCustomerReceipt(input, actorId)`. Keep `recordPayment` as a thin
compatibility wrapper only if another internal caller exists; the production
route must call the canonical operation.

Within the receipt transaction:

1. Normalize and hash the semantic receipt payload before opening the
   transaction.
2. Acquire a transaction advisory lock for the business receipt ID.
3. Load `payment_receipts` by receipt ID.
   - same hash: load ordered allocations and return the persisted result;
   - different hash (including another customer): `409`;
   - do not take the customer lock on this replay branch.
4. Reject an ambiguous legacy receipt ID found only in old allocation/ledger
   rows.
5. Acquire `LedgerService.lockEntity(tx, 'CUSTOMER', customerId)`.
6. Verify the active customer exists.
7. Load all relevant customer AR ledger rows inside the lock. Build trip
   outstanding amounts and immutable sort keys from persisted rows; do not
   consult live customer terms or the business calendar.
8. For explicit instructions:
   - validate unique targets belong to this customer;
   - validate each exact instructed amount is no greater than the locked
     outstanding amount;
   - otherwise reject the whole transaction with `422`.
9. For default allocation, sort open trip obligations by:
   - `effectiveDueDate =
     processingDueDate ?? originalDueDate ?? issueTimestamp.slice(0, 10)`;
   - immutable issue timestamp ascending;
   - trip ID ascending.
10. Insert `payment_receipts`, ordered `payment_allocations`, and each
    trip-level `PAYMENT_RECEIVED` ledger credit.
11. If excess remains, insert one customer-level `PAYMENT_RECEIVED` ledger
    credit (`txnId: 0`, same receipt ID, explicit unapplied-credit note) and
    persist that amount in `payment_receipts.unapplied_amount`.
12. Return the persisted receipt result; transaction commit makes header,
    allocations, trip credits, unapplied credit, and running balance atomic.

The fallback for legacy null due-date snapshots uses only immutable persisted
issue time. It does not recalculate from today's customer term/calendar, so it
preserves Q19. Null snapshots should be visible in the result/QA rather than
silently presented as contractual due dates.

The customer lock must be acquired before reading outstanding amounts.
`LedgerService.postEntry` may re-acquire the same transaction advisory lock;
PostgreSQL transaction advisory locks are re-entrant.

### Q23 request idempotency and lock order

Add:

```ts
IDEMPOTENCY_ENDPOINTS.PAYMENT_RECEIVE = 'payments.receive'
```

The route should pass `req.header('Idempotency-Key')`, the canonical parsed
payload, actor ID, and receipt entity loader to `runIdempotent`. Retain the
optional-no-header behavior for non-browser legacy clients; receipt-level
idempotency remains mandatory regardless of header.

Global lock order:

1. Q23 request-key advisory lock in `runIdempotent` (when header exists);
2. Q03 receipt-ID advisory lock in the receipt service;
3. customer ledger advisory lock.

All payment code must follow this order. Different receipts for the same
customer serialize at step 3. Same receipt for different customers serializes
at step 2 and the loser receives `409`. Same request key with a different
payload is rejected at step 1. This order has no inverse payment path and
avoids a receipt/customer deadlock.

If the outer Q23 transaction fails to store its key after the inner receipt
transaction committed, a retry safely replays the receipt and can then repair
the request-key mapping. This is why receipt-level idempotency cannot be
replaced by the generic request-key table.

Emit the payment notification only when neither the Q23 layer nor the receipt
layer reports a replay. Cache invalidation may be repeated safely. Set the
audit entity ID/key to the receipt header ID/receipt ID.

## Production UI change

Update `DebtDetailPage` rather than adding a second payment screen:

- send `{ customerId, receiptId, amount }` for the default path; do not send
  browser-calculated `payments[]`;
- remove `Math.min(amount, totalOutstanding)` so excess reaches the server;
- keep a client-generated `Idempotency-Key` stable for the same normalized
  payload across a failed retry; generate a new key when the user edits amount,
  receipt ID, or customer, and clear it only after success;
- describe the actual rule: oldest processing due date, then oldest issue
  time; explain that excess remains unapplied customer credit;
- consume the returned allocation result and show allocated and unapplied
  totals in the success toast/state;
- keep the current submit-disable guard to prevent ordinary double-clicks, but
  treat it as UX only, not correctness.

If an explicit-allocation editor is not included in this slice, the existing
`payments[]` API remains the backward-compatible explicit-instruction path.
The default production UI is still sufficient to prove the unspecified case.

The statement list should also sort its display by the same immutable key
instead of `date` alone, so the preview matches the server. The server remains
authoritative.

## Required tests and E2E

### Shared/schema

- legacy `payments[]` payload parses and derives total;
- `amount`-only payload parses;
- neither amount nor payments fails;
- duplicate trip IDs fail;
- decimals/non-positive values fail;
- explicit sum greater than amount fails;
- trim/length behavior for receipt ID.

### Backend service/database

Rewrite `m56-payment-allocation.test.ts`; do not preserve the current
"second call allocates the remainder" assertion.

- a later-issued debt with an earlier frozen `processingDueDate` is allocated
  first;
- equal due dates use earliest immutable ledger timestamp, then trip ID;
- legacy null due snapshot uses immutable issue-date fallback and never live
  customer/calendar recomputation;
- explicit instructions are applied exactly and preserve caller order;
- over-outstanding, wrong-customer, missing, deleted, or duplicate explicit
  targets roll back everything;
- amount above instructed/default allocations creates one customer-level
  credit and persists `unappliedAmount`;
- same receipt/same payload returns the same result and row IDs with exactly
  one receipt header, allocation set, notification, and ledger effect;
- same receipt/different amount, targets, or customer returns `409`;
- `Promise.all` concurrent first submits with same receipt/payload create one
  result;
- concurrent different receipts for one customer never over-allocate and
  preserve total money as allocated plus unapplied;
- forced failure after header planning leaves no header/allocation/ledger
  partial state;
- a pre-existing legacy receipt ID is rejected without new writes;
- Q19 regression: changing customer term/calendar after revenue posting does
  not change allocation order;
- Q23 route tests: stable key replay, different-payload conflict, concurrent
  first submit, optional legacy no-header request;
- route notification is emitted once and audit records replay/conflict.

Keep `m114-payment-term.test.ts` green: it reads
`payment_allocations.targetType/targetId/amount/createdAt`, so new nullable
receipt foreign keys must not invalidate legacy fixture inserts.

### Frontend

- default submit sends `amount`, not client-generated trip splits;
- amount is not capped at outstanding;
- same-payload retry reuses the same idempotency key;
- editing the payload produces a new key;
- returned unapplied amount is visible;
- due-order/unapplied-credit copy is correct;
- desktop and narrow mobile modal remain usable with no overflow and a
  reachable submit button.

### E2E

Through authenticated `POST /api/payments/receive` and the real debt UI:

1. create two open debts whose issue order conflicts with frozen due-date
   order;
2. submit an amount that pays the first and partially pays the second;
3. assert API result, `payment_receipts`, ordered allocations, ledger balance,
   and statement agree;
4. replay the same request key/receipt and assert no additional rows or
   notification;
5. reuse the receipt with changed amount/customer and assert `409`;
6. submit more than outstanding and assert the exact excess remains customer
   unapplied credit;
7. run a concurrent-first-submit API case;
8. exercise the modal at desktop/tablet/mobile widths.

Because this changes a shared contract, financial schema, live API flow, and
frontend behavior, the eventual implementation requires all mandatory gates:
shared typecheck, root lint, backend/frontend typecheck and tests, build, and
full E2E, with every run saved under `qa/`.

## Legacy behavior intentionally preserved

- Existing `payments[]` clients remain accepted.
- Existing `payment_allocations` rows without a receipt header remain readable.
- Existing payment-term, Q18 governance, and period-lock consumers continue to
  read `targetType`, `targetId`, `amount`, and `createdAt`.
- New allocation rows continue to populate the legacy text `receiptId`.
- Existing customer ledger sign convention and `txnId: 0` customer-level
  credit representation remain intact.
- Q19 `originalDueDate`/`processingDueDate` snapshots remain immutable; Q03
  only reads them.
- Q23 generic request-key behavior and conflict audit remain the shared
  request-level authority.

## Explicit non-goals

- refund approval/workflow for unapplied credit;
- automatic reallocation of old unapplied credit to future invoices;
- changing payment-term calculation semantics;
- redesigning billing-document allocation targets;
- rewriting or guessing historical receipt results;
- changing RBAC.

## Files expected in the implementation

- `shared/src/schemas/index.ts`
- `shared/src/index.ts`
- `shared/src/types/index.ts`
- `backend/src/db/schema.ts`
- `backend/drizzle/0138_q03_payment_receipts.sql`
- `backend/drizzle/meta/0138_snapshot.json`
- `backend/drizzle/meta/_journal.json`
- `backend/src/services/payment-allocation.service.ts`
- `backend/src/services/financial.service.ts` (compatibility wrapper/removal of
  duplicate write logic)
- `backend/src/services/idempotency.service.ts`
- `backend/src/routes/financial/payments.routes.ts`
- `backend/src/services/statement.service.ts`
- `frontend/src/pages/DebtDetailPage.tsx`
- focused shared/backend/frontend tests and the payment E2E flow

## Conclusion

Q03 is not implemented on the production path today. The smallest safe
correction is a receipt header plus nullable allocation FK/sequence, one
canonical receipt transaction, and route/UI wiring. A unique receipt header
is necessary: the existing non-unique allocation rows and ledger text cannot
store a replayable zero/multi-allocation receipt result or distinguish exact
replay from conflicting reuse.

Status: DONE  
Summary: Production route, shared contract, frontend caller, posting service,
unused allocator, Q19 snapshot authority, Q23 request idempotency, migration
position, lock order, compatibility boundary, and QA matrix are traced above.
Concerns/Blockers: The worktree contains extensive controller-owned in-flight
changes including untracked migrations through `0137`; the implementer must
generate `0138` only after those files are stable and must preserve them.
