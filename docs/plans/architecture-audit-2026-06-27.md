# TingTing Architecture Audit & Refactor Plan

**Date:** 2026-06-27
**Method:** `/improve-codebase-architecture` — Phase 1 (Map) → Phase 2 (Catalog) → Phase 3 (Deliver)
**Scope:** full monorepo (backend 26k LOC, frontend 51k LOC, shared) against the working tree
**Rule:** understand before changing; every claim cites `file:line`; refactors are independently shippable, never big-bang.

---

## Executive Summary

The **plumbing layers are genuinely strong**: a leak-free API transport client, centralized query keys, universal route code-splitting, a single-source `PAGE_CATALOG` with a *compile-time* drift guard, one Zod contract on the agent socket, an append-only ledger with sorted advisory locks, and a clean two-tier Casbin RBAC model. These should be preserved.

The risk concentrates in three places:

1. **Missing safety nets** — core financial logic (ledger, `updateTripFigures`, billing docs) has **no unit tests**; **no lint in CI**; **no root `make test`**; and the one class of contract that *lacks* a compile-time guard (Drizzle `pgEnum` ↔ shared TS `enum`) is exactly the one that has bitten production before.
2. **Two data-integrity landmines** — a **non-monotonic migration journal** (`0040` jumps backwards → drizzle silently skips later migrations) and **cache invalidation that runs after commit and swallows its own errors** → stale financial reads with no signal.
3. **God modules where bugs cluster** — `billingDocument.service.ts` (1367 LOC mixing DB/domain/ExcelJS), `updateTripFigures` (436-line method), `TruckTiresPage.tsx` (1751 LOC), `useTripFormDispatch.ts` (~1100 LOC), `components/UI.tsx` (702 LOC, 16 exports).

**The ordering principle:** stand up the safety nets *first* (Wave 0), because every later decomposition is "refactoring blind" without them. Then defuse the landmines, then decompose, then dedupe, then performance, then cosmetic.

---

## Phase 1 — Architecture Map

### Monorepo topology

```
                        ┌───────────────────────────────────────────┐
                        │  shared/  (@tingting/shared)              │
                        │  types · schemas(Zod) · calculations ·    │
                        │  constants · navigation/PAGE_CATALOG      │
                        └───────────────┬───────────────────────────┘
                  (frontend: src/, live)│(backend: dist/, STALE until tsc)
            ┌───────────────────────────┴────────────────────────────┐
   ┌────────▼──────────────┐                       ┌──────────────────▼─────┐
   │  frontend/  React 18  │   socket.io /agent    │  backend/  Express v5  │
   │  Vite · TanStack      │◄──────────────────────│  /api/* (no /v1)       │
   │  React Router         │   REST /api           │  Casbin RBAC @ mount   │
   │  57 lazy routes       │                       │                        │
   │  lib/api/client.ts    │                       │  routes → services →   │
   │  api/keys.ts (qk)     │                       │  Drizzle → Postgres    │
   └───────────────────────┘                       │  + Redis cache         │
                                                   │  + audit seam (res.json)│
                                                   └────────────────────────┘
```

### Request lifecycle (backend)

```
index.ts (init services in order; graceful drain: io→http→pg→redis)
  → cors → json → static /uploads → request-log
  → auditLogMiddleware (GLOBAL; monkey-patches res.json, writes audit row on 'finish')
  → authMiddleware → casbinAuthz(resource)   ← RBAC enforced at the MOUNT, not the handler
  → router (thin handlers → service) → drizzle → Postgres
  → globalErrorHandler (ZodError→400, ApiError→status, 23505→409)
```

### Frontend shell

```
main.tsx: QueryClientProvider → BrowserRouter → App
App.tsx : 6 nested providers
  ReducedMotion → Auth → Toast → AgentDirective → Month → Search
  → 57 × React.lazy(<Page/>) under <Suspense>   (code-splitting is universal ✅)
```

### The strong contract (do not regress)

