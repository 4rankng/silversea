# QA — Dispatch Lạch Huyện Phase 5: Responsive dispatch workspaces

- Date: 2026-08-19
- Scope: `qa/2026-08-19_dispatch-lach-huyen_phase5_frontend-workspaces`
- Gate: phase 5 implementation complete, all automated gates green

## What shipped

### Detailed-plan editor (atomic)
- **`DispatchPlanEditorCell.tsx`** (renamed from `PlateAssignmentCell` — its responsibility is now
  the whole plan row): carrier, vehicle, estimates, **Phân loại (required)**, and **Đóng kết hợp**
  save through ONE `updateDispatchDetailPlan` call guarded by both row versions
  - Legacy null classification → editor forces explicit choice before first save (validation
    blocks save with Vietnamese error, modal/draft stay open)
  - Vehicle block sent only when touched — estimates/classification-only saves never disturb
    stored vehicle columns
  - **Pinned LH suggestions**: OWN-truck picker passes `fulfillmentId`; `suggestedItems` merge
    ahead of page options, deduped by value, reason tags in the label (screen-reader parity:
    "51C-123 — Hạ LH D-1 · Lấy LH D+1"); suggestions cleared when switching to EXTERNAL
  - Close/Escape/outside press restore focus to the trigger; save errors keep modal + draft
- **`useDispatchDetailPlan.savePlan`**: replaces returned row/versions/classification in place;
  propagates `lotFullyPlated` + new `shipmentVersion` to sibling rows of the same lot; 409 →
  "Dữ liệu đã thay đổi. Vui lòng tải lại."
- Legacy sequential callbacks (`assignPlate`/`assignCarrier`/`updateEstimates`) removed from the
  grid/page wiring (backend endpoints retained for API compatibility)

### Detailed grid columns
- Order now `Lịch trình | Khách hàng | Chứng từ | Container | Điều phối | Phân loại | Ghi chú`
- Classification column: label pill from `DISPATCH_CLASSIFICATION_LABELS`; null renders
  "Chưa phân loại" (dashed border, muted — meaning by text, not color alone); paired forms
  (Kẹp/Kết hợp) get emphasis styling
- Mobile (<768px) inherits the existing stacked `data-label` card layout — new column included

### Master-plan toolbar + summary
- Two multi-select facets (after Phân xe, before dates):
  - **"Cảng Lạch Huyện"** — options from `listLachHuyenPortFacets`, debounced search
  - **"Nhà xe"** — fixed identities `Xe SilverSea` / `Chưa điều xe` + async external carriers
  - Selected counts ("Cảng (2)"), clear-all ("Bỏ chọn"), loading/empty/error states, aria labels,
    keyboard operable, wrapped layout on narrow widths via existing CSS
- `useDispatchMasterPlan`: `portIds`/`carrierKeys` state → `listShipments` params with
  `includeDispatchSummary: true`; `dispatchSummary` state; race guard retained
- **Cargo summary strip** between filters and grid: "Sản lượng: N cont (20': a · 40': b · Khác:
  c) · Lẻ: d lô" over the FULL filtered set (never page counts); Khác/Lẻ omitted when 0; muted
  strip styling (not a card-in-card)
- Documents column typography: Bill/Booking normal weight, shipping line bold

### ADMIN port catalog restored
- `PortsConfigPage.tsx` on the existing `CrudTable`/`InlineForm`/`Field`/`FormActions` primitives;
  columns Tên cảng / Mã / Khu vực điều phối (Lạch Huyện badge) / Thành phố-Địa chỉ; inline form
  with the "Cảng khu vực Lạch Huyện" checkbox (dispatchZone LACH_HUYEN ↔ null)
- `/config/ports` route: redirect → `adminOnly(page(<PortsConfigPage />))`; Layout nav unchanged
  (already linked); MANAGER/DISPATCHER remain Casbin-denied on config writes

## Commands run + results

| Gate | Command | Result |
|------|---------|--------|
| frontend tsc | `cd frontend && npx tsc -b` | 0 errors |
| detailed-plan tests | `pnpm vitest run src/features/dispatch/detailed-plan/` | **40/40** (22 grid incl. new atomic-save, classification-required block, 7-column order; hook + filters) |
| master-plan tests | `pnpm vitest run src/features/dispatch/master-plan/ + Layout.test.ts` | **63/63** |
| frontend full | `pnpm test` | **954/954** (171 files; 2 legacy files removed with `PlateAssignmentCell`, replaced by new coverage) |
| lint | `pnpm lint` | 0 errors (90 pre-existing warnings) |
| backend tsc (unchanged files) | `npx tsc --noEmit` | 0 errors |

## Notes

- No new dependencies; Untitled UI + existing design-system/config primitives only.
- e2e (Playwright) + role walkthrough at 1280/768/390/320 deferred to Phase 6's closed-loop QA
  per the plan's own step 7 → Phase 6 scope.
