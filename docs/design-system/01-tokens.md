# 01 — Tokens
> **Counter of record.** The numbers below come from the 2026-09-27 audit greps (basis stated per
> section). The *ratchet* is authoritative for regressions: `cd frontend && pnpm design:drift`
> measures 179 page CSS files and fails on any increase over `frontend/design-drift.baseline.json`.
> Its 2026-09-27 baseline: 269 direct hex, 731 hex fallbacks, 98 off-ladder radii, 65 raw
> `box-shadow`, 85 raw `z-index`, 213 untokenized `transition`, 47 distinct `@media` widths, 21
> distinct `@container` widths. Fixing drift is free; adding it is a deliberate act.


The single source of values is `frontend/src/styles/tokens.css` (247 `--`
declarations in `:root`, plus a daisyUI theme bridge). This slice maps each
family to the members a page may use, the members that are legacy or
duplicated, and the raw values pages still write instead of a token.

Law and dates live in `docs/design-guidelines.md`; enforcement instruments are
listed in `./README.md`. All numbers below are counted from the tree
(`grep`/`find` over `frontend/src`), not estimated.

## Token families at a glance

| Family | Declared | App-wide `var()` refs | Verdict |
|---|---|---|---|
| `--bg*` + `--surface*` | 6 + 5 | 476 `surface`, 236 `surface-2`, 89 `surface-3`, 41 `bg-2`, 24 `bg-3`, 6 `bg` | `--surface*` is the live set; `--bg-1/2/3` are aliases |
| `--ink*` (4) / `--fg*` (6) | 4 + 6 | 744 `ink-3`, 614 `ink`, 383 `ink-2`, 361 `fg-3`, 218 `fg-1`, 188 `fg-2` | two parallel text ramps, both live |
| `--line*` (4) / `--border*` (4) | 4 + 4 | 673 `line`, 163 `line-2`, 115 `border-1`, 92 `border-2` | `--border-2` duplicates `--line-2` exactly |
| Status triads | 13 (+`--ok`,`--err`) | 321 `danger`, 100 `warning`, 82 `warning-text`, 75 `danger-text` | sanctioned; contrast-pinned |
| `--accent*` / `--brand*` | 4 + 6 | 332 `accent`, 228 `brand`, 97 `accent-soft`, 43 `accent-ink` | sanctioned |
| `--sb-*` (9) / `--sidebar*` (8) | 17 | 10 `sb-bg`, 7 `sb-text`, 5 `sidebar-w` | pure duplication |
| `--sh-*` (4) / `--shadow-*` (5) | 9 | 22 `sh-sm`, 6 `sh`, 4 `sh-lg`, 1 `sh-drawer` | all `none`; aliases unused |
| Type roles `--text-*-size` | 11 | 683 `caption`, 300 `data`, 255 `body`, 195 `label` | sanctioned scale |
| `--fs-*` legacy aliases | 14 | 323 `fs-xs`, 183 `fs-sm`, 115 `fs-2xs`, 23 `fs-md` | collapse to 6 distinct sizes |
| `--space-*` | 7 | 84 total | near-zero adoption |
| Radii `--r*` / `--app-radius*` | 4 / 5 | 60 `r-sm`, 40 `r`, 32 `app-radius-md`, 25 `app-radius-sm` | two ladders that disagree |
| `--z-*` | 12 | 51 (26 with a fallback) | rarely used outside overlays |
| Motion `--t-*` / `--ease*` | 4 / 3 | 76 `t-fast`+`t-normal` | <14% of transitions use them |
| Density `--control-*`(14) `--filter-*`(6) | 20 | 112 `control-touch-h`, 83 `control-compact-h`, 59 `filter-control-h` | sanctioned |
| `--ops-table-*` + `--ops-dialog-padding` | 12+1 | 32 `supporting-size`, 22 `meta-size`, 16 `primary-size` | sanctioned (`operational-table-typography.css`) |
| Accent ramp `--brass/--sage/--copper/--slate` | 4+3+1+6 | 5 pages only | legacy, page-local |
| daisyUI bridge `--color-*` etc. | 20+3+2+3 | via `d-*` primitives | mirrors the hand tokens |

---