```
shared/navigation/pageCatalog.ts   ← SINGLE SOURCE
   ├──→ frontend/lib/routes.ts            (1:1 projection; golden test routes.test.ts)
   ├──→ shared/schemas/agent.ts           (AGENT_ROUTE_KEYS + _agentKeysInSync compile-time guard)
   ├──→ backend/agent/tools/ui.ts         (PAGE_SEARCH_ENTRIES derived)
   └──→ backend/agent/routeMatcher.ts     (regex-compiled reverse resolver)
```

---

## Phase 2 — Critical Problem Areas (ranked)

Severity = blast radius × likelihood. Evidence is `file:line`.

| # | Sev | Finding | Evidence | Impact |
|---|-----|---------|----------|--------|
| 1 | **Critical** | **Non-monotonic migration journal.** `0040` `when` jumps *backwards* (~1 month). Drizzle decides "pending" by `max(created_at) vs journal.when` (not hash), so on any DB whose migrator read `0040`, every later migration appears already-applied. | `drizzle/meta/_journal.json` idx 40 (`1749456000000` < prev `1780925710452`); `drizzle/0040_settlement_code_column.sql:1` | Silent skip of `0041–0086` (tires, COMMISSION, truck_cap, agent tables all live past 0040). Same mechanism as the documented prod desync. ⚠ **Verify against prod `drizzle_migrations` first** — your memory notes a *future*-dated `when` was fixed on prod; a *backwards* jump in the repo journal is a distinct fresh-DB/re-migrate risk. |
| 2 | **Critical** | **Cache invalidation runs after commit AND swallows its own errors** (`.catch(() => {})`). DB write succeeds → cache invalidation fails or process dies between → stale P&L/dashboard until TTL, with zero observability. | `routes/trips.ts:40-45,124,137,150,172,208,228,256,300`; `routes/expense.ts:78,99`; 33 sites total | Ledger is correct (append-only, transactional) but *cached reads can lie* invisibly. |
| 3 | **High** | **Drizzle `pgEnum` literals and shared TS enums are kept in sync by hand — no compile-time guard.** Unlike `PAGE_CATALOG` (which has `_agentKeysInSync`), `trip_status`/`role`/`txn_type` have no link between `schema.ts` and `constants/`. | `backend/src/db/schema.ts:8-20` vs `shared/src/constants/index.ts` | Adding an enum member to one side only = silent query/data corruption. This is the exact class that bit the `enum→varchar` migration. |
| 4 | **High** | **Token-blacklist check fails CLOSED when Redis is down** → every authenticated request returns 401. | `backend/src/lib/redis.ts:91-101` (`isTokenBlacklisted` returns `true` on Redis error) | Redis outage = total auth lockout for the whole platform. Trades availability for a rare revocation case. |
| 5 | **High** | **`shared` src↔backend dist asymmetry.** Backend resolves `@tingting/shared` to `dist/` (no rebuild hook in `make dev`); frontend reads `src/` live. Editing shared source silently breaks the backend until manual `cd shared && tsc`. | `shared/package.json` (`main:dist/index.js`, `types:src/index.ts`); `backend/tsconfig.json` no `paths`; `frontend/vite.config.ts:11` alias to `src`; `Makefile dev:` runs `tsx watch` only on backend | Stale-code runtime bugs; split-brain dev (frontend shows new behavior, backend old). |
| 6 | **High** | **No safety net on the financial core.** `ledger.service`, `trip-mutations.updateTripFigures` (436-line method), `billingDocument.service` (1367 LOC) have **no dedicated unit tests**. Frontend is **4.3%** covered (12 test files / 281 sources). | absence in `backend/src/tests/`; `frontend find src -name '*.test.*'` = 12 | Financial regressions ship undetected (the chi hộ SERVICE_FEE bugs were caught in production). |
| 7 | **High** | **No lint in CI; no root `make test`.** `eslint.config.mjs` exists but CI has zero eslint steps; unit tests are per-package only. | grep `lint\|eslint` in `.github/workflows/ci-cd.yml` = empty; `Makefile` has no `test` target | `any`/style drift accumulates unbounded; no single green-bar gate. |
| 8 | **High** | **`useAuthedQuery` (401/403 → logout) built but adopted only 3×; 54+ raw `useQuery` callers** silently never redirect to login on token expiry. | `frontend/src/design-system/hooks/useAuthedQuery.ts` (3 callers) vs 54 raw `useQuery` across 29 files | Expired sessions → stuck error states instead of login redirect. Inconsistent UX. |
| 9 | **High** | **Layer violations + inconsistent transaction ownership.** `routes/trips.ts` and `routes/expense.ts` do Drizzle queries inline (`db.transaction`, `db.select`) instead of via services; meanwhile trip-expense CRUD opens the tx in the *route* while ledger services open it in the *service*. Two opposing conventions. | `routes/trips.ts:11-13,386-447`; `routes/expense.ts:19-20,112-186`; vs `services/trip-mutations.service.ts:350` | SQL leaks into the HTTP layer; composing two services in one tx is impossible where the route already opened one. |
| 10 | **High** | **Missing indexes + unbounded scans.** `trips.driverId`/`trips.truckId` filtered heavily but unindexed; `fetchLedgerGrouped` does an unbounded full-ledger scan into memory for FIFO aging. | `backend/src/db/schema.ts:335-341`; `services/aging.service.ts:77-92`; filters at `trip-queries.service.ts:98,103` | Seq scans that grow with data; ledger is append-only so aging cost grows monotonically. |

