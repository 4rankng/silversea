---
name: "design-system-contracts"
description: "Enforced UI contracts: control density (sm/md/xs + 44px coarse-pointer floor, pointer-based not width-based), card-grid pairing rules, operational color contract, selection≠workflow, 24h time-first datetime, size-consistency scale, pre-deploy bundle check"
folder: "features"
tags: ["design-system", "ui", "css", "responsive", "contracts", "44px"]
updatedAt: "2026-09-09T18:10:27.411Z"
author: "AI Engineer"
---

# Design-system contracts (migrated from frontend/docs/design-system.md, 2026-09-10)

These are the enforced UI contracts (2026-09-09 space-utilisation standards). Related: [[responsive-space-utilisation]] (program outcome), [[css-grid-orphan-parity-trap]], [[frontend-architecture]].

## Control density contract

Control size is owned by the shared primitive, never by page CSS. Tokens: `--control-compact-h` (30px), `--control-default-h`, `--control-touch-h` (44px). Variants: `sm` 34px desktop (operational filters, data-entry, toolbars), `md` 40px (forms/ordinary actions), `xs` 28px (low-emphasis inline) — ALL rise to 44px minimum on narrow screens. Pages may arrange controls and set widths but must NOT override height, padding, font size, or icon size — choose the semantic `size` prop. `sm` field type: 12px desktop / 14px narrow. Dense operational forms pick `sm` as a complete semantic variant instead of recreating dispatch typography in page CSS.

## Coarse-pointer touch floor (44px on every input device)

Width-based breakpoints miss coarse-pointer tablets (iPad at 768/1024px hits desktop layout but fingers still need 44px). Pattern: `@media (pointer: coarse) { .btn { min-height: var(--control-touch-h); } }` — use `min-height` (not `height`) so longer labels push taller; ship the compact base rule AND the coarse override together; icon buttons get `width: var(--control-touch-h)` (square hit area). NEVER use `@media (max-width: …)` as the touch-floor trigger. Pinned by `src/components/control-density.styles.test.ts`, `src/styles/operational-density.styles.test.ts`, `TruckFormModal.styles.test.ts` — every new operational control must grow a matching style-contract test pinning BOTH compact base and coarse-pointer override.

## Responsive pairing rules for card grids (table→card collapse)

Desktop tables collapsing to card views MUST pair cells 2-up across a grid (`repeat(2, minmax(0,1fr))` via container queries; tablet band 600–900px, phone band ≤599px) with full-span overrides for long content. Hard rules:
1. **Mirror the full-span list across every band that pairs** — a full-span rule in only one band produces half-width rows with stray dividers (the master-plan `Ghi chú` bug, fixed in `5324b1ad`).
2. **Long content ALWAYS spans full width** (multi-line notes, action triggers, identity cells) — `grid-column: 1 / -1`.
3. **Touch surfaces inside full-span cells keep the 44px floor.**
4. **Reset `border-inline-start: 0` when forcing full span** — the `:nth-child(2n)` rule still matches and draws a stray left-edge divider.
5. **Prefer explicit `:nth-child` positions over `:last-child:nth-child(odd)` parity** — display:none siblings shift parity but not nth-child (see [[css-grid-orphan-parity-trap]]).
Reference commits: `874bf1bb` (dispatch 44px date shortcuts), `38f4884d` (/trips table ≥1024px), `7eab78d3` (/shipments toolbar 2-up), `f511cbbf` (dashboard bento), `a9d3427d` (record-table whole-card band), `5324b1ad` (master-plan notes 600–900 fix).

## Operational table color contract

Tables are decision surfaces: body text uses neutral foreground scale (`--fg-1/2/3`); category labels (import/export, carrier type, allocation) use neutral badges. Semantic color ONLY for real operational conditions: forest=active/completed, bronze=attention, oxblood=cancelled/error/overdue. Never introduce blue/indigo/orange badges to distinguish categories.

## Selection ≠ workflow status

Selection (tab, filter, mode, chosen record) = neutral surface + one ink structural cue (border/2px edge, stronger label, check/radio when choosing). Never flood a control green/blue to show active. Workflow status = domain-labelled badge with semantic color only when the state itself carries that meaning. Risk = named warning + restrained strip/icon. Hover = quiet neutral change. Focus = separate visible ring, never the selected-state styling. Use shared `Tabs` variants (`plain` neutral border + inset ink edge; `bordered` underline); the dark `FilterBar` pill stays the deliberate high-contrast selection pattern.

## Combined date+time display contract (24h, time-first)

Always `HH:mm DD/MM/YYYY` (e.g. `14:30 20/08/2026`; tables may compact to `14:30 20/8/26`). NEVER 12-hour AM/PM, NEVER native `datetime-local`/`time` inputs (locale rendering can't be forced — produced 12h on en-US browsers, customer report 2026-09-09). Inputs: design-system 24h text input `BufferedUuiDateTimeInput` / `useBufferedDateTimeValue`, placeholder `HH:mm DD/MM/YYYY`, stored value ISO local `YYYY-MM-DDTHH:mm`. Display: `formatDateTime24` (local-ISO) / `formatDateTimeShort` (Vietnam-pinned `HH:mm d/M/yy`) from `frontend/src/lib/format.ts` — never inline `toLocaleString`/`Intl` for combined date-time (field order is engine-dependent). Pinned by `useBufferedDateTimeValue.test.tsx`.

## Size-consistency scale (PM standard 2026-09-09)

A page that pairs correctly but LOOKS off is not done. Violations:
- **One control height per context:** sibling controls in the same view share the SAME computed height (the 36px-vs-44px /payables fuel-invoice toolbar bug class). Implement with one CSS variable per context, swapped by breakpoint: `--filter-control-h: var(--control-compact-h)` → touch-h under `max-width:767px` AND `(pointer:coarse)`. Never mix compact-h and touch-h across siblings.
- **One type scale:** sizes from `--fs-*` / `--ops-table-*` steps (ops table: primary 13.5px/600, meta 11.5px, note 12.5px). No arbitrary page-CSS font sizes; correct the shared primitive, not the page.
- **No oversize components:** a filter trigger is not a hero button. Verify by sampling three siblings' computed heights.
- **Cross-page coherence:** same component type looks identical everywhere. Reference chrome: filter trigger (`--filter-control-h`, `--r-sm` radius, compact font), card (`--app-radius-md`, 1px `--line`, `--surface`, 8–10px row gap), chip (pill, 4/8–10px padding, 11–12px), divider (1px `--line`). New pages inherit chrome from `src/design-system/` + `src/styles/` shared sheets (`record-table.css`, `operational-density.css`, `table-sort.css`) — do not roll your own. Pinned by `global-sizing-contract.styles.test.ts`, `filter-density.test.ts`, `control-density.styles.test.ts`.

## Pre-deploy served-bundle check (verifier lesson 2026-09-09)

A fix in the local build is not a fix in production — staging once served the pre-fix bundle hash (`MasterPlanPage-Bx9sxB1c.css`) while local build passed. Before declaring a frontend commit done: from the browser console on the affected page, fetch the served stylesheet (`cache: 'no-store'`) and assert the expected rule exists; the Vite content hash MUST flip when output changes. Also `git rev-parse HEAD` vs `git ls-remote origin prod`. Any agent committing a frontend fix while a wave is in flight MUST run this before saying "done". Reference: `qa/2026-09-09_master-plan-600-900-notes-fix.log`.
