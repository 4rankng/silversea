---
type: Reference
title: "Quickstart"
description: "Shortest safe path to install, run, validate, and understand the current SilverSea checkout."
tags: [quickstart, setup, tests, scripts, validation]
sources:
  - id: openwiki-source-39c3295efc089133e87a9c80
    resource: repo://CONTEXT.md
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-14bce692c84c730f363428ab
    resource: repo://scripts/lib/http.test.mjs
  - id: openwiki-source-3b7fb2012e47899d7453cd01
    resource: repo://scripts/lib/ui-driver.test.mjs
  - id: openwiki-source-592889025dfa2f31c9e5bba0
    resource: repo://shared/package.json
  - id: openwiki-source-2321476aab68e6b1ce6c7ba0
    resource: repo://testplan/testaccounts.txt
generated: { by: "claude-code", at: "2026-09-24T07:05:35.307Z" }
verified:
  - by: openwiki/0.5.2
    at: 2026-09-24T07:05:35.307Z
---

# Quickstart

SilverSea is a TingTing-platform deployment for the SilverSea container-trucking customer: Express+TS backend, React+Vite frontend, Drizzle/Postgres, Redis, JWT+Casbin RBAC. This wiki is **optional just-in-time context** — source code and tests are authoritative.

## Get a local environment running

```bash
pnpm install
make setup          # first time: start infra, recreate DB, migrate, seed
make dev            # db + redis + backend (:3002) + frontend (:7175); waits on Postgres 5441
```

| Service | Where | Port |
|---------|-------|------|
| Backend API | `backend/` | 3002 |
| Frontend | `frontend/` | 7175 (strictPort) |
| Postgres | `silversea-db` container | 5441 |
| Redis | local | 6391 |
| Adminer | local | 8083 |

Staging: https://vantai.tingting.vip — accounts resolve per role via `testaccounts.txt` (shared password `Abc123`; local dev holds TWO DB modes — dev-seed demo users by default after `make dev` + `make seed`, or the named prod-mirror staff after `make stgdb` with the Abc123 reset re-run — and the QA harness walks the role list when a login misses). **Demo mode is permanently disabled** in `frontend/src/config/index.ts`; the frontend always talks to the real API.

## Tests and checks

- Backend: `pnpm --dir backend test` (unit + DB-backed integration, tsx runner). After editing `shared/`, rebuild it first (`pnpm --dir shared build`).
- Frontend: `pnpm --dir frontend test` (vitest, incl. `structure.guard.test.ts` ratchet). The 2026-09-09 origin/prod → main merge swept 48 `FROZEN_MAX_LOC` ceilings by +1..+8 lines as a one-shot contract change; new entries still require the ratchet rule that entries may only shrink, with growth reviewed as a contract change.
- `make migrate` backs up the DB first and fails closed — use it instead of raw drizzle-kit.
- Context resolver: `pnpm context` (resolve), `pnpm context:check` (validate manifest), `pnpm context:test` and `pnpm scripts:test` (Node test runner; current scripts use `node --test scripts/lib/*.test.mjs` and `node --test scripts/context-for.test.mjs scripts/lib/*.test.mjs`).
- Lint: `pnpm lint` (root eslint).
- Schema drift guard: `make db-drift-check` asserts `drizzle-kit generate` is a no-op on a clean tree.

## QA harness and evidence

The testplan ships a reusable Node-based harness under `testplan/qa/`. It is the canonical QA entry point:

```bash
# full sweep
node testplan/qa/scripts/run-all.mjs

# single case
node testplan/qa/scripts/run-case.mjs <TC-id>

# smoke (fast)
node testplan/qa/scripts/smoke.mjs
```

The harness depends on `testplan/qa/lib/{env,harness,selectors}.mjs`. Evidence lives under `testplan/qa/evidence/<date>_<scope>/` — never under `frontend/qa/` or `backend/qa/`. The root `qa/` directory remains the cross-project evidence sink per `AGENTS.md` and is what the QA gate report should reference.

## Deploys

`make demo` ships the current tree to staging (https://vantai.tingting.vip) and keeps the existing DB; cut from a clean detached checkout so uncommitted lane work never bakes into the build, then verify the `buildHash` and asset guard via `/api/health`. `make deploy` ships to prod (https://silversea.tingting.vip) from the synced prod branch and refuses a dirty tree. Prod deploys stay gated on an all-green test wave and explicit go-ahead.

## Pre-commit hook

A versioned pre-commit hook (`scripts/githooks/pre-commit`, wired by `git config core.hooksPath scripts/githooks` and auto-installed by the root `prepare` script) runs the typecheck table whenever staged files touch a project, and refuses the commit on failure. Escape hatch: `git commit --no-verify` — always justify in the commit body. A red `main` is worse than a delayed commit.

## Where to go next

- [Overview](overview.md) — domain at a glance, stack table, removed features.
- [Architecture](architecture.md) — codebase map, financial-precision contract, structure ratchet, mechanical gates.
- `AGENTS.md` — repo contracts, QA gates, roles table.
- `testplan/` — role-based flows; `testaccounts.txt` for accounts.

## Chi-phi wave (2026-09-21/22) — notes

- The isolated backend test runner (`TZ=UTC node backend/scripts/test-isolated.mjs --filter <substr>`) builds a throwaway template DB per run: it applies every drizzle journal migration, so a journal entry whose migration `.sql` file is not tracked breaks every fresh checkout with a silent migrate exit — census `git ls-files backend/drizzle/*.sql` against `ls backend/drizzle/*.sql` first.
- The accountant phoi-phieu surface needs its routes declared in `middleware/material-write.ts`; an undeclared route 500s on the audit context, not 404s.
- Seed changes (fee catalog, fee norms) ride the cut's seed step; the seed is fill-only, so admin edits on live rows always win.

## Chi-phi wave (2026-09-24) — validation-path notes

- **Migration trio coherence check BEFORE any migration landing**: `node backend/scripts/check-migration-trio.mjs` (f90a5930) verifies journal/sql/snapshot consistency — run it in the same commit as any `make generate` output; it closes the incomplete-trio class (09-24: a .sql landed without journal/snapshot and the staging migrate silently skipped it).
- **Post-deploy migration gate on every cut**: staging journal cursor must equal the freeze tree's journal count AND a probe endpoint backed by the newest migration must return 200 BEFORE the cut is declared deployed (runbook rule; today's 130-vs-131 miss is structurally impossible next cut).
- **BE suites run on the isolation runner** (`TZ=UTC node backend/scripts/test-isolated.mjs --concurrency 4 [--filter substr]`) — throwaway template DB per suite, local :5441 only, never staging; local DATABASE_URL fallback (5441) still applies for un-filtered runs.
- **Two-checkout port map unchanged** (09-24): `ss-prod-*` containers (Postgres 5441 / Redis 6391 / Adminer 8083), app stack 3002/7175 on this checkout; the sibling `silversea-main` keeps `ss-main-*` (5442/6392/8084, app 3001/7174) — never run both app stacks at once.
