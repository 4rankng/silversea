# Backend Architecture Conventions

How `backend/src` is structured and extended. Process rules (git workflow, QA gates, artifacts)
live in [`AGENTS.md`](../AGENTS.md) — this doc owns architecture. Invariants here are enforced by
`src/tests/unit/arch-layering.test.ts`; when this doc and that test disagree, the test wins and
this doc must be fixed in the same commit.

## 1. Layering

```
routes/          thin: zod parse -> authz -> service call -> response envelope
  └─ services/   queries, transactions, business rules
       └─ db/    schema + client (Drizzle only — no raw SQL)
```

- Route files must not import the db client (`from '../db'`). `../db/schema` type imports are
  fine. A frozen, shrink-only baseline of legacy offenders lives in the arch test; never add
  entries — fix the file and remove its entry in the same commit.
- Services must not import from routes (zero tolerance — no baseline).
- Service-to-service imports are allowed, but **no cycles**. When two services need each other,
  extract the shared piece into a leaf both import: precedent `governance-action-core.service.ts`
  (cycle 2 broke the governance services' import cycle this way).
- Route files stay thin. If a handler grows queries or business rules, move them to a service —
  see the split recipe below.

## 2. Naming and layout

- Service files: `domain-topic.service.ts`, prefix-clustered in the flat `services/` directory
  (e.g. `billing-document-draft/-template/-shared`, `cus-shipment-workspace-reads/-writes`).
  Reads/writes suffixes split large domains along their natural seam.
- Route files: one resource per file at `routes/`, config sub-area at `routes/config/`,
  `routes/utils/` holds route machinery (crud-factory) — the only place allowed to touch db
  from the routes layer.
- When a file outgrows ~800 LOC, plan a split before it hits the 1,500 hard budget.
- **Schema lives in `db/schema/`** — 12 domain files split from the old monolith:
  `_shared.ts` (the `applicationEnum` helper + pgvector column), `_enums.ts` (every status
  vocabulary — the single place enum values are defined), `core`/`master-data`/`pricing`/
  `trips`/`costs`/`financial`/`treasury`/`shipments`/`agent`, and `index.ts` (the barrel —
  the drizzle-kit target). New tables go in their domain file (or a new domain file + barrel
  export); move each enum into `_enums.ts` next to its siblings.

## 3. Split recipe (proven cycles 1–2, three applications)

1. Map the export inventory (`grep -n '^export ' <file>`) onto cohesive seams — by sub-resource
   or reads/writes, never by verb.
2. Extract blocks with **brace-walking** (walk to the matching closing brace). Never regex-cut
   TS blocks — regex extraction shredded files in cycle 2.
3. The original file becomes a **compatibility barrel**: named re-exports only.
   `export *` is banned — the material-write registry scanner resolves named exports.
4. Repoint path pins: registry/middleware tests that reference the old file literal must be
   updated in the same commit (`git grep '<old-path>'`).
5. Remove the file's `SIZE_BASELINE` entry in `arch-layering.test.ts` — the split must pass the
   budget without exemption.
6. Full `pnpm test` green with the existing suites **unmodified** — the suites are the behavioral
   lock; if a split "requires" changing assertions, the split is wrong.

## 4. Adding an entity / endpoint

Catalog-style CRUD (config tables, no transactional invariants):

1. Define the table in `db/schema/<domain>.ts` (enum values in `_enums.ts`); `make generate`
   (serialized — see Migration rails) → migration lands in `drizzle/`.
2. Mount `createCrudRouter` in `routes/config/catalog-crud.routes.ts`.
3. Transactional needs (multi-statement invariants) get a dedicated router instead — see the
   header comment in `routes/config/debit-note-templates.routes.ts` for why crud-factory's
   non-transactional beforeCreate+insert is insufficient.
4. Casbin policy row for the new route path in `src/casbin/policy.csv` (hand-edited — no
   registry; double-check role coverage); governed materials register in the material-write
   registry (`middleware/material-write.ts` + its exhaustive test).

Full workflow entities (shipments, advances, billing…):

1. Schema + migration as above.
2. New service leaf(s) owning queries and transactions; keep them under the size budget.
3. Route file thin over the service; zod schemas near the route or in `shared/src/schemas`
   when the frontend consumes them too.
4. Backend pagination always — never return unbounded arrays (list helpers:
   `list-pagination-helpers` unit test shows the envelope pattern). KPI/tab
   counts ride the envelope as full-set aggregates (`statusCounts`,
   `statusAmounts`, `summary` — computed over the same where-clause minus the
   page window); they must never be derived client-side from one page.
5. If it feeds a report/dashboard, register its cache in `lib/report-cache.ts` (below).
6. Frontend wiring is out of this doc's scope; see the frontend conventions in
   `docs/design-guidelines.md` for UI work.

**Adding a status value (3 layers — the parity test guards 1↔2):**

1. Backend: append the value to the enum in `db/schema/_enums.ts`, then `make generate`
   (text-based enums — no `ALTER TYPE`; the migration is a constraint/default change).
2. Shared: update the matching TS enum in `shared/src/constants/index.ts` and any shared zod
   schema that enumerates the values — **shared-derived zod rejects unknown values on writes**,
   so skipping this layer breaks the new status end-to-end.
3. Frontend: status label/option maps (`*_STATUS_LABELS`) + any status-gated UI.
   `src/tests/unit/status-vocabulary-parity.test.ts` fails if layers 1 and 2 diverge.

**Report caches (`lib/report-cache.ts`):** every `reports:` key is spelled exactly there —
key prefixes, setter-side builders (`pnlMonthKey`, `dashboardWidgetsMonthKey`, …), and
semantic groups (`tripWrite`, `tripStart`). A new report: add its key + builder, assign group
membership (which mutations feed it), then bust via `invalidateReportCaches(group)`.
A unit drift gate fails any file that hand-spells a quoted `reports:` key outside the registry.

## 5. Migration rails (enforced by the root `Makefile`)

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
- **Journal floor moves with every migration**: both migration-safety tests
  (`o2c-rev1…`, `customer-workflow…`) assert the current entry count — bump the number in the
  same commit that adds a migration. The helper (`tests/helpers/journal-invariants.ts`) checks
  contiguity, monotonic timestamps, and tag↔file existence structurally.
- Conventions: append-only additive migrations; guard backfills with `EXISTS`; no
  `CREATE TYPE`/`ALTER TYPE` (text enums by design); see
  `docs/journals/260820-fulfillment-classification-migration.md` for the snapshot-defect
  post-mortem — never hand-edit generated metadata, and verify snapshots before generating.

## 6. Standing rules

- **Drizzle only — no raw SQL** in services or routes. Financial precision via `round2dp()` /
  `computeTripTotals()` (`shared/src/calculations/`); VND displays without decimals.
- **Tests:** `src/tests/unit/*.test.ts` (flat glob, no DB, sub-second) vs `src/tests/*.test.ts`
  (integration, `--test-concurrency=1`, real DB). Arch and invariant tests belong in unit.
  Helpers shared by both globs live in `src/tests/helpers/`.
- **Shell hygiene:** never pipe test/build output through `tail` — it masks exit codes
  (recurring incident source). Check `$?` or use `echo "EXIT=$?"`.
- **Schema conventions:** no database-level FK constraints — referential integrity is
  application-enforced by design (guard deletes in services; partial unique indexes use
  `WHERE deleted_at IS NULL`). New timestamp columns use `timestamptz` (`withTimezone: true`).
  VND money is `numeric(15, 0)`; rates may use finer scales. jsonb columns get `.$type<>()`
  unless deliberately opaque (governance snapshots).

## 7. Enforcement map

| Invariant | Enforced by |
|-----------|-------------|
| No db-client imports in routes | `arch-layering.test.ts` rule 1 (+ frozen baseline) |
| No services→routes imports | `arch-layering.test.ts` rule 2 |
| LOC budget 1,500 | `arch-layering.test.ts` rules 3–4 (+ baseline) |
| Migration journal integrity + count floor | `tests/helpers/journal-invariants.ts` via both safety tests |
| Report-cache keys spelled only in the registry | `tests/unit/report-cache-registry.test.ts` (source-scan drift gate) |
| Backend↔shared status vocabulary parity | `tests/unit/status-vocabulary-parity.test.ts` |
| Generate serialization / pre-migrate backup / drift probe | root `Makefile` targets (`generate`, `db-backup`, `db-drift-check`) |
| Governed-write registry coverage | `material-write-registry-exhaustive.test.ts` |
| Locked-entity write boundary | `q18-locked-write-boundary-exhaustive.test.ts` |
| Native `<select>` ban (frontend) | ESLint rule `@tingting/no-native-select` |
