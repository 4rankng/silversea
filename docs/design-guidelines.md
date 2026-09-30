# Design Guidelines — Silversea house design law book

> **Audience:** every lane building or reviewing Silversea UI (frontend, fullstack, QA).
> Model: nepocorp's `docs/design-guidelines.md` (299 lines). Sources consolidated:
> operator rulings (2026-09-16 → 2026-09-22), the 2026-09-22 four-role QA sweep
> (`testplan/cycles/2026-09/2026-09-22-ui-ux-sweep-4-roles.md`, cards 20260922_24–28), and the
> operator-approved nepocorp study
> (`plans/reports/nepocorp-design-lessons-260922.md`, order: study → tickets → implement only after).
>
> **How a law enters this book:** an operator ruling or a lead-filed, operator-approved card.
> Every law carries its ruling date and originating card (session rulings cite the ruling date;
> sweep cards cite the sweep). A later law supersedes an earlier one and says so in its source line.
> Unwritten does not mean unruled — when a design call is uncertain, see *Design process* below.

## 0. Read order

This file is the **history of rulings** (why). The **system** — what exists, which one to use for a job,
what is banned, and which check holds it — is `docs/design-system/README.md` (tokens, controls and forms,
data display and feedback, layout/navigation/overlays). Read the map first; come here for the reason and
the date. A ruling row should name the test or `design-lock` entry that now enforces it.

## 1. Status and data cells

- **No pill-shaped buttons.** Buttons are rectangles with a small radius (~8px); never `border-radius: 999px`.
  *Source:* 2026-09-17 operator ruling; sweep card 20260917_16 (pill-button sweep), re-sweep card 20260922_27.
- **Data cells are text-only.** Status/state values render as plain text in the house compact style (optionally the house
  color-dot) — no pill bubbles, no rounded background fills, no decorative icons beside the value.
  *Source:* 2026-09-22 operator ruling ("dont display this blob, text only… dont fucking spam icon everywhere");
  sweep cards 20260922_21, 20260922_24, 20260922_27 (fix landed c22e7bd6).
- **Icons are for actions, never decoration.** Icons appear only on functional action buttons (trash/edit/chevron row
  actions). No icons decorating labels or statuses; no icon repeated in the same cell; a meaningful icon without a
  visible text label is removed or gets one. When a surface is tight on space the answer is text + whitespace, never
  iconography.
  *Source:* 2026-09-22 operator ruling; sweep cards 20260922_21, 20260922_24.
- **One concept, one place per row.** A concept (e.g. dispatch status) displays once per row — never in two columns at
  once; two signals that contradict each other on one surface are a defect, not a nuance.
  *Source:* sweep card 20260922_24 (2026-09-22).
