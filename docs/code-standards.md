# Code Standards

> **Audience:** Developers contributing code. Distilled from [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md). For domain terms, see [CONTEXT.md](../CONTEXT.md).

## TypeScript

- **Strict mode** enabled. No `any` types.
- Files: `.ts` for backend/shared, `.tsx` for React components.
- Interfaces in `shared/src/types/`; Zod schemas in `shared/src/schemas/` must mirror them.
- Enums defined in `backend/src/db/schema.ts` as `pgEnum`; TypeScript enums in `shared/src/constants/`.

## Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| Files (TS/TSX) | kebab-case for new files | `trip-legs.ts`, `fuel-price-history.ts` |
| Database columns | snake_case (enforced by Drizzle) | `fuel_price_applied` |
| API responses | snake_case (serializer middleware) | `trip_id`, `fuel_liters` |
| API request bodies | camelCase (parsed by frontend, validated by Zod) | `fuelLiters`, `tripId` |
| React components | PascalCase | `TripForm`, `Money`, `StatusStrip` |
| CSS classes | kebab-case, page-scoped | `.trip-detail-header`, `.kpi-strip` |
| Environment variables | SCREAMING_SNAKE_CASE | `DATABASE_URL`, `JWT_SECRET` |
| Vietnamese labels | PascalCase for enums, kebab-case for keys | `statusLabel` map key: `IN_TRANSIT` |

## Database & Drizzle ORM

- **All database access through Drizzle ORM** -- no raw SQL, no query builders.
- Single schema file: `backend/src/db/schema.ts` (all tables + pgEnums).
- Migrations: Drizzle-kit generated (journal-based). Applied automatically by `make dev`; production via `make deploy-backend` or `make prod-migrate`.
- **Ledger is append-only.** Never update or delete ledger rows. Use `ADJUSTMENT` txn_type for corrections, `UNLOCK_REVERSAL` for trip unlocks.

## Financial Precision

- All monetary calculations must go through `round2dp()` and `computeTripTotals()` from `shared/src/calculations/`.
- **VAT asymmetry:** Revenue recorded ex-VAT (net). Costs recorded incl-VAT (gross). Do not normalize.
- VND has no decimal places in display. Internal calculations preserve 2dp for intermediate rounding.
- `fuelPriceApplied` is a config snapshot at trip creation -- never mutate. `fuelActualUnitPrice` is the per-trip override. Effective = actual ?? snapshot.

## RBAC & Authorization

Dual-layer enforcement:

1. **`casbinAuthz('resource')`** -- coarse check against Casbin policy (ADMIN wildcard, role-resource mapping).
2. **`requireRoles([ADMIN, MANAGER])`** -- tight check, used in route handlers.

HTTP method maps to action: `GET` = read, `POST/PUT/PATCH` = write, `DELETE` = delete.

Policy definitions: `backend/src/casbin/policy.csv`. Middleware: `backend/src/middleware/casbin.ts`.

## Error Handling

Pipeline in `backend/src/middleware/errorHandler.ts`:

| Priority | Error Type | HTTP Status | Response |
|----------|-----------|-------------|----------|
| 1 | ZodError | 400 | `{ error: message, details: issues }` |
| 2 | ApiError | custom (statusCode field) | `{ error: message, details? }` |
| 3 | Custom errors with `.status` | 400-599 | `{ error: message }` |
| 4 | PG unique constraint (23505) | 409 | `{ error: "Da ton tai" }` |
| 5 | Fallback | 500 | `{ error: message }` (Pino logged) |

Use `ApiError` from `backend/src/errors.ts` for known application errors.

## Audit Logging

Every mutation request (POST/PUT/PATCH/DELETE) is auto-logged by `backend/src/middleware/audit.ts`:

- Vietnamese-language message via templates in `backend/src/services/audit-templates.ts`
- Records: user, action, entity, timestamp, before/after diff
- Audit type definitions: `backend/src/services/audit-types.ts`
- Query endpoint: `GET /api/v1/audit-logs` (ADMIN/MANAGER only)

