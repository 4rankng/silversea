# Codebase Summary

> **Audience:** Developers joining the project. This is your "where do I find X" index. For conventions and rules, see [Code Standards](code-standards.md). For architecture, see [System Architecture](system-architecture.md).

## Repository Map

```
backend/     40,265 LOC / 179 files  Express v5 + TypeScript API
frontend/    92,707 LOC / 302 files  React + Vite + TypeScript SPA
shared/       5,985 LOC /  24 files  Types, schemas, calculations, navigation
deploy/       1,102 LOC /    2 files  nginx config, server setup scripts
docs/         Specs, flows, ADRs, plans, company documents
```

pnpm monorepo. Build order: shared -> backend -> frontend (backend reads shared from `dist/`).

## Package Responsibilities

### `shared/` -- `@tingting/shared`

Cross-package contract layer. Backend imports from `dist/`; frontend imports from `src/`.

| Directory | Purpose |
|-----------|---------|
| `src/types/` | TypeScript interfaces (Trip, LedgerEntry, Driver, etc.) |
| `src/schemas/` | Zod validation schemas mirroring TS types (used by both API validation and frontend forms) |
| `src/calculations/` | `round2dp()`, `computeTripTotals()` -- financial math used everywhere |
| `src/constants/` | Shared enums, Vietnamese label maps, status definitions |
| `src/navigation/pageCatalog.ts` | Single source of truth for SPA routes, titles, and agent-search entries |

**Critical:** After editing shared, rebuild it (`cd shared && npx tsc`) before running backend or tests. Frontend reads from `src/` directly.

### `backend/` -- `@tingting/backend`

Express v5 REST API on port 3090.

#### Entry Point

`backend/src/index.ts` -- initializes telemetry, connects to Postgres + Redis, loads Casbin enforcer, sets up Express middleware stack, mounts all routes.

#### Directory Map

| Directory / File | Purpose |
|------------------|---------|
| `config/index.ts` | dotenv loading, env var access |
| `db/schema.ts` | Single Drizzle schema file with all table definitions + pgEnums |
| `db/index.ts` | postgres.js database instance |
| `casbin/` | `model.conf` + `policy.csv` -- RBAC policy definitions |
| `errors.ts` | `ApiError` class for structured error responses |
| `middleware/` | auth (JWT), casbin (RBAC + requireRoles), audit (Vietnamese logging), errorHandler, serializer (snake_case), logger |
| `routes/` | Express routers for all API endpoints |
| `services/` | Business logic layer |
| `agentSocket.ts` | Socket.io server for agent chatbot |
| `lib/redis.ts` | ioredis client for GPS cache and sessions |
| `lib/telemetry.ts` | OpenTelemetry setup |

#### Routes (API Endpoints)

| Route File | Mount Path | Purpose |
|------------|------------|---------|
| `auth.ts` | `/api/auth` | Login, token refresh (no `/v1` prefix) |
| `trips.ts` | `/api/v1/trips` | Trip CRUD, lifecycle transitions |
| `financial.ts` | `/api/v1/financial` | Ledger, receivables, payments, P&L |
| `expense.ts` | `/api/v1/expenses` | Vendor expenses, payables |
| `driver.ts` | `/api/v1/drivers` | Driver management, work days |
| `config.ts` | `/api/v1/config/*` | Catalog CRUD (customers, trucks, routes, etc.) |
| `salary.ts` | `/api/v1/salary` | Salary periods and processing |
| `agent.ts` | `/api/v1/agent` | AI chatbot (LLM orchestration) |
| `upload.ts` | `/api/v1/upload` | File/image upload (Multer + Sharp) |
| `ocr.ts` | `/api/v1/ocr` | Container/seal OCR (OpenRouter Qwen3-VL + Gemini) |
| `maps.ts` | `/api/v1/maps` | Location autocomplete, distance |
| `notifications.ts` | `/api/v1/notifications` | In-app notifications, push subscription |
| `admin-gps.ts` | `/api/v1/admin/gps` | Bach Khoa GPS tracking (ADMIN only) |
| `admin-chatbot-metrics.ts` | `/api/v1/admin/chatbot` | Chatbot performance monitoring |
| `forwarder.ts` | `/api/v1/forwarder` | Forwarder portal endpoints |
| `forwarder-admin.ts` | `/api/v1/forwarder-admin` | Forwarder settlement approval (office) |

#### Services (Business Logic)

| Service | Purpose |
|---------|---------|
| `trip.service.ts` | Trip lifecycle, fuel calc, road allowance, status transitions |
| `ledger.service.ts` | Append-only ledger operations, payment posting |
| `reporting.service.ts` | P&L reports, receivables summary, fuel variance |
| `receivables.service.ts` | Customer receivables management |
| `statement.service.ts` | Debit-note / statement generation |
| `salary-period.service.ts` | Salary period CRUD, unlock, driver wage calculation |
| `config.service.ts` | `createCrudRouter()` factory for all catalog tables |
| `driver.service.ts` | Driver-specific logic |
| `audit.service.ts` | Audit log queries |
| `storage.service.ts` | File storage (local disk) |
| `event-bus.ts` | Internal pub/sub for cross-service events |
| `agent/` | LLM chatbot: orchestrator, tools, GPS provider, semantic-data gateway |

#### CRUD Factory Pattern

`config.service.ts` exports `createCrudRouter(table, options)` which generates a standard Express router with:

- `GET /` -- list with pagination, filtering, search
- `GET /:id` -- single record
- `POST /` -- create (Zod validation)
- `PUT /:id` -- update
- `DELETE /:id` -- delete

Used for 20+ catalog tables (customers, trucks, routes, suppliers, expense items, etc.).

