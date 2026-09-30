# Backend Architecture Conventions

How `backend/src` is structured and extended. Process rules (git workflow, QA gates, artifacts)
live in [`AGENTS.md`](../AGENTS.md) — this doc owns architecture. The layering invariants here are
enforced by `src/tests/unit/arch-layering.test.ts`; when this doc and that test disagree, the test
wins and this doc must be fixed in the same commit.

## 1. Layering

```
routes/          thin: zod parse -> authz -> service call -> response envelope
  └─ services/   queries, transactions, business rules
       └─ db/    schema + client (Drizzle only — no raw SQL)
```

The arch test enforces this by static scan (fs walk + import-specifier regex — no module graph;
the codebase uses static ESM imports only). Three rules:

1. **Route files must not import the db client** (`from '../db'`). `../db/schema` imports stay
   allowed (type-only surface). `src/routes/utils/` — route machinery (crud-factory, pagination,
   idempotency, parse-id) — is exempt; crud-factory is db-allowed by design and is the only utils
   file that touches the client. Legacy violators live in the frozen, shrink-only
   `DB_CLIENT_IMPORT_BASELINE` in the arch test, each entry annotated with its fix. Never add
   entries — move the file's queries to a service and remove its entry in the same commit. A
   companion test fails on dead entries (a listed file that stops importing the client, or
   disappears, must be dropped from the baseline).
2. **Services must not import from routes** — reverse layering edge, zero tolerance, no baseline.
3. **Every `.ts` file under `src/services` and `src/routes` respects the 1,500 LOC budget.**
   The `SIZE_BASELINE` exemption table in the test is empty today; an entry is a temporary
   deferral annotated with the phase that removes it — see the split recipe below.

Service-to-service imports are allowed, but **no cycles**. When two services need each other,
extract the shared piece into a leaf both import: precedent `governance-action-core.service.ts`.

Route files stay thin. A handler that grows queries or business rules has them moved to a
service — the routes that still hold queries are baseline entries, not a pattern to extend.

## 2. Naming and layout

- **Services:** `domain-topic.service.ts`, prefix-clustered in the flat `services/` directory
  (~245 service files: `shipment-*`, `trip-*`, `expense-*`, `billing-*`, `dispatch-*`, `salary-*`,
  …). Reads/writes suffixes split large domains along their natural seam
  (`cus-shipment-workspace-reads/-writes`). Files without the `.service.ts` suffix are shared
  types/helpers of a family (`trip-shared.ts`, `shipment-types.ts`, `governance-policy.ts`).
  A domain split deep enough may take a subdirectory with its own barrel
  (`services/shipment-queries/`).
- **Routes:** one resource per file at `routes/`; family subdirectories for multi-leaf resources
  (`config/`, `financial/`, `shipments/`, `trips/`, `forwarder/`, `portal/`); `routes/utils/`
  holds route machinery, not resources.
- **Schema lives in `db/schema/`**, split from the old monolith into domain modules re-exported
  by the barrel `index.ts` (the drizzle-kit target): `core`, `master-data`, `pricing`, `trips`,
  `costs`, `financial`, `treasury`, `shipments`, `ops`, `salary-exclusions`, `expense-accounting`,
  `shipment-finance`, `deposit`, `quotation`, plus `_shared.ts` (the `applicationEnum` helper —
  application-owned enum values on unrestricted text columns) and `_enums.ts` (every status
  vocabulary — the single place enum values are defined). `expense-metadata.ts` is an internal
  leaf consumed by `costs`/`ops`, not barrel-exported. New tables go in their domain file (or a
  new domain file + barrel export); move each enum into `_enums.ts` next to its siblings.
- When a file reaches ~800 LOC, plan a split before it hits the 1,500 hard budget.

## 3. The transaction seam (executor convention)

"One transaction or none" is a caller-level decision. The canonical types live on the db barrel
(`db/index.ts`): **`Database`** (`typeof db`), **`Tx`** (the Drizzle transaction handle — what
`db.transaction` hands its callback), and **`Executor = Tx | Database`** — the one database-handle
seam. An Executor is whichever handle a query should run on: the pool or a caller's open
transaction; the callee only promises to use the handle it is given, so the same function serves
standalone reads and transactional bodies without `tx ?? db` shims or `as Tx` casts. The
convention (the doc comment on `db/index.ts`'s `Executor` is the verbatim rule):

- Functions whose job is to run on a caller-supplied handle — transactional bodies, invariant
  guards, batch readers shared by both paths — take `executor: Executor` as their **first**
  parameter, required.
- Optional-transaction service functions (standalone by default, joining a transaction when the
  caller is in one) take `executor: Executor = db` as their **last** parameter, so callers can
  omit it. Never make callers import `db` just to pass it back in.
- Inside `db.transaction((tx) => ...)`, pass `tx` — `Tx` is a subtype of `Executor`, so every
  Executor-taking function accepts it.

Supporting pieces:

- **`runInTx(transaction, execute)`** (`backend/src/lib/tx.ts`) — the optional-transaction
  runner: reuses the caller's transaction when provided (joining the caller's atomicity
  boundary), otherwise opens a top-level `db.transaction`. The callback must not commit or roll
  back the passed handle — `db.transaction` owns the lifecycle in the top-level case.
