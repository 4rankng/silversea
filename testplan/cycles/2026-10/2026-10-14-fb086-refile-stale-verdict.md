# 2026-10-14 — FB-086 re-file verdict: STALE (same scenario as round 19, no code)

Ngày: 2026-10-14 · Nguồn: Muse TODO board — QA party kia re-file
"FB-086: them container khong cap nhat tong quan" · Verdict branch:
`verify/fb-086-refile` @ `398a9c57` (= prod pointer; chứa toàn bộ fix round 19).

## Verdict

**STALE — same scenario.** Re-file là diễn đạt lại của triệu chứng (a) ticket
round 19 **131026201000** ("overview/schedule không cập nhật" sau khi thêm
container), đã fix và verify ở round 19. Không có code mới. Bằng chứng dưới
danh để Muse đóng ticket; nếu QA party vẫn giữ TODO, cần reproduction mới trên
build ≥ `c7dcc286` (xem "Điều kiện mở lại" cuối file).

## Ánh xạ kịch bản (re-file ↔ ticket đã fix)

| Re-file (Muse TODO) | Round 19 — ticket 131026201000 |
|---|---|
| "them container" | Luồng Thêm container — cả hai cửa ngõ còn sống đều gọi chung `POST /shipments/cus-workspace/{id}/containers` → `addCusShipmentContainer` |
| "khong cap nhat tong quan" | Triệu chứng (a) trong thẻ `2026-10-14-r19-fb086-edit-add-container.md`: "overview/schedule không cập nhật" |

Root cause round 19: container thêm vào landed NULL type/route/cảng/nhà
máy/hẹn → không đóng góp gì cho "Lịch cont" / cột "Lịch trình & điều xe" của
Tổng quan cho tới khi điền tay từng cột. Fix: BE kế thừa mặc định từng cột bỏ
trống từ sibling không-NULL đầu tiên (thứ tự id), input tường minh vẫn thắng.

## Commits (đều là ancestor của `398a9c57` — đã kiểm `git merge-base --is-ancestor`)

| Commit | Vai trò |
|---|---|
| `81c38d9e76671249c23715c0b509a026d2209481` | BE `addCusShipmentContainer` kế thừa lô (shared owner của mọi đường add) + FE drawer hồi phục sau 409 phiên bản (`onDetailStale`) |
| `ad1fb9a3234d21f2db896cc42d6e5774cdee7c2e` | test follow-up (bỏ cờ `exact` không được hỗ trợ) |
| `c7dcc286ea241c6f48e7d7ddd13b9913a0cf3e82` | merge `fix/round19-wave` vào main (chứa 2 commit trên) |
| `747c7d7dceac7419e4b13e2e2c9da94ee0d6f794` | workboard `/shipments-detail` regain hàng động ＋Thêm/Xóa — ride cùng endpoint kế thừa của BE |

Hai bề mặt add còn sống (không còn route `/shipments/:id` — đã kiểm
`frontend/src/App.tsx`): drawer `/shipments` (`CusContainerLedger`) và
workboard `/shipments-detail` (`ShipmentContainerLedger` +
`useCusDetail.addContainer`). Cả hai đều hội tụ về cùng owner BE đã fix, nên
"tổng quan không cập nhật" không tái hiện được trên build ≥ `c7dcc286`:

- Drawer: sau add thành công → `onLineSaved` → `applySavedContainerLine` cập
  nhật dòng overview (containerSummary/đếm cont — card 071026100800); 409 →
  `onDetailStale` → `loadDetail(id, true)`.
- Workboard: sau add → `finishSave()` → `loadRowsRef.current()` tải lại toàn
  bộ rows (kế thừa hẹn → dòng lịch xuất hiện).

## Bằng chứng test

**Round 19 (đã ghi, chạy trong worktree `fix-round19-wave`):**
`qa/2026-10-14_fb086_be-test.log` (6/6), `qa/2026-10-14_fb086_fe-test.log`
(30/30), UI rung 3: `qa/2026-10-14_fb086-fix_ui-*` (driver log ghi
`[POST 201] .../cus-workspace/285/containers`), DB row cont 315 đủ cột (handoff
round 19). Muse QA PASS (theo thông báo của owner).

