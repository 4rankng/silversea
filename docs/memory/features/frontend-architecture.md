---
name: "frontend-architecture"
description: "Contains the frontend two-layer architecture rules, cross-feature helper placement, and the journey-board tag-pool embedding contract"
folder: "features"
tags: ["frontend", "api-layers", "tanstack-query", "design-system", "conventions"]
updatedAt: "2026-09-11T03:30:13.066Z"
author: "Full-Stack Developer"
---

# Frontend architecture (migrated from frontend/docs/api-layers.md + adding-a-page.md + design-system.md, 2026-09-10)

## Architecture: two-layer API split (not three)

```
src/api/*Client.ts  → domain endpoint bundles (tripClient, configClient, driverClient, financialClient, forwarderClient, salaryClient, reportClient, userClient…). Each method = typed path wrapper over lib/api. **ADD ENDPOINTS HERE.**
src/lib/api/client.ts → singleton `api` transport (fetch; Bearer via hooks/useToken; JSON/multipart/blob; typed ApiError; Vietnamese Zod error translation in lib/api/errors.ts). **Pages never call fetch() directly.**
src/api/keys.ts → `qk` TanStack Query key factory (typed parameterised keys, hierarchical prefixes for broad invalidation, compile-time guard that all catalog keys are invalidated). **Always qk.*, never literal ['foo'] keys.**
src/hooks/useXxxQueries.ts → domain-bucketed query/mutation hooks with right staleTime. **Pages consume hooks, never raw useQuery** (unless wrapping a one-off endpoint).
src/pages/ + src/features/ → route entry (thin, ≤200 LOC, no business logic) composing feature components + design-system primitives. Feature folders own their hooks/components/types.
```

**New endpoint decision flow:** 1) path constants in `@tingting/shared` (`shared/src/constants/`, re-export from index) → 2) method in matching `api/*Client.ts` typed with shared shapes → 3) hook in `hooks/useXxxQueries.ts` (or co-located under `features/X/`) using `qk.*` → 4) key-factory entry in `api/keys.ts` (+ add prefix to `qk.allCatalogKeys` if catalog-like) → 5) thin page.

**Adding a page recipe:** route entry `src/pages/XxxPage.tsx` (≤200 LOC); feature components `features/X/components/`; cross-cutting primitives `src/design-system/`; layout shells `src/components/`. Lazy import + `<Route path element={adminOnly(page(<X />))} />` in App.tsx. List pages: `useTableQueryState` + `DataTable` + `Pagination` + `EmptyState`. Co-located CSS `XxxPage.css` imported only by the page. Semantic Vietnamese labels via `*_LABELS` maps from `@tingting/shared`.

**Don'ts:** no new client under `lib/api/`; no raw `localStorage.getItem('token')` (use `getToken()` from design-system `useToken`); no literal queryKeys; no fetch in pages; no duplicate inline SVG for lucide icons.

## Conventions: dispatch cursor pagination invariants

`dispatchPlanningClient.ts` endpoints use cursor pagination end-to-end:
- flat `{ items, total, limit, nextCursor }` response; `total` is authoritative (never infer from limit/items.length).
- `nextCursor` is opaque — pass through unchanged, never parse/derive.
- `getDispatchFleet()` fans out 3 requests (TRUCK, DRIVER, EXTERNAL_CARRIER); each keeps its own pagination stream + cache state.
- Search filters ride the same cursor stream as the list they refine — never reuse one cursor across different search terms or resource types.
- Backend `dispatch-fleet` route requires explicit `resource` query param; keep that contract client-side.
- If the contract changes, update client tests + backend route/service together.

## Design-system import surface

`src/design-system/` is the canonical home for cross-cutting UI primitives (Pagination, DataTable, EmptyState, TextField, SelectField, NumberField, CrudFormModal, hooks: useDebouncedValue, useToken, useAuthedQuery, useMonthRoute, useTableQueryState, useSalaryPeriod). Import via `@/design-system`.

**Add a primitive when:** same JSX shape duplicated 3+ files, no business logic (props-driven), testable in isolation. **Don't** when: one-feature-specific (→ `features/X/components/`), depends on auth context/specific query/domain types, or is a page-specific layout shell. Migration to primitives is incremental, page by page.

Untitled UI React components live under `src/components/untitled-ui/` (version-8 pinned) — compose them through the product design system; edit a shared UUI primitive only when behavior should change for every consumer. Retrieval procedure: skill `untitled-ui-component-workflow`.

See [[design-system-contracts]] for the density/pairing/color/datetime contracts, and [[agent-working-contract]] for repo-wide rules.

## M1 coupling dissolution (ticket 53a536f9, commit 320aad6b, 2026-09-11)

- The driver journey-board response (`GET /driver/me/journey-board`) embeds `knownTagLabels[]` — the active dispatch-task-tag pool in canonical display_order, from the same `listDispatchTaskTags()` query. Driver chips resolve from the board; the driver portal makes NO tag-pool fetch.
- `parseNote`/`composeNote` live in `frontend/src/lib/dispatchTaskTags.ts` (moved from features/dispatch/detailed-plan). Pages must not import from `features/` — cross-feature pure helpers go in `lib/`.
- The DRIVER casbin bypass on `/shipments/dispatch-task-tags` (B1) is REMOVED: the tag pool is dispatcher-only. RBAC pin: driver GET → 403 (dispatch-detail-plan.test.ts). journey-board `knownTagLabels` contract pinned in driver-journey-board-fields.test.ts.
- Deploy-skew contract: FE defaults missing `knownTagLabels` to `[]` — chips degrade to plain note text during a skew window, never crash.
- LOC ratchet caution: `frontend/src/api/driverClient.ts` sits at its 656/656 ceiling; DispatchPlanEditorCell.tsx at 792/792. Both need reviewed bumps before further growth.
