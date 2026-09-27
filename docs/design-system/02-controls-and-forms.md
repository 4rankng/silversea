# 02 — Controls and forms

Slice 2 of the design-system map (see [`README.md`](./README.md)). Code owns WHAT;
this file owns only **which primitive does which job**, what is banned, and what
enforces it. Every count below is a grep over `frontend/src` at commit state
2026-09-27 (`.tsx` excluding `*.test.*` unless stated). Law sources live in
[`../design-guidelines.md`](../design-guidelines.md).

## Buttons

### Action buttons
- **Use** — the daisyUI-derived class family in `frontend/src/components/Button.css`: `.btn` (`Button.css:5`) plus `.btn--primary` (`:32`), `.btn--secondary` (`:48`), `.btn--ghost` (`:57`), `.btn--danger` (`:76`), `.btn--danger-outline` (`:67`), `.btn--icon` (`:87`), `.btn--sm` (`:85`), `.btn--lg` (`:86`). Applied as `className`, not imported. 595 `btn` class matches across **192 `.tsx` files** (token counts: `btn--sm` 299, `btn--secondary` 222, `btn--primary` 178, `btn--ghost` 111, `btn--icon` 19, `btn--danger` 13, `btn--danger-outline` 2, `btn--lg` 1).
- **Never** — `frontend/src/components/untitled-ui/base/buttons/button.tsx` (`Button`, Aria-backed) is a **second** button system: 16 files import it (`features/dispatch/master-plan/*`, `features/dispatch/catalogs/*`, `features/shipments/cus/*`, `pages/ShipmentsPage.tsx:20`) — it renders its own `styles.colors` size table and does not compose `.btn`, so an operator sees two button shapes on adjacent surfaces. `components/UI.tsx:13` re-exports it as `UIButton` (0 external consumers). Bespoke per-page shells: native `<button>` 936 occurrences; `.page-btn` (`components/Table.css:471`), `.stab-pill`, `.wf-btn`, `.expense-add-btn`.
- **Divergence** — 595 `.btn` uses / 192 files vs 16 files on UUI `Button`; 936 raw `<button>`.
- **Enforced by** — `src/styles/mobile-touch-floor.styles.test.ts` (pins the `#root .btn` 44px floor in 3 bands); `scripts/check-ui-contract.mjs` (phone `:where(#root) button` min-height); `src/styles/control-surface.styles.test.ts` (action buttons hug content, no full-width slabs).
- **Gap** — no check owns the `.btn--*` vocabulary or bans a second `<button>` shell; a page can ship a hand-styled button unconcerned.

## Button groups / segmented controls

- **Use** — `Tabs` from `frontend/src/design-system/Tabs.tsx`, **`variant="boxed"`**, CSS `design-system/Tabs.css`. Operator ruling 2026-09-27 ("this is our existing working button group… use this consistently globally"); the fleet-vehicle status group is the reference look. 17 product call sites `<Tabs` (`ShipmentsPage.tsx:424`, `CustomersPage.tsx:535`, `FleetVehiclesView.tsx:188`, `DetailedPlanFilters.tsx:251`, `PeriodFilter.tsx:97`, …), 13 with `variant="boxed"`.
- **Never** — a page may size the group and give it a layout hook class
  (`className="…-tabs"` for grid placement, `overflow-x: auto`, `min-width: 0`) —
  nothing else. Two real violations were re-verified by grep against the tree
  (2026-09-27, parent audit):
  - **Bespoke groups that never adopted the primitive** (no `<Tabs>` in the file):
    `.status-tabs` / `.stab-pill` — `features/trips/tripFilters.tsx` (+`pages/trip-list/filters.css:28`);
    `.shipment-finance__tabs` — `features/shipment-finance/ShipmentFinancePanel.tsx` (bespoke `button[aria-pressed]`, `ShipmentFinancePanel.css:5`);
    `.ftrip-date-picker__range-tabs` — `pages/ForwarderTripDateRangePicker.tsx` (own border/radius/inset edge, `ForwarderTripDateRangePicker.css:15`).
  - **Pages that adopt `<Tabs>` and then re-skin its internals** (`.ds-tabs__btn`, `--active`, `:hover`, `:focus-visible`, `.ds-tabs__count`): `pages/AccountingWorkspacePage.css:29-31` (own radius/colour/focus ring/weight), `pages/AdvanceWorkspacePage.css:61-94` (`--active` background, hover, focus), `pages/ShipmentsPage.css:61-74`, `pages/DriverTripsPage.css:30,106`, `pages/config/config-page.css:1197`, `features/expense-accounting/ExpenseAccounting.css:6-9`. If a page needs a different *shape*, it must choose a sanctioned variant (`boxed` / `bordered` / `plain`) — not fork the boxed one.
  - Classes that are **hooks on the primitive, not divergence** (verified: the file renders `<Tabs className="…">`): `.accounting-tabs`, `.shipments-control__tabs`, `.cfg-finance-tabs`, `.dd-workspace-tabs`, `.driver-journey__tabs`, `.role-work-inbox__tabs`.
