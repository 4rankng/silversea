# Design Guidelines — Silversea house design law book

> **Audience:** every lane building or reviewing Silversea UI (frontend, fullstack, QA).
> Model: nepocorp's `docs/design-guidelines.md` (299 lines). Sources consolidated:
> operator rulings (2026-09-16 → 2026-09-22), the 2026-09-22 four-role QA sweep
> (`testplan/2026-09-22-ui-ux-sweep-4-roles.md`, cards 20260922_24–28), and the
> operator-approved nepocorp study
> (`plans/reports/nepocorp-design-lessons-260922.md`, order: study → tickets → implement only after).
>
> **How a law enters this book:** an operator ruling or a lead-filed, operator-approved card.
> Every law carries its ruling date and originating card (session rulings cite the ruling date;
> sweep cards cite the sweep). A later law supersedes an earlier one and says so in its source line.
> Unwritten does not mean unruled — when a design call is uncertain, see *Design process* below.

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

## 4. Tables and data display

- **No-truncation doctrine.** Never clip a column value (`overflow: hidden` clipping is banned). Long text wraps by
  default (`overflow-wrap`); single-token values (codes, plates, tax codes, phones) instead EXPAND — `white-space:
  nowrap` with no clip, so the column sizes to content (composes with card 20260922_22's auto layout). A hover tooltip
  with the full text or a card layout is the fallback for values that cannot wrap. Horizontal scroll is reserved for
  token tables (card 20260922_23 pattern). **The only truncation allowed in a table is an intentional short badge
  adjacent to `sr-only` text** — every other clipped cell value is a defect.
  *Source:* nepocorp report F5 (2026-09-22); default rule per data table + exception clause = card 20260922_37
  (swept 2026-09-22).
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
- **QA enforces the book.** No DEV_COMPLETED without embedded per-criterion screenshots; full-page state-matrix at
  1280/1440/1920/2560 per reachable state class; a screenshot contradicting the claim auto-fails the card; shared
  components re-sweep every hosting screen.
  *Source:* operator hard gate 2026-09-19/2026-09-20 (kanban-work skill, QA evidence section).

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
