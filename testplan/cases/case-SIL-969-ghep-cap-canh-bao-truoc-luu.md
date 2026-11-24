# SIL-969 — Ghép cặp: cảnh báo tải trọng phải TRƯỚC khi lưu ('Vẫn lưu?'), không phải sau save

- Ticket: SIL-969 (board plan.tingting.vip, id 1128, tạo 24/11/2026). Môi
  trường QA: staging build df7b2a73, vai Điều vận (dungnv); repro lô
  W3A-FCL-01, 2×20DC MSKU9000007 + MSKU9000012 (mỗi cont 18,5 tấn, tổng 37
  tấn) lên xe 15C-167.31 — xe CHƯA nhập tải trọng cho phép (capacityKg null).

## Luật (KB Ch.3 §3.3.6, K3.52)

Trigger cảnh báo: tổng trọng lượng 2 cont vượt tải trọng cho phép, HOẶC tải
trọng cho phép của xe chưa nhập (null) ⇒ hộp thoại xác nhận MỀM 'Vẫn lưu?'
TRƯỚC khi lưu. Không chặn cứng ghép cặp Kẹp 2×20FT. Bấm xác nhận mới lưu,
bấm hủy thì không lưu. Không vi phạm ⇒ không dialog thừa.

## Hành vi trước fix

`PairTripsDialog.handlePair` bấm 'Ghép chuyến' là POST /trips/pairs ngay
(201, pairKind KEP), không cảnh báo nào trước khi lưu; hai advisory cân/tải
(`capacityMissing` + `KEP_WEIGHT_WARNING_MESSAGE`) chỉ hiện trong
`result.warnings` SAU khi cặp đã tạo — quá muộn, Điều vận chỉ còn 'Xong'.

## Luật sau

FE pre-save confirm trong dialog Ghép chuyến (BE không đổi một byte — luật
lưu, response `warnings[]` và các advisory giữ nguyên):

- `frontend/src/features/dispatch/detailed-plan/pairWeightWarning.ts` — mirror
  thuần của luật BE (`kepPairWeightVerdict` + nhánh `capacityMissing` từ
  `trip-pairs.service.ts`/`trip-pair-rules.service.ts`), chạy trên draft sắp
  submit. Text DOC verbatim.
- `PairTripsDialog.handlePair` — warning ⇒ `confirm('<text> Vẫn lưu?')` trước
  khi `tripClient.createPair`; 'Hủy' không lưu, 'Xác nhận' lưu như cũ. Warning
  đã xác nhận bị LOẠI khỏi banner sau-save (chuyển, không lặp lại); warning BE
  trả mà pre-check không dự đoán được vẫn render sau-save (BE là authority).

## Case pin

1. Tổng 2 cont > tải trọng xe ⇒ confirm 'Vẫn lưu?' + DOC text TRƯỚC khi POST;
   'Xác nhận' ⇒ 201 như cũ; 'Hủy' ⇒ không gọi POST.
2. Xe chưa khai tải trọng (capacityKg null) ⇒ confirm với text
   'Xe chưa khai tải trọng…' TRƯỚC khi POST; xác nhận ⇒ lưu với
   `vehicleCapacityKg: null` (không dead-end); hủy ⇒ không lưu.
3. Tổng ≤ tải trọng (kể cả đúng bằng) ⇒ KHÔNG dialog, lưu thẳng.
4. Đã xác nhận trước save ⇒ không lặp lại sau save; advisory khác (phí chờ,
   khác tuyến) vẫn hiện + 'Xong'.
5. `frontend/src/features/dispatch/detailed-plan/pairWeightWarning.test.ts` +
   `PairTripsDialog.test.tsx` — pure law + dialog wiring pins.

## Ranh giới

- Không đổi luật lưu: `backend/src/services/trip-pairs.service.ts` và
  `trip-pair-rules.service.ts` giữ nguyên (sil750-manual-pair-overload-advisory
  + sil638-tc6-* xanh nguyên trạng, response `warnings[]` như cũ).
- Không đụng gate phát lệnh 409 `KEP_WEIGHT_WARNING` + confirm retry
  (SIL-674/TC6 scope) và các surface phát lệnh khác.
- Áp dụng cho mọi loại ghép (trigger K3.52 không phân kind — cùng luật với
  advisory BE vốn kind-free).
- Supersedes timing pin của case-SIL-750 ('FE giữ nguyên (đã render)' — chỉ
  còn đúng cho luật lưu, sai cho thời điểm hiển thị).