## API Conventions

- REST endpoints under `/api/v1/` prefix.
- Exception: auth login at `/api/auth/login` (no `/v1`).
- Response format: `{ data: T }` for success, `{ error: string, details? }` for errors.
- Pagination: `{ data: T[], total: number, page: number, limit: number }`.
- Filtering: query params (`?status=COMPLETED&driverId=5`).
- Search: `?q=searchTerm` (unaccent-aware via PostgreSQL extension).

## Frontend Conventions

### Layout & CSS

- **Tailwind CSS v4** via `@tailwindcss/vite` plugin -- no `tailwind.config` file.
- Page-scoped CSS files in `frontend/src/styles/` (e.g., `TripDetailPage.css`).
- **No `!important`** -- use page-scoped selectors for specificity.
- **No truncation** of column values -- use wrap, tooltip, or card layout.

### Typography & Fonts

- Exactly 2 self-hosted fonts (zero Google CDN):
  - **Be Vietnam Pro** -- text and UI
  - **JetBrains Mono** -- numeric/tabular data
- Font files are in the repo; loaded via CSS `@font-face`.

### Data Display

- **No raw DB IDs in UI text** -- show meaningful business labels (customer name, route name, license plate).
- `<Money>` component renders VND with the dong sign as a subtitle-sized unit.
- `statusStrip` component (3x20px color bar) appears on every status display (desktop + mobile).
- Empty states use the illustration system: `frontend/src/lib/emptyIllustrations.ts` (4 PNGs resolved by category name).

### Mobile

- DRIVER and FORWARDER pages are mobile-first responsive.
- Breakpoints handled via `useObservedWidth` hook and Tailwind responsive utilities.

### State Management

- TanStack Query for server state (caching, invalidation, refetching).
- React context for auth state (`AuthProvider`).
- No global state management library (Redux, Zustand, etc.).

## Commit Format

- Conventional commit format: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- No AI references in commit messages (no "AI", "Copilot", "Claude", etc.).
- Keep commits focused and atomic.

## Testing

- **Vitest** for all tests.
- Backend: `cd backend && npm test`
- Shared: test files run via `tsx`, excluded from `tsc` (intentional -- see [architecture-refactor-consensus-plan](plans/architecture-refactor-consensus-plan.md)).
- Integration tests require Postgres + Redis running and a fresh migration applied.
- No E2E test framework (manual `make e2etest` script exists for specific flows).

## Code Patterns

### CRUD Operations (Backend)

Use `createCrudRouter(table, options)` from `config.service.ts` for standard catalog tables. Only write custom routes when business logic goes beyond simple CRUD.

### CRUD Operations (Frontend)

Use `useCRUD` hook with TanStack Query for list/detail/create/update/delete operations. Provides loading/error states and cache invalidation.

### Event Bus

`backend/src/services/event-bus.ts` provides internal pub/sub for cross-service notifications (e.g., trip completion triggers notification creation).

### File Upload

- Multer + Sharp for image upload and EXIF stripping.
- Max 15MB; HEIC supported.
- Stored on local disk (`UPLOAD_DIR` env var).
- Photo authorization logic documented in [docs/adr/0042-photo-authz-exact-storagekey.md](adr/0042-photo-authz-exact-storagekey.md).

## Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|-------------|
| Raw SQL queries | Drizzle ORM |
| `any` type | Proper TypeScript types or `unknown` |
| `!important` in CSS | Page-scoped selectors |
| Truncating table values | Wrap, tooltip, card layout |
| Showing raw IDs in UI | Business labels (name, plate, etc.) |
| Mutating `fuelPriceApplied` | Use `fuelActualUnitPrice` for overrides |
| Deleting ledger rows | Append ADJUSTMENT or UNLOCK_REVERSAL |
| Google Fonts CDN | Self-hosted Be Vietnam Pro + JetBrains Mono |
| Demo mode / fake data | Real API only (demo permanently disabled) |
