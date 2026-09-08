---
type: Reference
title: "Quickstart"
openwiki_generated: true
verified:
  - by: openwiki/0.5.0
    at: 2026-09-08T08:52:37.167Z
sources:
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-2321476aab68e6b1ce6c7ba0
    resource: repo://testplan/testaccounts.txt
generated: { by: "claude-code", at: "2026-09-08T08:52:37.167Z" }
---

# Quickstart

SilverSea is a TingTing-platform deployment for the SilverSea container-trucking customer: Express+TS backend, React 19+Vite frontend, Drizzle/Postgres, Redis, JWT+Casbin RBAC. This wiki is **optional just-in-time context** — source code and tests are authoritative.

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

## Where to go next

- [Overview](overview.md) — domain at a glance, stack table, removed features.
- [Architecture](architecture.md) — codebase map, financial-precision contract, structure ratchet, known traps.
- `AGENTS.md` — repo contracts, QA gates, roles table.
- `testplan/` — role-based flows; `testaccounts.txt` for accounts.
