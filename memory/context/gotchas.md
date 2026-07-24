# Gotchas & Pitfalls — NEPO Logistics

Lessons learned. Read before touching related code.

## Backend

### Drizzle / PostgreSQL
- **postgres-js driver**, NOT `pg`. Different connection API.
- **Cannot bind JS arrays** to IN-lists. Use: `sql.join(ids.map(id => sql\`${id}\`), sql\`, \`)`
- **pgEnum** values must be defined at top of `schema.ts` BEFORE table definitions that reference them.
- **Single schema file** — all tables in `db/schema.ts`, no splitting.
- `numeric` columns from Postgres come back as **strings**. Use Zod `.transform(Number)` (`numericMoney` helper) on all monetary fields.

### Service Layer
- `LedgerService.postEntry()` includes advisory locking — callers should NOT call `lockEntity` separately.
- `NoDriverProfileError` has `status = 404`. Driver route catch blocks use `err.status || 500`.
- `snakeCaseSerializer` middleware converts all camelCase keys to snake_case at response seam. Frontend reads snake_case.
- Trip lock procedure is **one transaction** — status flip + ledger entries + audit log all commit together. Partial commit is impossible.

### Financial Rules
- **Penalties are NOT company expenses** — they're salary deductions from drivers, recorded as "Other Income".
- **One set of fuel fields** per trip — no separate "expected" vs "actual". Same fields get continuously updated.
- **Locking is per-trip**, not monthly. Each trip locked individually as verified.
- **Ledger is immutable** — no UPDATE/DELETE. Corrections go through `POST /api/ledger/adjustments`.
- Revenue auto-populated from pricing table on create, but accountant can override (with audit trail).
- `gte` was removed from `financial.ts` imports — reporting service handles all date filtering.

### RBAC
- `requireRoles('ADMIN', 'MANAGER')` from `middleware/auth.ts`. Applied per-route.
- ADMIN is a developer/support role, not a business user.
- Driver endpoints return **allowlisted DTO** — never SELECT revenue, grossProfit, totalCost, etc.

## Frontend

### Build & Config
- **Vite path aliases**: `@` → `./src`, `@tingting/shared` → `../shared/src`
- **Tailwind CSS v4** (not v3) — uses `@tailwindcss/vite` plugin, no `tailwind.config.js`
- Express **v5** (not v4) — async error handling differs; route handlers can be async without wrapping.

### UI Patterns
- **Never use `window.confirm()` or `alert()`** — always use `useConfirm()` hook from `UI.tsx`
- **Never use `<a href>`** for internal navigation — use React Router `navigate()`
- **Toast notifications**: Inline pattern (fixed position, auto-dismiss 4.5s), matching DispatchPage style
- **CSV export**: Use `downloadCSV()` from `lib/csv.ts`
- `useConfirm()` returns `{ confirm, dialog: confirmDialog }`. `confirm` is async (returns boolean), `confirmDialog` is JSX to render at bottom of component.

### State & Data
- **No global state library** — React context (auth) + local state + TanStack Query
- API client in `lib/api.ts` — `ApiClient` class wrapping fetch with Bearer token
- Token stored in localStorage via `useAuth` hook

## Shared

- **Zod schemas mirror TypeScript types**. Use `z.infer<typeof XxxSchema>` for input types rather than defining separate interfaces.
- `computeTripTotals()` is pure — no I/O, all rates passed as args. Used identically by backend and frontend.
- `round2dp()` uses `Number(Math.round(parseFloat(n+'e2'))+'e-2')` form.

## General

- **All audit log messages in Vietnamese** — no English in user-facing audit trails.
- **Currency**: Vietnamese Dong (VNĐ), no decimals. Use `lib/format.ts` formatters.
- **No test runner or linter configured** in the project. No CI pipeline.
- Pre-existing TS errors in `tripClient.ts` — route path constants (`TRIPS`, `CATALOGS`, `REPORTS`, `CONFIG`) not exported from shared.