Plus a long tail (Medium/Low) catalogued in §6: god pages (`TruckTiresPage` 1751), `UI.tsx` 702-line god-file, image pipeline copy-pasted 4×, `config/index.ts` triple-declaring every key, ID-parsing in 3 styles, `OFFICE_ROLES`≡`FINANCIAL_ROLES` duplication, PG pool with zero config, 1475 inline `style={{}}` defeating memoization, doc drift (CLAUDE.md says port 5173, actual 7173).

---

## Phase 3 — Refactoring Strategy (waved by priority)

> **Golden rule:** every wave is a sequence of small, independently-deployable PRs. Add characterization tests *before* the corresponding decomposition.

### Wave 0 — Safety nets (DO FIRST; everything else is blind without these)

| Task | Change | Risk | Verify |
|------|--------|------|--------|
| 0a | **Characterization tests for `ledger.service`** (`postTripLock`/`postTripUnlock`/`postEntry`). Build a fixture trip, lock it, assert the 7 ledger entries debit/credit correctly; unlock, assert `UNLOCK_REVERSAL` mirrors. | Low (test-only) | `cd backend && npx tsx --test src/tests/ledger.service.test.ts` green. |
| 0b | **Characterization tests for `updateTripFigures`** — at least: fuel-norm calc, revenue-override detection, commission, legacy-frozen-fuel path. | Low | new test green; lock the *current* behavior even if imperfect. |
| 0c | **Enum sync compile-time guard** (see Example 1). | Very low (type-only, no runtime) | `cd backend && npx tsc --noEmit` fails if you deliberately drift one enum. |
| 0d | **Lint in CI** + **root `make test`** (`pnpm -r test` or a Makefile target running all 3 suites). | Low | CI fails on lint error; `make test` runs green locally. |

### Wave 1 — Defuse the data-integrity landmines

| Task | Change | Risk | Verify |
|------|--------|------|--------|
| 1a | **Fix migration journal monotonicity.** SSH-check prod `drizzle_migrations` first. Correct the `0040` `when` to be ≥ its predecessor; add a **CI check** that asserts `journal.when` is monotonically non-decreasing. Fold or delete the 11 orphan SQL files (or formally journal them). | Medium (data ops) — do on staging, with a backup, idempotently | Re-run migrator against a clone of prod; confirm no migration is silently skipped. |
| 1b | **Cache invalidation: stop swallowing failures.** Keep invalidation *after* commit (correct timing), but surface failures via log + metric (see Example 3). Optionally shorten TTLs on hot report keys. | Low–Medium | Inject a Redis fault in a test; confirm a warning/metric fires (not silence). |
| 1c | **Token-blacklist: fail OPEN on Redis outage** (treat Redis-down as "not blacklisted"), with a short-circuit TTL and an alert. Revocation is rare; total lockout is worse. | Medium (security trade-off) — pair with an alert so a real outage is visible | Kill Redis in staging; confirm auth still works and an alert fires. |