- **Divergence** — 3 files with a bespoke group + 6 files re-skinning the primitive's internals, against 20 files that render `<Tabs>` (13 with `variant="boxed"`).
- **Enforced by** — `src/design-system/Tabs.styles.test.ts` (pins the boxed contract: hairline container, flat active pill, plain count numerals, no shadow); `frontend/design-lock/expectations/dispatch.mjs` (computed `date-scope-is-the-shared-group`, `no-bespoke-segment`); `src/styles/selection-state-contract.styles.test.ts` **pins the page-local selected states** (it locks the divergence in place rather than retiring it).
- **Gap** — no test asserts a *product page* renders `ds-tabs`; the selection-state suite actively protects several bespoke groups.

## Text inputs

- **Use** — the `.input` class in `frontend/src/components/Input.css` (`Input.css:5`): 284 exact `className="input …"` matches, `.input` token across **87 `.tsx` files / 346 matches**. The typed wrapper `TextField` (`design-system/forms/TextField.tsx`, `ds-field`) — 74 usages / 29 files — is the form-scoped variant.
- **Never** — second input systems: untitled-ui `InputBase` (`components/untitled-ui/base/input/input.tsx`) reached only through `components/shared/EntityFormParts.tsx`; **403 raw `<input>`** in `pages`/`features`/`components`. Bespoke wrappers: `components/trip/InputWithPrefix.tsx` (prefix money field, own cursor math); `.entity-unit-wrap` (`EntityFormParts.tsx:54`, styled in `Modal.css:292`); `.input-icon` (4 files).
- **Divergence** — three text-input surfaces (`.input`, `.ds-field__input`, `InputBase`) over 403 raw `<input>`.
- **Enforced by** — `scripts/check-ui-contract.mjs` (`#root input:not([type=checkbox]):not([type=radio])` phone selector); `src/styles/control-surface.styles.test.ts` (opaque fill); `src/components/untitled-ui/base/form-control-boundaries.test.ts` (border not shadow).
- **Gap** — nothing forbids a page-local input; no rule says `.input` vs `ds-field`.

## Search shells

- **Use** — `ListFilterBar` (`frontend/src/components/ListFilterBar.tsx`), search slot `.filter-bar__search` (`components/FilterBar.css:55`) — the bar "owns the icon, chrome and placeholder". 6 consumers.
- **Never** — 16 bespoke search inputs with `placeholder="Tìm…"`, each with its own shell class: `.payables-toolbar__search`, `.shipments-control__search` (`ShipmentsPage.css`), `.ops-orders__search`, `.invoice-tracking-search`, `.fset-search-bar`, `.toolbar__search`, `.users-customer-scope__search`, `.routes-strip__search`, `.master-plan-filters__search`, `.expense-accounting-search`, `.penalty-filter-bar__search`, `.shipment-finance__search`, `.filters-search`, `.input-icon salary-attendance__search-input` (`SalaryAttendancePage.tsx`). Each re-declares height/border/focus.
- **Divergence** — 6 `ListFilterBar` hosts / 4 `filter-bar__search` renders vs 16 hand-rolled shells.
- **Enforced by** — `src/styles/search-shell-surface.styles.test.ts` (checks **only** `FilterBar.css` for the opaque `var(--surface)` fill, no tint); `src/components/FilterBar.styles.test.ts`.
- **Gap** — the search-shell law is pinned on one file; the 16 bespoke shells are unchecked.

## Selects / dropdowns / comboboxes

