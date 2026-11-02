# Test Plan & Evidence — SIL-651 (id 756): Every date picker is missing the calendar icon at the trailing edge

## 1. Defect Overview & Problem Statement
- **Reported Defect:** Owner reported and screenshotted date inputs in filter bar "Từ / Đến" (and across the whole application) where date inputs showed only the formatted date text (e.g., "Từ 23 / 10 / 2026", "Đến 23 / 10 / 2026") with NO calendar icon at the trailing (right) edge. The "Chọn ngày" calendar popup still opened and functioned correctly, but the visual affordance was completely missing.
- **Root Cause:** Historical commit `fee338eb` stripped trailing icon triggers from `DateTimeSegments.tsx`, leaving segmented date fields without a trailing calendar icon affordance. In `BufferedUuiDateInput.tsx`, the `[data-date-boundary]` container wrapped segments only when `fieldPrefix != null`, and neither branch rendered a trailing calendar affordance. Similarly, `DateInput.tsx` rendered a raw `<input data-date-input>` without trailing affordance, and `DateTimeField.tsx` wrapped `SplitDateTimeField` without an affordance button.
- **Solution:** Standardized the trailing calendar icon affordance in the shared design-system form layer:
  - `BufferedUuiDateInput.tsx`: Wrapped all date controls in `<div data-date-boundary data-uui-control="date" data-control-size={size}>` with a trailing `<button type="button" className="uui-date-icon-btn" tabIndex={-1} aria-label={`Mở lịch${label ? ` — ${label}` : ''}`} disabled={disabled || readOnly} onClick={(e) => { e.stopPropagation(); showCalendar(); }}><Calendar size={14} aria-hidden="true" /></button>`.
  - `BufferedUuiDateInput.css`: Pinned `.uui-date-icon-btn` with `margin-left: auto; flex: 0 0 auto; width: 20px; height: 20px; color: var(--ink-3); hover: var(--ink); border: 0; background: transparent;`. Also added rules for `.date-input-wrap`, `.date-input-calendar-btn`, `.datetime-field-wrap`, and `.datetime-field-calendar-btn`.
  - `DateInput.tsx`: Wrapped `<input data-date-input>` in `<div className="date-input-wrap" data-date-control>` with `padding-right: 32px !important;` to reserve space and prevent value text or caret overlap, and added trailing `<button type="button" className="date-input-calendar-btn" tabIndex={-1} aria-label="Mở lịch" disabled={...} onClick={...}><Calendar size={14} aria-hidden="true" /></button>`.
  - `DateTimeField.tsx`: Wrapped `SplitDateTimeField` in `<div className="datetime-field-wrap">` with trailing `<button type="button" className="datetime-field-calendar-btn" tabIndex={-1} aria-label={`Mở lịch — ${label}`} disabled={...} onClick={...}><Calendar size={14} aria-hidden="true" /></button>`.

## 2. Shared Components Fixed & Consumer Audit
### Fixed Components:
1. `frontend/src/design-system/forms/BufferedUuiDateInput.tsx`:
   - Line 2: Added `Calendar` import from `lucide-react`.
   - Lines 193-211: Standardized `data-date-boundary` wrapper with trailing `.uui-date-icon-btn` rendering `<Calendar size={14} aria-hidden="true" />` and wired click to `showCalendar()`.
2. `frontend/src/design-system/forms/BufferedUuiDateInput.css`:
   - Lines 83-195: Added styles for `.uui-date-icon-btn`, `.filter-bar > [data-input-wrapper]:not([data-has-prefix]):has(> [data-date-boundary])`, `.date-input-wrap`, `.date-input-calendar-btn`, `.datetime-field-wrap`, and `.datetime-field-calendar-btn`.
3. `frontend/src/design-system/forms/DateInput.tsx`:
   - Line 2: Added `Calendar` import from `lucide-react`.
   - Lines 45-104: Wrapped `<input data-date-input>` in `<div className="date-input-wrap" data-date-control>` with trailing `.date-input-calendar-btn`.
