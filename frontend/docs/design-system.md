# Design System

The `src/design-system/` folder is the canonical home for cross-cutting UI
primitives. Pages should import from here rather than reaching into
`components/UI` or rolling their own.

## Import surface

```ts
import {
  // Primitives
  Pagination, DataTable, EmptyState,
  TextField, SelectField, NumberField, CrudFormModal,

  // Hooks
  useDebouncedValue, useToken, useAuthedQuery, useMonthRoute,
  useTableQueryState, useSalaryPeriod,
} from '@/design-system';
```

## What's where

| Folder | What lives here |
|---|---|
| `Pagination.tsx` | Page navigation: windowed numbers, prev/next, optional summary line |
| `DataTable.tsx` | Generic table with desktop + mobile card render, loading, empty, pagination |
| `EmptyState.tsx` | Title / description / illustration / action block |
| `forms/TextField.tsx` | Labelled input with prefix/suffix/error/help text |
| `forms/SelectField.tsx` | Labelled select |
| `forms/NumberField.tsx` | Numeric input that emits `number | ''` to onChange |
| `forms/CrudFormModal.tsx` | Modal-wrapped CRUD form with render-prop children |
| `hooks/useDebouncedValue.ts` | Debounce any value |
| `hooks/useToken.ts` | Centralised localStorage JWT access |
| `hooks/useAuthedQuery.ts` | `useQuery` wrapper that 401s to `logout()` |
| `hooks/useMonthRoute.ts` | URL-state-backed month selector (replaces `MonthProvider`) |
| `hooks/useTableQueryState.ts` | All-in-one state for paginated list pages |
| `hooks/useSalaryPeriod.ts` | Re-export of the salary-period query |

## When to add a primitive here

Add a primitive to `design-system/` when:

1. The same JSX shape is duplicated in 3+ files.
2. The component has no business logic of its own (it accepts data via props).
3. The component can be reasonably tested in isolation.

**Don't** add a primitive here if:

- It's specific to one feature (use `features/X/components/` instead).
- It depends on auth context, a specific query hook, or specific domain types.
- It's a layout shell for a particular page.

## When to use a primitive

Use a design-system primitive when the page needs that pattern. The
following list maps pages to their target primitives:

| Page | Use these primitives |
|---|---|
| `TripListPage` | `DataTable`, `Pagination`, `useTableQueryState`, `useDebouncedValue`, `EmptyState` |
| `CustomersPage`, `SupplierListPage`, `DebtListPage`, `PayableListPage` | Same as above |
| `FleetPage`, `ConfigPage` | `CrudFormModal`, `TextField`, `SelectField`, `NumberField` |
| `AuditLogPage` | `DataTable` with `useInfiniteQuery` pattern |
| `LoginPage` | `TextField` |

The migration from per-page implementations to primitives is incremental.
Migrate one page at a time; the primitives are designed to be drop-in
replacements for the most-copied snippets, not a full rewrite.

## Untitled UI source

Untitled UI React components live under `src/components/untitled-ui/` and are
retrieved with the pinned version-8 workflow in
[`untitled-ui.md`](./untitled-ui.md). Use those accessible source primitives as
the component layer, then compose them through the product-specific design
system and feature modules above.

## Control density contract

Control size is owned by the shared primitive, never by page CSS:

| Variant | Desktop use | Desktop height | Narrow-screen minimum |
|---|---|---:|---:|
| `sm` | Operational filters, table toolbars, compact utility actions | 34px | 44px |
| `md` | Forms and ordinary page actions | 40px | 44px |
| `xs` button | Low-emphasis inline utilities | 28px | 44px |

The canonical CSS tokens are `--control-compact-h`, `--control-default-h`, and
`--control-touch-h`. Pages may arrange controls and set widths, but must not
override their height, internal padding, font size, or icon size. Choose the
semantic `size` prop instead. This keeps legacy controls and Untitled UI inputs,
selects, and buttons on the same rhythm across routes.

Compact field typography is shared too: `sm` fields use 12px on desktop and
14px at narrow widths, while retaining the 44px touch target. Page styles must
not override that type scale with `font`, `font-size`, or `line-height`; correct
the shared Untitled UI primitive when a compact field is inconsistent.
