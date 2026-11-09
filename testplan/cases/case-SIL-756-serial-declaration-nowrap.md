# SIL-756 (id 876) — Chống ngắt dòng giữa chuỗi cho số container và số tờ khai (Round 3)

- Ticket: SIL-756 (board SIL, id 876, tạo 08/11/2026, re-opened round 3 sau build a129994c).
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
Fix `cf765cf0` cấu hình `white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;`.

### Round 3 (Sau build a129994c / commit cf765cf0)
Build `a129994c` (commit `cf765cf0`) hết cắt đôi chuỗi nhưng render `1085907736…` — MẤT 2 số cuối `50`, không đọc được số đầy đủ trong ô (kể cả số đo dev tự ghi nhận trong bảng đo cũng là ellipsis).
Yêu cầu Round 3:
1. Số tờ khai/container/serial dài phải ĐỌC ĐƯỢC ĐẦY ĐỦ trong ô.
2. Ô CUỘN ngang được (`overflow-x: auto` trong cell, scrollbar hiện khi cần).
3. Tooltip/popover hiện đủ chuỗi khi hover/click (`title` attribute).
4. KHÔNG ellipsis cắt số.
5. Test đúng chuỗi `'108590773650'` (đủ 12 số) + `'QACU200050'`, `'TK1108R002'` — số đo trong test phải đọc ra đủ chuỗi.

## Thay đổi (Fix Round 3)

1. `frontend/src/pages/ShipmentContainersPage.css`:
   - Cập nhật rule cho `.shipment-container-ledger td[data-label="Số tờ khai"] .shipment-container-ledger__code`, `td[data-label="Bill/Booking"] .shipment-container-ledger__code`, `td[data-label="Thông số container"] .shipment-container-ledger__code`:
     - Bỏ `overflow: hidden !important;` và `text-overflow: ellipsis !important;`
     - Cấu hình:
       - `white-space: nowrap !important;`
       - `overflow-x: auto !important;`
       - `overflow-y: hidden !important;`
       - `text-overflow: clip !important;`
       - `overflow-wrap: normal !important;`
       - `word-break: normal !important;`
       - `scrollbar-width: thin;`
       - Webkit scrollbar 4px thanh mảnh, không gây nhảy dòng.
2. `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css`:
   - Bỏ `overflow: hidden; text-overflow: ellipsis;` trên:
     - `.detailed-plan-grid__decl-value`
     - `.detailed-plan-grid__decl-value--action`
     - `.detailed-plan-grid__cell--container .ops-container-line`
   - Cấu hình:
     - `white-space: nowrap;`
     - `overflow-x: auto;`
     - `overflow-y: hidden;`
     - `text-overflow: clip;`
     - `overflow-wrap: normal;`
     - `word-break: normal;`
     - `scrollbar-width: thin;`
     - Webkit scrollbar 4px thanh mảnh.
3. `frontend/src/pages/ShipmentContainersPage.no-truncation.styles.test.ts`:
   - Phục hồi `expectNoClip(codeRules)` theo đúng tôn chỉ SIL-515 (CẤM truncate, không clip).
   - Khẳng định `overflow-x: auto`, `nowrap`, và `not.toMatch(/text-overflow:\s*ellipsis/)`.
4. `frontend/src/features/shipments/detail/ShipmentContainerLedger.sil756.test.tsx`:
   - Khẳng định render đầy đủ chuỗi `'108590773650'` (đủ 12 chữ số, `textContent` chính xác 12 số, không chứa `…`), `'QACU200050'`, và `'TK1108R002'`.
   - Khẳng định CSS enforcing `overflow-x: auto` và KHÔNG ellipsis.

## Đo đạc thực tế sau Round 3

| Chỉ số đo | Build e6db602f (Round 1) | Build a129994c (Round 2) | Sau fix Round 3 | Yêu cầu Round 3 | Đạt? |
|---|---|---|---|---|---|
| Số tờ khai `108590773650` text | Cắt đôi: `10859077365` + `0` | Bị ellipsis: `1085907736…` | `108590773650` (đủ 12 số) | Đọc được đầy đủ, không ellipsis | ĐẠT |
| `declCode.styles.whiteSpace` | `normal` | `nowrap` | `nowrap` | `nowrap` | ĐẠT |
| `declCode.styles.overflowX` | `visible` | `hidden` | `auto` | `auto` (cuộn ngang được) | ĐẠT |
| `declCode.styles.textOverflow` | `clip` | `ellipsis` | `clip` (không ellipsis) | Không ellipsis cắt số | ĐẠT |
| `declCode.styles.wordBreak` | `break-word` | `normal` | `normal` | `normal` | ĐẠT |
| `declCode.title` (tooltip) | `108590773650` | `108590773650` | `108590773650` | Tooltip đầy đủ | ĐẠT |
| Số cont `EMCU6163403` text | `EMCU6163403` | `EMCU6163403` | `EMCU6163403` | Nguyên chuỗi | ĐẠT |
| `contCode.styles.whiteSpace` | `nowrap` | `nowrap` | `nowrap` | `nowrap` | ĐẠT |
| `contCode.styles.overflowX` | `visible` | `hidden` | `auto` | `auto` (cuộn ngang được) | ĐẠT |
| `contCode.styles.textOverflow` | `clip` | `ellipsis` | `clip` (không ellipsis) | Không ellipsis cắt số | ĐẠT |
| `contCode.title` (tooltip) | `null` | `EMCU6163403` | `EMCU6163403` | Tooltip đầy đủ | ĐẠT |

## Regression evidence
- Test riêng cho SIL-756: `src/features/shipments/detail/ShipmentContainerLedger.sil756.test.tsx` (3/3 passed).
  - Test đúng chuỗi `'108590773650'` (toàn chữ số dài 12 ký tự) đọc ra đủ chuỗi không ellipsis, có title tooltip.
  - Test đúng chuỗi `'QACU200050'` (số serial cont) đọc ra đủ chuỗi không ellipsis, có title tooltip.
  - Test đúng chuỗi `'TK1108R002'` (số tờ khai chữ + số) đọc ra đủ chuỗi không ellipsis, có title tooltip.
  - Test CSS rules enforces `white-space: nowrap !important; overflow-x: auto !important;`, không ellipsis truncation.
- Vitest styles: `src/pages/ShipmentContainersPage.no-truncation.styles.test.ts` (7/7 passed).
- Vitest rowheights: `src/features/dispatch/detailed-plan/DetailedPlanGrid.rowheights.styles.test.ts` (10/10 passed).
- Vitest ledger & grid: `src/features/dispatch/detailed-plan/DispatchDeclarationCell.test.tsx`, `src/features/dispatch/detailed-plan/DetailedPlanGrid.test.tsx`, `src/pages/ShipmentContainersPage.test.tsx`, `src/features/shipments/detail/ShipmentContainerLedger.test.tsx` (250/250 passed).
- Frontend typecheck: clean (`cd frontend && npx tsc -b`).
- Root lint: clean (`pnpm lint`).
