# SIL-591 (id 691) — Kế hoạch Chi tiết: lô lẻ đã ghép — phát lệnh 1 lô, cả nhóm tự đi lệnh gộp; hết lỗi "Xe đầu kéo đã bị trùng lịch kế hoạch"

- Ticket: SIL-591 (board SIL, id 691, priority HIGH) — báo cáo khách b_d. Phạm Trung Kiên 29/10/2026.
- Surface: `/dispatch-detail` (phát lệnh) + BE guard `assertResourceAvailability`, role Điều vận.

## Bug

Hai lô hàng lẻ đã ghép chung 1 xe (vd LONG MINH K2K32143352 + YUANFANG
K2K45235345634, "Ghép (2/2)" trên xe 15E-016.26):
1. Phát lệnh lô đầu — OK ("Đã phát lệnh cho tài xế").
2. Phát lệnh lô thứ hai — 409 "Xe đầu kéo đã bị trùng lịch kế hoạch." vì
   `assertResourceAvailability` thấy trip ACTIVE của lô 1 giữ cùng đầu kéo →
   coi là xung đột, trong khi đó là ĐÚNG một chuyến gộp.

## Expected sau thay đổi

1. Phát lệnh cho 1 lô thuộc nhóm ghép trả ĐV → `issueOrderCreateOrUpdate`
   tự động phát lệnh cho CÁC LÔ CÒN LẠI của cùng `costGroupId` trong CÙNG
   transaction: cùng đầu kéo/rơ-moóc/tài xế (OWN) hoặc cùng nhà xe ngoài +
   BKS (EXTERNAL), cùng khung giờ — đúng luật "các lô sau tự động được phát
   lệnh cho xe đi lệnh gộp".
2. Response `/shipments/:id/dispatch` mang `autoIssuedSiblings[]`
   (shipmentId/fulfillmentId/tripId/Bill/Booking) + `failedSiblings[]`
   (shipmentId + đúng lời của guard). Lô chính không bao giờ chết vì dữ liệu
   lô anh em thiếu — sibling lỗi đổ vào `failedSiblings`.
3. Guard trip-side: holder cùng `costGroupId` bị carve-out NGẮT (như
   `isSameGroup` của plan-row guard); lô khác nhóm / không nhóm vẫn chặn
   (không bao giờ cho "tải thứ ba" lên cùng đầu kéo).
4. FE: các dòng sibling flip "Đã phát lệnh" ngay (setItems), toast success
   nêu số lô + Bill/Booking được tự phát; toast warning nếu còn lô chưa phát
   được kèm lý do.
5. Chỉ cascade ở LẦN PHÁT ĐẦU (`expectedTripVersion == null`); Phân xe lại
   sửa MỘT chuyến — di chuyển cả nhóm là flow "Đổi nhà xe nhóm".

## Regression lock

- `backend/src/tests/unit/sil591-cost-group-issue-cascade.test.ts` — pure
  carve-out matrix: cùng nhóm được carve / ungrouped không carve / khác nhóm
  + không nhóm vẫn chặn / rỗng.
- Cascade chạy trong `issueLclCostGroupSiblingsInTx` (commands service) —
  sibling đã có live trip bị skip (không bao giờ phát đôi);
  `cascadeSiblings: false` chặn re-cascade.
