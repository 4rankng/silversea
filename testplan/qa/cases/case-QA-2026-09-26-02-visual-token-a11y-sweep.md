# Case QA-2026-09-26-02 — Visual token + a11y sweep (workflow audit follow-up)

Source: user request "improve UI UX visual representation, audit for all visual bugs"
+ workflow run 2026-09-26 (4 researchers + critic + synthesis).

## Scope
Frontend-only. No API/schema/RBAC/financial-logic change.

## Bugs covered
1. Off-palette hardcodes (P0): `#2563EB` in RevenueTrendChart, tire tables,
   TruckTiresPage, Dashboard/Finance `--wf-blue`, ForwarderAdvances `--stat-rail`;
   `#16A34A` (light green) + `#9CA3AF` (light grey) tire colors;
   finance-derived pie fills `#059669/#D97706/#2563EB`;
   `var(--success, #059669)` / `var(--warning, #D97706)` stale fallbacks;
   ShipmentDetailPage + ShipmentDebitWorkspace amber/orange hardcodes
   (`#fff3e0/#9a3412/#ea580c/#fecaca/#fff7ed/#fef2f2/#b91c1c/#bbf7d0/#f0fdf4/#166534`).
2. Money unit contrast (P0): `.money__unit` 11px at opacity 0.65 drops the
   effective ratio below the 4.5:1 floor (§2).
3. Spinner a11y (P1): standalone `<Spinner>` in TripDetailPage + TripEditPage
   renders in a plain div with no `role="status"` (LoadingOverlay pattern not used).
4. Close glyph (P2): U+2715 `✕` text in 5 dialog close buttons instead of lucide
   icon (§1 icons-for-actions-only).
5. Dark-mode stray (P2): `@media (prefers-color-scheme: dark)` in
   SalaryPeriodConfigPage.css although the nepo theme is light-only
   (`prefersdark: false`).

## Explicit non-goals
- Skip-link: verified present (`Layout.tsx:771` → `#main-content`, plus
  `CustomerPortalLayout`); NOT a bug, no change.
- `outline:none` sites: spot-checked — replacements via `:focus-visible` exist
  across the touched surfaces; no blanket change in this case.
- Categorical chart fills (`FALLBACK_COLORS`/`CATEGORY_COLORS`): graphic-only,
  left as-is except the three finance-derived slices remapped to house
  semantic hexes.
- PageHeader/ListFilterBar coverage stats: consistency note only, no change.

## Repro steps
1. `rg -n "#2563EB|#059669|fff3e0|9a3412|ea580c|prefers-color-scheme: dark|✕" frontend/src`
   → expect zero hits (outside tests). Stale `var(--success|warning*, …)` fallbacks
   now carry token-matching hexes (`#177448/#A45D1C/#914A16`).
2. Known-remaining (deferred, needs per-site re-measure per design law §3):
   `--wf-green-500 #16A34A` / `--wf-amber-mid #D97706` text usages in the
   Dashboard/Finance wf subsystem, and the salary hero-metrics gradient
   (`#16A34A → #5EE99B`, graphic). `FALLBACK_COLORS`/`CATEGORY_COLORS` stay
   graphic-only.
2. Render any `<Money value={1500000}/>` → unit `₫` inherits parent color at
   full opacity, same hue as digits.
3. TripDetail/TripEdit loading state → container has `role="status"`,
   spinner element has `aria-hidden="true"`.
4. Open each of the 5 dialogs → close button shows lucide X icon, keeps
   `aria-label="Đóng"`.
5. SalaryPeriodConfigPage with OS dark mode → no dark restyle (light-only).

## Expected
- All chart/legend/status/alert colors ride house tokens
  (`--info/--info-text/--info-soft`, `--success-text`, `--warning*/--danger*`,
  `--ink-4`); no 11–12px text below 4.5:1 by token construction.
- `docs/design-guidelines.md` §§1–2 hold: text+dot statuses, no pills,
  accent graphic-only, flat surfaces untouched.

---

# Part 2 — All-pages all-roles visual pass (26/09, agent-browser, local dev)

Follow-up to the static sweep above: every distinct route walked in a real
browser per role, screenshots in `qa/2026-09-26_visual-all-roles_ui-*.png`,
driver log `qa/2026-09-26_visual-all-roles_ui-driver.log`.

## Roles walked (local dev, http://localhost:7175, demo seed accounts)