### Page must never write a raw colour
- **Use** — the status triad + ramp tokens: `--success/-soft/-text`, `--warning/-soft/-text/-deep`, `--danger/-soft/-text`, `--info/-soft/-text`, `--accent/-soft/-ink`, `--brand/-hover/-soft`, `--ink/-2/-3/-4`, `--line/-2/-3/-strong`, `--surface/-2/-3` — `frontend/src/styles/tokens.css:101-176`
- **Never** — raw hex literals in page CSS: `frontend/src/pages/config/debit-note-template-editor.css:5` (`background: #f7faf8`), `:16` (`background: #fff`), `frontend/src/pages/salary-attendance/calendar.css:18` direct-value hex, plus 243 direct `prop: #hex` values total. Legacy Tailwind palette values bypassing the muted palette: `frontend/src/pages/AdminAdvanceSettlementsPage.css:72` (`--stat-ink: #1d4ed8`), `frontend/src/pages/config/config-page.css:762` (`background: #16a34a`), `frontend/src/pages/DebtDetailPage.css:1819` (`color: var(--fg-1, #111827)`), `:1844` (`var(--warning-text, #92400e)`), `frontend/src/pages/accounting/DepositRefundTrackerPage.css:32` (`var(--color-warning, #b45309)`), `frontend/src/pages/config/debit-note-template-editor.css:385` (`color: #111827`).
- **Divergence** — 1051 hex occurrences across 85 files under `frontend/src/{pages,features,components}/**/*.css` (excl. `styles/`, `untitled-ui/`): **243 direct `prop: #hex`**, **742 inside `var(--token, #hex)` fallbacks**. Worst files by occurrence: `features/dispatch/detailed-plan/DispatchPlanEditorCell.css` 89, `pages/ShipmentsPage.css` 80, `pages/config/debit-note-template-editor.css` 55, `pages/TruckTiresPage.css` 55, `features/dispatch/detailed-plan/DetailedPlanGrid.css` 55, `pages/DriverTripDetailPage.css` 43.
- **Enforced by** — `frontend/src/styles/operational-color-contract.styles.test.ts` (palette + no `#3B82F6|#EF4444` in shared constants; per-file audit of 10 surfaces), `frontend/src/styles/semantic-token-contrast.styles.test.ts` (`--ok`/`--err` aliases, 4.5:1), `frontend/src/styles/surface-ladder.test.ts` (status triad contrast + monotonic ramp). `frontend/scripts/check-ui-contract.mjs:163` bans raw hex **only** in `sharedColorFiles` (10 shared primitives).
- **Gap** — nothing checks raw hex in page CSS. Every non-listed page is free to mint `#16a34a` beside `var(--success)`.

### Surface and border ladder
- **Use** — `--surface` (white card/overlay), `--surface-2` (inset chips/fields/table heads), `--surface-3` (deep inset), `--bg` (page canvas), and the border ramp `--border-1 → --line → --line-2 → --line-3 → --line-strong` — `frontend/src/styles/tokens.css:101-119`
- **Never** — a second border name for the same value: `--border-2: #ADB9B3` (`tokens.css:152`) is byte-identical to `--line-2: #ADB9B3` (`tokens.css:115`) yet `--border-2` still draws 92 refs; `--border-1: #D1D9D4` (`:151`) differs from `--line: #C8D2CC` (`:114`), so the two ramps are not interchangeable. Canvas aliases `--bg-1/2/3` (`:126-134`) are re-pointed names for `--bg`/`#FFF`/`--surface-3` and still draw 71 refs.
- **Divergence** — 5 surface tokens + 4 canvas aliases + 8 border/line tokens for 2 conceptual ramps.
- **Enforced by** — `frontend/src/styles/surface-ladder.test.ts` (measured contrast per rung + strict monotonic order).
- **Gap** — no test forbids `--border-2` or the `--bg-*` aliases, so both ramps keep growing.