### Wave 2 — Dev/deploy correctness

| Task | Change | Risk | Verify |
|------|--------|------|--------|
| 2a | **Auto-rebuild `shared` in `make dev`** — add `tsc --watch` on `shared/` (or tsx watch) so backend sees shared edits live. | Low | Edit a shared constant; confirm backend picks it up without manual rebuild. |
| 2b | **Fix `shared/package.json` `main`/`types` mismatch** (point both at dist, or both at src + build). | Low | `tsc` in both apps resolves consistently. |
| 2c | **Add build orchestration** (turbo/nx or pnpm `-r` with `--filter`) so build order + caching is graph-driven, not duplicated in `Makefile` + `ci-cd.yml`. | Medium | `make build` succeeds; CI uses the same command. |

### Wave 3 — God-module decomposition (each behind the Wave-0 tests)

| Task | Change | Risk | Verify |
|------|--------|------|--------|
| 3a | **Split `billingDocument.service.ts`** → `repository` (CRUD) / `lines` (domain line-building) / `xlsx-render` (ExcelJS). Pure-domain `lines` becomes unit-testable without Excel. | Medium | characterization tests (0a–0b style) + `buildLegacyXlsx` as regression oracle. |
| 3b | **Extract shared entry-construction from `postTripLock`/`postTripUnlock`** into a `buildTripLedgerEntries(trip, direction)` helper; lock and unlock call it with flipped txnType. | Medium (financial) | ledger characterization tests (0a) prove debit/credit + reversal still balance. |
| 3c | **Decompose `updateTripFigures`** (436 LOC) into stages: `resolveTripContext` → `computeEconomics` (fuel/commission/bonus) → `postLedger` → `upsertLegs`. Keep one outer tx. | High — highest-risk financial mutation | exhaustive characterization tests first; one stage per PR. |
| 3d | **Split `components/UI.tsx`** (702 LOC, 16 exports) into `ui/Button.tsx`, `ui/Overlay.tsx` (Modal/Drawer), `ui/Layout.tsx` (Panel/Card), `ui/Feedback.tsx` (StatusPill/ConfirmDialog + `useConfirm`). | Low | vite build + visual spot-check of consumers. |
| 3e | **Decompose `TruckTiresPage.tsx`** (1751 LOC) into a `features/tires/` page shell + hooks (move the 7 query hooks out of flat `hooks/`) + sub-components. | Medium | manual QA of the tire page; existing `tireUtils.test.ts` still green. |

### Wave 4 — Duplication & consistency

| Task | Change |
|------|--------|
| 4a | **Extract image-processing pipeline** to `lib/imageProcessing.ts` (4 copies → 1) — see Example 2. |
| 4b | **Consolidate hook homes.** Pick one rule (recommend: domain query+mutation hooks colocate under `features/<domain>/hooks/`; primitives stay in `design-system/hooks/`; retire the flat `hooks/` dumping ground). Migrate incrementally. |
| 4c | **Adopt `useAuthedQuery`** as the single query entrypoint (or bake its 401-handler into a thin `useQuery` wrapper the whole codebase uses) — fixes #8. |
| 4d | **Unify transaction ownership:** services own their tx; routes never call `db.transaction`. Move trips/expense inline Drizzle into services. |
| 4e | **`parseIdParam(req,'id')` helper** (one ID-parsing style, one 400 behavior). |
| 4f | **Dedupe `OFFICE_ROLES` ≡ `FINANCIAL_ROLES`** — one constant in shared. |
| 4g | **De-triple-declare config** (`config/index.ts`) — derive `raw` from the Zod schema and `withDefaults` from `.parse(env)` defaults. |

### Wave 5 — Performance