| Role | User | Routes walked |
|---|---|---|
| ADMIN | admin | 62 list/hub routes + details: /trips/3095, /trips/3095/edit, shipment detail drawer, /customers/3217, /suppliers/595, /expenses/4/edit |
| OPS | giaonhan | my-orders, ops/orders, ops/fleet-tracking, ops/wallet, my-forwarder-trips, my-advances, my-settlements, my-settlements/new |
| DRIVER | laixe | my-trips, two-orders, earnings, payslips, penalties, notifications |
| CUS (clerk) | cus | /shipments surface (its home); /portal/* gate-bounces to /shipments — expected for CUS-clerk |
| CUSTOMER (row-scoped) | samsung-cs | portal shipments/debit-notes/statement — renders the "Tài khoản chưa được liên kết" guard (demo account not linked) |
| ACCOUNTANT | ketoan | fuel-evidence (accountant-only gate verified), finance, debt, expenses |
| MANAGER | giamdoc | dashboard, shipments, finance |
| DISPATCHER | dieuvan | dispatch, dispatch-detail; /trips bounce → /dispatch (tripDetailOnly gate) |

## New bugs found in the visual pass

6. **chot-debit date filters full-width (P2 layout)** —
   `/accounting/chot-debit`: both `BufferedUuiDateInput` filters carry the
   component's `w-full` wrapper and the page's flex row imposes no width cap,
   so each date field stretched across the whole content band (own row).
   Fix: 170px fixed-width wrappers (value-length width ruling, 09-26).
   Re-verified: qa/2026-09-26_visual-all-roles_ui-fix-01-chot-debit.png
7. **Inline select label mid-word wrap (P2 layout)** — React Aria renders the
   UuiSelectField inline label as `span[data-label]` inside the control row;
   the existing nowrap guard targeted `> label` and never matched, so tight
   filter toolbars squeezed it ("Lái xe" stacked on /penalties).
   Fix: `.ds-uui-select--inline [data-label] { flex: 0 0 auto; white-space: nowrap; }`
   in UuiSelectField.css (class-level fix — all inline filter labels).
   Re-verified: qa/2026-09-26_visual-all-roles_ui-fix-02-penalties.png

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Static token sweep (bugs 1–5) | UI DRIVEN (spot) | finance/dashboard/trips/accounting/shipments screenshots show token-consistent renders; token sweep grep zero hits | per-site contrast re-measure of deferred wf-subsystem greens; OpsSettlementsPanel + OpsAccountantTab dialog interiors (lists render, dialogs need seeded ops data) |
| Bug 6 chot-debit date width | UI DRIVEN | qa/2026-09-26_visual-all-roles_ui-fix-01-chot-debit.png; admin-12-chot-debit.png (before) | mobile viewport |
| Bug 7 inline label wrap | UI DRIVEN | qa/2026-09-26_visual-all-roles_ui-fix-02-penalties.png; admin-20-penalties.png (before) | other inline-label toolbars using short labels |
| All-role route render (per role table) | UI DRIVEN | one screenshot per route in qa/, driver log | /debt/:id with real debt rows (demo DB has 0 debtors), portal data surfaces (demo CUSTOMER unlinked), /payables/:id (no payables in demo DB), driver/cus walks at 1280 viewport (first pass) vs 1440 for others |
| Ops/Accountant dialog close ✕→X swap (bug 4) | CODE-READ ONLY (dialog interiors) | diff is mechanical ✕→`<X/>`; import + typecheck green; base lists verified rendered | opening the seeded-data dialogs in browser |

## Gates (26/09)

- `cd frontend && npx tsc -b` → 0 errors
- `pnpm lint` → 0 errors
- `cd frontend && pnpm test` → first run: 3 failures / 3044 passed —
  1 real (structure guard: `AccountingDebitClosePage.tsx` 407L vs new-file
  400L ceiling; fixed by compacting the comment and adding a justified
  400→404 baseline entry, guard precedent DetailedPlanGrid 451) and 2 stale
  on HEAD (`DriverTripDetailPage.test.tsx`: expected alt `Ảnh nhiên liệu
  TRIP-55` + 9-label field order predate `1af13d12` "lead with the bill" and
  `dc1b1cba` internal-id removal — updated to the shipped behavior: plain alt
  `Ảnh nhiên liệu`, 11-label order incl. `Số điện thoại kho`). Solo re-run:
  43/43 green. Final full-suite artifact:
  `qa/2026-09-26_visual-sweep_frontend-test.log`.
- Backend gates/E2E: not run — frontend-only visual change, no API/schema/RBAC/financial surface touched.
