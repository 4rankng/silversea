---
type: "Reference"
title: "Architecture and Codebase Map"
openwiki_generated: true
verified:
  - by: openwiki/0.5.0
    at: 2026-09-08T08:52:37.167Z
sources:
  - id: openwiki-source-a08d0826dadf2aa659264512
    resource: repo://backend/src/services/aging.service.ts
  - id: openwiki-source-1047363cf615000e4c9bb694
    resource: repo://frontend/package.json
  - id: openwiki-source-316dfb4c2b43d4800b46fd34
    resource: repo://frontend/src/tests/structure.guard.test.ts
  - id: openwiki-source-592889025dfa2f31c9e5bba0
    resource: repo://shared/package.json
  - id: openwiki-source-5fdaee04264279630f2bb947
    resource: repo://shared/src/calculations/round.ts
  - id: openwiki-source-f7fd2de8ba29e8649d8291fb
    resource: repo://shared/src/calculations/tripTotals.ts
generated: { by: "claude-code", at: "2026-09-08T08:52:37.167Z" }
---

# Architecture and Codebase Map

> Related: [Overview](overview.md) · Roles: `AGENTS.md` · Domain flows: `docs/prd/QuyTrinhO2C.md`

## Layout

SilverSea is a pnpm monorepo: `backend/` (Express + TypeScript), `frontend/` (React 19 + Vite), `shared/` (`@tingting/shared`), plus `testplan/` (role-based QA flows), `docs/prd/` (canonical product specs), and `openwiki/` (this generated wiki).

- **backend/** — Express API on port 3001. Services-oriented layout: `backend/src/services/` holds 214 service modules; routes under `backend/src/routes/`; tests under `backend/src/tests/` run by node's tsx runner (`pnpm --dir backend test` = unit + integration, DB-backed integration suites). Drizzle ORM over Postgres. JWT + Casbin RBAC.
- **frontend/** — React 19 + Vite on strictPort 7174; features under `src/features/` (shipments, dispatch, salary-attendance, ...), tests via vitest, plus the `src/tests/structure.guard.test.ts` ratchet.
- **shared/** — `@tingting/shared` package with `src/schemas/` (zod intake schemas shared backend/frontend) and `src/calculations/` (pure functions with colocated `.test.ts`): `round.ts` (`round2dp`), `tripTotals.ts` (`computeTripTotals`), fuel surcharge, ISO 6346 container check-digit, FIFO aging, driver salary (per-container), billing documents.
- **docs/prd/** — canonical product specs; diagram-based content is authoritative (QuyTrinhO2C).
- **testplan/** — role-only test cases; usernames resolve via `testaccounts.txt` per environment.

## Contracts and known traps

- **Financial precision** lives in `shared/src/calculations/`: `round2dp()` + `computeTripTotals()`; VND amounts carry no decimals. Frontend and backend share these functions — do not re-implement rounding in either app.
- **Structure ratchet**: `frontend/src/tests/structure.guard.test.ts` freezes line ceilings per file ("ratchet only shrinks"). When two branches independently grow the same file, bump the ceiling to the actual merged line count with a comment naming both feature sets.
- **Report-cache invalidators** exist in 3 copies; a new ledger-report pattern must be wired into all of them.
- **shared/dist staleness**: backend tests import the compiled `@tingting/shared`; after editing `shared/src`, run `pnpm --dir shared build` or imports fail with "does not provide an export named ...".
- **Frontend split status**: backend god-file split is complete; the frontend wave remains partially open (FinancePage split and Salary JSX bulk outstanding).

## Related pages

- [Overview](overview.md) — what SilverSea is, ports, stack.
- Roles and visibility gates: see `AGENTS.md` (the repo's role table).
- Domain flows: `docs/prd/QuyTrinhO2C.md` and `testplan/flows/`.