- **Use** — `UuiSelectField` (`design-system/forms/UuiSelectField.tsx`) — declared "the only sanctioned select control in the app"; 187 usages across **89 files**. It becomes a type-to-search combobox past `SEARCH_THRESHOLD`.
- **Never** — `SelectField` (`forms/SelectField.tsx`, children API, delegates to `UuiSelectField`) 2 files / 4 uses — a compatibility façade over the same control. `components/UI/Select` (Radix) **0 consumers** and `components/UI/DropdownMenu` **0 consumers** are dead primitives. Native `<select>` survives in 6 places: `features/shipments/cus/CusQuickEdit.tsx:54`, `pages/accounting/DebitSettlementRoundDialog.tsx:191,197,203`, `pages/config/ForwarderExpenseTypesConfigPage.tsx:146`, and the vendored `components/untitled-ui/base/select/select-native.tsx:49`.
- **Divergence** — 6 native selects despite the eslint ban; 2 UI primitives with 0 consumers.
- **Enforced by** — `@tingting/no-native-select` (`eslint.config.js:157`), but it is switched `'off'` in an override (`eslint.config.js:251`) — confirm the exempt glob still matches the 6 sites; `design-system/forms/UuiSelectField.styles.test.ts` (popover never clips an option); `form-control-boundaries.test.ts`.
- **Gap** — the eslint guard does not cover `SelectField`/Radix `Select`, and two vendors ship the same job.

## Multi-select / facets

