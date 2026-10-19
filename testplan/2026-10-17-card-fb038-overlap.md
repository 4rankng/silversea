# Card 171026121100 — FB-038/072 verify-fail 3: gán xe trùng lịch lưu thầm lặng

- Card: `171026121100-fb038-072-verifyfail3-overlap-silent.docx`
- Môi trường báo lỗi: staging vantai.tingting.vip, role DISPATCHER (dungnv).
- Hai fix trước (111026105630, 121026185530) DEV_COMPLETED trên trunk.

## Case 2026-10-17-FB038-03A — cùng biển số cho 2 dòng kế hoạch trùng ngày

- ID: 2026-10-17-FB038-03A
- Steps:
  1. Dispatcher mở /dispatch-detail, chọn 2 dòng FCL khác lô cùng ngày giao,
     chưa phân xe.
  2. "Sửa ô điều phối" gán biển X cho dòng 1 → lưu.
  3. "Sửa ô điều phối" gán cùng biển X cho dòng 2 → lưu.
- Expected:
  - Lần 2 phải bị từ chối một lần với 409 code `RIG_OVERLAP_COMPLETED`
    ("… Vẫn lưu?"), FE hiện dialog xác nhận; "Vẫn lưu" (retry với
    `rigOverlapCompletedConfirmed: true`) thì lưu; huỷ thì giữ editor mở.
  - Không bao giờ lưu thầm lặng.

## Case 2026-10-17-FB038-03B — "Phân xe lại" đụng chuyến COMPLETED cùng ngày

- ID: 2026-10-17-FB038-03B
- Steps:
  1. Tồn tại trip COMPLETED của xe T, khung giờ chứng minh được (planned
     timestamps). Tồn tại trip CREATED khác xe, khung giờ giao tùy biến trùng
     khung đó.
  2. Dispatcher "Phân xe lại" trip CREATED sang xe T, lý do hợp lệ.
- Expected:
  - 409 code `RIG_OVERLAP_COMPLETED` ("Có N chuyến đã hoàn thành trùng khung
    giờ phân công này. Vẫn lưu?") lần đầu; retry với confirm flag thì lưu.
  - Không bao giờ lưu thầm lặng, không hard-block không đường thoát.

## Ghi chú phân quyền

- Trên staging role Điều vận không vào được /trips/:id/edit nên nhánh confirm
  của form sửa chuyến phải được kiểm chứng bằng admin (_FB038-03C, theo dõi
  riêng; form dùng chung hook use-trip-form-submit đã có confirm flow).

## Kết quả local (2026-10-17, backend :3002 @ f1e36ecc)

- Xem `qa/2026-10-17_fb038_api-repro.log` — thực hiện qua API thật đúng
  contract trên (rung 2); UI driver theo §9 báo cáo chính.

## Root cause (điều tra staging read-only + local repro)

Cả 2 cảnh báo ĐÃ có sẵn trên trunk từ 07–14/10 (2087fe5b, 21723617, d03fffbb,
454319ee, 6051d39a, 12fcf20d, c2ae248b, 27b63bfe) và staging build 17/10
(a526352d) chứa đủ. Local repro với dòng có container + ngày giao date-only
→ warn đúng. Đặc thù dữ liệu staging làm 2 lỗ hổng guard còn sót:

1. **FB038-03A (2 dòng cùng biển số, cùng ngày)**: 2 dòng QA dùng là ff
   198/199 của CÙNG lô 298, FCL **không có container**
   (`shipment_container_id` NULL — dòng chưa decompose). Holder scan
   `scanPlanRowHolders` INNER JOIN `shipment_containers` → holder vô hình →
   `sameLotPlanClaim` không bao giờ true → lưu thầm lặng.
2. **FB038-03B (Phân xe lại đụng chuyến COMPLETED cùng ngày)**: chuyến COMPLETED
   (trip 117 · BLCUSa24BB) **không có planned timestamps** (runAt null, chỉ có
   ngày). Mọi scan tier-completed yêu cầu `isNotNull(planned_start_at)` → vô
   hình → lưu thầm lặng, dù grid hiển thị chuyến finished đậu trên biển đó
   cùng ngày.

## Fix (đã land worktree này)

- `scanPlanRowHolders`: INNER → LEFT join container; holder không container
  claim LOT window như nhánh LCL (luật 061026174603), giữ marker
  `fallbackSlot` → weak evidence → tier WARN.
- Tier completed (3 scan: `assertResourceAvailability` rig rows,
  `assertTripRigAvailable`, `assertPlanRowRigAvailable`): trip COMPLETED
  không timestamps claim nguyên ngày hiển thị theo luật 12fcf20d — vẫn
  warn-once `RIG_OVERLAP_COMPLETED`, không bao giờ hard block.
- KHÔNG đổi: scan DRIVER tier-completed giữ bar "provable window" (quyết định
  harmonization 11/10 giữ nguyên — date-only completed row không chứng minh
  được tài xế bận).

## Regression

- `dispatch-plan-row-rig-conflict.test.ts` — describe mới: 5 test container-less
  (cùng lô warn + retry, khác lô warn + retry, first-save control).
- `trip-overlap-warning.test.ts` — describe mới: 2 test (edit form + fallback
  reassign) completed date-only; test harmonization driver cũ vẫn pass.
- `dispatch-resource-availability-kep-kethop.test.ts` — T15/T16/T17.
- `dispatch-overlap-warning.test.ts` — pin M1: LCL holder có closingAt chứng
  minh được giữ tier HARD (không bị leak vào scan FCL như warn).
- Kết quả: 57/57 pass trên 6 suite liên quan (`qa/2026-10-17_fb038_backend-tests.log`).

## Independent review (code-reviewer subagent, 17/10)

- DONE_WITH_CONCERNS → 2 finding ĐÃ fix + pin:
  - **H1** (silent-save regression do bản nháp đầu): tier completed của
    `assertResourceAvailability` match truck AND trailer conjunctive → chuyến
    COMPLETED cùng đầu xe khác rơ-moóc thành vô hình. Fix: disjunction theo
    từng resource (truck/trailer各自 day-window; driver giữ bar timestamp).
    Pin: T18a (date-only) + T18b (provable) cùng đầu xe khác rơ-moóc.
  - **M1**: leftJoin cho LCL row lọt scan FCL với fallbackSlot luôn true →
    hạ tier HARD của LCL cross-lot chứng minh được xuống warn. Fix:
    `ne(fulfillmentType,'LCL_SHIPMENT')` trong scan FCL (phục hồi tính độc
    quyền như INNER JOIN cũ). Pin: test HARD tier ở dispatch-overlap-warning.
- Low: predicate `is not null` dự phòng (departureDate NOT NULL) — giữ nguyên.

## Phân loại 14 test fail trong full backend suite

- `qa/2026-10-17_fb038_preexisting-failures.log` — standalone WITH FIX vs AT
  BASE (git stash): 58/44/14 GIỐNG HỆT → pre-existing tại f1e36ecc, không do
  diff này (card10/11/169/197/377/customer-user-link/comprehensive E2E).
