# Plan: Forwarder Receipt-Photo Ownership-Scoped Serving (deferred review #1 + #5–#9 triage)

> **STATUS: `PENDING APPROVAL`** — ralplan consensus output (Planner → Architect → Critic). NOT executed.
> Produced: 2026-06-17. Method: `/oh-my-claudecode:ralplan` (deliberate mode).
> Critic verdict: **APPROVE** with 5 mandatory final merge conditions (N1, N2, N3, N5, N6 — see §0).
> Source review: `fix/phase0b-feedback-b1-b5` code-review findings #1 (forwarder photo regression) and #5–#9.

---

## 0. Mandatory Final Merge Conditions (N-conditions — bind execution)

These are non-negotiable; the executor MUST implement all five in the implementation PR.

| ID | Condition | Why |
|----|-----------|-----|
| **N1** | **Status-code unification across GET-list, POST-create, DELETE for the unowned case → all 404, none 403.** `deleteExpensePhoto` (forwarder.service.ts) currently returns `'FORBIDDEN'` → HTTP 403 (forwarder.ts:257). v2's read-LIST returns 404. Same predicate, two codes = existence oracle. Align all three to 404. | Prevents a photo-ID enumeration side-channel on a security-sensitive path. |
| **N2** | **`upload.ts:250-258` blanket `DRIVER/FORWARDER → 403` deny is DELETED and REPLACED by the `authorizeExpensePhoto()` call — not left alongside it.** The existing branch short-circuits (`return`); if the helper is added below it, the helper never runs for any forwarder key → the feature silently no-ops. | Highest-leverage failure mode in the plan. Must be stated explicitly in prose, not implied by a diagram. |
| **N3** | **Explicit integration test: NULL `trip_expenses.forwarderId` (accountant-created) POSTed-to by a forwarder → 404 (per N1), never succeeds.** | The most hand-waved cell; the nullable FK makes ownership genuinely ambiguous. |
| **N5** | **Fold the colliding-deny / ACTIVE predicate INTO the ownership SQL join, not a separate post-query check.** Single `innerJoin(users, … status='ACTIVE')`; no extra round-trip, no TOCTOU window. | Architectural correctness; avoids N+1 and a race. |
| **N6** | **`logger.warn` on the strictest-match deny specifically caused by a both-tables collision** (not a routine unowned-deny), including the colliding key + resolved role. | A collision is a write-path integrity signal, not normal traffic; silent 403 would hide a real bug. |

---

## 1. Problem

Two receipt-photo domains share the storage prefix `expense-photos/<id>/`:

- **Company financial receipts** — table `expense_photos` (schema.ts:452), keyed by `expenses.id`. Written by `expense.ts`.
- **Forwarder trip-expense receipts** — table `trip_expense_photos` (schema.ts:571), `tripExpenseId → trip_expenses.id` (NOT NULL). Written by `forwarder.ts:246` as `expense-photos/${trip_expenses.id}/${Date.now()}${ext}`.

Serving: `GET /api/photos/{*path}` (`photosRouter`, upload.ts:209) matches `^expense-photos\/(\d+)\/` and the `expenseMatch` branch (upload.ts:250-258) **blanket-403s DRIVER and FORWARDER**. `ForwarderTripDetailPage` renders receipts via `/api/photos/${storageKey}`, so a forwarder can **upload** a receipt (forwarder.ts POST `/expenses/:id/photos`) but can **never view** it.