#### Key Database Tables

Operational tables: `trips`, `trip_legs`, `ledger`, `expenses`, `salary_periods`, `driver_work_days`, `tires`, `vehicle_alerts`, `trip_instructions`, `truck_profit_distribution`, `fuel_price_history`, `agent_messages`, `notifications`, `push_subscriptions`.

Config tables (~24): `customers`, `trucks`, `trailers`, `routes`, `drivers`, `suppliers`, `expense_items`, `cargo_types`, `penalty_reasons`, `fuel_config`, `salary_config`, and more.

### `frontend/` -- `@tingting/frontend`

React 18 SPA on port 7173. Path alias `@` -> `./src`.

#### Entry Point

`frontend/src/App.tsx` -- React Router setup + AuthProvider context.

#### Directory Map

| Directory | Purpose |
|-----------|---------|
| `pages/` | 37 route pages (Dashboard, TripList/Create/Detail/Edit, Finance, Debt, etc.) |
| `hooks/` | Custom hooks: `useAuth`, `useCRUD`, `useCatalogs`, `useTripForm`, `useObservedWidth` |
| `api/` | API client (`tripClient.ts`, `ApiClient` class in `lib/api.ts`) |
| `components/` | Layout, UI primitives, TripForm, LocationAutocomplete, agent/, billing/, charts/, config/, trip/ |
| `features/` | Feature-scoped directories: dashboard, dispatch, fleet, penalties, tires, trip-detail, trips, users |
| `lib/` | Utilities: api, format (VND), date, round, route, maps, csv, avatar |
| `design-system/` | Token definitions, theme configuration |
| `styles/` | Global CSS, page-specific CSS files |

#### Page Routing

Routes derive from `shared/src/navigation/pageCatalog.ts` (the single source of truth). `frontend/src/lib/routes.ts` is a 1:1 projection. All 37 pages live in `frontend/src/pages/`.

#### Key Hooks

| Hook | Purpose |
|------|---------|
| `useAuth` | JWT auth state, login/logout, role check |
| `useCRUD` | Generic CRUD operations with TanStack Query caching |
| `useCatalogs` | Fetches all config catalog tables |
| `useTripForm` | Trip create/edit form state management |
| `useObservedWidth` | Responsive layout width observation |

## Agent / Chatbot Subsystem

A full AI assistant built with Socket.io, connecting to MiniMax-M3 (LLM) with tool-use orchestration.

| Component | Location | Purpose |
|-----------|----------|---------|
| Orchestrator | `backend/src/services/agent/orchestrator.ts` | LLM prompt construction, tool dispatch, response synthesis |
| Tools (semantic) | `backend/src/services/agent/semantic-data.service.ts` | 6 data tools + 11 entity lookups (trips, ledger, P&L, etc.) |
| GPS provider | `backend/src/services/agent/gps/` | Bach Khoa GPS live tracking integration |
| LLM clients | `backend/src/services/agent/llm/` | MiniMax-M3 primary, prompt templates |
| Frontend | `frontend/src/components/agent/` | Chat drawer, message list, directive handler |
| Tours | `shared/src/tours/` + `frontend/src/context/TourControllerContext.tsx` | Role-scoped curated walkthrough catalog, progress and Driver.js spotlight |
| Onboarding checklist | `shared/src/onboarding/tasks.ts` + `frontend/src/hooks/useOnboardingChecklist.ts` | Office-role activation tasks; work tasks complete on their matching success event, while orientation/reference tasks complete when their own guide finishes |
| Tutorial library | `frontend/src/components/onboarding/TutorialLibrary.tsx` | Persistent office-role guide library available from the topbar/checklist |
| Socket | `backend/src/agentSocket.ts` + `frontend/src/lib/agentSocket.ts` | Real-time bidirectional chat |
| Perf metrics | `backend/src/routes/admin-chatbot-metrics.ts` | ADMIN-only dashboard (p95 latency, turn counts) |

## Where to Find...

| I want to... | Look in... |
|--------------|------------|
| Add a new API endpoint | `backend/src/routes/` (new file or extend existing) + `backend/src/services/` |
| Add a new database table | `backend/src/db/schema.ts` (single schema file) |
| Add a new config catalog | `backend/src/db/schema.ts` + route auto-generated by `createCrudRouter` |
| Add a new frontend page | `frontend/src/pages/` + register in `shared/src/navigation/pageCatalog.ts` |
| Change financial calculations | `shared/src/calculations/` (round2dp, computeTripTotals) |
| Change RBAC permissions | `backend/src/casbin/policy.csv` + `backend/src/middleware/casbin.ts` |
| Change a Vietnamese label | `shared/src/constants/` (label maps) or component-level |
| Change error messages | `backend/src/middleware/errorHandler.ts` (structure) + individual routes (messages) |
| Add a chatbot tool | `backend/src/services/agent/semantic-data.service.ts` (data tools) or orchestrator |
| Add a mobile notification | `backend/src/services/notification.service.ts` + `backend/src/services/push.service.ts` |

## Testing

- **Runner:** Vitest. No `make test` target.
- **Backend:** `cd backend && npm test`
- **Shared:** test files run via `tsx`, excluded from `tsc` (intentional -- see `docs/plans/architecture-refactor-consensus-plan.md`)
- **Integration tests:** require Postgres + Redis running + fresh migration applied

## Build & Dev Commands

See [Deployment Guide](deployment-guide.md) for full details. Quick reference:

```bash
pnpm install          # Install all dependencies
make setup            # First-time: infra + migrate + seed
make dev              # Backend :3090 + Frontend :7173
make build            # shared tsc + backend tsc + frontend vite build
cd backend && npm test  # Run backend tests
```