| Task | Change |
|------|--------|
| 5a | **Indexes:** `trips(driverId)`, `trips(truckId)`; `agent_turn_metrics(user_id)`, `(error_kind)`, `(aborted)` for the dashboard. |
| 5b | **Bound `fetchLedgerGrouped`**: add a date lower bound / cursor; paginate or materialize aging snapshots. |
| 5c | **PG pool config:** set `max`, `idle_timeout`, `connect_timeout`, `statement_timeout` in `db/index.ts`. |
| 5d | **Reduce inline styles** in data-heavy pages (1475 site-wide; 104 in `ForwarderTripDetailPage`) → extract to CSS classes / design tokens; enables `React.memo`. |

### Wave 6 — Cosmetic / cleanup

Doc drift (port 5173→7173 in `CLAUDE.md`); migrate `migrate-trailers.ts` out of `db/`; centralize magic constants; consolidate `schemas/index.ts` (800+ LOC).

---

## Production-Grade Code Examples (top 3 fixes)

### Example 1 — Compile-time enum sync guard (Wave 0c)

Mirrors the existing `_agentKeysInSync` pattern. Zero runtime cost; fails `tsc` the moment a shared enum and its Drizzle `pgEnum` drift in *either* direction.

```ts
// backend/src/db/enum-sync.ts
import { TripStatus, Role, TxnType } from '@tingting/shared';
import { tripStatusEnum, roleEnum, txnTypeEnum } from './schema';

type DrizzleValues<T extends { enumValues: readonly string[] }> = T['enumValues'][number];

// String-enum members → string-literal union, so `${TripStatus}` is exactly
// 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'LOCKED' | 'CANCELED'.
type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// Assigning `true` to `false` fails compilation — the single source for each set
// stays schema.ts (Drizzle) and constants/ (shared); this file only links them.
const _tripStatus: AssertEqual<DrizzleValues<typeof tripStatusEnum>, `${TripStatus}`> = true;
const _role:       AssertEqual<DrizzleValues<typeof roleEnum>,       `${Role}`>       = true;
const _txnType:    AssertEqual<DrizzleValues<typeof txnTypeEnum>,    `${TxnType}`>    = true;

export {};
```

> **Adoption caveat:** on first commit this may *fail* `tsc` — that's the guard doing its job. `roleEnum` has `DRIVER` + `FORWARDER`; if shared `Role` doesn't list the exact same members, the assertion fires and you've found real drift. Reconcile the two sets, then commit. After that, any future one-sided change is caught at compile time.

### Example 2 — Extract the image-processing pipeline (Wave 4a)

Four near-identical `sharp` pipelines (`routes/expense.ts`, `routes/forwarder.ts`, `routes/upload.ts`, `services/ocr.service.ts`) collapse to one.

```ts
// backend/src/lib/imageProcessing.ts
import sharp from 'sharp';
import { ApiError } from '../errors';

const MAX_IMAGE_DIMENSION = 2048;

/** Auto-orient, cap to 2048px on the long edge, re-encode. Replaces 4 duplicated pipelines. */
export async function normalizeImage(
  buffer: Buffer,
  opts: { preferJpeg?: boolean } = {},
): Promise<Buffer> {
  const pipe = sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true });
  return opts.preferJpeg
    ? pipe.jpeg({ quality: 85, mozjpeg: true }).toBuffer()
    : pipe.png().toBuffer();
}

/** HEIC-aware wrapper: typed 415 instead of a raw sharp error leaking to the client. */
export async function normalizeUpload(buffer: Buffer, mimetype: string): Promise<Buffer> {
  try {
    return await normalizeImage(buffer, { preferJpeg: true });
  } catch (err) {
    if (/(heic|heif)/i.test(mimetype)) {
      throw new ApiError(415, 'Ảnh HEIC không được hỗ trợ. Vui lòng tải lên JPG/PNG.');
    }
    throw err;
  }
}
```

### Example 3 — Cache invalidation with surfaced failures (Wave 1b)

> **Correction worth noting:** the audit suggested "move invalidation inside the transaction." That is *wrong* — invalidating before commit lets a concurrent read re-populate stale data, and invalidating inside a rolled-back tx is pointless. The correct timing stays *after commit*; the real bug is the **silent `.catch(() => {})`**. Fix the observability, not the timing.