4. `frontend/src/design-system/forms/DateTimeField.tsx`:
   - Lines 2, 4: Added `Calendar` from `lucide-react` and imported `./BufferedUuiDateInput.css`.
   - Lines 58-79: Wrapped `SplitDateTimeField` in `<div className="datetime-field-wrap">` with trailing `.datetime-field-calendar-btn`.

### Proof that ONE Shared Change Covers Every Date Picker:
Audited consumers across the entire codebase that now automatically inherit the trailing calendar icon:
- **Filter bars & DateRangeFields (owner reported screenshot):**
  - `DateRangeFields.tsx` (the shared "Từ / Đến" filter pair used across `/shipments`, `/shipments-detail`, `/accounting`, `/ops/orders`)
- **UUI & Segmented Date Inputs:**
  - `features/accounting/AccountingWorkspaceRoot.tsx`
  - `features/accounting/InvoiceTrackingFormModal.tsx`
  - `features/accounting/PhoiPhieuChiHoDialog.tsx`
  - `features/fleet-productivity/DailyProductivityView.tsx`
  - `features/shipments/create/uui-fields.tsx` (LCL delivery date)
  - `features/shipments/cus/CusQuickEdit.tsx` (customer schedule date)
  - `features/shipments/detail/ShipmentContainerScheduleEditor.tsx`
  - `pages/OpsOrdersPage.tsx`
  - `pages/accounting/DebitSettlementRoundDialog.tsx`
  - `pages/accounting/DepositRefundTrackerPage.tsx`
  - `pages/config/QuotationConfigPage.tsx`
  - `pages/config/QuotationCreateDialog.tsx`
- **Standard Entity Forms (via DateField & DateInput):**
  - `features/fleet/TruckFormModal.tsx` (`TruckDateField`)
  - `features/fleet/DriverFormModal.tsx`
  - `features/fleet/TrailerFormModal.tsx`
  - `features/shipment-finance/ShipmentFinanceForm.tsx`
  - `features/expense-accounting/ExpenseCashDrawer.tsx`
  - `features/expense-accounting/ExpenseCreateDrawer.tsx`
  - `features/expense-accounting/ExpenseEvidenceFields.tsx`
  - `features/expense-accounting/ExpenseHistory.tsx`
  - `features/expense-accounting/ExpenseReconciliationDrawer.tsx`
  - `features/expense-accounting/ExpenseReport.tsx`
  - `features/expense-accounting/ExpenseVoucherDrawer.tsx`
  - `features/ops/OpsExpenseFinancialFields.tsx`
  - `features/treasury/TreasuryAccountDrawer.tsx`
  - `components/trip/DriverExpenseCorrection.tsx`
  - `components/trip/FuelRefillReportForm.tsx`
  - `components/trip/ShipmentCostEntryForm.tsx`
- **Datetime Fields (via DateTimeField):**
  - `features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx`
  - `features/shipments/create/ShipmentCreateContainerRow.tsx`
  - `features/shipments/create/ShipmentCreateWorkspace.tsx`

