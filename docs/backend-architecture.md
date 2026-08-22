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
- `db/schema.ts` is the single schema module (domain-folder split is a known deferred item —
  do not start it piecemeal).

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

1. Define the table in `db/schema.ts`; `pnpm db:generate` → migration lands in `drizzle/`.
   Journal invariants are checked structurally — there is no list to extend.
2. Mount `createCrudRouter` in `routes/config/catalog-crud.routes.ts` (27 existing mounts).
3. Transactional needs (multi-statement invariants) get a dedicated router instead — see the
   header comment in `routes/config/debit-note-templates.routes.ts` for why crud-factory's
   non-transactional beforeCreate+insert is insufficient.
4. Casbin policy for the new route path; governed materials register in the material-write
   registry (`middleware/material-write.ts` + its exhaustive test).

Full workflow entities (shipments, advances, billing…):

1. Schema + migration as above.
2. New service leaf(s) owning queries and transactions; keep them under the size budget.
3. Route file thin over the service; zod schemas near the route or in `shared/src/schemas`
   when the frontend consumes them too.
4. Backend pagination always — never return unbounded arrays (list helpers:
   `list-pagination-helpers` unit test shows the envelope pattern).
5. Frontend wiring is out of this doc's scope; see the frontend conventions in
   `docs/design-guidelines.md` for UI work.

## 5. Standing rules

- **Drizzle only — no raw SQL** in services or routes. Financial precision via `round2dp()` /
  `computeTripTotals()` (`shared/src/calculations/`); VND displays without decimals.
- **Tests:** `src/tests/unit/*.test.ts` (flat glob, no DB, sub-second) vs `src/tests/*.test.ts`
  (integration, `--test-concurrency=1`, real DB). Arch and invariant tests belong in unit.
  Helpers shared by both globs live in `src/tests/helpers/`.
- **Migrations:** append-only. `src/tests/helpers/journal-invariants.ts` asserts contiguity,
  monotonic timestamps, tag↔file existence — new migrations need zero test edits.
- **Shell hygiene:** never pipe test/build output through `tail` — it masks exit codes
  (recurring incident source). Check `$?` or use `echo "EXIT=$?"`.

## 6. Enforcement map

| Invariant | Enforced by |
|-----------|-------------|
| No db-client imports in routes | `arch-layering.test.ts` rule 1 (+ frozen baseline) |
| No services→routes imports | `arch-layering.test.ts` rule 2 |
| LOC budget 1,500 | `arch-layering.test.ts` rules 3–4 (+ baseline) |
| Migration journal integrity | `tests/helpers/journal-invariants.ts` via both safety tests |
| Governed-write registry coverage | `material-write-registry-exhaustive.test.ts` |
| Locked-entity write boundary | `q18-locked-write-boundary-exhaustive.test.ts` |
| Native `<select>` ban (frontend) | ESLint rule `@tingting/no-native-select` |
