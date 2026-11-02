# SIL-638 (id 742) — TC6(2) silent unprovable weight gate + TC1 IN_TRANSIT busy rig (QA 02/11/2026)

QA verdict on staging build `ed0056e1` (ticket comment 02/11 12:28): TC1 + TC6(2)
FAIL, cả hai đều là "lưu im lặng" — không cảnh báo, không xác nhận. Cả hai case
đã được tái hiện LOCAL bằng `qa/scripts/2026-11-02-sil638-tc1-tc6-repro.mjs`
(probe log: `qa/2026-11-02-sil638-tc1-tc6/repro.log`, EXIT=0 sau fix) và sửa
trong lane này.

## Case S638-W1 — TC6(2): kẹp pair thiếu dữ liệu tải trọng phát lệnh im lặng

### Reproduction (pre-fix)

1. Lô FCL với 2 cont 20', mỗi cont `cargoWeightKg = 60000`; xe gắn moóc KHÔNG
   có loại (`trailers.type = null` → `inferredVehicleCapacityKg` → null).
2. Điều vận đặt Phân loại = Kẹp cho cả 2 chân, cùng khung giờ 08:00–12:00.
3. Phát lệnh chân 1 → 201 (chưa có partner, gate chưa chạy — đúng).
4. Phát lệnh chân 2 → **201 im lặng**, `trip_pairs` row `KEP|ACTIVE` được tạo
   tự động. KHÔNG có 409 `KEP_WEIGHT_WARNING`, KHÔNG có dialog xác nhận.

### Root cause

`kepWeightGuardOutcome` (trip-pair-rules.service.ts) map `verdict =
'unprovable'` (capacity null hoặc một bên thiếu trọng tải) → `'allow'` im
lặng, với comment "the existing missing-capacity advisory owns that case".
QA đã chứng minh advisory đó KHÔNG sở hữu path phát lệnh (auto-pair tạo pair
trước khi bất kỳ advisory nào kịp hiển thị). DOC TC6(2) v2 (31/10) quy định
cảnh báo mềm phủ CẢ nhánh thiếu dữ liệu ("hoặc cont chưa có dữ liệu tải trọng
/ xe chưa cấu hình tải moóc") — KHÔNG được im lặng, KHÔNG được chặn cứng.

### Expected behavior (post-fix)

- Phát chân 2 → 409 `KEP_WEIGHT_WARNING` với text DOC verbatim
  ("Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương
  tiện, Điều vận vui lòng kiểm tra lại"), KHÔNG tạo pair ở lần refuse đầu.
- Dispatcher xác nhận (retry mang `kepWeightWarningConfirmed`) → 201, pair
  tự tạo (warn-once contract — phát lệnh kịp thời vẫn được ưu tiên).
- Verdict `pass` (đủ dữ liệu, không quá tải) vẫn lưu sạch, không nag.

## Case S638-B1 — TC1: gán thêm lệnh cùng ngày khi xe đang chạy (IN_TRANSIT) im lặng

### Reproduction (pre-fix)

1. Chân A 08:00–12:00 đã phát lệnh và tài xế ĐÃ NHẬN (trip `IN_TRANSIT`).
2. Gán thêm chân D 18:00–22:00 cùng xe, cùng ngày (window chạm mép, không
   overlap [start,end)) → **200 im lặng**. QA staging: chân 18:00 gán THÀNH
   CÔNG trong khi cả 2 chân 27/11 đều IN_TRANSIT (trips 158+161).

### Root cause

Toàn bộ scan cửa sổ của `assertPlanRowRigAvailable` so [start, end) — chuyến
đang chạy thực tế chiếm xe đến khi COMPLETED (chạy trễ qua planned end là
chuyện thường), nên window chạm mép/đuôi ngày đi qua không có bất kỳ tín hiệu
nào. QA verdict: "khối IN_TRANSIT chưa sống".

### Expected behavior (post-fix)

- Gán cùng ngày trên xe có chuyến IN_TRANSIT → 409 warn-once
  `"Đầu xe <plate> đang bận thực hiện lệnh chưa hoàn tất. Vẫn lưu?"` (code
  `RIG_OVERLAP_COMPLETED`) — đúng text DOC TC1.
- Confirm → lưu tiếp (chạy xoay vòng ca sáng/chiều vẫn khả thi; tuyệt đối
  KHÔNG trở lại luật cứng 1 xe = 1 lệnh/ngày).
- Leg đã COMPLETED không còn warn (luật hiện giữ nguyên); ngày KHÁC của
  chuyến đang chạy không bị nag (`busyDayClaimOverlaps` theo ngày business
  Asia/Ho_Chi_Minh của holder).

## Verification

- Unit (BE law, pinned): `sil638-tc6-weight-unprovable-warn.test.ts`,
  `sil638-tc1-busy-rig-warn.test.ts`, `sil638-tc8-tc9-pair-gating.test.ts` —
  backend unit suite 788/788 pass; `npx tsc -p tsconfig.json --noEmit` 0 error.
- Integration probe (LOCAL dev, BE worktree :3013 + ss-prod-db): probe1/
  probe2/probe3.1–3.6 all PASS, EXIT=0 — xem
  `qa/2026-11-02-sil638-tc1-tc6/repro.log`.
