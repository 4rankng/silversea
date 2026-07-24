# Architecture — NEPO Logistics

## Monorepo Structure
```
tingting/
├── backend/        Express 5 + Drizzle ORM + PostgreSQL (port 3090)
├── frontend/       React 18 + Vite + TanStack (port 5173)
├── shared/         Types, Zod schemas, enums, calculations
├── docs/           Product specs, company files, flow docs
├── wireframe/      HTML wireframes for all role views
├── memory/         Deep memory (glossary, context, projects)
├── CONTEXT.md      Authoritative domain glossary
├── TASKS.md        Development task tracking
├── CLAUDE.md       Working memory (hot cache)
└── HANDOFF.md      Session state (gitignored)
```

## Backend Architecture

### Layers
| Layer | Pattern | Files |
|-------|---------|-------|
| Routes | Express routers, async handlers (Express 5) | `src/routes/*.ts` |
| Middleware | Auth (JWT), RBAC (Casbin), Audit, Error handling | `src/middleware/` |
| Services | Business logic, transactional | `src/services/` |
| DB | Drizzle ORM schema + migrations | `src/db/` |
| Config | dotenv, environment | `src/config/` |

### Service Layer
| Service | Responsibility |
|---------|---------------|
| `trip.service.ts` | Trip CRUD, fuel calc, lifecycle transitions, rate snapshotting |
| `ledger.service.ts` | Immutable entries, advisory locks, running balance |
| `reporting.service.ts` | Dashboard, P&L, profit distribution |
| `driver.service.ts` | Driver-specific queries, `NoDriverProfileError` |
| `audit.service.ts` | Vietnamese audit messages, in-transaction logging |
| `storage.service.ts` | File upload/download, local storage impl |

### Route Pattern
- **Config routes**: Generic CRUD factory for catalog tables (customers, trucks, routes, etc.)
- **Trip routes**: Full lifecycle with status transitions
- **Financial routes**: Ledger, payments, adjustments, P&L
- **Driver routes**: Allowlisted DTO — never exposes revenue/cost data
- **Upload routes**: Magic-byte validation, MIME allowlist, HEIC→JPEG, EXIF strip

### Database Patterns
- **pgEnum** for all status/type fields — defined at top of `schema.ts`
- **No FKs on ledger** — `entity_type` (VARCHAR) + `entity_id` (Integer), loose coupling
- **Advisory locks** — `pg_advisory_xact_lock` sorted by `(entityType, entityId)` to prevent deadlocks
- **Optimistic concurrency** — `version` column on trips, 409 on conflict
- **Rate snapshotting** — 7 columns frozen at save time from config tables
- **Atomic trip codes** — `INSERT ... ON CONFLICT DO UPDATE` for gap-free `TRP-{YYYYMM}-{0000}`

## Frontend Architecture

### Key Hooks
| Hook | Purpose |
|------|---------|
| `useAuth` | JWT auth context, auto-fetch `/users/me` |
| `useCRUD` | Generic CRUD for config tables (inline add/edit/delete) |
| `useCatalogs` | Bootstrap reference data (5min stale time) |
| `useTripForm` | Trip form state management |
| `useConfirm` | Async confirm dialog (from `UI.tsx`) |
| `useObservedWidth` | Responsive width measurement |

### Component Patterns
- **`UI.tsx`**: Shared primitives — Panel, Card, KPI, Modal, Drawer, StatusPill, ConfirmDialog, FormGroup
- **`TripForm/`**: Sub-components — TripLegFields, FuelConfigurator, AllowanceConfigurator, TotalsPanel, PhotoUploader
- **Config pages**: Use `useCRUD` + `InlineForm` + `ActionBtns` shared components
- **Toast pattern**: Inline fixed-position notification, auto-dismiss 4.5s (not a library)
- **CSV export**: `downloadCSV()` from `lib/csv.ts`

### Routing & Navigation
- React Router with `useNavigate()` — never `<a href>` for internal links
- Role-based sidebar in `Layout.tsx`
- All routes mounted in `App.tsx`, visibility controlled by role

## Shared Package

### Structure
| Path | What |
|------|------|
| `constants/index.ts` | All enums + Vietnamese label maps + API paths |
| `types/` | TypeScript interfaces for all entities + API shapes |
| `schemas/index.ts` | Zod validation schemas (mirrors types) |
| `calculations/round.ts` | `round2dp()` helper |
| `calculations/tripTotals.ts` | `computeTripTotals()` — pure, no I/O |

### Key Enum Reference
| Enum | Values |
|------|--------|
| `TripStatus` | CREATED, IN_TRANSIT, COMPLETED, LOCKED, CANCELED |
| `FuelMode` | AUTO, FLAT_RATE |
| `LoadingType` | HANG (loaded), VO (empty) |
| `Role` | ADMIN, MANAGER, ACCOUNTANT, DRIVER |
| `TxnType` | TRIP_REVENUE, PAYMENT_RECEIVED, PENALTY, MANAGEMENT_FEE, ADJUSTMENT, DRIVER_SALARY |
| `TrailerType` | 20FT, 40FT |
| `TruckStatus` | ACTIVE, MAINTENANCE, INACTIVE |