- **Empty values name the missing field.** Missing-data warnings say exactly which field is missing ("Thiếu ngày vận
  chuyển", "Thiếu biển số"), never a generic "Thiếu dữ liệu"; they never appear on rows that have complete data.
  *Source:* sweep card 20260922_24 (2026-09-22); supersedes the 09-16 fixed-label "Thiếu dữ liệu" compact-badge ruling.

## 2. Color and contrast

- **Color encodes meaning only.** Success/green = completion or money actually received; warning/amber = needs
  attention; danger/red = error or blocked; info = informational. Costs, payables, and owed/pending amounts never use
  success tokens — "Chưa giao tiền" (not yet paid in) is amber, not green.
  *Source:* 2026-09-22 operator ruling + card 20260922_27 (fix landed c22e7bd6).
- **4.5:1 text contrast is the floor.** Every rendered text (including empty-value and status labels at 11–12px) clears
  4.5:1 against its actual background (3:1 for text ≥24px or ≥18.66px bold). Fixed at the token layer, not per site.
  *Source:* sweep card 20260922_25 (2026-09-22; landed via the `--ok` token alias at 7.0:1).
- **Status colors are triads with a dual-role contract.** Each status carries fill / soft / text as separately tuned
  tokens; `--success` must clear 4.5:1 both as text on white and as a fill under white text; the accent green
  (`--accent`) is graphic-only (dots, bars, rings) — never a text color (use `--success-text` / `--accent-ink`).
  *Source:* nepocorp report F3 (2026-09-22); enforcement test = card 20260922_35.
- **Placeholder/empty-value text stays readable.** It must read at ≥4.5:1, distinguishable from real data but never
  near-invisible grey.
  *Source:* sweep card 20260922_25 (2026-09-22).

## 3. Surfaces and overlays

- **Flat by contract.** Elevation never comes from shadows (`--sh-*: none` in the shell); hierarchy comes from the
  surface ladder and borders. A "looks unused" shadow token is intentional, not dead code.
  *Source:* nepocorp report (parity verified 2026-09-22).
- **Surface ladder placeholder — lands with card 20260922_33.** The calibrated minimum-contrast ladder for `--bg`,
  `--surface-2/3`, `--line*`, `--control-border`, `--ink-4` (the nepocorp F1 measured-ratio table) is ADOPTED as target
  law but NOT yet landed: card 20260922_33 (FullStack) re-calibrates `frontend/src/styles/tokens.css` and this section
  then carries the measured ratio table in its place. Until it lands: do not lighten any rung of the ramp without
  re-measuring; the ramp stays monotonic
  (`--surface < --surface-2 < --surface-3 < --border-1 < --line < --line-2 < --line-3`).
  *Source:* nepocorp report F1 (2026-09-22); implementation card 20260922_33.
- **Floating overlays are always `--surface` (white).** Dropdowns, popovers, and modals are never a canvas alias or
  inset tone — in a flat UI the white fill is their only elevation cue.
  *Source:* nepocorp report F4 (2026-09-22); audit/implementation card 20260922_36.
- **Editing affordances appear only where editing happens.** Hover affordances for EDITING (e.g. the copy affordance in
  the STT cell) exist on schedule-editing surfaces only; read-only views never grow them.
  *Source:* 2026-09-18 operator ruling (staging); card 20260918_3.
- **Search shells follow the control-surface law** — opaque surface token, no tint/canvas transparency; same
  control-height and focus rules as any control.
  *Source:* Director ruling 2026-09-26; QA cut #10 canvas-tint evidence; card 20260926_7.

## 4. Tables and data display

- **No-truncation doctrine.** Never clip a column value (`overflow: hidden` clipping is banned). Long text wraps by
  default (`overflow-wrap`); single-token values (codes, plates, tax codes, phones) instead EXPAND — `white-space:
  nowrap` with no clip, so the column sizes to content (composes with card 20260922_22's auto layout). A hover tooltip
  with the full text or a card layout is the fallback for values that cannot wrap without wrecking density — e.g. the
  2-line note preview (card 20260915_35 user ruling; full note in `title` + drawer). Horizontal scroll is reserved for
  token tables (card 20260922_23 pattern). `text-overflow: ellipsis` on data cells is banned outright; the only
  exception is an intentional short badge adjacent to `sr-only` text (card 20260922_37).
  *Source:* nepocorp report F5 (2026-09-22); default rule per data table + short-badge exception = card 20260922_37
  (swept 2026-09-22); fallback-clause reconciliation 2026-09-22 (same-day — the first wording contradicted the
  fallback sentence it lived next to).
- **Status/action columns keep a fixed width at every viewport.** ~150–170px at ALL widths, desktop included; one
  full-text action max per row; destructive actions are icon-only with `aria-label`.
  *Source:* 2026-09-18 operator ruling (CusShipmentRow rework); sweep card 20260922_21.
- **Sortable headers are legible and honest.** Sort hit area ≥24px (house target 32px), indicator icon ≥12px inline
  with the label (never dropped to a second line), explicit unsorted/asc/desc states; non-sortable columns show no
  indicator.
  *Source:* sweep card 20260922_26 (2026-09-22).
- **Numbers and units never join into one word.** Every number/unit pair keeps a visible gap ("71 người", not
  "71người"); fix belongs in the shared KPI primitive, not per page.
  *Source:* sweep card 20260922_28 (2026-09-22).

## 5. Density and layout

- **Compact density is the house standard.** 12px data density; 11px labels/supporting text; tight rows — a dense data
  workspace, not a marketing site. Desktop hit areas ≥24px (WCAG floor), house target 32px; 44px touch targets on
  mobile.
  *Source:* nepocorp report (parity verified 2026-09-22); hit-area numbers from card 20260922_26.
- **Entity-management pages follow the /suppliers table design.** Dense table as the list; forms lay out horizontally
  using available width — a form must never force vertical scrolling on a wide screen.
  *Source:* 2026-09-21 operator ruling.
- **Data-dense rows.** Prefer data-dense rows over spacious cards for list surfaces; the QA sweep confirms space-waste
  reads as unfinished to the operator.
  *Source:* operator review (intake "The UI waste lots of space — data-intensive design"); sweep set 20260922_20–23 (2026-09-22).
- **Filter bar: desktop = row-packing, dropdown tối đa ~320px, full-width chỉ dành cho search chính; mobile = stack 1 cột.**
  *Source:* 2026-09-24 Director systemic filter order (LAW).

## 6. Empty states

- **Empty states are informational, never tutorials.** No help/onboarding UI anywhere in the app — no tours, coach
  marks, or liveness-style gating surfaces. Product is for trained operators; empty states explain, they don't teach.
  *Source:* 2026-09-20 operator ruling; card 20260919_14 (help/onboarding removal).
- **Empty-state art routes through a resolver.** All empty-state illustrations come from one shared resolver with a
  small shared image set; no ad-hoc `empty-*.svg` art per page.
  *Source:* nepocorp report F8 (2026-09-22); implementation card 20260922_40 (resolver + image set pending).
- **Empty variants stay consistent.** The three empty variants (no-data / no-selection / no-results) render the same
  way everywhere.
  *Source:* card 20260920_41 (empty-state variants, 2026-09-20 intake).

## 7. Interaction

- **Pickers never auto-close.** Selecting an hour/minute/date applies the value and keeps the panel open; only the
  explicit Xong button (or Enter in exact entry / X / Escape) closes. New picker components wire the apply-to-close
  path.
  *Source:* 2026-09-16 operator ruling; card 20260916_1 (picker select no-auto-close).
- **One input per datum.** A stored-values dropdown + free-text box for the same datum merge into ONE searchable
  combobox that also accepts free-typed values.
  *Source:* 2026-09-16 operator ruling.
- **Enter commits the typed value.** In free-text-capable comboboxes, typed values commit on Enter (not silently lost
  to suggestion mismatch).
  *Source:* card 20260922_4 (2026-09-22, RAC combobox Enter-commit mechanics).
- **No front-end liveness gates.** The app never blocks the UI behind connection/session-check retry curtains;
  individual API calls fail on their own. ConnectionGate/AuthRecoveryGate were removed for this.
  *Source:* 2026-09-16 operator ruling (ConnectionGate/AuthRecoveryGate removed).

## 8. Copy and identifiers

- **No lecturing copy.** Long instructional helper text is removed on sight; users are trained operators.
  *Source:* 2026-09-16 operator ruling.
- **One term per concept, app-wide.** Status/verb families stay unified ("điều xe" family everywhere — "Chưa điều xe"
  is the UNASSIGNED label; do not re-split the verb family). New labels join the family.
  *Source:* 2026-09-18 operator ruling (landed 66869ce4).
- **Dropdown options show the short name only.** Long descriptions never render inside option rows (move to
  tooltips/secondary text).
  *Source:* 2026-09-17 operator ruling (customer complaint, ticketed).
- **Internal IDs never render in user-facing UI.** Database ids and id-derived codes ("#162", "SHP-2609-00182 = id
  182") never appear as visible text; display keys are the business identifiers — Số Bill/Booking first, then số tờ
  khai. Internal ids live only in URLs, DOM attributes, and API payloads.
  *Source:* 2026-09-19 operator ruling; cards 20260919_38, 20260919_39.
- **Port and place names are data, not code.** Port/place names live in CRUD data, never hard-coded in identifiers or
  UI logic; no backcompat shims — direct migration.
  *Source:* 2026-09-19 operator ruling, card 20260919_6.

## 9. Design process

- **The goal is elegant UI/UX.** Judge results as a designer (alignment, rhythm, hierarchy, density), propose and apply
  design changes without asking when they serve elegance, within the house language and these laws.
  *Source:* 2026-09-20 operator directive.
- **Reference before invention.** Search the tailkit + untitledui MCP catalogs and the internet (React Aria, NN/g,
  design systems) when a design call is uncertain; in-repo rulings and this book win over external references; the
  internet fills gaps, it does not override house rules. Primitive-looking dropdown styling = take from untitledui
  dropdown components.
  *Reference rule:* 2026-09-20 operator directive; untitledui-dropdown rule 2026-09-18.
- **d-* primitives are sanctioned house primitives.** daisyUI 5 is installed, wired via `tokens.css`
  (`@plugin "daisyui" prefix "d-"` + nepo theme), and adopted (19 files / 170 usages) — it stays. tailkit +
  untitledui catalogs remain the design REFERENCE and the source for new primitive patterns; a d-* → other-library
  rewrite is churn without user-visible value and is not wanted without a fresh operator directive. New primitive
  additions still follow reference-before-invention.
  *Source:* operator delegation 2026-09-23 ("if you think replace daisyUI … no need to ask me anymore" — lead
  ruling: sanction, documented here per card 20260922_39's resolution).
- **QA enforces the book.** No DEV_COMPLETED without embedded per-criterion screenshots; full-page state-matrix at
  1280/1440/1920/2560 per reachable state class; a screenshot contradicting the claim auto-fails the card; shared
  components re-sweep every hosting screen.
  *Source:* operator hard gate 2026-09-19/2026-09-20 (kanban-work skill, QA evidence section).
- **Driver-role surfaces verify mobile-first.** Driver-facing surfaces (my-trips and future driver flows) verify at
  mobile viewports first; desktop evidence is secondary for driver-facing roles.
  *Source:* 2026-09-24 Director ruling (LAW).

## 10. Parity conventions (shared with the sibling TransTing codebases)

Not laws — standing conventions already at parity, verified by the 2026-09-22 study
(`plans/reports/nepocorp-design-lessons-260922.md`):

| Convention | Note |
|---|---|
| `<Money>` component | All currency values; đồng unit rendered subtitle-sized |
| StatusStrip 3×20 | Every status display uses the 3×20px strip component, never full-height color fills |
| Flat shadows | `--sh-*: none` in the app shell — see §3 |
| Fonts | Be Vietnam Pro (UI text) + JetBrains Mono (numeric data, codes) self-hosted; mono is for data only, never Vietnamese prose |
| 12px data density | See §5 |

## 11. Anti-patterns (all banned, with the law that bans each)

| Don't | Do instead | Law |
|---|---|---|
| Pill buttons (`border-radius: 999px`) | Rectangle ~8px | §1 |
| Status/value rendered as pill bubble or rounded fill | Plain text (+ house color-dot) | §1 |
| Decorative icons in data cells | Icons on functional actions only | §1 |
| Same concept twice in one row; contradictory signals | One concept, one place | §1 |
| Generic "Thiếu dữ liệu" | Name the missing field | §1 |
| Success green on costs/payables/pending amounts | Green = completion/money received only | §2 |
| Near-invisible placeholder text (<4.5:1) | ≥4.5:1 readable muted ink | §2 |
| `--accent` as text color | `--success-text` / `--accent-ink` | §2 |
| `overflow: hidden` clipping column values | Wrap / tooltip / card layout | §4 |
| Truncation comment left in code | Wrap it, then delete the comment | §4 |
| Icon-only columns without labels/aria-label | One full-text action max; icon-only destructive with aria-label | §4 |
| Sort hit area <24px or dropped-to-second-line indicator | ≥24px (target 32px), icon inline, explicit states | §4 |
| "71người" | "71 người" | §4 |
| Vertical-scrolling forms on wide screens | Horizontal forms on the /suppliers pattern | §5 |
| Help/onboarding/tour surfaces | Informational empty states | §6 |
| Ad-hoc `empty-*.svg` per page | Shared resolver + shared image set | §6 |
| Auto-closing pickers | Apply stays open; Xong/Enter/Escape closes | §7 |
| Dropdown+free-text duplicates of one datum | One free-text-capable combobox | §7 |
| Connection/session liveness curtains | API calls fail individually | §7 |
| Lecturing helper text | None — trained operators | §8 |
| Raw DB ids as visible text | Business identifiers (Số Bill/Booking, số tờ khai) | §8 |
| Port names in code identifiers | Ports are CRUD data | §8 |
| Inventing UI patterns when unsure | tailkit/untitledui MCP + internet reference first | §9 |

## 12. Change log

| Date | Change |
|---|---|
| 2026-09-22 | Law book created (card 20260922_34, nepocorp F2). Seeded with every standing ruling 09-16 → 09-22. |
| 2026-09-22 | No-truncation sweep (card 20260922_37): table data cells wrap or expand, never clip; §4 short-badge exception clause made explicit; regression pin `table-no-truncation.styles.test.ts`. |
| 2026-09-22 | §4 reconciliation (same-day): the short-badge exception governs `text-overflow: ellipsis` specifically; the tooltip/card fallback (note preview, card 20260915_35) stands as written. |
| 2026-09-23 | §9: d-* (daisyUI 5) primitives sanctioned as house primitives — installed, themed, adopted; tailkit/untitledui remain design references. Card 20260922_39 resolution. |
| 2026-09-24 | §1 shared text+dot contract (card 20260924_21, BATCH A pill-badge purge): the shared `Badge` in `frontend/src/components/shared/` now renders plain text + a single house color-dot via the new `StatusText` component and the `--status-text-*` token triad. NO pill bubble, NO rounded background fill, NO border. The legacy `<Badge variant="…">` API is preserved (delegates) so all three existing callers pick up the new treatment without per-page edits — the purge happens at the SHARED layer. Per-page pill code is not modified in this batch. Pin: `frontend/src/components/shared/StatusText.test.tsx`. |
| 2026-09-24 | §3 flat-surface chief ruling (card 20260924_6): "Bề mặt phẳng: KHÔNG 3D, KHÔNG box-shadow (Chief 24/09)" — visual confirmation on mobile ShipmentsPage (~390px) where toolbar / summary had shadows/3D that obscured the 1-column stack. Mobile filter surfaces now collapse to a one-column stack at ≤480px (label above control, full-width controls, 44px touch floor) via `frontend/src/components/ListFilterBar.css`; the summary rail at ≤480px drops to a 2×2 grid with the XLSX button on its own full-width row (`frontend/src/pages/ShipmentsPage.css`). `frontend/src/styles/utilities.css` adds a global `.sr-only` utility so the PageHeader H1 stops colliding with the breadcrumb title. Focus-visible outlines remain the only sanctioned elevation cue on form fields. Authority: card 20260924_6 (agy), report `plans/reports/c12-agy-card6-mobile-ui.md`. |
| 2026-09-26 | §5 enforcement sweep (case QA-2026-09-26-03, user order "polish UI UX for all mobile device sizes"): all-route × all-width browser sweep (`frontend/mobile-ux-sweep.mjs`) fixed — hamburger 32→44×44 (52 routes); page-CSS button floors 30/40px → shared `#root .btn` ID-scoped guard in phone/`pointer:coarse`/tablet bands (contract: height belongs to the shared primitive); `/profit` `.workflow-profitability__controls .btn` 30px dead rule removed; UUI combobox input 16px strip → full-field tap surface (root `padding-block:0` + input `height:100%` on touch — tapping anywhere now focuses and types; previously opened the list without focus); `.expense-add-btn` 32→44 on phone; unstyled `<small>` 9.6/8.8px → 11px caption token (`/recoverable-costs`); finance chart `tr₫` unit 9→11px; collapsed sidebar rail items 39→47px on coarse pointers only (1024 iPad landscape). Later-law note: 09-22 §5 (44px) supersedes ticket 6770b9cb (09-10, 30/32px phone scale). Pins: `frontend/src/styles/mobile-touch-floor.styles.test.ts` (8 cases). |
| 2026-09-27 | §8 business-identifier rule enforced on the driver task screen (case QA-2026-09-27-01, card `20260927_1`): the `/my-trips/:id` header titled the trip with the internal shipment code (`SHP-YYMM-NNNNN`) — it now titles with the carrier document number (Số Bill on IMPORT / Số Booking on EXPORT), direction-first, falling back to factory → route → "Lệnh vận chuyển"; the internal code is never a fallback. §8 density: the `Chứng từ giao hàng` completion card dropped its 2-line instruction + 2-row bullet list for a section-scale title and one `·`-separated missing-documents line (`role="list"`), 128px → 56px at 390px; the instruction paragraph survives only in the closed state. §5 bottom-fill ruling (new): a fixed tab bar pinned to a shorter layout viewport than the visible one (mobile browser / in-app WebView retaining a bottom toolbar strip) MUST paint its own `--surface` band past the layout-viewport bottom edge (`.bottom-nav::after`, plus the root canvas via `html:has(body .app.is-driver)`), and sticky bars stacked ABOVE the tab bar MUST NOT re-add `env(safe-area-inset-bottom)` — the tab bar already reserves it. |
| 2026-09-27 | §Controls: KHÔNG hiển thị text phím tắt (⌘K, Cmd+K...) trong bất kỳ control nào (CHIEF 27/09). Phím tắt vẫn hoạt động nhưng là vô hình — badge/kbd trong input, select, combobox, search shell bị loại bỏ ở tầng render (input.tsx, combobox.tsx, tag-select.tsx, ListFilterBar). Pin: các suite base-component không khẳng định bất kỳ nút phím tắt nào được hiển thị. |

| 2026-09-27 | **All-device-size continuation** (operator principle: "elegant visual UI in all device sizes" resolves conflicts): the record card was extended to the TABLET band — labels ride the value line with the SHORT sentence-case name range-wide (tablet previously kept the uppercase long-form label while the phone had the short one: two label voices on one product), the schedule block and the direction chip inline, and the dispatch-decision + notes cells PAIR in the two columns instead of each owning a full-width row whose content filled ~30% (a 742px row with 30% content reads as a hole). Measured at 768px: container card 357px → 226px, master-plan lô card 430px → 286px. Verified at 390/768/1024/1440 that thead/table mode is untouched above the record breakpoint (evidence `qa/matrix/`, `qa/matrix-sweep/`). Also: master-plan placeholders now name their field (`Chưa có cont` for an empty port group or cargo summary, was a bare `—`); `/config/fuel-price-periods` gates the accountant quotation-approval inbox by role so CUS no longer fires a request Casbin refuses (403 gone, pinned by test); `/accounting/invoice-tracking` gained the house phone record-card mode (13 columns → labelled cards with `data-label`, token rail kept above the breakpoint). |
| 2026-09-27 | §1/§4/§5/§6/§8 four-role sweep (user order "go through all pages of these roles (chungtu, dieuvan, laixe, ops) and visually check and fix"; instrument `frontend/role-ui-sweep.mjs` + `role-ui-sweep-report.mjs`, evidence `qa/role-sweep*/`, `qa/final-sweep/`, 48 captures at 390 + 1440). **Dispatch phone records rebuilt**: the phone card printed up to nine uppercase label rows of its own (one card = 469px at 390px); the label now rides the record line it names via a new `data-label-short` attribute (sentence case, 11px, `·`-separated values) and empty placeholder lines collapse (`data-empty`), so a container card is 371px and a master-plan lô card 242px (was 370). The dispatch-detail phone header became two deterministic cells ([title \| presets] / [range \| + Gán xe]) plus a 2-track facet grid whose last row holds Bộ lọc/Xóa lọc, replacing four stacked bands with two controls alone on near-empty rows (296px → 96px header). **Shared fixes**: `DateRangePopover` trigger is content-sized (`max-content`, floor 220) — a fixed 220px ellipsized the trigger's OWN `DD/MM/YYYY - DD/MM/YYYY` value on /shipments, /shipments-debit and /accounting/invoice-tracking at both widths; `ListFilterBar` phone band stacks a pair that holds a date RANGE; `.btn--danger-outline` (referenced by the dispatch catalogs but never defined) is now defined; every rendered ⌘K/kbd badge deleted (ShipmentsPage, CustomersPage, RoutesConfigPage, CatalogTableShell + the dead `shortcut` prop/CSS) per the 27/09 no-shortcut-text ruling; catalog search wrapper stretches full width on phones; `.ops-wallet__empty` stays a real table cell (its `display:block` confined the desktop empty message to column 1). **Copy/data**: missing values name their field on the OPS pages and fuel-price register; CUS direction badge no longer renders an empty pill; forwarder empty states stopped instructing; driver phone topbar keeps the notification bell (`.topbar__actions` could shrink to 0 width) and driver screens show a title again; notification messages strip the internal `TRP-…` code via the shared `lib/notificationText` helper. Residual findings reported, not fixed: `/config/fuel-price-periods` calls `/api/quotations/fuel-approvals` which 403s for CUS (role/casbin mismatch); `/accounting/invoice-tracking` keeps the 13-column token table with its horizontal rail (permitted by §4). |
| 2026-09-27 | **Global button group** (operator ruling: "this is our existing working button group and I like it, please use this consistently globally"). The fleet-vehicle status group (`Tất cả 45` · `Hoạt động 44` · `Bảo trì / Ngưng 1`) is THE segmented-control look, and `design-system/Tabs variant="boxed"` is its single implementation: hairline container on `--surface-2`, 2px inset, flat white active pill (1px `--line-2` outline, **no shadow** — flat-surface law), **plain tone-coloured count numerals** (`countTone: 'accent' | 'warning' | 'info'`, no count pills, tabular numerals), 12px/600 labels, 6px cell radius, 2px gap, 44px floor under `(pointer: coarse), (max-width: 767px)`. Converted in this ruling: the dispatch date scope (`Hôm nay/Hôm sau/Tất cả`, was a bespoke UUI-button grid) and every hand-rolled `role="tab"` group in `FleetVehiclesView`, `FleetDriversView`, `CustomersPage`, `PayableListPage`, `DebtDetailPage`, `PeriodFilter`, `RoleWorkInbox`. One-off group CSS is deleted, not aliased; a page may size the group (phone type scale) but never restyle its shape. Locked by `frontend/design-lock/expectations/dispatch.mjs` (`date-scope-is-the-shared-group`, `no-bespoke-segment`) and the CSS pins in `DetailedPlanGrid.date-pair.verify.styles.test.ts` / `Tabs.styles.test.ts`. |
| 2026-09-27 | **Driver phone chrome is compact** (operator report with two screenshots: the topbar stacked identity / plate / month navigator on three rows — "move the date to compact size and to header, why two rows here"; the trip-detail completion bar read as an oversized slab — "too big … make it subtle"). (1) `frontend/src/components/layout/topbar.css` ≤640 driver band: the month navigator no longer takes a full-width row under the greeting — identity · date chip · bell share ONE row (wrap kept only as the ≤340px fallback) and the chip drops its period range in that band, staying in the trigger's `aria-label` and returning at ≥641px. Measured 390px: header 110px → 57px, driver name not ellipsised. (2) `frontend/src/pages/DriverTripDetailPage.css`: `.driver-task-complete-sticky__btn` returns to the shared control geometry (`--control-h` 44px, `--radius-field` 8px, weight 600, gap 6 — no raised 48px cabin size on a navigation affordance) and its disabled face is a quiet `--surface-3` / `--ink-2` placeholder at full opacity instead of the ink fill at 55% opacity (the grey slab); the live count renders at the 11px caption token. Holding instrument: `testplan/qa/scripts/ui-driver-chrome-20260927.mjs` (TC-DRIVER-CHROME-01..03, 390 + 768, evidence `testplan/qa/evidence/*_driver-chrome/`); spec `testplan/cycles/2026-09/2026-09-27_driver-chrome-compact.md`. |
| 2026-09-27 | **From/to dates are two independent fields — no date-range picker** (CHIEF ruling, two screenshots at ~1187px: "choose from and to separately instead of one long control", then "I dont want daterangepicker" + "I want seprate control for from date and to date, I dont want to merge"). The shared `DateRangePopover` (one dual-calendar trigger, later split into two halves sharing one popover) is DELETED; `design-system/forms/DateRangeFields.tsx` is the one implementation: two `BufferedUuiDateInput` single-date fields in a transparent 2-track grid, each with its own one-month calendar, order enforced by `min`/`max` between the two (a typed or picked out-of-order date is refused — no clamp code needed). Quick ranges are no longer hidden in a popover: `DateRangePresets` renders them as the shared boxed segmented group beside the fields. Migrated: /shipments, /shipments-detail, /shipments-debit, /accounting/invoice-tracking, /dispatch (master-plan toolbar + drawer), /dispatch-detail. Pins: `components/filter-grid-rebuild.styles.test.ts`, `features/dispatch/*/…date-pair.verify.styles.test.ts`, page suites. |
| 2026-09-27 | **One filter-bar layout at every width — the declared tablet band is retired** (CHIEF, two screenshots at ~1187px: "this page and many other page having similar problem where the controls are layout poorly … if layout efficiently I just need 2 rows instead currently 4 rows" + "check all filers control section of all pages to ensure proper visual display and layout" + "need to ensure look properly layout in all device size"). `.filter-bar` (`components/FilterBar.css`) is now THE bar layout: `display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))` — the column count is MEASURED from the bar's own width, never declared per breakpoint; equal tracks are what make a wrapped row line up (content-sized tracks gave one row a 198px and a 253px select). The `768-1279px ⇒ exactly 2 columns` band that forced the 8-control Chi tiết lô hàng bar into FOUR rows is deleted; only the phone stack (`<768px`, one column) remains a band. Two structurally wide families own two tracks: the from/to date group and the shared segmented group (`.ds-tabs`). The flex spacer is retired (`display: none`; the item after it pins to the row end via `grid-column: auto / -1`). Every filter surface in the app carries `.filter-bar` and keeps only its own sizes: /shipments Row 2 now rides the shared `ListFilterBar` (its bespoke toolbar + search shell CSS deleted), plus /shipments-detail, /shipments-debit, /accounting/invoice-tracking, /expense-list, /debt-list, /penalty log, /phoi-phieu-control, /deposit-refund-tracker, expense accounting + reconciliation history, shipment-finance panel, /portal statement. Measured at 390/768/1024/1187/1440 (instrument `testplan/qa/scripts/ui-filter-layout-sweep-20260927.mjs`): the detail bar 4 rows → 2 rows at ≥1024, 3 at 768; 0 clipped controls, 0 overflow. Pins: `components/filter-grid-rebuild.styles.test.ts`. |
| 2026-09-27 | **The filter strip is ONE wrapping flex line in one card — the grid above is retired** (CHIEF, four reports the same day on /shipments: "too many fucking rows", "some control the value very short but why the fuck it does take full row? the width of control should relative to value it holds", "why the dropdown jump around not right below where I clicked", "our goal is trying to keep this 2 rows max"). `.filter-bar` (`components/FilterBar.css`) is `display:flex; flex-wrap:wrap; gap:12px 16px` inside ONE `--surface` card: the criteria every list shares stay INLINE (search · Từ/Đến · quick-range chips · `Bộ lọc` · reset) and every other criterion lives in the ONE `components/FilterDropdown` dialog, which renders its children inline whenever the bar holds 2 rows — the fold is MEASURED from the rendered lines, never declared at a breakpoint (`components/filter-bar-mode.ts`, `RETRY_SLACK` hysteresis so it cannot flap). Controls are as wide as the value they hold via a descendant `width:auto` reset no page wrapper can out-specify; the ≤767 card-strip and width re-assertions are deleted. Locks: `design-lock/expectations/filters.mjs` (`rows` ≤2 at 594/768/1024/1187/1440, `maxWidth` pair 348 / trigger 180 / plan 320 / presets 340). Measured at 594-1440: 2 rows, 0 clipped controls, 0 overflow. |
| 2026-09-27 | **The filter card spans the same width as the tab row above it** (CHIEF screenshot, 4 words: "misalinment where tab row longer than row below"). The ≤767 band stripped the bar of its card and inset it 12px (`margin: 0 12px 12px`, `border: 0`, `background: transparent`), so a 704px /shipments drew a 681px tab row over a 657px bar. Those five declarations are DELETED — the card is the bar's chrome at every width, so its outer box always matches the tab group. Same ruling: the `Từ`/`Đến` cue becomes `sr-only` below 768px (accessible name kept), which drops the pair from 2×149px to 2×125px and is what lets `search + date pair + Bộ lọc` share ONE line at a 704px bar — 3 rows → 2. |
| 2026-09-27 | **One control ceiling app-wide: text 11-12px, component ≤40px** (CHIEF, /shipments screenshot: "componentsize too oversize comparet to text, we should keep this global rule, text 11px 12px component size max 40px"). `styles/tokens.css` gains `--control-max-h: 40px` and the touch floor IS that ceiling (`--control-touch-h: var(--control-max-h)` — a coarse pointer inflated the 30px filter fields to 44px around 12px text; measured before: search, both date fields, the `Bộ lọc` trigger and the quick-range chips all 44px, after: all 40px). `[data-control-size='xl']` and `--control-h` resolve through the token, so every `var(--control-touch-h)` consumer inherits the cap without an edit. The `tapFloor` design-lock default follows the ruling (40px, was 44 — pass `min: 44` where a surface genuinely needs the old floor). Locks: `design-lock/expectations/filters.mjs` (`tapFloor min 40` at 390 + 594, `minFont` 11). |
| 2026-09-27 | **The `Bộ lọc` dialog holds two rows and the ranges fold in as a dropdown** (CHIEF, dialog screenshot + the wrapped chips group: "please use dropdown here instead of [the wrapped chips]", "we can increse width of dialog so that all filters and buttons fit 2 rows, instead of 3", "the height of component ke hoach dropdown too high, please reduce to be same as other dropdown"). (1) `design-system/forms/DateRangeFields.tsx` gains `DateRangePresetSelect` — the SAME `presets` array as `DateRangePresets`, rendered as one content-sized dropdown (`Ngày: Hôm nay` … `Tất cả`) for the dialog; the chips stay in the bar, so there is exactly one implementation of the ranges per container and no second preset list. (2) `components/FilterDropdown.css` panel is `min(520px, calc(100vw - 24px))` (was a flat 320px) and the folded ranges are a `flex: 0 0 auto` item on the same line as the criteria, not a `flex: 1 1 100%` block — measured 500px viewport: row 1 `[Ngày][Xuất/Nhập][Loại]`, row 2 `[Kế hoạch][Đặt lại][Áp dụng]`; 594px: the ranges stay in the bar and the dialog is still two rows. (3) The dialog's footer/hint row is deleted — `Đặt lại`/`Áp dụng` are `.filter-dropdown__actions` inside the body (`margin-left:auto`), and every criterion in a filter context is forced to ONE height (`:is(.filter-bar, .filter-dropdown__body) .searchable-select__trigger`, `--filter-control-h`) so `SearchableSelect`'s phone band can no longer out-height its siblings. Held by `components/FilterDropdown.test.tsx` and `design-lock/expectations/filters.mjs` (`rows ≤2`, `matchHeight`, `maxWidth .filter-dropdown__trigger ≤180`). |
| 2026-09-27 | **Every filter control plane in the app is the ONE strip** (operator: "apply the philosphy implement UI change to all pages filters control plane" + "also redesign this to make it data dense card"). The 46 renderers of `ListFilterBar` now include every surface that still hand-rolled a toolbar: the dispatch catalogs (via `CatalogTableShell`), the detailed-plan header + Drawer, the trips filter card, users/audit/ops-orders/salary, the payables family, the config catalogue shell (`CrudTable` — 17 pages in one edit), `/config`, `/customers`, the transport register, fuel-evidence, recoverable costs, the profitability panel, `/config/routes`, the shipment-finance panel and the shared `PeriodFilter`. A page may only size a control inside the family caps; secondary criteria live in the `Bộ lọc` dialog; a status/scope/role segment is `Tabs variant="boxed"` and — new — a boxed group placed in a bar takes the strip's own control height (`.filter-bar .ds-tabs__btn`), since a bar child otherwise stood 36px beside 30px siblings. Dead with it: `.fwd-filter-chip*`, the `Toolbar` pill row, `WorkboardFilters` + `.list-filter-bar__pair`, the `.filter-tabs`/`.pill-row` band, and the duplicated desktop/phone selects on the admin + forwarder pages. Same ruling, the **record card**: at ≤999px the CUS shipment card is a two-column FACT grid — only the identity cell spans both columns, the section label rides the first value's line (`data-cell-short` prints the short form), a cell whose facts are all placeholders collapses them onto one line (`data-facts="inline"`, ` · `-separated) and cargo nothing is known about is named once ("Chưa có hàng hóa") instead of "— · — kg". Measured: 500px card 375 → 203px, 768px 379 → 263px for the same information (locks `shipments/{phone,tablet}/record-card-density`). |
| 2026-09-27 | **The shared record-table card is data dense too** (operator, screenshot of `/config/fuel-price-periods`: "redesign this to fit data dense UI philosophy"). `styles/record-table.css`'s container-≤1100px band printed every fact as a label line ABOVE its value, so a four-fact catalogue card was 230px tall for four short facts and half of each card was dead space. The label is an inline caption now (`td::before { display: inline }`, 11px uppercase muted) and the cell rhythm is `5px 12px`, so a fact costs one line instead of two — measured `/config/fuel-price-periods` 230 → **117px** at 1147 and 768, 138 → 118px at 390, `/config/ports` 125px, with the role sweep clean at every route × 390/1440 (0 overflow, 0 clipped, 0 sub-11px, 0 console errors). Locks `config/fuel-price-periods/{w1147,w768}/card-density` + `no-clipped-text` and `config/ports/w1147/card-density`. |
| 2026-09-28 | **Both paid UI catalogs are mandatory for a UI/UX problem, and their roles are pinned.** The "reference before invention" rule of §9 now has a named discovery step: the **Untitled UI PRO** MCP (`search_components` → `get_component`/`get_component_bundle` → the returned `pnpm uui:add:*`) is the component **source** — its returned command is the pinned install path, and `frontend/src/components/untitled-ui/installed.json` (enforced by `structure.guard.test.ts`) is the do-not-overwrite record. The **Tailkit** MCP is a **pattern reference only**: its app components are built on a `secondary-{50..900}` ramp plus `@headlessui/react` and Heroicons `hi-*` classes that this project does not have, so it is retokenized, never pasted — checklist in `frontend/docs/tailkit-ui.md`. Routing is enforced in `AGENTS.md` (mandatory tool routing + a design-provenance rule on the UI verification contract): a UI decision names the catalog and component id it consulted, or states why a house primitive was the right answer. The Untitled theme re-colouring and the `components.json` v8 pin are now `pnpm check:brand` failures, so an upstream theme re-fetch cannot silently revert the brand. |
| 2026-09-29 | **One page heading, sentence case — and never a second name welded onto it** (CHIEF report with two screenshots of the Kế toán section; `/accounting/chot-debit` titled itself *"Kế toán chốt debit — KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP"*, its board caption repeated *"KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP — thu/trả theo lô (cước vận chuyển)"*, and a second heading shouted *"TỔNG HỢP CÔNG NỢ KHÁCH HÀNG"*): the H1 is the SCREEN's name — the thing the sidebar already calls it — so it is ONE name, sentence case, with no separator joining a second one and no ALL-CAPS run. The document a board renders is the BOARD's identity: it belongs in the board's own `<h2>`/`<caption>`, where the period and the row count can sit beside it. A detail page composing `<record> — <value>` at runtime is a different thing (its suffix is a business identifier), which is why the guard reads literal `title=` values only. The same case rule governs every literal `<h1|h2|h3>` and every VISIBLE `<caption>`: a caption is `sr-only` when it only restates the page name; otherwise it carries what the table ADDS. Pin: `frontend/src/components/page-heading-law.test.ts` (app-wide source scan; measured before landing — 2 offending titles and 3 offending headings app-wide, all in this section). |
| 2026-09-29 | **A board too wide for the canvas scrolls ON PURPOSE** (same report: the /accounting/chot-debit board was a 2640px `table-layout: fixed` wall whose explicit colgroup shares were the only thing holding it together, and half of it lived off screen; /accounting/phoi-phieu squeezed 11 columns into ~57px needles instead): a money matrix wider than the ~1150px operational canvas gets (1) an explicit scroll box with a `--border-1` hairline, (2) a per-column `min-width` so the header wraps inside its own cell and the TABLE grows instead of the columns collapsing, (3) a STICKY identity pair (the board's axis + the row's identity) at `z-index: var(--z-base)` so it stays under the sticky header band while painting above the columns that scroll under it, and (4) a touch-only scroll cue (the card 20260924_9 `/shipments-debit` pattern). A `nowrap` HEADER is the defect that starves the data columns — the amount never wraps, its header always does. Pin: `frontend/src/pages/accounting/AccountingDebitClosePage.css`. |
| 2026-09-29 | **A column with no value is not a column — and absence is not data** (same report; the board opened with four money columns whose every cell read "Thiếu cước thu"): card `20260928_193`'s `autoHideWhenEmpty` default is applied to the value behind the cell, not to the cell's text. A breakdown column hidden while every rendered row is *missing* that field returns by itself the moment one row carries a number, and an explicit choice in the column picker always wins. The board's totals, identity and action columns never take part — they are the board's decision surface. Pin: `frontend/src/pages/accounting/AccountingDebitClosePage.test.tsx` ("a breakdown column with no value anywhere stays out of the board, and returns with data"). |
| 2026-09-29 | **Bulk actions belong to the selection** (same report; the board carried two always-visible buttons reading "(0 dòng)" and "(0)" — dead controls that taught the operator nothing): an action that needs a selection appears WITH the selection, and the strip that appears states how many rows it covers. The bar keeps exactly one primary action plus the batch actions that act on the FILTER (e.g. "Xác nhận đối soát (N)"), the selection-scoped actions ride a strip under the bar, and "select all" states its scope in its own label ("Chọn tất cả N lô đủ điều kiện" — the rows the filter is showing, never the whole result set). Pin: `frontend/src/pages/accounting/AccountingDebitClosePage.tsx`. |
| 2026-09-29 | **Filter plane and primitives: the Kế toán section converges** (same report; the section was named the worst offender in `docs/design-system/03-data-display-and-feedback.md`): `/accounting/chot-debit` moved its hand-rolled filter flex row and `<details>` checkbox dropdown onto the ONE `ListFilterBar` (dates = the shared `DateRangeFields`, facets = shared `SearchableMultiSelect` inside the one `Bộ lọc` dialog, columns = the shared `ColumnPicker`); its `tt-table` 2640px board became a page-scoped scroll box over the shared table typography; `/accounting/expenses` stopped printing its own `<h1>` + back link for the `PageHeader` primitive and the app-wide term (`Chi phí phát sinh`); the dead `DebitFilterDropdown` was deleted once its only consumer went. Nothing here is a new primitive — every substitution is an existing one. |
| 2026-09-29 | **Two shared table defects the Kế toán sweep surfaced, fixed at the primitive** (the sweep's own evidence, not a new operator ruling — recorded here because each one had already been patched page-locally three times, which is the divergence §"rule of one answer" exists to stop): (1) **a header label is never chopped mid-word.** `record-table thead th` declared `overflow-wrap: anywhere`, so a narrow column's min-content was one CHARACTER and shredded its label ("CONTAINER" → CONTAINE + R, the defect QA filed as card 20260922_54; `/accounting/deposit-tracker`'s `STT` rendered over two lines). `.ppc-board`, `.shipment-debit-table` and `.invoice-tracking-table` each carried their own copy of the fix. Both the shared base and the global `:where(table thead th)` now declare `overflow-wrap: normal; word-break: keep-all` — law §4's "single-token values EXPAND" applied to the head, so the COLUMN sizes to the label. (2) **supporting text inside a data cell floors at 11px.** A `<small>` beside 12px data renders at the browser's 0.8em default (9.6px, §5 wants 11px for supporting text, and `role-ui-sweep.mjs` counts sub-11px as a defect); the global table base now floors it at `--ops-table-meta-size`. Pins: `src/styles/table-no-truncation.styles.test.ts` (the header rule), `src/styles/operational-table-typography.test.ts` (the `<small>` floor). Measured after: 0 chopped headers and 0 sub-11px text across the 18 routes swept at 1440, and `pnpm design:drift` FELL (rawShadow 61→59, rawZIndex 81→80, untokenizedTransition 133→132). |
| 2026-09-30 | **The phone's screen name lives in the topbar — one title, and the page keeps the accessible one** (operator, two phone screenshots side by side: `/shipments` printed "Tổng quan lô hàng" in its own header row while `/shipments-detail` printed the same words in the topbar; the request was to make them match). `/shipments` is the only page that had inverted the split: it owned a *visible* `<h1>` AND suppressed the topbar's fallback via `lib/page-heading-policy.ts` + `.app--page-own-heading`, so the phone showed a bespoke header row where every other route shows the shell title. That page now takes the same treatment `PageHeader` gives every other screen — at ≤640px `.shipments-control__title` is sr-only (in the a11y tree, out of the visual flow) and the topbar's "Đang xem" block is the visible title at EVERY width. The policy module, its test, the `Layout.tsx` class and the responsive rule are DELETED: with no page owning a visible phone heading there is nothing left to suppress, and the exact-match path list was the mechanism's whole risk (a prefix would have stripped the title off `/shipments/new`, `-detail`, `-debit`, `/:id`). The `<h1>` is not deleted above 640px — desktop keeps the page's own title beside the tabs, as before. Pin: `src/pages/ShipmentsPage.test.tsx` (the ≤640px sr-only rule + no `app--page-own-heading` in `responsive.css`). Measured: 390px title height 1px (sr-only) with the topbar title visible; 768/1440px unchanged; 0 horizontal overflow at all three. |