- **One definition each.** Services import `Tx`/`Executor` from `'../db'` (they already import
  the client there). Routes must not — the arch guard's client-import regex cannot distinguish
  `import type` from a real client import — so the route-safe type surface is the `Tx`
  re-export in `lib/tx.ts`. Legacy per-service `Tx`/`Executor` definitions from before the seam
  are being deleted; do not add a local alias.
- Routes own neither connections nor transactions — they pass payloads to services. The
  route-file db-client baseline exists precisely because this seam used to leak inward.
- `as Tx` casts (including `db as unknown as Tx`) are forbidden in new code; every survivor must
  carry a written justification.

## 4. God-file split history and recipe

The services directory is flat by design, and the size budget is what keeps it honest: when a
service outgrows its seam it is split along domain lines, never left to accrete. The wave that
shaped the current tree (2026-08 → 09): `shipment.service` into lifecycle/review/detail-reads;
`advance.service` into request/settlement/shared; shipments routes into resource leaves under
`routes/shipments/`; `schema.ts` into the domain schema modules; the `shipment-queries` god
service into the `services/shipment-queries/` query-domain leaves; `billing-export`,
`billing-document`, `salary-period-close`, `statement`, `trip-mutations`, `shipment-lifecycle`,
`shipment-accounting-lock` each into shared/… leaves; the CUS workspace read model into
sql/mapping/builders leaves; trips and forwarder routes into family leaves (route leaves went
db-free); the route db-client baseline shrunk 13 → 7 → its current 6 entries.

The recipe (proven across those splits):

1. Map the export inventory (`grep -n '^export ' <file>`) onto cohesive seams — by sub-resource
   or reads/writes, never by verb.
2. Extract blocks with **brace-walking** (walk to the matching closing brace). Never regex-cut
   TS blocks — regex extraction shredded files in an early cycle.
3. The original file becomes a **compatibility barrel**: named re-exports only. `export *` is
   banned — the material-write registry scanner resolves named exports.
4. Repoint path pins: registry/middleware tests that reference the old file literal must be
   updated in the same commit (`git grep '<old-path>'`).
5. Remove the file's `SIZE_BASELINE` entry in `arch-layering.test.ts` — the split must pass the
   budget without exemption.
6. Full `pnpm test` green with the existing suites **unmodified** — the suites are the behavioral
   lock; if a split "requires" changing assertions, the split is wrong.

## 5. Adding an entity / endpoint

Catalog-style CRUD (config tables, no transactional invariants):

1. Define the table in `db/schema/<domain>.ts` (enum values in `_enums.ts`); `make generate`
   (serialized — see Migration rails) → migration lands in `drizzle/`.
2. Mount `createCrudRouter` in `routes/config/catalog-crud.routes.ts` (30 mounts at the time of
   writing).
3. Transactional needs (multi-statement invariants) get a dedicated router instead — see the
   header comment in `routes/config/debit-note-templates.routes.ts` for why crud-factory's
   non-transactional beforeCreate+insert cannot atomically enforce a single-default invariant.
4. Casbin policy row for the new route path in `src/casbin/policy.csv` (hand-edited — no
   registry; double-check role coverage); governed materials register in the material-write
   registry (`middleware/material-write.ts` + its exhaustive test).

Full workflow entities (shipments, advances, billing…):

1. Schema + migration as above.
2. New service leaf(s) owning queries and transactions; keep them under the size budget.
3. Route file thin over the service; zod schemas near the route or in `shared/src/schemas`
   when the frontend consumes them too.
4. Backend pagination always — never return unbounded arrays (the envelope pattern is pinned by
   the `list-pagination-helpers` unit test). KPI/tab counts ride the envelope as full-set
   aggregates (`statusCounts`, `statusAmounts`, `summary` — computed over the same where-clause
   minus the page window); they must never be derived client-side from one page.
5. If it feeds a report/dashboard, register its cache in `lib/report-cache.ts` (below).

**Adding a status value (3 layers — the parity test guards 1↔2):**

1. Backend: append the value to the enum in `db/schema/_enums.ts`, then `make generate`
   (text-based enums — no `ALTER TYPE`; the migration is a constraint/default change).
2. Shared: update the matching TS enum in `shared/src/constants/index.ts` and any shared zod
   schema that enumerates the values — **shared-derived zod rejects unknown values on writes**,
   so skipping this layer breaks the new status end-to-end.