- **Use** — `SearchableMultiSelect` (`design-system/forms/SearchableMultiSelect.tsx`) — the facet picker; 5 usages / 3 files (`ShipmentsPage.tsx`, `MasterPlanFilters.tsx`, `DetailedPlanFilters.tsx`). Companion single-select `SearchableSelect` — 24 usages / 14 files.
- **Never** — no third facet widget found; the divergence here is **two searchable-select implementations** (`SearchableSelect` vs `UuiSelectField`'s combobox branch) that mirror each other's UX but are separate code (`forms/SearchableSelect.tsx` own portal/position hook).
- **Divergence** — 2 separate searchable-picker code paths.
- **Enforced by** — `src/styles/selection-state-contract.styles.test.ts` pins `aria-selected` + a conditionally-rendered `Check` glyph (shape not hue) on every option.
- **Gap** — nothing dedupes `SearchableSelect` and `UuiSelectField`.

## Date / time fields

- **Use** — `BufferedUuiDateInput` (`forms/BufferedUuiDateInput.tsx`, 29 usages / 14 files) built on the segmented `DateTimeSegments` (`forms/DateTimeSegments.tsx` + `.css`); single `DateInput` 40 / 29; `DateField` 32 / 22; `TimeInput` 4 / 4; `SplitDateTimeField` 2 files. A **from/to filter pair** is `DateRangeFields` (`forms/DateRangeFields.tsx`) — two independent single-date fields in a transparent 2-track grid, order enforced by `min`/`max` between them — with `DateRangePresets` beside it for quick ranges (shared boxed segmented group).
- **Never** — a merged date-range control. `DateRangePopover` (one dual-calendar trigger, then two halves sharing one popover) was DELETED 2026-09-27 on the operator ruling "I dont want daterangepicker" / "I want seprate control for from date and to date, I dont want to merge": no trigger may read `DD/MM/YYYY - DD/MM/YYYY`, and no two-date popover may own both ends. Quick ranges are never hidden inside a popover — they render as visible `DateRangePresets` cells.
- **Never** — ad-hoc date fields retired by sweep: `src/styles/native-date-sweep.styles.test.ts` pins the 6 former native-date hosts. One native time input remains: `features/shipments/detail/ShipmentContainerLedger.tsx:578` (`type="time"`).
- **Divergence** — 1 remaining native date-family input.
- **Enforced by** — `native-date-sweep.styles.test.ts` (file-local, no new `type="date"`); `design-system/forms/DateTimeSegments.styles.test.ts` (per-segment widths, symmetric separators); `frontend/design-lock/expectations/shipments.mjs` (`date-seg-group` is the ≥44px tap target).
- **Gap** — the sweep's pattern only matches `type="date"`, so `type="time"` at `ShipmentContainerLedger.tsx:578` is unpinned.

## Checkboxes / toggles

- **Use** — untitled-ui `Checkbox` / `Toggle` / `RadioGroup` (`components/untitled-ui/base/checkbox|toggle|radio-buttons`) — **0 external JSX call sites**; used only internally by `base/select/select-item.tsx`.
- **Never** — `components/trip/CheckboxCard.tsx` (`tc-checkbox-card`, 3 files) and `components/trip/FuelModeToggle.tsx` (2 files) are the de-facto controls; plus **45 native `type="checkbox"` in 27 files** and **15 native `type="radio"`** (`AccountingTransportRegister.tsx`, `ForwarderExpenseForm.tsx`, `UserFormFields.tsx`, `TripListPage.tsx`, `CustomersPage.tsx`, …).
- **Divergence** — 0 adoptions of the sanctioned toggle primitives vs 45 + 15 native and 2 bespoke wrappers.
- **Enforced by** — — none (⇒ flag: no test or lint rule touches checkbox/radio/toggle).
- **Gap** — there is effectively **no shared checkbox/toggle primitive in use**; the UUI ones are orphaned.

## Form field layout + labels

- **Use** — `TextField` (`ds-field` / `ds-field__label`, `forms/TextField.css:8`) and untitled-ui `Label` (`base/input/label.tsx`, `fieldLabelText` from `base/control-typography.ts`). Label stacking: `.ds-field { flex-direction: column; gap: 6px }`.
- **Never** — bare `<label>` with per-page classes (`.expense-label` `ExpenseEntryPage.tsx:419`, `.cfg-field`, `.trip-pod__*`, `.users-*`, `.searchable-select__*`). Each page re-declares label size/weight/color.
- **Divergence** — dozens of label styles across pages; no counted single rule.
- **Enforced by** — — none (⇒ flag: no test pins label typography, casing, or column layout).
- **Gap** — no single field wrapper; `ds-field` and the untitled-ui `TextField` both exist.

## Required-field marking

- **Use** — `ds-field__required` (`forms/TextField.tsx:41`, `TextField.css:15`) and untitled-ui `Label isRequired` (`base/input/label.tsx:31`).
- **Never** — bespoke markers with no shared class: `.req` (`salary-attendance-components.tsx:504`, `payables-fuel-invoices.tsx:401`, `PayableListPage.tsx:161`), `.expense-required` (8 uses, `ExpenseEntryPage.tsx:419`), `.trip-pod__required` (`TripPodSubmission.tsx:261`), `.searchable-select__req` (`SearchableSelect.tsx:389`), `.modal__req-mark` (`EntityFormParts.tsx:93`).
- **Divergence** — 5 bespoke `*` markers + 2 shared.
- **Enforced by** — — none (⇒ flag).
- **Gap** — required marking is not standardized; two shared markers already exist.

## Validation / error presentation

- **Use** — `aria-invalid` on the control (32 uses) driving `.input[aria-invalid="true"]` (`Input.css:39`, red border) and `.ds-field--error`; `role="alert"` for announcement (220 uses).
- **Never** — **8 bespoke error classes**: `.cfg-form-error` (`FinancePolicySection.tsx:104`, 22 uses), `.cfg-field-error` (`OperationalPolicySection.tsx:65`, 9), `.field-error` (`ForwarderExpenseForm.tsx:309`, 7), `.expense-field-error` (`ExpenseEntryPage.tsx:556`, 6), `.fwd-field-error-inline`, `.users-field-error` (`UserAddPanel.tsx:194`), `.tdp-error-text`, `.salary-attendance__error-text`, plus `.form-error` (`PairTripsDialog.tsx:153`). Several inline-style the color (`style={{ color: 'var(--danger)' }}`) instead of using the token rule.
- **Divergence** — 8+ page error classes; each owns its own position + color.
- **Enforced by** — — none (⇒ flag: no test pins error placement, colour, or `aria-describedby` wiring).
- **Gap** — errors render anywhere a page decides; no shared `FieldError` primitive.

## Disabled / read-only states

- **Use** — `.input:disabled` / `.input[aria-disabled="true"]` (`Input.css:25`), `.ds-field__input:disabled` (`TextField.css:46`), `.btn[disabled]` (`Button.css:93`, opacity .45).
- **Use (solid/emphasis controls)** — a disabled control whose fill is `--ink`/`--accent` swaps to a quiet surface, it does not dim the fill: `--surface-3` fill + `--line-2` border + `--ink-2` text at `opacity: 1` (≥4.5:1). A 55%-opacity ink fill over live content reads as a grey slab, not a disabled control (2026-09-27 operator report, `docs/design-guidelines.md` same date; reference impl `.driver-task-complete-sticky__btn:disabled`).
- **Never** — 91 page-level `:disabled` rules, 764 `disabled` attributes, 85 `readOnly` (1 `aria-readonly`) — every page re-declares the disabled look.
- **Divergence** — 764 disabled sites / 91 page rules vs 3 primitive rules.
- **Enforced by** — — none (⇒ flag).
- **Gap** — read-only has no shared style at all (`aria-readonly` used once).

## Focus rings

- **Use** — the global `:focus-visible { outline: 2px solid var(--accent-2) }` in `src/styles/base.css:54`; `.input:focus-visible` (`Input.css:33`) and `.btn:focus-visible` (`Button.css:26`) keep it.
- **Never** — **`ds-field__input:focus` sets `outline: none` and a `box-shadow` ring** (`forms/TextField.css:40`) — the primitive itself diverges from the global rule; and 125 page-level non-`none` `outline:` rules + 38 `outline: none` + 24 `box-shadow` rings across `pages`/`features`/`components` (128 page `:focus-visible` rules).
- **Divergence** — 125 hand-written outlines, 38 suppression rules, 24 shadow rings vs 1 global + 2 primitive rules.
- **Enforced by** — `scripts/check-ui-contract.mjs` pins only `base.css` and `Input.css` (both must keep the `2px solid var(--accent-2)` outline). Nothing pins page focus.
- **Gap** — no test forbids `outline: none` or a page-local focus ring; `ds-field` is itself off-contract.

## Touch floors

- **Use** — the token floors `--control-touch-h` / `--control-mobile-h`, applied via the `#root .btn` guard repeated in three bands in `src/styles/responsive.css:257,746,783` and the universal phone selector (`responsive.css:246`).
- **Never** — page CSS that owns control height and out-specifies the band (the 2026-09-26 sweep fixed `.workflow-profitability__controls .btn` 30px and `.expense-add-btn` 32px; `.stab-pill` and `#config-search` are still individually pinned for historical heights).
- **Divergence** — not counted as files; the risk is specificity, not volume.
- **Enforced by** — `src/styles/mobile-touch-floor.styles.test.ts` (3× `.btn` floor, hamburger 44×44, coarse-pointer links); `scripts/check-ui-contract.mjs` (universal phone selectors); `frontend/design-lock/expectations/{shipments,dispatch}.mjs` (`tapFloor` at every width).
- **Gap** — floors apply to `.btn` and raw `button`/`input`/`select`; bespoke class controls (`.filter-chip`, `.stab-pill`) rely on separate pinned rules.

## System gaps

- **Checkboxes / toggles / radios** — no shared primitive is in use (UUI `Checkbox`/`Toggle`/`RadioGroup` have 0 call sites); worst offender: `components/trip/CheckboxCard.tsx` (and 45 native checkboxes).
- **Validation / error display** — no shared `FieldError`; errors are 8 page-local classes. Worst offender: `src/features/app-settings/FinancePolicySection.tsx` (`.cfg-form-error`, 22 uses).
- **Required marking** — 5 bespoke `*` markers, no shared contract; worst offender: `src/pages/ExpenseEntryPage.tsx` (`.expense-required` ×8).
- **One text input** — `.input` vs `ds-field__input` vs UUI `InputBase`; worst offender: `components/trip/InputWithPrefix.tsx`.
- **One searchable picker** — `SearchableSelect` and `UuiSelectField` duplicate the combobox; worst offender: `design-system/forms/SearchableSelect.tsx`.
- **One button** — `.btn` classes vs UUI `Button`; worst offender: `frontend/src/components/untitled-ui/base/buttons/button.tsx` + its 16 adopters.

## Enforcement gaps

- **Button vocabulary** — nothing checks `.btn--*` usage or bans a page-local button shell (`Button.css`).
- **Button groups** — no test asserts a product page renders `ds-tabs variant="boxed"`; `selection-state-contract.styles.test.ts` currently *pins* 12+ bespoke group states. Worst offender: `frontend/src/styles/selection-state-contract.styles.test.ts`.
- **Search shells** — law pinned on one file only; 16 hand-rolled shells unchecked. Worst offender: `frontend/src/pages/ShipmentsPage.css`.
- **Focus rings** — only `base.css` + `Input.css` are pinned; `ds-field__input:focus` suppresses the outline and no test forbids page `outline: none`. Worst offender: `frontend/src/design-system/forms/TextField.css:40`.
- **Disabled / read-only** — 91 page `:disabled` rules, no pin. Worst offender: `frontend/src/pages/config/config-page.css`.
- **Label / required / error** — no test covers casing, layout, placement, or announcement. Worst offender: `frontend/src/pages/ExpenseEntryPage.tsx`.
- **Checkboxes** — no test or lint rule on checkbox/radio/toggle. Worst offender: `frontend/src/components/trip/CheckboxCard.tsx`.
- **`type="time"`** — `native-date-sweep` matches only `type="date"`. Worst offender: `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx:578`.
