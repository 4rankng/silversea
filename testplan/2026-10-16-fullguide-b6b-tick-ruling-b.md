# Case 141026230770 / TC-B6(b) — Phiếu hoàn ứng thiếu dấu tích xác nhận: triển khai Option B (F-W1-1 ruling)

Nguồn: hướng dẫn kiểm thử khách hàng 16/10/2026 (B.6, phiếu 141026230770) +
ruling doc `testplan/2026-10-16-fb100-draft-gate-ruling.md`. Môi trường:
staging `e3286338`.

## Tái hiện (rung 3, staging e3286338)

`/my-settlements/new` (hoangnh): form "Tạo phiếu thanh toán" có nút
"Ghi nhận phiếu thanh toán" nhưng KHÔNG có tick "Xác nhận hoàn ứng" —
`qa/2026-10-16_fullguide_g-advances.log` (g-b-live-submit, hasTick=false).
Tick mà FB-100 đã làm chỉ render khi `status === 'DRAFT'` (SettlementPrintPage)
mà không writer nào sinh DRAFT ⇒ chết trong mọi luồng sống (F-W1-1).

## Quyết định

Owner instruction (task 16/10): "add the missing confirmation checkbox on the
Phiếu hoàn ứng — implement with tests" = chốt Option B của ruling:
tick bắt buộc tại nút submit sống + stamp `checked_by/checked_at` lúc tạo +
xóa block DRAFT chết. Không đổi thời điểm ghi tiền (PRD §9.1/§9.2 giữ nguyên).

## Thay đổi

1. `ForwarderSettlementCreatePage`: tick "Xác nhận hoàn ứng" bắt buộc —
   khóa NÚT và khóa cả handler (submit bằng bàn phím không vượt qua được);
   `isFormReady` thêm điều kiện tick.
2. `advance-settlement.service.createAdvanceSettlement`: stamp
   `checkedBy = forwarderId, checkedAt = now()` lúc tạo (người lập tự xác nhận).
3. `SettlementPrintPage`: xóa block DRAFT chết (tick + "Ghi nhận phiếu" +
   editor tạm ứng/chi phí DRAFT + state/handler mồ côi); thêm dòng xác nhận
   "Xác nhận hoàn ứng: <tên> · <thời điểm>" từ checked_by/checked_at.
4. CSS: `.fset-confirm-tick` + `.settlement-detail__confirm` theo house tokens.

## Phần còn lại của B.6 (đã có từ FB-100, re-verify trên staging)

- (a) Nút "Phê duyệt tạm ứng": PASS rung 3 (g-approve-post: DB
  `22|RECORDED|9|t|2` — duyệt = giải ngân KP-148).
- (c) Số âm: PASS rung 3 (report row: remainingSigned −275.000,
  needsCollection, "Đề nghị thu tiền ứng").

## Gates

FE tsc -b 0 · vitest SettlementPrintPage 15/15 (2 pin Option B mới thay pin
DRAFT cũ) + ForwarderSettlementCreatePage 11/11 (pin tick mới + sửa 3 pin
cũ thêm bước tick) + AdminAdvancesPage 9/9 · BE tsc 0 ·
advance-settlement-deadlock-order 2/2 (pin checked_by/checked_at lúc tạo).

## Kế hoạch xác thực

Rung 3 re-drive B.6 sau deploy: driver `fullguide-g-advances.mjs` — kỳ vọng
g-b-live-submit hasTick=true, tick khóa/mở nút, tạo phiếu thành công, dọn
sạch (hoàn đủ 200.000₫, outstanding=0).