3. Frontend: status label/option maps (`*_STATUS_LABELS`) + any status-gated UI.
   `src/tests/unit/status-vocabulary-parity.test.ts` fails if layers 1 and 2 diverge.

**Report caches (`lib/report-cache.ts`):** every `reports:` key is spelled exactly there — key
prefixes, setter-side builders (`pnlMonthKey`, `dashboardWidgetsMonthKey`, …), and semantic
groups (`tripWrite`, `tripStart`). A new report: add its key + builder, assign group membership
(which mutations feed it), then bust via `invalidateReportCaches(group)`. A unit drift gate
fails any file that hand-spells a quoted `reports:` key outside the registry.

## 6. Migration rails (enforced by the root `Makefile`)

- **`make generate` is lock-serialized** (mkdir lock — `flock` does not exist on local macOS;
  the deploy flock runs server-side on Linux). Two concurrent generates double-claim the next
  journal idx — the 2026-08-29 journal-branching incident. Never bypass the lock.
- **`make db-backup`** runs a timestamped `pg_dump -Fc` before every local migration apply
  (`make migrate`, `make migrate-sql`, `make dev` startup) and fails closed; deploys take the
  same backup server-side before the flocked migrate. There are **no down-migrations** — image
  rollback does not rewind the DB, so the dump is the only recovery path. Rehearse a restore
  into a scratch DB before trusting a backup.
- **`make db-drift-check`** asserts `drizzle-kit generate` is a no-op on a committed-clean
  `backend/drizzle/` tree — run it before committing schema work. It refuses dirty trees and
  its probe cleanup never touches real pending work.
- **Journal floor moves with every migration**: `tests/customer-workflow-migration-safety.test.ts`
  asserts the current entry count — bump the number in the same commit that adds a migration.
  The helper (`tests/helpers/journal-invariants.ts`) checks contiguity, monotonic timestamps,
  tag↔file existence, and the genesis tag structurally.
- Conventions: append-only additive migrations; guard backfills with `EXISTS`; no
  `CREATE TYPE`/`ALTER TYPE` (text enums by design); never hand-edit generated metadata, and
  verify snapshots before generating.

## 7. Standing rules

- **Drizzle only — no raw SQL** in services or routes. Financial precision via `round2dp()` /
  `computeTripTotals()` (`shared/src/calculations/`); VND displays without decimals.
- **Tests:** `src/tests/unit/*.test.ts` (flat glob, no DB, sub-second) vs `src/tests/*.test.ts`
  (integration, `--test-concurrency=1`, real DB). Arch and invariant tests belong in unit.
  Helpers shared by both globs live in `src/tests/helpers/`.
- **Shell hygiene:** never pipe test/build output through `tail` — it masks exit codes
  (recurring incident source). Check `$?` or use `echo "EXIT=$?"`.
- **Schema conventions:** referential integrity is application-enforced by default (guard
  deletes in services) — the few database-level foreign keys in the schema are deliberate
  exceptions with explicit `onDelete` semantics, not the pattern. Partial unique indexes use
  `WHERE deleted_at IS NULL`. New timestamp columns use `timestamptz` (`withTimezone: true`).
  VND money is `numeric(15, 0)`; rates may use finer scales. jsonb columns get `.$type<>()`
  unless deliberately opaque (governance snapshots).

## 8. Enforcement map

| Invariant | Enforced by |
|-----------|-------------|
| No db-client imports in routes | `arch-layering.test.ts` rule 1 (+ frozen baseline + dead-entry test) |
| No services→routes imports | `arch-layering.test.ts` rule 2 |
| LOC budget 1,500 (services + routes) | `arch-layering.test.ts` rule 3 (+ empty baseline) |
| Migration journal integrity + count floor | `tests/helpers/journal-invariants.ts` via `customer-workflow-migration-safety.test.ts` |
| Report-cache keys spelled only in the registry | `tests/unit/report-cache-registry.test.ts` (source-scan drift gate) |
| Backend↔shared status vocabulary parity | `tests/unit/status-vocabulary-parity.test.ts` |
| List envelopes paginate + carry full-set aggregates | `tests/unit/list-pagination-helpers.test.ts` |
| Governed-write registry coverage | `material-write-registry-exhaustive.test.ts` (+ `-completeness`) |
| Locked-entity write boundaries | domain suites: `shipment-accounting-lock.test.ts`, `billing-document-lock.test.ts`, `shipment-cost-lock-adjust.test.ts` |
| Generate serialization / pre-migrate backup / drift probe | root `Makefile` targets (`generate`, `db-backup`, `db-drift-check`) |
| Native `<select>` ban (frontend) | ESLint rule `@tingting/no-native-select` |
