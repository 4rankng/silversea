# shipmate:uiux — POLISH verdict (SIL-756 round 3, diff trên branch fix/r5-756-scroll)

Mode: **POLISH** (touch-up trên surface có sẵn — cột Số tờ khai, Bill/Booking, Thông số container trên `/shipments-detail` và `/dispatch-detail`).
Domains touched: layout (in-cell horizontal overflow scrolling, no ellipsis truncation), accessibility (full readability, WCAG 1.4.10 reflow / text zoom, title tooltips).
Domains not touched: writing, typography, colors-as-palette → Not reviewed (không đổi copy/palette).

## Recon

Framework React 18 + Vite + Tailwind v4 + CSS Modules/Plain CSS;
Viewports: 320/390/768/1366/1440; preview local 7175.
Doctrine: shipmate:uiux + SIL-515 (CẤM truncate, whole-token readable in cell).

## Changes reviewed (diff)

1. `frontend/src/pages/ShipmentContainersPage.css`:
   - `.shipment-container-ledger td[data-label="Số tờ khai"] .shipment-container-ledger__code`,
     `td[data-label="Bill/Booking"] .shipment-container-ledger__code`,
     `td[data-label="Thông số container"] .shipment-container-ledger__code`:
     Bỏ `overflow: hidden !important;` và `text-overflow: ellipsis !important;`.
     Cấu hình `white-space: nowrap !important; overflow-x: auto !important; overflow-y: hidden !important; text-overflow: clip !important; scrollbar-width: thin;` kèm webkit scrollbar 4px thanh mảnh.
2. `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css`:
   - `.detailed-plan-grid__decl-value`, `.detailed-plan-grid__decl-value--action`, `.detailed-plan-grid__cell--container .ops-container-line`, `.detailed-plan-grid__cell--declaration .detailed-plan-grid__line`:
     Bỏ `overflow: hidden; text-overflow: ellipsis;`.
     Cấu hình `white-space: nowrap; overflow-x: auto; overflow-y: hidden; text-overflow: clip; scrollbar-width: thin;` kèm webkit scrollbar 4px thanh mảnh.
3. `frontend/src/features/dispatch/detailed-plan/DispatchDeclarationCell.tsx`:
   - LCL declaration line kế thừa `.detailed-plan-grid__decl-value` cuộn ngang khi danh sách số tờ khai dài.
4. `frontend/src/features/shipments/create/ShipmentDeclarationInline.css`:
   - `.csc-decl-inline__value`, `.csc-decl-inline__trigger` cấu hình `white-space: nowrap; overflow-x: auto; text-overflow: clip;` với thanh cuộn mỏng 4px.
5. `frontend/src/pages/ShipmentContainersPage.no-truncation.styles.test.ts`:
   - Khôi phục `expectNoClip(codeRules)` theo đúng tôn chỉ SIL-515 không clip/không ellipsis, xác thực `overflow-x: auto`.
6. `frontend/src/features/shipments/detail/ShipmentContainerLedger.sil756.test.tsx` & `DispatchDeclarationCell.test.tsx`:
   - Khẳng định chuỗi `'108590773650'` (đủ 12 chữ số), `'QACU200050'`, và `'TK1108R002'` hiển thị đủ ký tự, không bị ellipsis cắt số, tooltip title đầy đủ.

## Verification duty (rendered & component tests)

- Đầy đủ chuỗi:
  - Chuỗi 12 số `'108590773650'` hiển thị toàn bộ 12 số trong cell, không bị render thành `'1085907736…'`.
  - Chuỗi `'QACU200050'` và `'TK1108R002'` hiển thị nguyên vẹn.
- Cuộn ngang (`overflow-x: auto`):
  - Khi chiều dài chuỗi vượt quá chiều rộng cell, cell hỗ trợ cuộn ngang mượt mà, scrollbar 4px tinh tế không gây đội chiều cao dòng table.
- Tooltip/Popover:
  - `title` attribute cung cấp native tooltip trên hover/focus.
- Contrast & Typography:
  - Font dữ liệu `--font-data` / `var(--ops-table-supporting-size)` giữ nguyên tính toàn vẹn của hệ thống design system.
- Regression tests:
  - `src/features/shipments/detail/ShipmentContainerLedger.sil756.test.tsx`: 3/3 passed.
  - `src/pages/ShipmentContainersPage.no-truncation.styles.test.ts`: 7/7 passed.
  - `src/features/dispatch/detailed-plan/DetailedPlanGrid.rowheights.styles.test.ts`: 10/10 passed.
  - Component tests: 250/250 passed.
  - Frontend typecheck (`tsc -b`): clean, 0 errors.
  - Linter (`pnpm lint`): clean, 0 errors.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | HIGH | Build trước (cf765cf0) dùng `text-overflow: ellipsis` làm mất 2 số cuối '50' của tờ khai 12 số | **RESOLVED** trong Round 3: Chuyển sang `overflow-x: auto` + `nowrap`, bỏ hoàn toàn ellipsis. |

Không còn finding mở.

## Verdict

**Approve**
