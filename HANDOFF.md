# fix-171026182554 — bỏ nút Thêm/Xóa container ở màn Chi tiết lô hàng — DONE (chưa merge)

Controller: this session (Paseo agent), worktree
`fix-171026182554-bo-nut-them-xoa-container-chi` (branch-off main @ e36c4a06).
Updated: 2026-10-17 (tối).

## Thay đổi (10 file, +53/−463)

- Thao tác thêm/xóa container giờ CHỈ còn ở drawer Tổng quan (`/shipments`,
  `CusContainerLedger` — không đụng). Bỏ: nút dòng ＋Thêm/Xóa +
  `AddContainerRowForm` của `ShipmentContainerLedger` (`/shipments-detail`),
  nút `Thêm container` + dialog của `ShipmentDetailPage` (`/shipments/:id`),
  `addAction` của `ShipmentDetailContainers`, `addContainer`/`removeContainer`
  của `use-cus-detail`, CSS `__row-actions` chết, và
  `shipment-container-ledger-card-actions.styles.test.ts` (pin đúng cặp nút đã bỏ).
- Card supersede FB-086/FB-112 trên 2 màn Chi tiết; endpoint server + RBAC +
  form tạo lô + `ContainerInstancesCard` (chuyến) nguyên vẹn.
- Rung 3 (CUS, backend :3002 + vite :7175 từ worktree, DB 5441): cả 2 màn
  Chi tiết không còn nút (1440 + 390), 78 trigger "Chỉnh sửa ô…" còn nguyên,
  drawer Tổng quan vẫn Thêm + Xóa (lô 110968, cont FBXF9069254/FBXG9069267),
  DB unchanged. `qa/2026-10-17_card171026182554_*`.
- Gates: lint 0 · be-tsc 0 · fe-tsc 0 · make build OK · FE vitest 5058/5059 —
  fail duy nhất `dev-port-contract` là CỦA CARD KHÁC đã fail trên HEAD
  (`testplan/qa/scripts/qa-20261017-qa1-007-chip-rung.mjs` hardcode 7176/3003,
  commit f9b36180) — không sửa trong ticket này. Structure guard cũng vượt
  ceiling sẵn ở HEAD trên nhiều file không liên quan.

## Mục cũ (worktree khác, đã merge trunk — lịch sử)

# fix-171026121100 — FB-038/072 verify-fail 3: overlap guard 2 lỗ hổng còn sót — DONE (pending trunk merge)

Controller: this session (Paseo agent), worktree `fix-fb038-overlap-silent-glm`
@ f1e36ecc → merged origin/main 66368f42 (merge commit 2514e663).
Updated: 2026-10-17 (tối).

## QUAN TRỌNG — va chạm nhánh với agent khác (đã giải quyết)

Trong lúc làm, trunk đã land fix MỘT PHẦN của chính card này từ agent
`agy-fb038-overlap-claude` (merge `e6ea78ce`, WIP `4297fe78`): luật
**date-only completed trip claim ngày hiển thị** (Gap B) qua shared
`tripClaim*Sql` + `countDateOnlyTripClaims` + suite
`dispatch-overlap-day-only-trips.test.ts`. Giải pháp theo authority order:
- Gap B: NHẬN bản trunk làm law owner (revert phần mình, giữ nguyên file
  `dispatch-resource-availability.service.ts` = trunk verbatim; conflict
  trong `assertTripRigAvailable` resolve theo trunk).
- Gap A (holder không container — kịch bản 1 của card, repro staging ff
  198/199 cùng lô 298): trunk KHÔNG có — giữ nguyên fix của mình
  (`scanPlanRowHolders` LEFT join + `ne('LCL_SHIPMENT')`, review M1-aware)
  + toàn bộ test pins (T15–T18, container-less describe, LCL hard-tier pin,
  date-only trip tests) — 68/68 xanh trên 7 suite liên quan gồm suite của
  trunk.

## Root cause (chứng minh bằng staging read-only + local repro)

1. **FB038-03A** — dòng QA trên staging là ff 198/199 của CÙNG lô 298, FCL
   **không container** (`shipment_container_id` NULL). `scanPlanRowHolders`
   INNER JOIN `shipment_containers` → holder vô hình → lưu thầm lặng.
