# 2026-09-24 — C12 visual audit fixes (card 20260924_1)

**Mục tiêu:** 7 fix visual-only từ audit `plans/reports/c12-agy-visual-audit.md` (55 issue → 18 CODE_FIX → card tách 9; card này làm 7 mục visual; phần logic/FE-lane: AddChiPhi handlers + PhoiPhieuTienDuongDialog phiếu-chi → work order riêng).

**Môi trường:** local dev `http://localhost:7175` · **Tài khoản:** theo `testplan/testaccounts.txt` (mật khẩu `Abc123`).
**Bằng chứng automated:** vitest touched suites + `npx tsc -b` → `qa/2026-09-24_c12-mimo-gates.log`.
**Ràng buộc card:** KHÔNG browser QA → các case dưới đây **chưa click-through trên browser**; mỗi case kèm test tự động pin hành vi. Browser re-run để QA lane chạy trước khi deploy (re-run bắt buộc theo AGENTS.md).

## Cases

| Case ID | Surface | Repro (bug trước fix) | Expected sau fix | Test pin tự động | Browser |
|---|---|---|---|---|---|
| C12-VIS-01 | `/phoi-phieu` → Báo cáo tháng (image11, HIGH) | Mở báo cáo tháng; header cột hiện `Tổng phải thu\|trả`, `Đã thu\|trả`, `Còn phải thu\|trả` — 3 khái niệm gộp 1 ô, `tt-table` fixed-layout + `nowrap` làm chữ tràn/đổ vào cột kề, không rõ ranh giới | Header 2 tầng: group `PHẢI THU`/`PHẢI TRẢ` (colspan 3) trên; leaf `Tổng` / `Đã thu` / `Đã trả` / `Còn phải thu` / `Còn phải trả`; header wrap + line phân cách; không ô nào chứa `\|` hay `/` | `PhoiPhieuControlPage.reports.test.tsx` + `PhoiPhieuControlPage.styles.test.ts` | Chưa chạy (cấm browser) |
| C12-VIS-02 | `/my-trips` form Chi phí lô hàng — ô `Thực chi (VND)` (image12, LOW) | Nhập `1200000` → ô hiển thị thô `1200000` (caption kỳ vọng `1.200.000 ₫`) | Ô hiển thị grouping vi-VN `1.200.000`; contract dữ liệu giữ nguyên số nguyên (payload `amount: 1200000`) | `ShipmentCostEntryForm.test.tsx` (pin format + round-trip parse + payload) | Chưa chạy (cấm browser) |
| C12-VIS-03 | Checkbox đồng bộ thu/trả — `ExpenseCreateDrawer` + `ExpenseEntryDrawer` (image10, LOW) | 2 biến thể label: `Nhập Thu và Trả bằng nhau` (Chi tiết chi hộ) vs `Thu bằng trả` (Thêm khoản chi / chi tiết) | Một term một khái niệm (law §8): cả hai drawer dùng `Nhập Thu và Trả bằng nhau` | `ExpenseCreateDrawer.test.tsx`, `ExpenseEntryDrawer.test.tsx` | Chưa chạy (cấm browser) |
| C12-VIS-04 | Dialog phơi phiếu căn giữa viewport (image10, LOW) | Backdrop `align-items: flex-start` → modal dính mép trên; bản chụp audit lệch trái do 2 surface cùng mở (đã bị card 20260923_11 khử) | `.ops-modal-backdrop` center cả 2 trục (`justify-content` + `align-items: center`); đúng 1 surface lúc mở (pin sẵn) | `ops-modal.styles.test.ts` + `PhoiPhieuChiHoDialog.test.tsx` (one-surface) | Chưa chạy (cấm browser) |
| C12-VIS-05 | Bảng 2.2 — header `Phí CSHT` (image6, LOW) | Cột ghi tắt `Phí CSHT` — không rõ nghĩa | `Phí cơ sở hạ tầng` (header wrap được, không cần tooltip) | `ShipmentDebitTables.test.tsx` | Chưa chạy (cấm browser) |
| C12-VIS-06 | Bảng 2.2 — cột `Phí khác (không hđ)` cut chữ (image7, LOW) | `.csc-debit-item__name` + `.csc-debit-otherfee` đều `nowrap`/no-wrap trong cột hẹp → tên phí bị cắt cuối từ | Name wrap (`white-space: normal` + `overflow-wrap`), dòng other-fee `flex-wrap: wrap` — law §4 no-truncation | `table-no-truncation.styles.test.ts` | Chưa chạy (cấm browser) |
| C12-VIS-07 | `/ops/orders` dropdown `Nhóm chi phí` 5 nhóm truncate (image1, HIGH) | Popover pin `w-(--trigger-width)` + `overflow-x-hidden` → option cắt giữa (`Có hóa đơn · Nâ`), không ellipsis | `.ds-uui-select__popover { min-width: max-content }` — popover nở ra đúng mức chứa option; trigger-width giữ cho option ngắn (CSS-only, không đụng handler) | `UuiSelectField.styles.test.ts` | Chưa chạy (cấm browser) |

## Verification coverage (mandatory block)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| C12-VIS-01..07 | CODE-READ ONLY + automated pins (không phải rung 3) | vitest suites green → `qa/2026-09-24_c12-mimo-gates.log`; report `plans/reports/c12-mimo-visual.md` | browser click-through (card cấm), mobile viewport 44px, staging vs local, các role khác (ketoan/OPS/DRIVER), viewport 1280/1920, data thật trên staging |
