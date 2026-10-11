# Case: card 111026195000 — /shipments/new layout after the owner mock + all-size assurance

- Case ID: 2026-10-11-card111026195000-layout-mock
- Reported: 11/10/2026 19:46-19:55 (owner images 5/6/7 + mock `/Users/dev/Downloads/Tạo lô hàng.html` + "use untitled PRO" + "ensure UI UX looks good in all device size")
- Status: FIXED (11/10 20:0x)

## Reproduction

At the owner's 1000px window the "Thông tin hàng" section fell into the
stacked-record tier (`@container (max-width: 1037px)`): each container
rendered as a ~307px-tall two-column form (measured: 9 cells at 451px,
one field per line) instead of the dense 40px spreadsheet row the owner's
idea references show. The mock also specifies: fixed bottom action bar
with status text, chip-style option flags, and a scroll-capped declaration
panel.

## Root cause

The record-transform threshold (1037px container) was set when the table
had no internal scroll; the base tier already ships
`.csc-container-table-scroll { overflow-x: auto }` +
`.csc-container-table { min-width: 1038px }`, so the stack was the only
way to fit mid widths. The mock prefers the scrolling dense row.

## Fix (consultation recorded)

- Tier threshold `@container (max-width: 1037px)` → `620px` (both blocks:
  record transform + the editor-reveal carve-out). Mid widths (768/1000
  measured: table-row 40px, header visible, internal horizontal scroll)
  keep the dense row; phones keep the record card (390 measured: grid,
  no header). Pins updated in ClerkShipmentCreatePage.styles.test.ts +
  picker-reveal styles test; comments in ShipmentContainerCell.css.
- Fixed bottom action bar (mock `.bar`; UUI modal-foot idiom — border-top
  surface bar, right-aligned actions; searches recorded): status line
  (validation count / submit error / ready) + Huỷ + Tạo lô hàng; env
  safe-area strip inside its own opaque box (counted once); page trailing
  clearance `calc(84px + env)` once at every tier. The old
  `.csc-summary__actions` block retired; validation list stays in flow.
- Data-flag chips (mock `.opt`; supersedes the 20260922_31 plain-box
  ruling): ONE shared chip treatment for all three flags, brand-soft fill
  + accent border when checked.
- Declaration panel scroll cap: list scrolls inside its panel (max-height
  372px, overscroll contained); head (title + count pill) and add row
  anchored.

## Evidence

- Local rung PASS (container-tier-rung.mjs): tier assertions at
  1000/768/390 + action bar fixed/bottom:0/hasCreate at all widths;
  screenshots qa/2026-10-11_card111026195000_ui-tier-*.png + driver log.
- Create suites 17 files/195 tests green after pin updates.
- Full gates: see qa/2026-10-11_card111026195000_* logs.

## Not in this wave (proposed follow-ups from the mock)

- Label-line "+ Thêm" actions (move append buttons onto the field label
  line) — JSX restructuring across SearchableField consumers + test churn.
- Segmented control for Nhập khẩu/Xuất khẩu (replaces the select).
- Bulk-paste for declarations (Dán nhiều số) — new interaction + tests.