```ts
// backend/src/lib/cacheLifecycle.ts
import { cacheInvalidate, cacheInvalidatePattern } from './redis';
import { logger } from './logger';

type Invalidation = () => Promise<unknown>;

/**
 * Fire invalidations AFTER the DB transaction commits. Timing is intentional;
 * what changes vs the old `.catch(() => {})` is that failures are now OBSERVABLE.
 * The write already succeeded, so we never reject the request — we log + emit a
 * metric so a stale-cache incident is diagnosable instead of invisible.
 */
export function afterCommit(registry: Invalidation[]): Promise<void> {
  return Promise.allSettled(registry.map((fn) => fn())).then((results) => {
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
      logger.warn(
        { count: failed.length },
        'cache invalidation failed after commit — possible stale read until TTL',
      );
      // staleCacheIncident.inc(failed.length);  // wire to your metrics (OTel/Pino already present)
    }
  });
}
```

Route handler, before → after:

```ts
// BEFORE — silent staleness (routes/trips.ts:42-44 today)
await tripCommand.completeTrip(req.params.id, actor);
await Promise.all([
  cacheInvalidate('reports:dashboard'),
  invalidatePnl ? cacheInvalidatePattern('reports:pnl:*') : Promise.resolve(),
]).catch(() => {});   // 🛑 swallowed — stale read possible, no signal

// AFTER — observable; invalidations declared where the write happens
await tripCommand.completeTrip(req.params.id, actor);
await afterCommit([
  () => cacheInvalidate(`dashboard:${actor.userId}`),
  () => cacheInvalidatePattern('report:trips:*'),
]);
```

*(Evolution path for the residual "process dies between commit and invalidate" window: versioned cache keys or write-through repopulation. Out of scope for v1 — alerting first.)*

---

## What's working well — do NOT refactor

- **Append-only ledger + sorted advisory locks** (`ledger.service.ts:57-77,125-161`) — correct deadlock prevention, balance recomputed inside the tx. Preserve.
- **`crud-factory.ts`** — sound generics, soft-delete detection, LIKE-escape, 23505→409 translation. Config CRUD routed consistently through it.
- **Centralized pagination** (`routes/utils/pagination.ts`) with clamping.
- **`asyncHandler` + `globalErrorHandler`** — uniform try/catch-free handlers; textbook Express v5 error mapping.
- **Audit logging as a single global seam** (`middleware/audit.ts`) — no route can forget to audit.
- **Casbin at the mount** (`casbinAuthz(resource)`) with `requireRoles` reserved for *tighter* intra-resource gating.
- **Agent tool interface** (`defineReadTool`) — genuinely uniform; ~10 lines to add a tool; Zod-only validation; defense-in-depth role re-check.
- **Frontend transport** (`lib/api/client.ts`, 159 callers, zero `API_BASE` leakage; `If-Unmodified-Since` optimistic concurrency).
- **Centralized query keys** (`api/keys.ts`, typed `qk`, 96 invalidations).
- **Universal `React.lazy` code-splitting** (57 routes).
- **`PAGE_CATALOG` single-source** with compile-time + runtime guards.
- **Single Zod contract on the agent socket** (no duplicated message shapes).

---

## Suggested first 3 PRs (lowest risk, highest leverage)

1. **PR-1 (safety):** Wave 0c + 0d — enum-sync guard + lint-in-CI + root `make test`. Type-only + CI-only; touches no runtime behavior.
2. **PR-2 (safety):** Wave 0a + 0b — characterization tests for ledger + `updateTripFigures`. Test-only; unblocks Wave 3.
3. **PR-3 (landmine):** Wave 1b — cache invalidation observability (Example 3). Small, surgical, immediately improves diagnosability of the most-likely production incident class.

*Defer Wave 1a (migration journal) until after an SSH check of prod `drizzle_migrations` — it is the highest-impact but also the one that most needs a staging dress-rehearsal.*