### Typography scale
- **Use** — the semantic roles: data **12px** `--text-data-size`, labels/captions **11px** `--text-label-size` / `--text-caption-size`, body **12px** `--text-body-size`, section titles **14px** `--text-section-size`, dialog titles **16px** `--text-dialog-title-size`, page titles **18px** `--text-title-size`, KPI/display numbers **20px** `--text-metric-size` / `--fs-display` — `frontend/src/styles/tokens.css:335-381`
- **Never** — raw px fonts in pages: `frontend/src/pages/config/customer-config-density.css:22` (`font-size: 26px` — not on any token), `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:607` (`font-size: 15px` — frozen dispatch, exempt). Legacy `--fs-*` role names (`tokens.css:348-359`) used instead of the semantic role: `--fs-2xs`/`--fs-xs`/`--fs-3xs` all resolve to 11px, `--fs-md` and `--fs-lg` both resolve to 14px. Raw direct values: 28 `font-size:<n>px` across `pages|features|components` CSS.
- **Divergence** — 28 raw font-size declarations over 14 files; `--fs-*` legacy aliases still carry 695 refs vs the 11 semantic roles.
- **Enforced by** — `frontend/scripts/check-ui-contract.mjs` `checkPageFontSizeDrift` (pages/: value must be in `{0,10,11,12,13,14,16,18,20,24}`), `checkTableTypeScale` (no `>=14px` inside `td`/`th` outside frozen prefixes), `frontend/src/styles/operational-table-typography.test.ts` + `global-sizing-contract.styles.test.ts` (ops role tokens), `frontend/src/styles/driver-portal-typography.styles.test.ts` (19 driver/portal/fleet files must use `var(--text-*-size)` and page titles `var(--text-title-size)`).
- **Gap** — the drift scan is scoped to `src/pages/` only; `src/features/` is unchecked (`check-ui-contract.mjs` comment says it "joins this scan in a later wave").

### Radii ladder
- **Use** — `--r-sm: 8px` (controls/buttons), `--r: 12px` (cards/panels), `--r-lg: 18px`, `--r-xl: 24px`; the house badge radius is a fixed `6px` (`.d-badge.d-badge`, `tokens.css:70-72`); `--app-radius-full` / `999px` is reserved for the status strip (`--status-strip-radius`, `tokens.css:293`) — never buttons/pills (`docs/design-guidelines.md` §1)
- **Never** — off-ladder literals: `frontend/src/pages/TruckTiresPage.css:300` (`border-radius: 14px`), `:225`/`:512` (`10px`), `:621` (`9px`), `frontend/src/pages/ForwarderTripsPage.css:43` (`9px`), `:90` (`10px`). The two ladders also disagree: `--r-lg: 18px` (`tokens.css:220`) vs `--app-radius-lg: 16px` (`:225`), and `--r-xl: 24px` (`:221`) vs `--app-radius-xl: 22px` (`:226`).
- **Divergence** — 818 raw `border-radius` values over 177 files. On-ladder/sanctioned: 8px ×222, 6px ×135, 12px ×79, 16px ×19, 18px ×7, 999px ×11, 24px ×1, 22px ×1 = **475**. Off-ladder: **343 (42%)** — 10px ×139, 4px ×45, 14px ×43, 9px ×31, 7px ×25, 2px ×19, 5px ×15, 3px ×9, 11px ×4, 20px ×4, 99px ×6, 13px ×1, 32px ×1, 100px ×1. Worst: `pages/config/debit-note-template-editor.css` 32, `pages/DashboardPage.css` 31, `pages/ForwarderSettlementsPage.css` 25.
- **Enforced by** — `frontend/scripts/check-ui-contract.mjs` bans colored left borders and the 4×32 rail; `frontend/src/styles/badge-radius.styles.test.ts` pins the 6px badge radius. **No test checks page radii.**
- **Gap** — nothing enforces the ladder, and `--app-radius-lg/-xl` give two valid answers for one rung.

### Spacing scale
- **Use** — `--space-xs 4` / `-sm 8` / `-md 12` / `-lg 16` / `-xl 24` / `-2xl 32` / `-3xl 48` (`tokens.css:230-236`)
- **Never** — raw px rhythm beside them: 1973 raw `padding*: <n>px` and 2018 raw `gap: <n>px` declarations under `pages|features|components`; most common raw paddings are 10px ×278, 12px ×250, 8px ×220, 14px ×120 — i.e. off the 4px scale.
- **Divergence** — the whole family is used **84 times app-wide** against ~3991 raw spacing declarations. It is effectively dead law.
- **Enforced by** — — none.
- **Gap** — undocumented inverse of `--space-2/3/4` (undeclared: 4 refs, `space-2/3/4` appear only as `var(--space-2, …)` fallbacks).

