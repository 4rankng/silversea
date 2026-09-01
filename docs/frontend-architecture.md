# Frontend Architecture

How the `frontend/` React 19 + Vite app is structured, and the rules that keep it
extendable. The backend twin is [`backend-architecture.md`](backend-architecture.md);
both are enforced by tests where stated. Last updated 2026-09-01 (structural wave
`plans/260901-1622-frontend-extensibility-change-wave/`).

## Layer map

```
main.tsx ─ QueryClientProvider (focus off · retry off · staleTime 5min) + BrowserRouter
└─ App.tsx ─ 85 lazy routes (URLs are user-facing contracts; never rename one casually)
   ├─ pages/         ── thin route shells: URL-param parsing + composition + page CSS
   ├─ features/<domain>/ ── the real surface: state hooks, pure models, row/panel leaves
   ├─ api/*Client.ts ── thin typed transport over lib/api/client (auto idempotency keys,
   │                    session-expiry, token cache). No business logic.
   ├─ api/keys.ts    ── `qk` TanStack key factory — the ONLY place query keys are spelled
   ├─ hooks/use*Queries.ts ── react-query read hooks per domain
   └─ components/    ── cross-domain primitives (UI.tsx barrel) + shared composites
```

Reference implementations to copy: `features/accounting/` (components + models +
queries + url-state + index barrel), `features/shipments/cus/` (workboard: state
hook on react-query + quick-edit model + export + row leaf), `features/users/components/`.

## Rules

1. **Pages are shells.** A page file parses URL state, composes feature leaves, owns
   its CSS import — nothing else. Logic lives in `features/<domain>/`. The structure
   guard (`src/tests/structure.guard.test.ts`) freezes every oversized file at its
   current size (ratchet only shrinks) and caps NEW files at 400 lines.
2. **Server state goes through react-query + `qk`.** New list/detail reads use
   `useQuery` with a `qk.<domain>` key. Hand-rolled `requestSequence` race guards are
   legacy — do not add more. When a surface has live-tuned refresh semantics, encode
   them as per-query options and lock them with a config test (see
   `use-cus-workspace-state.ts` + its test for the 30s-poll / focus-'always' /
   keepPreviousData pattern that fixed the 27.8 trial staleness regression).
3. **Mutations carry `expectedVersion` + idempotency keys.** The transport
   (`lib/api/client.ts`) auto-keys un-keyed mutations; flows that need replay
   semantics manage signature-keyed ids explicitly (see `use-cus-workspace-state`'s
   `getIdempotencyKey`).
4. **Status vocabulary is shared.** Workflow-status labels come from
   `@tingting/shared` `*_LABELS` — never re-spell them locally. Parity is guarded by
   `src/lib/status-vocab-parity.test.ts` (enum↔label completeness). Known divergent
   wordings are inventoried in that test's docblock as open product decisions.
5. **Dates/currency come from `lib/format.ts`.** The formatter-clone ban in the
   structure guard allows only the documented intentional variants (midnight-normalized
   CUS dates, print precision, host-local tables) and delegating wrappers.
6. **One surface, one unambiguous name.** Route files match their route's intent
   (`ShipmentContainersPage` serves the container workboard; `ShipmentDetailPage`
   serves `/shipments/:id`). Grab-bag `*-components.tsx` files belong in their
   feature dir, not `pages/`.

## UI systems (codified, not consolidated)

Five styling layers coexist deliberately; mass migration is a visual-regression risk
on P0 surfaces, so pick by context instead:

| Layer | Use for |
|---|---|
| `components/UI.tsx` primitives (Btn, Modal, Drawer, Panel, KPI…) | default building blocks |
| `components/untitled-ui/*` + `design-system/` (UUI fields) | form controls inside UUI-styled surfaces (CUS worksheet, drawers) |
| Page CSS (per-page files) | layout + surface-specific styling; imports live in the page shell |
| Global tokens (`styles/theme.css`) | colors/spacing/typography — never hardcode what a token owns |
| daisyui utilities | legacy; no NEW usage on operational surfaces |

CSS contracts are machine-checked: `pnpm --dir frontend check:ui` (font-size token
drift, frozen-CSS prefixes) + `check:brand`. `docs/design-guidelines.md` owns sizing.

## Adding a page (the path)

1. Route in `App.tsx` (lazy import; role-gated wrapper if needed).
2. `pages/FooPage.tsx` — shell only: URL params, `useFoo*` hook, page CSS import.
3. `features/foo/` — `use-foo-*.ts` (react-query reads via a new `qk.foo` entry +
   `keys.test.ts` case), pure `fooModel.ts` for payload/diff rules (unit-tested),
   presentation leaves.
4. Labels from shared `*_LABELS`; dates/currency from `lib/format`.
5. Gates: `tsc -b`, `vitest`, `pnpm --dir frontend lint`, `check:ui`, `make build`
   (see AGENTS.md for the full table + `qa/` artifacts).

## Known debts (tracked, not hidden)

- Baseline-grandfathered oversized files — the ratchet list in the structure guard.
- `ForwarderTripDetailPage` (single 1005L component), `SalaryAttendancePage`,
  `FinancePage` — next split wave; characterization-first like the CUS split.
- Divergent status wordings (TripPod, container dispatch) — product decision pending,
  inventoried in the parity test docblock.
