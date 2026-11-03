# SIL-668 (id 781) — bỏ auto-pair: ghép Kẹp/Kết hợp chỉ THỦ CÔNG bởi Điều vận

Ngày: 2026-11-03 · Branch: `fix/sil668-remove-auto-pair` (base `41c75c08`)
Nguồn: ruling owner 03/11, verbatim **"bỏ auto pair"** — ghép là tính năng
THỦ CÔNG theo customer doc `2026.9.6_Logic_nghiep_vu.docx` Phần 2 ("Cho phép
Điều vận CHỌN 2 lệnh cont riêng biệt và gán chung 1 xe/tài xế trong cùng 1
ngày"). SIL-638-BE2 (commit `cf289a89`, live ~31/10) đã tự tạo pair
DOUBLE/COMBINED khi 2 cont cùng xe/tài xế/ngày business tại issue path —
gỡ trigger này; pair chỉ hình thành khi điều vận gán 2 lệnh cùng xe bằng
hành động thủ công (POST /api/trips/pairs).

## Regression cases

| ID | Bước tái hiện | Kết quả mong đợi |
|----|---------------|------------------|
| REG-668-1 (AC1 — không tự ghép) | Lô 2 cont 20', cả 2 fulfillment khai `DOUBLE`; phát lệnh leg 1 (xe X + tài xế D, ngày N), rồi phát lệnh leg 2 cùng rig/ngày — KHÔNG thao tác ghép | KHÔNG có row `trip_pairs`, KHÔNG `active_trip_pair_id` trên 2 chuyến, KHÔNG tag pairKind trên detail. Chứng minh DB: `qa/2026-11-03-sil668/after.log` (trip 772/773 — 0 pair row, stamps null) |
| REG-668-2 (AC2 — ghép thủ công giữ nguyên) | Sau REG-668-1, điều vận ghép 2 lệnh qua POST /api/trips/pairs (`pairKind='KEP'`, draft khớp authority) | 201; pair row ACTIVE KEP đúng 2 chuyến; stamps `active_trip_pair_id` + order 1/2 như cũ. Chứng minh DB: `after.log` (pair 24, `772|24|1`, `773|24|2`). VETC/lương chạy qua CÙNG core thủ công — luật pin tại `sil638-tc3-pair-vetc-salary.test.ts` (dev DB chưa cấu hình phụ phí nên rule inert by design) |
| REG-668-3 (AC3 — 0 pin còn assert auto-pair) | `grep -rniE "autoPair|auto_pair|auto-pair" backend/src` | Chỉ còn 1 hit: comment lịch sử "removed by SIL-668" (trip-pair-rules.service.ts:119) + các `doesNotMatch` trong pin mới. 0 pin assert auto-pair chạy |
| REG-668-4 (pin chống tái nhập) | Ai reintroduce `autoPairIssuedTripInTx`/`selectAutoPairPartnerCandidate`/field `autoPairedTrip` | `sil668-manual-pair-only.test.ts` FAIL (doesNotMatch 3 service files + status machine) |
| REG-668-5 (bảo toàn manual core) | Xoá 1 gate bất kỳ trong core (40' Kẹp, same-size, kế thừa số cont, VETC, lương) | `sil668-manual-pair-only.test.ts` FAIL (match anchors) |
| REG-668-6 (TC2 không regress) | Gán ĐƠN lên holder KẸP và ngược lại | Message "Cần cả 2 cont cùng khai báo KẸP mới cho đi chung xe" giữ nguyên 2 chiều — pin runtime trong `sil668-manual-pair-only.test.ts` + `sil638-tc2-*` |
| REG-668-7 (before-evidence đối chứng) | Cùng kịch bản REG-668-1 chạy trên backend còn auto-pair | Pair row TỰ SINH (chứng minh trigger thật sự có trước khi gỡ): `qa/2026-11-03-sil668/before.log` (trip 763/764 → pair 23 KEP ACTIVE, stamps `763|23|1`, `764|23|2`) |

## Phạm vi sửa

- `backend/src/services/dispatch-planning-commands.service.ts` — bỏ wiring
  `autoPairIssuedTripInTx` + recompose, field `autoPairedTrip` trên
  `IssueOrderMutationResult`, import; giữ pre-acquire 6118 (deadlock-order
  guard, comment cập nhật theo luật mới).
- `backend/src/services/trip-pairs.service.ts` — bỏ `autoPairIssuedTripInTx`;
  `createTripPairCoreInTx` GIỮ NGUYÊN (byte-identical với HEAD trừ comment)
  cho đường thủ công.
- `backend/src/services/trip-pair-rules.service.ts` — bỏ section auto-pair
  (`autoPairKindForClassification`, `AutoPairLegFacts`,
  `AUTO_PAIR_PARTNER_STATUSES`, `selectAutoPairPartnerCandidate`); mọi luật
  khác giữ nguyên.
- Test: xoá `sil638-b2-auto-pair.test.ts` (19 pin assert auto-pair), thêm
  `sil668-manual-pair-only.test.ts` (pin màu mới: không tái nhập + manual
  core nguyên vẹn + TC2 2 chiều).
- KHÔNG đổi schema/DB, KHÔNG đụng frontend, KHÔNG xoá data pair cũ, KHÔNG
  đổi message text TC2/TC6.

## Chống-lặp (điều kiện GHÉP THỦ CÔNG vẫn chặn sai — giữ nguyên)

- Ghép 2 lệnh KHÔNG cùng xe/tài xế/ngày → core gate từ chối như cũ.
- 40' Kẹp → hard block text DOC (TC6); kết hợp lệch cỡ → hard block (TC7).
- Một lệnh đã có pair ACTIVE → 409 "Một trong hai chuyến đã nằm trong cặp
  điều vận khác".
- 2 lệnh KẸP+ĐƠN cùng xe → bị chặn ĐỒNG NHẤT 2 chiều (TC2 round 3) — luật
  availability giữ nguyên, không đổi message.

## Bằng chứng chạy (2026-11-03)

| Gate | Kết quả | Artifact |
|---|---|---|
| Scoped BE tests (17 file pair/dispatch/conflict) | 197/197 pass | `qa/2026-11-03-sil668/scoped-tests.log` |
| Full BE unit | 342/342 pass | `qa/2026-11-03-sil668/unit-full.log` |
| Backend typecheck `tsc --noEmit` | 0 lỗi | trong unit-full.log session |
| Root lint | 0 errors (4 warnings cũ, FE không đụng) | `qa/2026-11-03-sil668/lint.log` |
| Driver PHASE=before (auto-pair còn) | all PASS — pair tự sinh | `qa/2026-11-03-sil668/before.log` |
| Driver PHASE=after (không tự sinh + manual pair OK) | all PASS | `qa/2026-11-03-sil668/after.log` |
| Independent code-reviewer | APPROVE (8/8 checklist PASS) | review session ses_e5fc6e9e4ffediQaRZ7bzUIR00 |

Port contract: FE 7175 / BE 3002 (dev). Driver: `qa/2026-11-03-sil668/sil668-pair-driver.mjs`
(`QA_PHASE=before|after node …`) — API + psql đọc-only qua `docker exec ss-prod-db`.