## 3. Variant Matrix Pinned
The variant matrix was verified and pinned across all permutations:
| Variant | Component | Value State | Control State | Icon Assertion | Click Behavior |
|---|---|---|---|---|---|
| Date-only (prefix "Từ / Đến") | `BufferedUuiDateInput` | Empty (`value=""`) | Enabled | `.uui-date-icon-btn` with `<Calendar size={14} />` | Opens `DatePickerSurface` dialog |
| Date-only (prefix "Từ / Đến") | `BufferedUuiDateInput` | With value (`2026-10-23`) | Enabled | `.uui-date-icon-btn` with `<Calendar size={14} />` | Opens `DatePickerSurface` dialog |
| Date-only (prefix "Từ / Đến") | `BufferedUuiDateInput` | Any | Disabled / ReadOnly | `.uui-date-icon-btn:disabled` (opacity 0.5) | Click disabled |
| Date-only (prefix "Từ / Đến") | `BufferedUuiDateInput` | Invalid date (`33/10/2026`) | Error (`isInvalid`) | `[data-date-boundary]:has(.date-seg-group--error)` red border, icon intact | Opens `DatePickerSurface` dialog |
| Date-only (standalone, no prefix) | `BufferedUuiDateInput` | Empty / With value | Enabled | `[data-date-boundary] .uui-date-icon-btn` present | Opens `DatePickerSurface` dialog |
| Date-only (entity form) | `DateField` / `DateInput` | Empty (`value=""`) | Enabled | `.date-input-calendar-btn` with `<Calendar size={14} />` | Opens `DatePickerSurface` dialog |
| Date-only (entity form) | `DateField` / `DateInput` | With value (`2026-10-23`) | Enabled | `.date-input-calendar-btn` with `<Calendar size={14} />` | Opens `DatePickerSurface` dialog |
| Date-only (entity form) | `DateField` / `DateInput` | Any | Disabled | `.date-input-calendar-btn:disabled` | Click disabled |
| Date-only (entity form) | `DateField` / `DateInput` | Invalid date | Error (`aria-invalid="true"`) | Border red via error token, icon intact | Opens `DatePickerSurface` dialog |
| Datetime | `DateTimeField` | Empty / With value | Enabled | `.datetime-field-calendar-btn` with `<Calendar size={14} />` | Opens date picker dialog |
| Datetime | `DateTimeField` | Any | Disabled | `.datetime-field-calendar-btn:disabled` | Click disabled |
| Datetime | `DateTimeField` | Invalid datetime | Error (`error="Lỗi"`) | Error message displayed below, icon intact | Opens date picker dialog |

### How Tests Assert the Icon:
1. `frontend/src/design-system/forms/DateField.calendar-icon.styles.test.ts`:
   - Asserts CSS house token rules for `.uui-date-icon-btn`: `display: inline-flex`, `align-items: center`, `flex: 0 0 auto`, `margin-left: auto`, `border: 0`, `background: transparent`, `color: var(--ink-3)`, `cursor: pointer`.
   - Asserts hover: `color: var(--ink)`.
   - Asserts disabled: `opacity: 0.5`, `cursor: not-allowed`.
   - Asserts overlap protection in `.date-input-wrap > input[data-date-input]`: `padding-right: 32px !important`.
   - Asserts height containment: icon buttons are ≤ 24px and use `min-height: 0` or compact height `var(--control-compact-h, 32px)`, adhering to control geometry.
   - Asserts source pins in `BufferedUuiDateInput.tsx`, `DateInput.tsx`, `DateTimeField.tsx` ensuring `Calendar` from `lucide-react` with `size={14} aria-hidden="true"` is rendered and wired.
2. `frontend/src/design-system/forms/DateField.test.tsx`:
   - Asserts `screen.getByRole('button', { name: 'Mở lịch' })` exists, is not disabled, and clicking it opens `screen.getByRole('dialog', { name: 'Chọn ngày' })`.
   - Asserts disabled field disables the calendar button.
3. `frontend/src/design-system/forms/DateRangeFields.test.tsx`:
   - Asserts both "Từ ngày" and "Đến ngày" contain `.uui-date-icon-btn` with `svg`.
   - Asserts clicking the button opens `screen.getByRole('dialog', { name: 'Chọn ngày — Từ ngày' })`.
4. `frontend/src/design-system/forms/DateTimeField.retain.test.tsx`:
   - Asserts `screen.getByRole('button', { name: 'Mở lịch — Giờ trả hàng' })` exists with `svg`.
   - Asserts clicking it opens `screen.getByRole('dialog', { name: 'Chọn ngày — Giờ trả hàng' })`.
   - Asserts disabled field disables the button.