2. **FB038-03B** — chuyến COMPLETED (trip 117 · BLCUSa24BB) **không planned
   timestamps** (chỉ departureDate) — mọi scan tier-completed đòi
   `isNotNull(planned_start_at)` → vô hình. (Trunk đã fix law này.)

Lưu ý: 2 fix trước (111026105630, 121026185530) đã có trên trunk từ 07–14/10
và có trong staging build; verify-fail 3 là do 2 shape dữ liệu trên, không
phải deploy lag.

## Changes (2 service files + 3 test files)

- `backend/src/services/dispatch-planning-detail-plan.service.ts`:
  `scanPlanRowHolders` INNER→LEFT join (holder không container claim LOT
  window, marker fallbackSlot → tier WARN); 2 scan completed
  (`assertTripRigAvailable`, `assertPlanRowRigAvailable`) claim ngày hiển thị
  theo luật 12fcf20d — warn-once `RIG_OVERLAP_COMPLETED`, confirm flag proceed.
- `backend/src/services/dispatch-resource-availability.service.ts`: tier
  completed tách rig rows (truck/trailer — day-claim mới) khỏi driver leg
  (giữ bar provable-window theo harmonization 11/10, KHÔNG mở lại).
- Tests: container-less describe (5 test), trip edit + reassign fallback vs
  completed date-only (2 test), kep-kethop T15/T16/T17. 38/38 3 file đó pass.

## Files owned by this task

- 2 services + 3 tests trên; `testplan/2026-10-17-card-fb038-overlap.md`;
- `qa/2026-10-17_fb038_*` (api-repro, ui-*, backend-tests, root-lint);
- `qa/drivers/2026-10-17-fb038-ui-drive.mjs` (+2 debug drivers);
- CHANGELOG.md entry.

## QA artifacts

- `qa/2026-10-17_fb038_api-repro.log` — rung 2: pre-fix repro (chẩn đoán),
  post-fix trên server :3092 code worktree với staging-exact shapes (3A/3B/3C),
  restore fixtures + cleanup (đã quay lại trạng thái gốc).
- `qa/2026-10-17_fb038_ui-*.png` + `_ui-driver.log` — rung 3: dieuvan,
  /dispatch-detail 1440, dialog "…container khác của lô này… Vẫn lưu?" hiện,
  'Xác nhận' lưu; DB proof ff 47995/47996 (đã dọn sau).
- `qa/2026-10-17_fb038_backend-tsc.log` exit 0; `qa/2026-10-17_fb038_root-lint.log`
  — red-at-base 20 problems (file 16/10, không thuộc diff), scoped eslint 5
  file fix = exit 0.
- `qa/2026-10-17_fb038_backend-tests.log` — full suite rerun sạch (run1
  `_run1-poisoned.log` bị 2 process test mồ côi của lần chạy đầu giành DB —
  đã kill, có ghi trong log).

## Unrelated / preserved

- Main checkout /Volumes/LexarSSD/projects/silversea có untracked testplan/qa
  scripts của task khác — không đụng.
- Dev stack (:3002/:7175) của main checkout giữ nguyên; server phụ :3092/:7176
  của task này đã tắt sau QA.
- Test 'card 20260928_169/197/377/E2E comprehensive' fail trong run1 — nghi do
  concurrent DB; chờ run2 sạch để kết luận (nếu vẫn đỏ ở run2, kiểm tra lại
  với git stash để xác định pre-existing).

## Non-goals / ghi chú

- Scan DRIVER tier-completed giữ nguyên harmonization (không warn trên
  date-only completed) — quyết định review 11/10, card không yêu cầu đổi.
- RBAC staging: role Điều vận không vào được /trips/:id/edit nên nhánh confirm
  của form sửa chuyến (use-trip-form-submit) chưa UI-driven — admin phải verify
  riêng (FB038-03C, đã ghi testplan).
- Không deploy staging (cần chỉ thị owner).

## Next step

- ĐÃ LAND TRUNK: merge commit `9d109c0d` trên main (main checkout), sau khi
  merge nhánh vào main @ b930be12; trunk tsc exit 0 sau land.
- Còn lại cho owner: deploy staging (`make demo`) khi sẵn sàng + admin verify
  FB038-03C (form sửa chuyên /trips/:id/edit — RBAC Điều vận không vào được).
