# fix-171026121100 — FB-038/072 verify-fail 3: overlap guard 2 lỗ hổng còn sót — DONE (pending full-suite green)

Controller: this session (Paseo agent), worktree `fix-fb038-overlap-silent-glm`
@ f1e36ecc (= origin/main khi bắt đầu). Updated: 2026-10-17.

## Goal & status

Card `171026121100-fb038-072-verifyfail3-overlap-silent.docx`: gán cùng biển
số cho 2 dòng kế hoạch trùng ngày + "Phân xe lại" đụng chuyến COMPLETED cùng
ngày đều LƯU THẦM LẶNG trên staging. Điều tra xong; 2 lỗ hổng guard THẬT trên
trunk (dữ liệu staging dính đúng shape), đã fix + test + UI driven.

## Root cause (chứng minh bằng staging read-only + local repro)

1. **FB038-03A** — dòng QA trên staging là ff 198/199 của CÙNG lô 298, FCL
   **không container** (`shipment_container_id` NULL). `scanPlanRowHolders`
   INNER JOIN `shipment_containers` → holder vô hình → lưu thầm lặng.
2. **FB038-03B** — chuyến COMPLETED (trip 117 · BLCUSa24BB) **không planned
   timestamps** (chỉ departureDate). Mọi scan tier-completed đòi
   `isNotNull(planned_start_at)` → vô hình.

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

- Full-suite run2 xanh (hoặc phân loại pre-existing) → review pass → commit
  trunk theo §4 (gates xanh → review → commit).