## 4. Density Contract & Control Height Proof
- **Density Law:** Trailing icon must NOT alter the control's height.
- In `control-geometry.css`:
  - `[data-uui-control]` declares `--uui-control-h: var(--control-default-h)` (or `var(--control-compact-h)` for size="sm", and `var(--control-touch-h)` on touch).
  - `[data-date-boundary]` has `height: var(--uui-control-h, var(--control-default-h))`.
  - Inner segments `:is(.date-seg-group, .date-seg-wrapper)` have `height: calc(var(--uui-control-h) - 2px)`.
  - `.uui-date-icon-btn` has `width: 20px; height: 20px; flex: 0 0 auto; border: 0; background: transparent;`. Since 20px < 28px/32px/40px, the icon button sits comfortably inside the existing boundary without altering height.
- In `DateInput`:
  - `.date-input-wrap` has `position: relative`.
  - `.date-input-calendar-btn` is `position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; border: 0; background: transparent;`.
  - Because it is absolutely positioned, it takes zero flow height.
- Density pin results:
  - `frontend/src/components/control-density.styles.test.ts`: PASSED (11/11 tests).
  - `frontend/src/design-system/forms/DateTimePickerPanels.density.styles.test.ts`: PASSED (7/7 tests).

## 5. Mobile & Responsive (390px / 768px / 1440px)
- **390px (Mobile):**
  - In `DateRangeFields`, total width is `min(100%, 348px)`.
  - Two columns of `minmax(0, 1fr)` allocate ~165px per date field.
  - Prefix ("Từ" / "Đến") = ~18px, segments (`DD/MM/YYYY`) = ~95px, icon button = 20px with 6px gap = ~26px.
  - Total content = ~145px, which cleanly fits inside 165px without crowding or wrapping.
  - `DateInput`: input has `padding-right: 32px !important;` so 10-character `DD/MM/YYYY` text never touches the icon.
- **768px / 1440px (Desktop):**
  - Controls retain 32px compact height in filter bars (`--filter-control-h`) and 40px in standard forms (`--control-default-h`).

## 6. Design Language Source Consulted
- **Catalog & Icons Consulted:**
  - Consulted Untitled UI PRO pattern: Date input with trailing calendar affordance (`components/untitled-ui/base/input`).
  - Consulted house icon library: `lucide-react` (v0.511.0), matching `DateTimePickerPanels.tsx` and `UnifiedDateRangePicker.tsx` which both render `<Calendar size={14} aria-hidden="true" />`.
  - Token scale: `var(--ink-3)` for passive affordance icon, `var(--ink)` on hover, `opacity: 0.5` on disabled, `var(--surface)` for opaque boundary.

## 7. Verbatim Gate Counts
- **Gate 1: Forms vitest suite**
  - Command: `cd frontend && pnpm exec vitest run src/design-system/forms/`
  - Result: **29 passed (29 test files)**, **247 passed (247 tests)**
- **Gate 2: Frontend TypeScript typecheck**
  - Command: `cd frontend && npx tsc -b`
  - Result: **0 errors** (exit status 0)
- **Gate 3: Forms ESLint**
  - Command: `cd frontend && pnpm exec eslint src/design-system/forms/`
  - Result: **0 errors** (exit status 0)
- **Gate 4: Consumer vitest suites**
  - Command: `cd frontend && pnpm exec vitest run src/features/shipments/create/ src/features/dispatch/detailed-plan/`
  - Result: **90 passed (90 test files)**, **794 passed (794 tests)**

Raw output logs are saved in:
- `qa/2026-11-02_sil651_forms_vitest.txt`
- `qa/2026-11-02_sil651_tsc.txt`
- `qa/2026-11-02_sil651_eslint.txt`
- `qa/2026-11-02_sil651_consumer_vitest.txt`

## 8. Status Block
```
Status: DONE
Summary: Implemented trailing calendar icon on every date picker across the app (BufferedUuiDateInput, DateRangeFields, DateField, DateInput, DateTimeField) using house Calendar icon and tokens with zero control-height drift and complete test pin verification.
Concerns/Blockers: None
```
