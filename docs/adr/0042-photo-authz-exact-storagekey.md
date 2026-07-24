# ADR 0042 — Receipt-photo authorization by exact `storage_key` (strictest-match)

- **Status:** Accepted
- **Date:** 2026-06-17
- **Supersedes / relates to:** interim fix `c46efb11` (inline ownership join in `upload.ts`);
  memory `forwarder-expense-photo-prefix-collision.md`; ralplan consensus
  `docs/plans/forwarder-photo-ownership-plan.md` (Critic APPROVE, N1–N6).
- **Parts touched:** `backend/src/services/photo-authz.service.ts`,
  `backend/src/routes/upload.ts`, `backend/src/routes/forwarder.ts`,
  `backend/src/services/forwarder.service.ts`, migration `0047`,
  `backend/src/tests/photo-authz.test.ts`, `frontend/.../ForwarderTripDetailPage.tsx`.

## Context

The `/api/photos/{*path}` router serves receipt photos stored under the
`expense-photos/<id>/` prefix. That prefix is **shared by two independent
pipelines** with independent serial primary keys:

| Pipeline | Table | Keyed by | Written by |
|---|---|---|---|
| Company financial receipts | `expense_photos` | `expenses.id` | `routes/expense.ts` |
| Forwarder trip-expense receipts | `trip_expense_photos` | `trip_expenses.id` | `routes/forwarder.ts` |

Because both sequences are independent, an `<id>` parsed from the URL path is
**ambiguous** — `expense-photos/42/…` could be a company receipt *or* a
forwarder receipt, and the two can even collide numerically. The prior serving
path either blanket-403'd DRIVER/FORWARDER (so a forwarder could *upload* a
receipt but never *view* it) or, in the interim fix, checked only the
forwarder side inline.

Three compounding security holes were found during planning:

1. **Write side** — `POST /forwarder/me/expenses/:id/photos` had no ownership
   check; any forwarder could attach photos to any `trip_expense`.
2. **Read-LIST side** — `GET /forwarder/me/expenses/:id/photos` took no
   `forwarderId`; any forwarder could enumerate photo metadata of any expense.
3. **Disabled-forwarder bypass** — `/api/photos` sits behind
   `assetAuthMiddleware` (JWT signature + `jti` blacklist only — it does **not**
   check `users.status`). `resolveForwarder` (which enforces `ACTIVE`) is not
   mounted on `/api/photos`, so a disabled forwarder with an unexpired JWT
   could still read photos.

## Decision

Resolve the domain by **exact `storage_key`** against **both** tables, then
apply **strictest-match**: grant access only if the caller is authorized under
*every* table that holds the key. Encapsulate this in one pure, unit-testable
helper, `authorizeExpensePhoto(storageKey, { userId, role })`, returning
`{ allow, reason }` where `reason ∈ { not_found, forbidden, collision }`. The
route is a thin HTTP mapper.

```
allow     → sendFile
forbidden → 403
collision → 403 + logger.warn   (both-tables match is an integrity signal, N6)
not_found → 404
```

| `storage_key` matches | DRIVER | FORWARDER (ACTIVE, owns) | FORWARDER (ACTIVE, unowned) | FORWARDER (DISABLED) | ACCOUNTANT/MANAGER/ADMIN |
|---|---|---|---|---|---|
| nothing | 404 | 404 | 404 | 404 | 404 |
| `trip_expense_photos` only | 403 | **allow** | 403 | 403 | allow |
| `expense_photos` only | 403 | 403 | 403 | 403 | allow |
| BOTH (collision) | 403 | 403 + warn | 403 + warn | 403 | allow |

**NULL-`forwarderId` receipts** (accountant/manager-created, schema
`trip_expenses.forwarderId` is nullable) are denied to forwarders naturally:
`null !== userId` is false. Default DENY pending the §"Open question" product
decision — *not* "least-privilege on ambiguity".

**Write/read-list/delete unification (N1):** the forwarder portal's three
photo endpoints all gate on `getForwarderOwnedExpenseId(expenseId, forwarderId)`
and return **404** for the unowned case (never 403), so a photo-id cannot be
used as an existence oracle. `deleteExpensePhoto` returns `null` for both
not-found and unowned (it no longer returns `'FORBIDDEN'`).

### N5 refinement — ACTIVE via a LEFT-join annotation, not a filter or a probe

The ralplan N5 condition called for folding `users.status='ACTIVE'` into the
trip lookup. Two naive readings of that are both wrong:

- **Filter the join on `status='ACTIVE'` (INNER join + where):** *incorrect*.
  The trip lookup is *shared* across all roles; filtering it by the owner's
  status would make `tripMatch` false for a receipt owned by a **disabled**
  forwarder, so a finance role would fall through to `not_found` (404) — losing
  access to legitimate financial evidence belonging to a since-departed
  forwarder.
- **A separate post-query `isUserActive()` PK probe:** *correct but wasteful* —
  an extra round-trip on the forwarder-self allow path.

The implemented solution **LEFT-joins `users` on `forwarderId = users.id` with
no status filter**, selecting `ownerStatus` alongside `forwarderId` in the same
query. `tripMatch` stays a pure existence test (a disabled owner still produces
a row), and the FORWARDER branch reads `ownerStatus === 'ACTIVE'` inline —
closing the disabled-forwarder JWT bypass on `/api/photos` in **zero extra
round-trips** while preserving finance reads of disabled-owner receipts. (A
NULL `forwarderId` LEFT-joins to no user row, so `ownerStatus` is `null`; the
`forwarderId === userId` guard denies it first regardless.) The test
`ACCOUNTANT can read a receipt owned by a DISABLED forwarder` pins the
pure-existence behavior.

## Drivers

1. **Security correctness** — close the cross-domain/tenant leak without
   re-opening B1 (company-receipt confidentiality).
2. **Minimal blast radius** — only `/api/photos`, one helper, the forwarder
   write/list/delete endpoints, and one index migration.
3. **Unit-testability** — the disambiguation matrix is exercised directly
   (`photo-authz.test.ts`, 13 cases incl. a hardcoded colliding-key seed and
   the NULL-`forwarderId` case, N3).
4. **Least-privilege / fail-closed** — ambiguity → strictest policy.

## Alternatives considered

- **B — Disjoint storage prefixes + backfill (DEFERRED).** Removes the
  ambiguity at the source (`forwarder-receipts/` vs `expense-photos/`), but
  requires teaching every reader and a coordinated data migration. Follow-up.
- **C — Short-lived signed URLs (DEFERRED).** The original justification ("60–180
  `<img>` per print page") was a **false premise** — `SettlementPrintPage` is a
  text-only table with zero `<img>`; receipts render only on interactive detail
  pages (single-digit per page). Defer as Referer/bandwidth hardening.
- **D — Naive deny-list removal (REJECTED).** Parses `<id>` from the path and
  leaks company receipts via id collision.

## Consequences

- **+** Forwarders can view their own `trip_expense_photos` receipts (was
  blanket-403).
- **+** Company `expense_photos` stay confidential to finance roles (B1
  preserved); forwarders cannot read other forwarders' receipts.
- **+** Disabled forwarders are denied even with an unexpired JWT; write/list/
  delete are ownership-scoped with no existence oracle.
- **−** One extra indexed DB lookup per `/api/photos` expense request (mitigated
  by migration `0047` btree indexes on both `storage_key` columns); the owner's
  ACTIVE status is read via a LEFT-join annotation in that same query — no extra
  round-trip.
- **−** NULL-`forwarderId` receipts are denied to forwarders pending the open
  question below.

## Verification

- `backend/src/tests/photo-authz.test.ts` — 13/13 pass: full decision matrix,
  colliding hardcoded-key seed (direct `db.insert`, not `addExpensePhoto`'s
  `Date.now()`), NULL-`forwarderId` (N3), disabled-forwarder (N5), collision
  reason (N6), and `getForwarderOwnedExpenseId` / `deleteExpensePhoto` (N1).
- All three CI `tsc` commands pass (shared, backend `--noEmit`, frontend `-b`).
- Migration `0047` adds btree indexes on both `storage_key` columns.

## Open question (§4c — needs product input)

> Should a forwarder see accountant/manager-added (NULL-`forwarderId`) receipt
> photos on `trip_expenses` for trips where the forwarder has *other* (owned)
> expenses?

The `trips` table has **no `forwarder_id`** (only `driver_id`); a forwarder's
relationship to a trip exists only inferentially via `trip_expenses.forwarderId`
(nullable), which does not cover accountant-added receipts. A clean
"trip-scope" answer cannot be derived from the current data model.

- **This PR's default:** DENY (justified as "pending product decision").
- **If YES:** a follow-up PR must add a `trips.forwarder_id` column (or an
  explicit join rule) + backfill.

## Follow-ups

- §4c trip-scope decision + possible `trips.forwarder_id`.
- Option B: disjoint-prefix migration.
- Storage-object GC sweeper (orphan-on-crash / orphan-on-storage-fail, items 9a/9b).
- `buildPrintRows` DRY refactor (text-only, no security pressure).
- Photo-read audit logging (tie to signed-URL follow-up).
