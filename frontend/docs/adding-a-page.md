# Adding a new page

This is the recipe for adding a route entry. Follow it to keep the codebase
consistent.

## 1. Choose the right folder

| What kind of page | Where it goes |
|---|---|
| Route entry (the `<Route element={...}>` payload) | `src/pages/XxxPage.tsx` |
| Reusable business component for a domain | `src/features/X/components/` |
| Cross-cutting UI primitive | `src/design-system/` |
| Shared layout shell (sidebar, topbar) | `src/components/` |

A page file should be **≤ 200 LOC** and should not contain business logic.
It composes feature components, reads URL params, and wires hooks to UI.

## 2. Add the route

In `src/App.tsx`, add a lazy import alongside the existing ones and a
`<Route path="/your-path" element={...} />`. Choose the appropriate role
guard (most pages are `adminOnly`).

```tsx
const MyNewPage = lazy(() => import('./pages/MyNewPage'));
// ...
<Route path="/my-page" element={adminOnly(page(<MyNewPage />))} />
```

## 3. Build the data layer

### 3a. If this is a new domain

1. Add endpoint constants in `shared/src/constants/`.
2. Add a new client in `src/api/myClient.ts`:
   ```ts
   import { api } from '../lib/api';
   import { MY } from '@tingting/shared';
   export const myClient = {
     list: () => api.get<MyItem[]>(MY.LIST),
     // ...
   };
   ```
3. Add a key-factory section in `src/api/keys.ts`:
   ```ts
   myDomain: {
     all: ['my-domain'],
     detail: (id: number) => ['my-domain', id] as const,
   }
   ```
4. Add a hook file `src/hooks/useMyDomainQueries.ts` using `qk.myDomain.*`.

### 3b. If this is a list over an existing endpoint

Use `useTableQueryState` from `design-system/`. It owns the search/filters/
page/pageSize state and the underlying `useQuery`. Combine with `DataTable`
for the table.

```tsx
import { useTableQueryState, DataTable, Pagination, EmptyState } from '@/design-system';
import { tripClient } from '../api/tripClient';
import { qk } from '../api/keys';

const table = useTableQueryState<TripDetail>({
  endpoint: tripClient.listTrips,
  queryKey: qk.trips.list(),
  defaultPageSize: 25,
});

return (
  <DataTable
    data={table.rows}
    columns={tripColumns}
    pagination={{ page: table.page, totalPages: table.totalPages, onChange: table.setPage, totalItems: table.total, pageSize: table.pageSize }}
    emptyState={<EmptyState title="Không có chuyến" />}
    onRowClick={(t) => navigate(`/trips/${t.id}`)}
  />
);
```

## 4. Build the UI

- Use design-system primitives first. Only roll your own if the primitive
  doesn't exist and the pattern will be repeated 3+ times.
- Co-locate page-specific CSS using a single CSS file: `MyNewPage.css`
  imported only by `MyNewPage.tsx`.
- Use semantic Vietnamese labels. For status text, prefer the
  `*_LABELS` maps from `@tingting/shared` over hard-coded strings.

## 5. Verify

```bash
cd frontend
npx tsc --noEmit    # no type errors
pnpm test           # existing tests still pass
pnpm build          # production build succeeds
```

## What NOT to do

- ❌ Don't add a new client under `lib/api/`. The two-layer split is:
  `lib/api/client.ts` (transport) + `api/*Client.ts` (domain bundles).
- ❌ Don't use raw `localStorage.getItem('token')`. Use `getToken()` from
  `design-system/hooks/useToken`.
- ❌ Don't write a `queryKey: ['foo', ...]` literal. Add a factory in
  `api/keys.ts` and use `qk.foo`.
- ❌ Don't fetch in a page. Use a hook from `src/hooks/`.
- ❌ Don't import the same lucide-react icon twice inline as SVG.
