# TingTing — Vietnamese Trucking Logistics Platform

## Identity

Logistics/fleet management platform for a Vietnamese trucking company. Manages trips, drivers, customers, fleet, and financials (ledger, P&L, debt tracking, profit distribution).

## Monorepo Structure

```
backend/     Express v5 + TypeScript API (port 3090)
frontend/    React 18 + Vite + TypeScript (port 5173)
shared/      Shared types, schemas, constants, calculations
```

## Tech Stack

- **Backend:** Node.js, Express v5, TypeScript, Drizzle ORM, PostgreSQL
- **Auth:** JWT + Casbin RBAC
- **Frontend:** React 18, Vite, TanStack Query, React Router, Recharts
- **Testing:** Vitest (unit + integration)
- **Config:** `backend/src/config/index.ts`

## RBAC Roles

| Role | Vietnamese | Scope |
|------|-----------|-------|
| ADMIN | Quản trị | Full access |
| MANAGER | Giám đốc | Trips, financials, fleet, reports |
| ACCOUNTANT | Kế toán | Financials, debt, P&L |
| DRIVER | Lái xe | Own trips, earnings, mobile-optimized pages |

## Conventions

- TypeScript strict mode — no `any` types
- REST API with `/api/v1` prefix
- Drizzle ORM for all database queries — no raw SQL
- Financial precision: use `round2dp()` and `computeTripTotals()` from `shared/src/calculations/`
- Demo mode permanently disabled — frontend uses real API only
- Vietnamese currency (VND) — no decimal places in display formatting

## Key Files

### Backend
- `backend/src/index.ts` — Entry point
- `backend/src/routes/` — auth, trips, financial, driver, fleet, maps, upload, config
- `backend/src/services/` — Business logic layer
- `backend/src/middleware/` — Auth, Casbin enforcement, error handling
- `backend/src/casbin/` — RBAC policy definitions
- `backend/src/db/` — Drizzle schema and migrations
- `backend/src/config/` — Environment configuration

### Frontend
- `frontend/src/App.tsx` — Router + auth provider
- `frontend/src/pages/` — All route pages (Dashboard, Trips, Finance, Fleet, Dispatch, etc.)
- `frontend/src/api/` — API client (tripClient.ts)
- `frontend/src/hooks/` — useAuth, useCRUD, useCatalogs, useTripForm, useObservedWidth
- `frontend/src/components/` — Layout, UI primitives, TripForm, LocationAutocomplete

### Shared
- `shared/src/types/` — Shared TypeScript interfaces
- `shared/src/schemas/` — Zod validation schemas
- `shared/src/calculations/` — Financial math (round2dp, computeTripTotals)
- `shared/src/constants/` — Shared constants

## Task Tracking

`TASKS.md` in project root — two tracks:
- **Track 1:** E2E Trip Lifecycle Epic (Phases 1-4)
- **Track 2:** Feature Backlog (Fuel norms, Receivables, Dashboard, Profit distribution, Tech debt)

## Key Documents

- `docs/flows/DELIVERY_TRIP_LIFECYCLE.md` — Trip lifecycle QA guide + user manual
- `docs/company-files/` — Original Vietnamese business documents (fuel norms, allowances, vehicle data)