### Elevation and shadows
- **Use** — the flat-surface law: `--sh-sm`, `--sh`, `--sh-lg`, `--sh-drawer` are all `none` (`tokens.css:202-205`); hierarchy comes from the surface ladder and borders (`docs/design-guidelines.md` §3).
- **Never** — bespoke shadows: 125 raw `box-shadow` declarations under `pages|features|components` (excl. `none` and `var(--sh*)`). Worst: `frontend/src/pages/config/debit-note-template-editor.css:51` (`0 10px 28px rgba(0,63,34,.08)`) and `:475` (`inset 3px 0 0 var(--ink)`), `frontend/src/pages/DebtDetailPage.css` ×17, `frontend/src/pages/ShipmentsPage.css` ×11.
- **Divergence** — 125 raw shadow declarations vs 33 token refs (`--sh-sm` 22, `--sh` 6, `--sh-lg` 4, `--sh-drawer` 1).
- **Enforced by** — — none for page shadows. (`design-lock` records some computed chrome values.)
- **Gap** — the shadow aliases `--shadow-card`, `--shadow-md`, `--shadow-elevated`, `--shadow-brand` (`tokens.css:207-211`) have **0 refs**: four dead names nobody checks, so nothing would fail if someone "fixed" a flat surface with them.

### Motion
- **Use** — `--t-fast: 120ms var(--ease)`, `--t-normal: 180ms`, `--t-slow: 240ms`, `--t-spring: 300ms var(--ease-spring)`; curves `--ease`, `--ease-spring`, `--ease-drawer` (`tokens.css:317-324`). Entrance keyframes are shared `tt-*` in `frontend/src/styles/animations.css`.
- **Never** — bespoke durations: 248 `transition:` declarations under `pages|features|components`, only **34 (14%)** use `var(--t-*)`; 212 hardcode a duration. Most common raw: `120ms` ×105, `0.15s` ×70, `150ms` ×44, `140ms` ×32, `180ms` ×16, `0.2s` ×16 (examples `frontend/src/pages/DashboardPage.css:40` `transition: width 0.6s ease`, `:160`, `:224`). 35 bespoke `@keyframes` outside `styles/` (33 unique) duplicate the shared set — `spin` ×3, `fade-up`, `slideUp`, `skeleton-shimmer`, `modal-rise`, `ops-spin`, `penalty-spin`, `debt-loading-spin` all re-invent `tt-fade-up`/`tt-slide-up`/`tt-spin`/`tt-shimmer`.
- **Divergence** — 212 raw durations over 15+ files; 24 of 33 unique keyframe names duplicate a shared `tt-*` intent.
- **Enforced by** — `frontend/src/styles/animations.css:156` and `frontend/src/styles/utilities.css:53,272` provide `prefers-reduced-motion` fallbacks; no test pins durations.
- **Gap** — no rule requires page motion to use `--t-*` or the shared `tt-*` keyframes; `--t-slow` and `--t-spring` have 0 refs.

### Z-index
- **Use** — the single ladder `--z-base 0` … `--z-dropdown 50`, `--z-sticky 100`, `--z-overlay 200`, `--z-modal 300`, `--z-confirm 350`, `--z-popover 400`, `--z-nested-popover 410`, `--z-picker-modal 420`, `--z-toast 500`, `--z-tooltip 600`, `--z-max 700` (`tokens.css:384-395`)
- **Never** — ladder-bypassing literals: `frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css:706` (`z-index: 1040`) and `:712` (`1050`) — both above `--z-max`; `frontend/src/components/shared/stale-build-banner.css:9` (`450`, between confirm and toast); `frontend/src/components/Table.css:134` (`60`, between dropdown and sticky); `frontend/src/pages/CustomersPage.css:96,204` (`30` ×2).
- **Divergence** — 20 raw `z-index` values outside the local `1–4` stacking hints; distinct set `{10, 11, 30, 35, 40, 45, 50, 60, 100, 450, 1040, 1050}`. 51 token refs total, 26 of them carrying a fallback. `--z-toast`/`--z-tooltip` have 1 ref each.
- **Enforced by** — — none.
- **Gap** — no check forbids literal `z-index` or values above `--z-max`.

### Density tokens (control / filter / dialog / table)
- **Use** — `--control-compact-h 30px`, `--control-default-h 34px`, `--control-touch-h 44px`, `--control-field-font-size`, `--filter-control-h` (compact desktop, reverts to touch at ≤640px, `tokens.css:435-449`), `--ops-dialog-padding` (in `frontend/src/styles/operational-density.css:13`) and the `--ops-table-*` role tokens (in `frontend/src/styles/operational-table-typography.css:14`).
- **Never** — per-page control heights: `frontend/src/pages/CustomersPage.css` toolbar (checked against `--control-compact-h`), `frontend/src/pages/DriverPenaltyPage.css` month select pinned at 44px. Raw `min-height: 30px/40px` page floors are banned in favour of the shared `#root .btn` guard.
- **Divergence** — 112 `--control-touch-h`, 83 `--control-compact-h`, 59 `--filter-control-h`, 42 `--control-field-font-size` refs; the family is well adopted, so remaining drift is page-local `min-height` literals.
- **Enforced by** — `frontend/src/styles/global-sizing-contract.styles.test.ts`, `frontend/src/styles/mobile-touch-floor.styles.test.ts`, `frontend/src/styles/filter-density.test.ts`, `frontend/src/styles/control-surface.styles.test.ts`, `frontend/src/styles/dialog-density-contract.styles.test.ts`.
- **Gap** — `--control-h` (44px) and `--control-mobile-h` both resolve to `--control-touch-h`, giving three names for the touch floor.