**Chạy lại mới hôm nay tại HEAD `398a9c57` trên branch này (exit 0 cả hai):**
`qa/2026-10-14_fb086-refile_be-test.log` — 8/8 pass, gồm suite
"quick-add container inherits the lot (FB-086, round 19)":
- "an omitted column falls back to the first non-null sibling value"
- "an explicit add input still overrides the lot default"

`qa/2026-10-14_fb086-refile_fe-test.log` — 4 files, 149/149 pass, gồm các pin:
- "adds a container to an existing lot inline (FB-086)" (workboard)
- "removes a container from its lot through the danger confirm (FB-086)"
- "withholds lot composition actions from lot-level rows (FB-086)"
- "calls onDetailStale and appends the retry hint when the add hits the version 409"
- "keeps the plain error (no recovery hint, no reload) for a non-version failure"

Ghi chú minh bạch về artifact rung 3: `qa/2026-10-14_fb086-fix_ui-overview.png`
byte-identical với `qa/2026-10-14_fb086-fix_ui-after.png` (đã đối chiếu `cmp`)
— artifact "overview" là chính trạng thái màn hình sau-add được lưu dưới hai
tên; phiên verdict này không xem lại được nội dung ảnh (model không đọc ảnh),
nên claim rung 3 dựa trên artifact + DB proof đã ghi của round 19, không
tái-assert mới.

## Vì sao re-file ra đời (stale-build pattern)

Re-file đến trong đợt batch 14 ticket "r17-verify-*" của QA party kia (xem
`docs/qa-batch-triage-2026-10-14.md` @ branch `docs/qa-batch-triage`,
commit `f75b9d0a`): FB-086 gốc là mục helpdesk **round 17** — trước khi round
19 fix. Verify lại round 17 trên build pre-`c7dcc286` tái hiện đúng báo cáo
này; đây là pattern stale-build đã có tiền lệ (FB-069 "500.00 kg" bị rút lại
cùng lý do — xem standing caveats của triage doc). Không kèm theo
build/commit provenance trong TODO.

## Điều kiện mở lại (cho Muse)

Đóng ticket này với evidence trên. Chỉ mở lại khi QA party cung cấp
reproduction mới: build/commit ≥ `c7dcc286` đã test, Số Bill/Số Booking (hoặc
shipment id), số container thêm, màn hình (drawer `/shipments` hay workboard
`/shipments-detail`), thời điểm — và tổng quan còn thiếu gì sau khi tải lại.

## Verification coverage (§9)

| Claim | Rung | Evidence | Not covered |
|---|---|---|---|
| Re-file = triệu chứng (a) của ticket đã fix round 19 | CODE-READ ONLY | mapping bảng trên; hai thẻ testplan FB-086 | nội dung ticket gốc trên Muse board (chưa có body) |
| Fix FB-086 có mặt ở build QA cần kiểm (main/prod) | CODE-READ ONLY | `merge-base --is-ancestor` c7dcc286/747c7d7d/81c38d9e → 398a9c57 | build thực tế QA party đã chạy (chưa có provenance) |
| Kế thừa + override sau add (BE) | tự động test | `qa/2026-10-14_fb086-refile_be-test.log` 8/8 | không phải rung UI |
| Add/409-hồi phục/workboard pins (FE) | tự động test | `qa/2026-10-14_fb086-refile_fe-test.log` 149/149 | không phải rung UI; chưa chạy toàn bộ 4756 FE tests |
| "Thêm container → tổng quan cập nhật" end-to-end | UI DRIVEN (round 19, đã ghi) | `qa/2026-10-14_fb086-fix_ui-*` + DB cont 315 (handoff R19) | lần verify này không tái drive UI; mobile viewport, non-CUS roles (như handoff R19) |