**Pre-existing**, not introduced by B1-B5 (old upload.ts only matched `^trips/`, so these keys 400'd before B1). Logged in memory `forwarder-expense-photo-prefix-collision.md`.

**Compounding security holes** (found during planning):
- **Write side** (forwarder.ts:224 POST) — no ownership check; any forwarder can attach photos to ANY `trip_expense`.
- **Read-LIST side** (forwarder.ts:218 GET → `getExpensePhotos`, forwarder.service.ts) — takes no `forwarderId`; any forwarder can enumerate photo metadata of ANY `trip_expense`.
- **Disabled-forwarder bypass** — `/api/photos` is behind `assetAuthMiddleware` (JWT sig + jti blacklist only; does NOT check `users.status`), and `resolveForwarder` (which enforces ACTIVE) is NOT mounted there. A disabled forwarder with an unexpired JWT reads photos today.

---

## 2. RALPLAN-DR Summary (deliberate)

### Principles
1. **Domain cannot be inferred from the URL path.** `expense-photos/<id>/` is shared by two independent serial sequences (`expenses.id`, `trip_expenses.id`) that can collide. Resolution MUST be by exact `storage_key` against both tables.
2. **Least-privilege / fail-closed.** Ambiguity (key in both tables, NULL owner) → strictest applicable policy.
3. **Authz decision is pure + unit-testable.** Helper takes `(key, user)`, returns a decision; HTTP mapping lives in the route.
4. **Preserve B1 company-receipt confidentiality.** DRIVER/FORWARDER must remain unable to read company `expense_photos`.
5. **No storage migration in this PR.** Prefix migration (Option B) is a follow-up; the security fix ships without data movement.

### Decision Drivers
1. Security correctness — close the cross-domain/tenant leak without reopening B1.
2. Minimal blast radius — only `/api/photos` + one helper + the forwarder write/list endpoints + one index migration.
3. Unit-testability of the disambiguation matrix.

### Chosen Option (A) vs Alternatives
- **A — exact-storageKey ownership gate (CHOSEN).** Pure `authorizeExpensePhoto(key, user)` looks up both tables by exact `storage_key`, applies strictest-match, adds an ACTIVE predicate. Replaces the blanket deny.
- **B — separate storage prefixes + backfill (DEFER).** Removes ambiguity at the source, but requires teaching every reader + a coordinated migration. Follow-up.
- **C — short-lived signed URLs (DEFER, corrected premise).** The v1 "60-180 `<img>` per print page" justification was **false** — `SettlementPrintPage` is a text-only table (zero `<img>`); receipts render only on interactive detail pages (single-digit per page). Defer as bandwidth/Referer hardening, not a perf emergency.
- **D — naive deny-list removal (INVALIDATED).** Parses id from path; leaks company receipts via id collision. Rejected.

---

## 3. Architecture Changes

| File | Change |
|------|--------|
| `backend/src/services/photo-authz.service.ts` *(NEW)* | Pure `authorizeExpensePhoto(storageKey, user)`. Strictest-match + ACTIVE-in-join. |
| `backend/src/routes/upload.ts:250-258` *(EDIT, **N2**)* | **Delete & replace** the blanket `DRIVER/FORWARDER → 403` with the helper call. Keep DRIVER deny (drivers never read expense photos). |
| `backend/src/services/forwarder.service.ts` *(EDIT)* | `getExpensePhotos(tripExpenseId, forwarderId)` — inner-join `trip_expenses` + `forwarderId` filter. `addExpensePhoto`/POST ownership gate. `deleteExpensePhoto` → return 404-shape (not 403) for unowned (**N1**). |
| `backend/src/routes/forwarder.ts:218, 224-250, 252-261` *(EDIT)* | Pass `forwarder.id` into list; POST fetches trip_expense → 404-before-process; align DELETE status (**N1**). |
| `backend/drizzle/0047_photo_storage_key_indexes.sql` + meta *(NEW)* | B-tree indexes on both `storage_key` columns (currently unindexed). |
| `backend/test/integration/photo-authz.integration.test.ts` *(NEW)* | Live Postgres, full decision matrix incl. colliding hardcoded-key seed (**N3**). |
| `backend/test/unit/photo-authz.unit.test.ts` *(NEW)* | Mocked, role-branch logic only (fast complement). |
| `docs/adr/0042-photo-authz-exact-storagekey.md` *(NEW)* | Records decisions, deferrals, §4c. |

---

## 4. The Helper (exact shape — strictest-match + ACTIVE-in-join)

```ts
// backend/src/services/photo-authz.service.ts
export interface PhotoAuthDecision { allow: boolean; reason: 'not_found' | 'forbidden' | 'collision' }

/**
 * Ownership-scoped authz for receipt photos served under the AMBIGUOUS
 * `expense-photos/<id>/` prefix. The prefix is shared by two independent
 * serial sequences (expenses.id, trip_expenses.id), so the request CANNOT
 * be authorized by parsing the id from the path. Resolve by EXACT storage_key
 * against BOTH tables, then STRICTEST-MATCH: allow only if authorized under
 * EVERY matching table.
 *
 * The FORWARDER branch folds users.status='ACTIVE' into the join (N5) — the
 * /api/photos router is behind assetAuthMiddleware (JWT sig + jti only), NOT
 * resolveForwarder, so a disabled forwarder with a live JWT must be re-checked.
 *
 * Caller maps decisions: allow → sendFile; forbidden/collision → 403; not_found → 404.
 * On a both-tables collision that denies, the route emits logger.warn (N6).
 */
export async function authorizeExpensePhoto(
  storageKey: string,
  user: { userId: number; role: Role },
): Promise<PhotoAuthDecision> {
  // Parallel, indexed lookups. The trip-lookup join ALSO enforces ACTIVE (N5):
  // forwarderId → users.id; innerJoin users on status='ACTIVE'. A disabled
  // forwarder yields no row → tripMatch false for that owner.
  const [tripRow, expenseRow] = await Promise.all([
    db.select({ forwarderId: s.tripExpenses.forwarderId })
      .from(s.tripExpensePhotos)
      .innerJoin(s.tripExpenses, eq(s.tripExpensePhotos.tripExpenseId, s.tripExpenses.id))
      .where(eq(s.tripExpensePhotos.storageKey, storageKey)).limit(1),
    db.select({ id: s.expensePhotos.id })
      .from(s.expensePhotos)
      .where(eq(s.expensePhotos.storageKey, storageKey)).limit(1),
  ]);

  const tripMatch = tripRow.length > 0;
  const expenseMatch = expenseRow.length > 0;
  if (!tripMatch && !expenseMatch) return { allow: false, reason: 'not_found' };

  const isFinance = user.role === Role.ACCOUNTANT || user.role === Role.MANAGER || user.role === Role.ADMIN;

  const authzTrip = (): boolean => {
    if (isFinance) return true;
    if (user.role === Role.FORWARDER) return tripRow[0].forwarderId === user.userId; // NULL !== userId → false
    return false; // DRIVER
  };
  const authzExpense = (): boolean => isFinance;

  const okTrip = !tripMatch || authzTrip();
  const okExpense = !expenseMatch || authzExpense();
  const allow = okTrip && okExpense;

  if (!allow && tripMatch && expenseMatch) return { allow: false, reason: 'collision' }; // N6 signal
  return { allow, reason: 'forbidden' };
}
```

> **ACTIVE-in-join detail (N5):** implement the trip lookup as a 3-way join
> `trip_expense_photos ⋈ trip_expenses ⋈ users` with `users.status='ACTIVE'`
> constrained to the matched forwarder row, so a disabled owner produces no
> `tripRow` and is denied without a second round-trip. (A disabled non-forwarder
> staff role is out of scope — staff disablement is handled at login + jti
> blacklist; only FORWARDER needs the extra check because its profile resolver
> is not on the photo path.)

### Decision table — `authorizeExpensePhoto`

| `storage_key` matches | DRIVER | FORWARDER (ACTIVE, owns) | FORWARDER (ACTIVE, unowned) | FORWARDER (INACTIVE) | ACCOUNTANT/MANAGER/ADMIN |
|---|---|---|---|---|---|
| nothing | deny (404) | deny (404) | deny (404) | deny (404) | deny (404) |
| `trip_expense_photos` only | deny (403) | **allow** | deny (403) | deny (403) | allow |
| `expense_photos` only | deny (403) | deny (403) | deny (403) | deny (403) | allow |
| BOTH (collision) | deny (403) | **deny (403) + warn** | deny (403) + warn | deny (403) | allow |

**NULL-`forwarderId` cell:** a `trip_expense_photos` row whose `trip_expenses.forwarderId IS NULL` is semantically **accountant/manager-added** (schema.ts:544 comment), NOT "ambiguous." The `forwarderId === user.userId` predicate denies it naturally. Justification: **"pending product decision" (§7)** — not "least-privilege on ambiguity."

---

## 5. Implementation Phases (build order)

**Phase 1 — Data layer (independently mergeable)**
1. Migration `0047`: `CREATE INDEX IF NOT EXISTS … ON trip_expense_photos (storage_key)` + `expense_photos (storage_key)`. Bump `_journal.json` + `0047_snapshot.json`.
2. `photo-authz.service.ts` helper (strictest-match + ACTIVE-in-join).

**Phase 2 — Read-side wiring (the broken receipts)**
3. `upload.ts:250-258`: **delete** the blanket deny, **replace** with the helper call (**N2**).

**Phase 3 — Write-side + read-LIST ownership (BLOCKING, N1)**
4. `getExpensePhotos(tripExpenseId, forwarderId)` — add the join + filter; route passes `forwarder.id`. Unowned → 404.
5. POST `/expenses/:id/photos` — fetch trip_expense before processing; unowned → 404.
6. DELETE `/expense-photos/:id` — align unowned to **404** (**N1**); `deleteExpensePhoto` stops returning `'FORBIDDEN'` (or the route maps both `null` + `'FORBIDDEN'` → 404).

**Phase 4 — Tests (must accompany, not trail)**
7. Unit suite (mocked): role/ACTIVE branch logic only.
8. Integration suite (live Postgres): full decision matrix + colliding hardcoded-key seed (direct `db.insert`, NOT `addExpensePhoto`) (**N3**: include NULL-forwarderId POST case).
9. E2E: forwarder-owned receipt 200; cross-forwarder 403; disabled-forwarder 403.

**Phase 5 — Benchmark**
10. autocannon/k6 against a 10k-row seeded table, pre/post index. Record p50/p95/p99. The p95<2ms claim is **conditional** on this benchmark proving it; otherwise strike the claim from the ADR.

**Phase 6 — Fold-ins (low-risk, same blast radius)**
11. `MAX_IMAGE_DIMENSION` → unify to 2048 across `forwarder.ts:33` (currently 1600) and `expense.ts`.
12. Forwarder upload sharp pipeline → wrap in try/catch matching `expense.ts` (clean 400 on codec failure).
13. `ForwarderTripDetailPage.tsx:84` → `encodeURIComponent` the storage key (parity with `ExpenseEntryPage.tsx:651`).

---

## 6. Pre-Mortem (5 scenarios)

1. **Prefix-only check leaks company receipts** → exact-storageKey lookup against both tables (helper).
2. **Wrong join column / missing `IS NULL`** → live-DB integration tier (full matrix).
3. **`addExpensePhoto`'s `Date.now()` masks a colliding-key bug in tests** → seed collisions via direct `db.insert` with hardcoded keys.
4. **Write-side injection: forwarder creates `trip_expense_photos` on an unowned row that then passes the read gate** → write-side ownership gate (Phase 3).
5. **Disabled-forwarder JWT bypass** → ACTIVE predicate folded into the join (N5).

---

## 7. ⚠ APPROVAL-TIME QUESTION (for the user — §4c, escalated)

> **Should a forwarder see accountant/manager-added (NULL-`forwarderId`) receipt photos on `trip_expenses` for trips where the forwarder has OTHER (owned) expenses?**

**Data-model constraint (verified):** the `trips` table (schema.ts ~205) has **no `forwarderId` column** — only `driverId`. A forwarder's relationship to a trip exists only inferentially via `trip_expenses.forwarderId` (schema.ts:544, nullable), and that inference does NOT cover accountant-added receipts the forwarder never touched. So a clean "trip-scope" answer cannot be derived from the current data model.

- **This PR's default:** DENY for NULL-`forwarderId` receipts (justified as "pending product decision," not "least-privilege on ambiguity"). Falls out naturally from `forwarderId === user.userId`.
- **If YES:** a follow-up PR must add a `trips.forwarder_id` column (or an explicit join rule) + backfill. **Out of scope here.**
- **If NO / defer:** this PR ships as-is.

---

## 8. Secondary Triage (#5–#9)

| Item | Severity | Disposition | Note |
|------|----------|-------------|------|
| 5b-ownership (write + read-LIST gates) | **BLOCKING** | This PR (Phases 3, N1) | not a fold-in |
| 5a duplicate `MAX_IMAGE_DIMENSION` | Low | FOLD-IN | unify to 2048 |
| 5b sharp try/catch + existence-check style | Low | FOLD-IN | align forwarder.ts to expense.ts |
| URL-encoding inconsistency | Low | FOLD-IN | ForwarderTripDetailPage:84 |
| 9a/9b orphan-on-crash / orphan-on-storage-fail | Low-Med | DEFER | holistic GC sweeper follow-up |
| `buildPrintRows` duplication | Low | DEFER | text-only, no security pressure |
| Photo-read audit | Medium | DEFER | tie to signed-URL follow-up |
| Signed URLs (Option C) | — | DEFER | corrected premise (no print-page `<img>` fan-out) |
| Non-deterministic order | — | **INVALID** | `getExpensePhotos` already `orderBy(uploaded_at DESC)` (forwarder.service.ts:1022) |
| `removePhoto` race | — | **ALREADY FIXED** | filters by `photo.id` (ExpenseEntryPage.tsx:171-178) |

---

## 9. Verification (proof before merge)

1. `cd backend && npm test` — integration matrix green (incl. colliding-key seed + NULL-forwarderId POST, **N3**); unit suite green. (No `make test` target — see claude-mem `backend-tests-command`; integration needs Postgres+Redis up + `pnpm db:migrate` first.)
2. The 3 CI `tsc` commands pass (canonical TS check; shared test files excluded — `shared-tests-tsc-blindspot`).
3. Migration `0047` applied; both indexes present (`\d expense_photos`, `\d trip_expense_photos`).
4. `EXPLAIN ANALYZE` shows Index Scan on the storage_key lookup post-migration.
5. Benchmark recorded (Phase 5); p95 claim grounded or struck.
6. Manual E2E: forwarder views own receipt (200, was 403); cross-forwarder (403); disabled forwarder (403); company receipt as forwarder (403).
7. `/code-review` before merge (separate reviewer pass — not self-approved).
8. **N1 assertion:** GET-list, POST, DELETE all return identical 404 on the same unowned photo.

---

## 10. Out of Scope (this PR)

- `trips.forwarder_id` schema addition (gated on §4c answer).
- Disjoint key-prefix migration (Option B).
- Signed URL issuance (Option C).
- Storage-object GC sweeper.
- `buildPrintRows` DRY refactor.
- Any change to `/api/upload` trip-photos pipeline or the driver trip-photo ownership check (upload.ts:229-249).
- Any RBAC/Casbin policy change (DRIVER/FORWARDER already hold `photos:read`).

---

## 11. ADR 0042 (outline)

- **Decision:** exact-`storage_key` ownership gate via pure `authorizeExpensePhoto`; strictest-match across both tables; `users.status='ACTIVE'` folded into the FORWARDER join.
- **Drivers:** prefix ambiguity (two serials collide); preserve B1 confidentiality; minimal blast radius; unit-testability.
- **Alternatives:** B (prefix migration — defer), C (signed URLs — defer, corrected premise), D (naive removal — rejected, leak).
- **Consequences:** + forwarder views own receipts; + company receipts stay confidential; − per-request DB lookup (mitigated by index); − NULL-`forwarderId` receipts denied to forwarders pending §4c.
- **Follow-ups:** §4c trip-scope decision; prefix migration; GC sweeper; `buildPrintRows` DRY; photo-read audit.

---

## 12. Success Criteria

- [ ] Forwarder reads own `trip_expense_photos` receipts (was blanket-403).
- [ ] Forwarder cannot read company `expense_photos` (B1 preserved).
- [ ] Forwarder cannot read other forwarders' receipts.
- [ ] Strictest-match: both-tables key → deny unless authorized under every match (integration proves it).
- [ ] Disabled forwarder (`status !== 'ACTIVE'`) → 403 even with valid unexpired JWT.
- [ ] POST + GET-list + DELETE reject unowned trip_expense, **all 404** (N1).
- [ ] NULL-`forwarderId` POST → 404, never succeeds (N3).
- [ ] `upload.ts:250-258` deny branch deleted & replaced (N2).
- [ ] ACTIVE predicate folded into the join (N5); collision triggers `logger.warn` (N6).
- [ ] Migration 0047 indexes both `storage_key` columns.
- [ ] Integration suite green across full matrix incl. colliding hardcoded-key seed.
- [ ] Benchmark recorded; latency claim grounded or removed.
- [ ] ADR 0042 written; §4c question surfaced to user.
- [ ] All 3 CI `tsc` commands pass; `npm test` green.