### Sidebar, accent ramp, and the daisyUI bridge (legacy)
- **Use** — `--sb-bg`, `--sb-text`, `--sb-text-muted`, `--sb-line` for shell chrome; `--color-*` only through `d-*` primitives.
- **Never** — the duplicated `--sidebar*` set (`tokens.css:189-196`) which mirrors `--sb-*` (`:179-187`) value-for-value; the page-local accent ramp `--brass-1/2/3`, `--copper`, `--sage-*`, `--slate-1..6` (`tokens.css:411-428`) reachable from only 5 files (`TripEditPage.css`, `trip-detail/details.css`, `trip-detail/header.css`, `penalty/violation-log.css`, `ShipmentsPage.css`); the legacy `--fs-*` aliases; `--ff-sans`; `--bg-glass`/`--glass-border` (0 refs).
- **Divergence** — 8 `--sidebar*` aliases duplicate 9 `--sb-*`; 14 accent-ramp values declared for 5 consumer files.
- **Enforced by** — `frontend/src/styles/font-family-contract.test.ts` (single family; no `--font-mono`/`JetBrains Mono`); `frontend/scripts/check-ui-contract.mjs` pins the sidebar gradient to the `--sb-*` tokens.
- **Gap** — no rule retires `--sidebar*` or the accent ramp.

## System gaps
Patterns with no primitive at all:
1. **Spacing** — 7 tokens, 84 refs, no enforcement; every page writes its own px rhythm. Worst offender: `frontend/src/pages/ShipmentsPage.css` (largest raw padding/gap count in `pages/`).
2. **Elevation** — the token set is intentionally `none`, but 125 raw shadows exist and nothing provides a sanctioned alternative cue. Worst offender: `frontend/src/pages/config/debit-note-template-editor.css`.
3. **Motion** — no sanctioned keyframe catalogue is referenced from pages (33 bespoke names). Worst offender: `frontend/src/pages/DebtDetailPage.css` (6 bespoke `animation:` decls).
4. **Z-index** — no layering primitive for in-page stacking; pages invent `10/30/40/1040`. Worst offender: `frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css`.

## Enforcement gaps
Rules that nothing checks yet:
1. **Raw hex in page CSS** — checked only in the 10 `sharedColorFiles`; 243 direct values live outside. Worst offender: `frontend/src/pages/config/debit-note-template-editor.css` (45 direct values).
2. **Off-ladder radii** — 343 occurrences, unchecked. Worst offender: `frontend/src/pages/DashboardPage.css` (31).
3. **`--app-radius-lg/-xl` vs `--r-lg/-xl`** — two sanctioned answers, no test. Divergence site: `frontend/src/styles/tokens.css:220-226`.
4. **`--features/` font-size drift** — `check-ui-contract.mjs` scans `src/pages/` only. Worst offender: `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:607`.
5. **Raw `z-index` and raw `box-shadow`** — no check. Worst offenders: `frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css` (z-index), `frontend/src/pages/config/debit-note-template-editor.css` (shadow).
6. **Dead/duplicate token names** — `--shadow-card`, `--shadow-md`, `--shadow-elevated`, `--shadow-brand`, `--brand-2`, `--brand-grad`, `--brand-glow`, `--bg-glass`, `--glass-border`, `--icon-sm/-md`, `--avatar-sm`, `--t-spring`, `--z-toast/-tooltip` (≈1 ref) have no reference-count gate.
7. **Undeclared token references** — `--ink-1` (10 refs), `--ink-muted` (2 bare), `--text-2` (4), `--space-2/3/4`, `--surface-1` (18 bare), `--warn` (9 bare), `--warn-soft` (3 bare), `--accent-strong`, `--ops-line`, `--strip` resolve to nothing or to a fallback; no check exists.
