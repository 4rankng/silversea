---
type: Reference
title: "Quickstart"
description: "Shortest safe path to install, run, validate, and understand the current SilverSea checkout."
tags: [quickstart, setup, tests, scripts, validation]
verified:
  - by: openwiki/0.5.0
    at: 2026-09-08T14:23:47.638Z
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
generated: { by: "opencode", at: "2026-09-08T14:23:47.638Z" }
---

# Quickstart

SilverSea is a TingTing-platform deployment for the SilverSea container-trucking customer: Express+TS backend, React+Vite frontend, Drizzle/Postgres, Redis, JWT+Casbin RBAC. This wiki is **optional just-in-time context** — source code and tests are authoritative.

## Get a local environment running

```bash
pnpm install
make setup          # first time: start infra, recreate DB, migrate, seed
make dev            # db + redis + backend (:3001) + frontend (:7174)
```

| Service | Where | Port |
|---------|-------|------|
| Backend API | `backend/` | 3001 |
| Frontend | `frontend/` | 7174 (strictPort) |
| Postgres | `silversea-db` container | 5441 |
| Redis | local | 6391 |
| Adminer | local | 8083 |

Staging: https://vantai.tingting.vip — accounts resolve per role via `testaccounts.txt` (shared password `Abc123`). Demo mode is permanently disabled.

## Tests and checks

- Backend: `pnpm --dir backend test` (unit + DB-backed integration, tsx runner). After editing `shared/`, rebuild it first (`pnpm --dir shared build`).
- Frontend: `pnpm --dir frontend test` (vitest, incl. `structure.guard.test.ts` ratchet).
- `make migrate` backs up the DB first and fails closed — use it instead of raw drizzle-kit.
- Context resolver: `pnpm context` (resolve), `pnpm context:check` (validate manifest), `pnpm context:test` and `pnpm scripts:test` (Node test runner; current scripts use `node --test scripts/lib/*.test.mjs` and `node --test scripts/context-for.test.mjs scripts/lib/*.test.mjs`).
- Lint: `pnpm lint` (root eslint).
- Schema drift guard: `make db-drift-check` asserts `drizzle-kit generate` is a no-op on a clean tree.

## Where to go next

- [Overview](overview.md) — domain at a glance, stack table, removed features.
- [Architecture](architecture.md) — codebase map, financial-precision contract, structure ratchet, mechanical gates.
- `AGENTS.md` — repo contracts, QA gates, roles table.
- `testplan/` — role-based flows; `testaccounts.txt` for accounts.
