# SIL-1228 … SIL-1232 — /config/quotations: filter label, fee catalog table, empty pane, lag wording

Case ID: SIL-1228-R1..R3, SIL-1229-R1..R2, SIL-1230-R1..R2, SIL-1231-R1..R2,
SIL-1232-R1 (QA report 28/11/2026, build 0c3e10f9, staging
vantai.tingting.vip, vai Quản trị viên, màn Báo giá `/config/quotations`).

**Ticket:** SIL-1228 (id 1420), SIL-1229 (id 1421), SIL-1230 (id 1422),
SIL-1231 (id 1423), SIL-1232 (id 1424) — board plan.tingting.vip/tingtingsoft
(SIL).
**Owner (implement):** frontend `pages/config/QuotationConfigPage.tsx`,
`pages/config/QuotationConfigPage.css`, `pages/config/QuotationFeesSection.tsx`,
`design-system/forms/UuiSelectField.{tsx,css}`.
**Owner (verify):** qa
**Status (this doc):** READY — regression recorded prior to implementation per
AGENTS.md §6.
**KB:** §5 filter law (docs/design-guidelines.md), design-system §controls
(hosted filter labels — QA-AUDIT-UI-56), no-truncation doctrine (§4),
design law "responsive wrapping without clipping".

---

## Root cause (verified in source)

- **SIL-1228** — `UuiSelectField` renders its label INSIDE the control row
  (`design-system/forms/UuiSelectField.css`: `.filter-bar .ds-uui-select
  .ds-uui-select__control { flex-direction: row; … }` + the `[data-label]`
  rule). `BufferedUuiDateInput` renders its `<Label>` ABOVE the control
  (`design-system/forms/BufferedUuiDateInput.tsx` — `<Label>` then the
  control). The quotations filter bar hosts both, so one bar carried two
  label anatomies: 'Khách hàng' inline (y=167) beside its select, 'Từ ngày' /
  'Đến ngày' stacked (y=137) above their inputs — a 30px offset between two
  label rows of the SAME bar. At 390px the criteria fold into the 'Bộ lọc'
  dialog (portalled out of `.filter-bar`), where the select falls back to the
  stacked anatomy — which is why the defect was desktop-only.
- **SIL-1229** — the fee catalog table (`.tt-table`) carries the shared
  `min-width: 480px` phone floor (`styles/responsive.css`), and its host
  `<section class="quotation-fees">` had NO scroll container (the page CSS
  declared no `.quotation-fees` rule at all). `overflow-x` therefore stayed
  `visible`, the table's 480px overflowed the 374px client width, and the
  document did not scroll either (`document.scrollWidth = 390`).
- **SIL-1230** — `.tt-table` is `table-layout: fixed` with no declared column
  widths (`components/Table.css`), so the seven fee columns took an equal
  share (1144/7 = 163px): STT spent 163px on one or two characters while
  PHÂN LOẠI wrapped its routing string over three lines (row height 61px).
- **SIL-1231** — `.quotation-detail.is-empty` centers its state in a 240px
  box (`place-items: center; min-height: 240px`), and the layout row is
  `align-items: start`, so the pane never took the height of the column it
  sits in: the state stayed at the top of a ~680px tall visible region.
- **SIL-1232** — the frame strip hard-coded the internal term
  (`QuotationConfigPage.tsx`: "engine tra giá dầu kỳ") in operator-facing copy.

## Case SIL-1228-R1 — the customer filter's label sits ABOVE its control at 1440px

- **Given** `/config/quotations` at 1440x900, vai Quản trị viên.
- **When** the filter bar renders.
- **Then** the 'Khách hàng' label sits on its OWN line above the select, the
  same anatomy as 'Từ ngày' / 'Đến ngày'; all three filter groups share one
  label line and one control baseline (no 30px offset between two label rows
  of the same bar). The select keeps its accessible name ('Khách hàng').

## Case SIL-1228-R2 — the other filter bars keep the band's inline row

- **Given** any other surface hosting a select in the shared `FilterBar`.
- **When** the band renders.
- **Then** the select keeps the inline label/control row (docs/design-system
  §controls — "Hosted filter labels", QA-AUDIT-UI-56): the stacked anatomy is
  opt-in, never a silent change of the shared band.

## Case SIL-1229-R1 — the fee catalog scrolls horizontally at 390px

- **Given** `/config/quotations` at 390x844 with a frame opened (the fee
  catalog visible).
- **When** the catalog renders.
- **Then** the table sits INSIDE the shared `.table-scroll` host
  (`overflow-x: auto`), the host scrolls horizontally, and the THAO TÁC
  ([Xoá]) button is reachable by scrolling — no column is painted outside the
  viewport with no way to reach it; the page itself does not scroll sideways.

## Case SIL-1229-R2 — the fee catalog at 1440px is untouched by the scroll host

- **Given** `/config/quotations` at 1440x900.
- **When** the catalog renders.
- **Then** the table fills its column (no horizontal scrollbar, no empty
  gutter) and every cell keeps its content.

## Case SIL-1230-R1 — the fee columns follow their content at 1440px

- **Given** `/config/quotations` at 1440x900 with a frame opened.
- **When** the catalog renders.
- **Then** STT takes a narrow track (48px), PHÂN LOẠI the wide one (28%),
  SỐ TIỀN / ĐỊNH TUYẾN / GHI CHÚ / THAO TÁC their own widths — the seven
  columns are NOT an equal share any more; the headers WRAP instead of
  painting over the neighbour column, and the routing string no longer needs
  three lines (the row is shorter than 61px for the reported content).

## Case SIL-1230-R2 — the headers never paint over a neighbour column

- **Given** the same catalog at 1440px.
- **When** the header row renders.
- **Then** no header word is clipped mid-word ('SỐ TIỀN M', 'ĐỊNH TUYẾ',
  'GHI CH') and no header overlaps the neighbouring column.

## Case SIL-1231-R1 — the empty state centers in the detail column at 1440px

- **Given** `/config/quotations` at 1440x900 with NO frame selected.
- **When** the page renders.
- **Then** the empty state (illustration + 'Chọn một báo giá để xem lưới
  giá.') is centered on BOTH axes of the visible detail column: its center
  sits near the column's vertical middle (was ~215px above it), and the blank
  canvas is distributed above and below it instead of piling up underneath.

## Case SIL-1231-R2 — a selected frame keeps the column at its content height

- **Given** `/config/quotations` at 1440x900 with a frame selected.
- **When** the page renders.
- **Then** the detail column keeps its content height, and the fee catalog
  and the version history follow it immediately (the empty-state stretch never
  pushes them below the fold).

## Case SIL-1232-R1 — the lag strip speaks business language

- **Given** `/config/quotations` with a frame opened.
- **When** the frame strip renders.
- **Then** the line reads 'Độ trễ áp giá dầu … ngày — hệ thống tra giá dầu kỳ
  (ngày vận chuyển − độ trễ)'; the internal term 'engine' appears nowhere in
  the operator-facing copy.
