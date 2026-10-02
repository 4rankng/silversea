# Regression case QA-2026-09-22-01 — Chi phí/Quyết toán filter bar stacks 4 rows with full-width date inputs

- **Case ID:** QA-2026-09-22-01
- **Reported:** 2026-09-22, operator screenshot ("why control takes 4 rows and date control so fucking long")
- **Surface:** `/shipments-debit` (ShipmentDebitPage filter bar — card 20260922_38 adoption)
- **Status:** repro captured (before-fix screenshots 53/54), fix in progress

## Repro (first try, local http://localhost:7175)

1. Login `admin` (password per testplan/testaccounts.txt).
2. Navigate to `Chi phí - Quyết toán` (`/shipments-debit`).
3. Observe the filter area under the page header.

## Expected

One compact filter row at ≥1280px: `Khách hàng` (240–320px) · `Từ ngày giao` (~150–170px) ·
`Đến ngày giao` (~150–170px) · `Trạng thái khóa lô` (~180px) · spacer · `Xuất Debit Note` right-aligned.
Controls are content-sized and never grow (`flex: 0 1 <basis>` — nepocorp ListFilterBar.css
`.list-filter-search { flex: 0 1 280px }` pattern). Stacking into one control per full-width row is a
MOBILE-ONLY pattern (≤640px), per the same reference. `DD/MM/YYYY` date fields must never stretch
across the page.

## Actual (pre-fix)

Four stacked rows with visible labels; both date inputs stretch to ~1145px at 1280 (`[data-input-wrapper]`
measured w=1145 while `.csc-searchable-field` = 240 and `.ds-uui-select` = 180); controls land at
y=156/217/338 = one per row.

## Root cause

`ListFilterBar.css` restored the width FLOORS (20260922_38 review B1) but carried no width CAPS /
flex-basis discipline; `BufferedUuiDateInput`'s root (`[data-input-wrapper]`) flex-grows to fill the row,
forcing wrap-after-every-control. The old page CSS (`.shipment-debit-filters__dates`) contained the
widths that were lost in the extraction.

## Fix contract (what makes this case pass)

- `[data-input-wrapper]` in the bar: `flex: 0 0 auto` with content width (~168px), floor 149px kept.
- All bar children `flex: 0 1 auto; min-width: 0` — none may grow.
- Verified by measurement at 1280/1440/1920/2560: all four controls + export in ONE row at ≥1280
  (wrap only with width to spare per card 20260919_48), date inputs ~168px, no control clipped.
