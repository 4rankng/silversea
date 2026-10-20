# HANDOFF — 2026-10-20 — R25 regressions: FB-011 "{" cảnh báo + FB-036 SĐT lái xe + FB-045 dialog clip (cards 201026135800/135900/140000)

Controller: agent, worktree `/Users/dev/.paseo/worktrees/1njkloyy/fix-r25-regressions`,
branch `fix-r25-regressions` (off `main` = `16f0e51a`). Updated 2026-10-20.

**Status**: DONE — committed + pushed to origin.

- **Investigation verdict**: cả 3 triệu chứng reproduced trên staging
  `ab0a9138` (pin controller-approved = 16f0e51a + A.1, không chạm surface
  này). Local A/B cùng DB (`_2026-10-20-r25-compare-builds.mjs`,
  `qa/2026-10-20-r25-regressions/compare-builds-driver.log`) cho thấy
  8bfa2ac7 và 16f0e51a hành xử GIỐNG HỆT trên cả 3 surface — KHÔNG commit
  nào trong range đổi behavior; R24 PASS là width/data-dependent. Fix theo
  expected behavior của card + pin test.
- **FB-011 (201026135800) FIXED**: `{` trên /dispatch từng silent-empty →
  giờ `masterPlanSearchError()` (pure) flag query không chữ/số qua slot
  `search.error` của FilterBar (role="alert", aria-invalid). Unit 3 pin.
- **FB-036 (201026135900) FIXED**: cell Điều phối /dispatch-detail hiện
  `biển số · tên · SĐT`. BE: `dispatch.assignedDriverPhone` trên read rows
  (trip branch: drivers.phone/external_driver_phone qua tripsComposite;
  planned branch: batch truck-driver assignment) + write echo (plate patch +
  atomic plan save). FE: phone token trong `dispatch-assignment-cell`;
  plate-patch merge giữ name+phone sau lưu. Wire 5/50 rows đủ 2 branch; DB
  roster khớp phone từng tên. Unit 2 pin.
- **FB-045 (201026140000) FIXED**: cột Giờ hẹn đóng/trả của drawer "Chi tiết
  container" có floor 150px (`__appointment-column`) + thead nowrap pin
  tường minh (luật FB-063/R17 1 dòng). Driver đo 1440/1280/1024: 9/9 header
  1 dòng 0 shear, value 1 dòng. Styles test 3 pin.

**Gates**: BE tsc 0 · BE unit 326/326 · FE tsgo -b 0 · FE full vitest
688 files / 5276 tests (1 fail đầu tiên do script A/B hardcode port
7176/3003 — rename `_`-prefix theo convention archived-script, re-run
green) · lint 0 · `make build` OK.
`qa/2026-10-20-r25-regressions/gates.log`.

**Stack note**: backend tsx watch :3002 + vite :7175 chạy background từ
worktree này (log /tmp/ss-backend-r25.log, /tmp/ss-frontend-r25.log); DB
dùng container ss-prod-db :5441 / ss-prod-redis :6391 có sẵn, KHÔNG đụng
container. Stack A/B R24 (/tmp/r24base, :3003/:7176) đã xóa tiến trình —
export dir /tmp/r24base có thể xóa.

**Files owned by task**: backend/src/services/{dispatch-planning-detail-plan-read.service.ts,dispatch-planning-detail-plan.service.ts,truck-driver-assignment.service.ts},
frontend/src/api/dispatchPlanningClient.ts,
frontend/src/features/dispatch/detailed-plan/{DispatchPlanEditorCell.tsx,.css,.test.tsx,useDispatchDetailPlan.ts,useDispatchDetailPlan.test.tsx},
frontend/src/features/dispatch/master-plan/{MasterPlanFilters.tsx,MasterPlanFilters.test.tsx,DispatchContainerDetailDrawer.tsx,.css,DispatchContainerDetailDrawer.styles.test.ts},
testplan/2026-10-20-r25-regressions.md, testplan/qa/scripts/2026-10-20-r25-*.mjs (+ _compare archived),
qa/2026-10-20-r25-regressions/ (force-tracked).

**Not covered**: staging re-drive của 3 fix (cần deploy staging ≥ commit
này — R26 re-check phải chạy trên build mới); viewport 761–1023 của drawer
(container card mode ≤760 là mode khác, không thuộc card); EXTERNAL-trip
phone trên local page 1 (branch chứng minh qua wire shape + unit type).
