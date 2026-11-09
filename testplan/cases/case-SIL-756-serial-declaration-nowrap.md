# SIL-756 (id 876) — Chống ngắt dòng giữa chuỗi cho số container và số tờ khai (Round 2)

- Ticket: SIL-756 (board SIL, id 876, tạo 08/11/2026, re-opened round 2 sau build e6db602f).
- Surface:
  - `/dispatch-detail` (Kế hoạch Chi tiết Xe) — cột Container (`.ops-container-line`) và cột Số tờ khai (`.detailed-plan-grid__decl-value`).
  - `/shipments-detail` (Chi tiết lô hàng) — cột Số tờ khai, Bill/Booking, Thông số container (`.shipment-container-ledger__code`).

## Bug (kết quả thực tế trước fix)

### Round 1
Các chuỗi định danh đơn lẻ (identifier tokens) bị ngắt dòng ở giữa chuỗi do `overflow-wrap: anywhere;`:
- Trên `/dispatch-detail`: Số serial container 11 ký tự `QACU2000507` bị ngắt thành `QACU200050` (dòng 1) và `7` (dòng 2).
- Trên `/shipments-detail`: Số tờ khai `TK1108R002` bị ngắt thành `TK1108R` (dòng 1) và `002` (dòng 2).

### Round 2 (Sau build e6db602f)
QA kiểm tra trên build `e6db602f`: Số tờ khai `108590773650` (12 chữ số) trên container `EMCU6163403` (lô Long Minh ASKEY-XƯỞNG 2) vẫn bị ngắt đôi giữa chuỗi: dòng 1 `10859077365`, dòng 2 `0`.
Nguyên nhân: Trong `frontend/src/pages/ShipmentContainersPage.css`, selector dòng 265 `.shipment-container-ledger__multiline:not(...) > span` có độ đặc hiệu (0, 8, 1) cao hơn rule nowrap dòng 310 (0, 3, 1), nên áp dụng `white-space: normal; word-break: break-word;` đè lên `nowrap`. Ngoài ra, container code trong `ShipmentContainerLedger.tsx` chưa có thuộc tính `title` để hiển thị tooltip.

## Thay đổi (Fix Round 2)

1. `frontend/src/pages/ShipmentContainersPage.css`:
   - Thêm `:not(.shipment-container-ledger__code)` vào rule multiline dòng 265, ngăn chặn triệt để việc kế thừa `word-break: break-word` hay `white-space: normal`.
   - Cấu hình chuẩn xác cho `.shipment-container-ledger td[data-label="Số tờ khai"] .shipment-container-ledger__code`, `td[data-label="Bill/Booking"] .shipment-container-ledger__code`, `td[data-label="Thông số container"] .shipment-container-ledger__code`:
     - `white-space: nowrap !important;`
     - `overflow: hidden !important;`
     - `text-overflow: ellipsis !important;`
     - `overflow-wrap: normal !important;`
     - `word-break: normal !important;`
     - `display: block; max-width: 100%;`
2. `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx`:
   - Bổ sung `title={row.isLotLevel ? undefined : (row.containerNumber || undefined)}` cho container code dòng 1559.
   - Các trường Bill/Booking (dòng 1524) và Số tờ khai (dòng 1531) đã có `title` đầy đủ.
3. `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css`:
   - Cập nhật `.detailed-plan-grid__decl-value` và `.detailed-plan-grid__decl-value--action`: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; overflow-wrap: normal; word-break: normal; display: inline-block; max-width: 100%;`.
   - Cập nhật `.detailed-plan-grid__cell--container .ops-container-line`: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; overflow-wrap: normal; word-break: normal; display: inline-block; max-width: 100%;`.
4. `frontend/src/features/dispatch/detailed-plan/DispatchDeclarationCell.tsx`:
   - Bổ sung `detailed-plan-grid__decl-value` vào class `trigger`.

## Đo đạc thực tế tại viewport 1440px (Puppeteer / Rung 3 UI DRIVEN)

Đo bằng script `qa/measure_after_756.mjs` trên live UI staging container `EMCU6163403` với tài khoản `tiepvv` (CUS):

| Chỉ số đo | Trước fix (build e6db602f) | Sau fix (Round 2) | Yêu cầu | Đạt? |
|---|---|---|---|---|
| Số tờ khai `108590773650` text | Bị cắt thành 2 dòng: `10859077365` + `0` | `108590773650` (nguyên chuỗi) | Không ngắt giữa chuỗi | ĐẠT |
| `declCode.styles.whiteSpace` | `normal` | `nowrap` | `nowrap` | ĐẠT |
| `declCode.styles.overflow` | `visible` | `hidden` | `hidden` | ĐẠT |
| `declCode.styles.textOverflow` | `clip` | `ellipsis` | `ellipsis` | ĐẠT |
| `declCode.styles.wordBreak` | `break-word` | `normal` | `normal` | ĐẠT |
| `declCode.isMultiLine` | `true` | `false` | `false` (1 dòng) | ĐẠT |
| `declCode.title` (tooltip) | `108590773650` | `108590773650` | Tooltip đầy đủ | ĐẠT |
| Số cont `EMCU6163403` text | `EMCU6163403` | `EMCU6163403` | Nguyên chuỗi | ĐẠT |
| `contCode.styles.whiteSpace` | `nowrap` | `nowrap` | `nowrap` | ĐẠT |
| `contCode.styles.textOverflow` | `clip` | `ellipsis` | `ellipsis` | ĐẠT |
| `contCode.title` (tooltip) | `null` (thiếu) | `EMCU6163403` (đầy đủ) | Tooltip đầy đủ | ĐẠT |

### Bằng chứng ảnh
- Trước fix: `qa/SIL-756_before_1440.png`
- Sau fix: `qa/SIL-756_after_1440.png`
- Script đo: `qa/measure_after_756.mjs`

## Regression evidence
- Test riêng cho SIL-756: `src/features/shipments/detail/ShipmentContainerLedger.sil756.test.tsx` (3/3 passed).
  - Test đúng chuỗi `'108590773650'` (toàn chữ số dài 12 ký tự) có `title` tooltip và class code.
  - Test đúng chuỗi `'QACU200050'` (số serial cont) có `title` tooltip và class code.
  - Test đúng chuỗi `'TK1108R002'` (số tờ khai chữ + số) có `title` tooltip và class code.
  - Test CSS rules enforces `white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;`.
- Vitest styles: `src/pages/ShipmentContainersPage.no-truncation.styles.test.ts` (7/7 passed).
- Vitest ledger: `src/pages/ShipmentContainersPage.test.tsx`, `src/features/shipments/detail/ShipmentContainerLedger.test.tsx` (150/150 passed).
- Frontend typecheck: clean (`cd frontend && npx tsc -b`).
