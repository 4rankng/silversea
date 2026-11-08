# SIL-750 (id 870) — Ghép Kẹp quá tải phải CẢNH BÁO MỀM ở dialog Ghép chuyến

- Ticket: SIL-750 (board SIL, id 870, tạo 08/11/2026). Môi trường QA:
  staging build c4cea6b6, vai Điều vận (dungnv); repro chuyến 462/463, lô
  1052/1053 (QA1108R-KB1/K-B2), xe 2 (15H-087.19, tải trọng 22 tấn),
  2×12 tấn = 24 tấn > 22 tấn → POST /api/trips/pairs 201 (pairId 37), dialog
  đóng, KHÔNG có cảnh báo nào.

## Luật (Spec_fix Bug 1 — Luật Kẹp/Kết hợp v2)

- Quá tải (tổng trọng 2 cont > tải trọng xe) ⇒ CẢNH BÁO MỀM + vẫn lưu.
- Xe chưa khai tải trọng ⇒ cảnh báo sau lưu (đã OK, QA xác nhận).
- Cont 40' vào cặp Kẹp ⇒ chặn cứng (đã OK, QA xác nhận).
- Gate 409 KEP_WEIGHT_WARNING + confirm ở bước PHÁT LỆNH là scope SIL-674/
  TC6 của SIL-638 — KHÔNG thuộc ticket này.

## Hành vi trước fix

`createTripPairCoreInTx` chỉ có 2 advisory: khác tuyến (KEP) và
capacityMissing. Proven overload (capacity + 2 finite weights, sum > capacity)
không rơi nhánh nào ⇒ pair lưu im lặng; FE dialog (`PairTripsDialog`) đóng
ngay vì `result.warnings` rỗng (FE đã render warnings + giữ dialog khi có).

## Luật sau

`createTripPairCoreInTx` push thêm advisory DOC verbatim
`KEP_WEIGHT_WARNING_MESSAGE` khi `kepPairWeightVerdict` trả 'overload' (cùng
pure law với gate phát lệnh) — áp cho CẢ KẸP lẫn KẾT HỢP, không kind-fence,
không bao giờ chặn cứng ở đường ghép thủ công. FE giữ nguyên (đã render).

## Case pin

1. 2×12t trên xe 22t, KẸP, cùng ngày ⇒ POST /trips/pairs 201 + response có
   warnings chứa DOC text; dialog mở, hiện cảnh báo, nút 'Xong'.
2. Xe chưa khai tải trọng ⇒ vẫn warning capacityMissing (không đổi).
3. Tổng ≤ tải trọng ⇒ KHÔNG warning trọng lượng.
4. 40' vào cặp Kẹp ⇒ vẫn chặn cứng 422 (không đổi, kepContainerSizeBlock).
5. `backend/src/tests/unit/sil750-manual-pair-overload-advisory.test.ts` —
   source pins (advisory sau insert, không KEP_WEIGHT_WARNING_CODE throw,
   không kind fence).

## Ranh giới

- Không đổi gate phát lệnh (dispatch-resource-availability) — pins
  sil638-tc6-* phải giữ xanh nguyên trạng.
- FE PairTripsDialog không đổi code — hành vi warnings đã có (case
  null-tải trọng QA đã xác nhận 'đúng bản chất cảnh báo mềm').
