# Frontend Architecture Layers

This document explains the two-layer API architecture used in the TingTing
frontend so contributors know where to add endpoints, hooks, and pages.

## Two layers, not three

```
┌────────────────────────────────────────────────────────────────┐
│  src/api/*Client.ts          (domain endpoint bundles)         │
│  ──────────────────                                            │
│  Exports one object per backend domain:                        │
│    tripClient, configClient, driverClient, financialClient,   │
│    forwarderClient, salaryClient, reportClient, userClient.   │
│                                                                │
│  Each method calls `api.get(...)` / `api.post(...)` from       │
│  `lib/api`. Methods are TYPED with shapes from @tingting/shared│
│  and know the path string.                                     │
│                                                                │
│  → ADD ENDPOINTS HERE.                                         │
└────────────────────────────────────────────────────────────────┘
                              │ uses
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  src/lib/api/client.ts        (HTTP transport)                 │
│  ─────────────────────                                         │
│  Singleton `api` class wrapping `fetch`.                       │
│  - Bearer-token auth (delegated to hooks/useToken)             │
│  - JSON content-type, multipart upload, blob/text downloads    │
│  - Centralized error parsing → typed ApiError                  │
│  - Vietnamese Zod error translation (lib/api/errors.ts)        │
│                                                                │
│  → DO NOT call `fetch()` directly from pages.                  │
└────────────────────────────────────────────────────────────────┘
                              │ uses
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  src/api/keys.ts              (TanStack Query key factory)     │
│  ─────────────────                                              │
│  The `qk` object centralises every queryKey with:              │
│  - typed factories for parameterised keys                      │
│  - hierarchical prefixes for broad invalidation                │
│  - compile-time guard that all catalog keys are invalidated    │
│                                                                │
│  → ALWAYS use qk.* in useQuery / invalidateQueries.            │
│  → Add a key here whenever you add a new query hook.           │
└────────────────────────────────────────────────────────────────┘
                              │ uses
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  src/hooks/useXxxQueries.ts   (TanStack Query hooks)           │
│  ────────────────────────────                                  │
│  Domain-bucketed query + mutation hooks.                       │
│  Thin wrappers around `useQuery` with the right                │
│  `queryKey` and staleTime.                                     │
│                                                                │
│  Pages consume these hooks. Pages do NOT call `useQuery`       │
│  directly unless wrapping a one-off endpoint.                  │
└────────────────────────────────────────────────────────────────┘
                              │ uses
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  src/pages/  +  src/features/  (route entry / feature UI)      │
│  ────────────────────────────                                  │
│  pages/XxxPage.tsx is the route entry. Each one is composed    │
│  from feature components in `features/X/` and primitives in    │
│  `src/design-system/`.                                         │
│                                                                │
│  Feature folders own their own hooks, components, and types    │
│  for a specific domain (e.g. features/trips/). They import     │
│  from `api/`, `hooks/`, and `design-system/`.                  │
└────────────────────────────────────────────────────────────────┘
```

## Decision flow for a new endpoint

1. **Path constants** live in `@tingting/shared` (e.g. `TRIPS.LIST`).
   Update `shared/src/constants/` and re-export from `shared/src/index.ts`.

2. **Endpoint method** goes in the matching client:
   `src/api/tripClient.ts` for trips, `configClient.ts` for catalog tables, etc.
   Type its input and output using shapes from `@tingting/shared`.

3. **Query / mutation hook** goes in `src/hooks/useXxxQueries.ts`
   (or a co-located file under `features/X/` if the hook is feature-specific).
   Use the `qk.*` factory for the query key; choose a sensible `staleTime`.

4. **Key factory entry** goes in `src/api/keys.ts`. Add a top-level
   sub-object (e.g. `myResource: { ... }`) and — if the data is catalog-like
   (changes infrequently and pages cache it) — add the prefix to
   `qk.allCatalogKeys` so `invalidateAllCatalogs` covers it.

5. **Page** consumes the hook. Pages must remain thin (≤ 200 LOC) —
   they compose feature components, not raw data plumbing.

## Pagination contracts to preserve

Dispatch planning endpoints in `src/api/dispatchPlanningClient.ts` use cursor
pagination end-to-end. Keep the client and backend aligned on these invariants:

- `listDispatchQueue`, `listDispatchHandoffs`, and `listDispatchFleetResources`
  all consume the flat `{ items, total, limit, nextCursor }` response shape.
- Treat `total` as authoritative. Do not infer it from `limit`, `items.length`,
  or a partially loaded page.
- Treat `nextCursor` as opaque. Pass it through unchanged to the next request;
  do not parse, normalize, or derive meaning from it.
- `getDispatchFleet()` fans out three independent requests for `TRUCK`,
  `DRIVER`, and `EXTERNAL_CARRIER`. Each resource keeps its own pagination
  stream and cache state.
- Search filters ride the same cursor stream as the list they refine. Do not
  reuse one cursor across different search terms or resource types.
- The backend `dispatch-fleet` route requires an explicit `resource` query
  parameter. Keep that contract in the client rather than synthesizing a
  default on the server.

If this contract changes, update the client tests and the backend route/service
together so pagination behavior stays explicit and regression-safe.

## Why two API layers (not one)?

| Need | Where it lives | Why |
|---|---|---|
| Auth header, error parsing, JSON encoding | `lib/api/client.ts` | Single transport; changing how we talk to the backend touches one file |
| Endpoint path, request/response typing, Zod schemas | `api/*Client.ts` | Each domain stays in its own file; co-locates its types |
| Query key, staleTime, refetch policy | `hooks/useXxxQueries.ts` + `api/keys.ts` | TanStack-specific concerns; refactor-friendly |

If we collapsed everything into a single `api/axiosClient.ts` and let pages
call it directly, we'd lose the type-safety benefit of grouping endpoints
by domain, and we'd scatter query keys across 60 page files.
