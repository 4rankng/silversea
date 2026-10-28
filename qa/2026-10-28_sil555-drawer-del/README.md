# QA — SIL-555 (id 629): nút XÓA CONT trong drawer "Chi tiết container"

Env: worktree stack `fix-629-drawer-del` — FE `http://localhost:7196` (vite),
BE `http://localhost:3102` (tsx watch), dev DB `localhost:5441/silversea`
(shared `ss-prod-db`). Role: **dungnv (DISPATCHER)** — ticket repro role.
Fixture: lô `SHP-2610-00157` / `R42RV-FCL` (id 240), cont MSKU1234565 (275)
+ MSKU1234570 (276) — cả hai mang tờ khai `TK-R42RV-001` (guard fixture).

## Gates

| Gate | Command | Result |
|---|---|---|
| Scoped vitest | `pnpm exec vitest run src/features/dispatch/master-plan/ src/features/shipments/detail/ShipmentContainerLedger.test.tsx src/pages/ShipmentContainersPage.test.tsx src/pages/ShipmentsPage.test.tsx src/features/shipments/cus/` | 45 files / 679 tests PASS — `vitest-scoped.log` |
| Frontend typecheck | `npx tsc -b` | EXIT 0 — `tsc.log` |
| Lint (changed files) | `npx eslint <changed>` | 0 errors |
| Build | `make build` | EXIT 0 — `build.log` |
| Full FE suite | `pnpm exec vitest run` (3 lần) | xem phân loại bên dưới |

### Full-suite failure classification (`vitest-full*.log`)

Run 1 (chồng CPU với UI drive): 5 file fail. Run 2: 7 file. Run 3: 19 file —
tập fail KHÁC NHAU giữa các lần (đa số `Test timed out in 5000ms` = tải song
song trên máy). Phân loại:

1. **Regression của thay đổi này (ĐÃ sửa)** — 3 file `MasterPlanPage*` fail
   `No "useToastOptional" export is defined on the Toast mock`: drawer giờ gọi
   `useToastOptional` ở component gốc. Sửa = hoàn thiện module mock
   (`useToastOptional: () => ({ toast })`) ở đúng 3 file tiêu thụ drawer;
   xanh isolated 18/18 và trong full-suite run 3. Class sweep: 58 file mock
   Toast thiếu export này nhưng chỉ 3 file mount drawer — không đụng file
   không liên quan.
2. **Build precondition** — `numeric-identity.styles.test.ts` cần
   `dist/assets` (`make build`); xanh 6/6 sau build.
3. **Flake tải song song** — `CrudTable.discovery` / `CarrierAllocationDialog`
   / `TripEditConflictDialog` fail timeout trong full-suite, xanh isolated
   8/8 (ship.sh flake quarantine).
4. **Pre-existing, không thuộc thay đổi này** — `ShipmentCreateWorkspace.*`
   (enter-save / cursor-advance) fail assertion cả khi chạy isolated; chứng
   minh pre-existing: cùng test fail trên checkout `main` pristine (không có
   thay đổi này) — lane create-form SIL-534/508/521/513 gần đây. Không đụng
   (giữ unrelated work), báo cáo tại đây.

## UI drive (rung 3) — `run1/`

Driver: `node qa/scripts/2026-10-28-sil555-drawer-del-ui-drive.mjs` — EXIT 0,
12/12 checks (`run1/assertions.json`, `run1/ui-driver.log`).

1. `ui-1-thao-tac-column-1280.png` — cột THAO TÁC + nút "Xóa container" từng
   hàng (DOM: 11 headers, 2/2 dòng có control).
2. `ui-2-guard-disabled-1280.png` — 2 dòng mang tờ khai: nút DISABLED, tooltip
   "Cont có tờ khai TK-R42RV-001 — gỡ tờ khai trước khi xóa" (SIL-177).
3. `ui-3-throwaway-guarded-1280.png` — thêm cont MSKU8234567 (3 cont); inherit
   tờ khai → nút Xóa disabled đúng guard.
4. `ui-4-remove-enabled-1280.png` — gỡ tờ khai (đúng prescription của tooltip)
   → nút Xóa ENABLED.
5. `ui-5-confirm-dialog-1280.png` — confirm "Xóa container MSKU8234567?" với
   nút nguy hiểm "Xóa container" + "Hủy" (SIL-472 contract).
6. `ui-6-deleted-1280.png` — sau confirm: dòng biến mất, toast "Đã xóa
   container MSKU8234567.", drawer refetch về "2 cont", dialog đóng.
7. `ui-7-deleted-390.png` — stacked 390px giữ trường THAO TÁC + control.

## DB side effect (`db-before.txt` / `db-after.txt`)

Throwaway MSKU8234567 được THÊM bởi drive và XÓA bởi chính flow under test:
trước 2 dòng (275/276, nguyên vẹn) → trong chạy 3 → sau trở lại đúng 2 dòng,
`updated_at` hai dòng gốc không đổi. Lot version 22 → 28 (add + sửa tờ khai +
remove của throwaway).

## Coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Nút XÓA CONT từng hàng trong drawer (id 629) | UI DRIVEN | ui-1 + assertions.json + driver log EXIT 0 | — |
| Confirm xóa thật sự xóa được dòng (SIL-472) | UI DRIVEN | ui-5, ui-6 + db-before/after | — |
| Guard SIL-177 disable khi có tờ khai | UI DRIVEN | ui-2, ui-3 (tooltip trong assertions.json) | guard trip (đã gắn chuyến) chỉ pin unit test — fixture local không có dòng tripped |
| Guard chuyến xe / FCL ≥1 cont / READY / version (BE) | CODE-READ ONLY (BE sẵn có, unit-pinned `cus-container-remove-tokhai-guard.test.ts`) | scoped vitest | không drive được nhánh 409 trip/last-cont trên local |
| Bảng "Chi tiết lô" không thêm/xóa (SIL-334) | rung 1 (unit pin giữ nguyên) | ShipmentContainerLedger.test.tsx / ShipmentContainersPage.test.tsx PASS | không chụp lại màn Chi tiết lô |
| Role ACCOUNTANT/DRIVER không thấy nút; lô khóa kế toán không thấy nút | rung 2 (unit pin) | DispatchContainerDetailDrawer.test.tsx (7 test mới) | không drive role khác dungnv |
| Width law FB-045 (header 1 dòng, giờ hẹn đọc trọn) | UI DRIVEN (đọc tại 1280) + styles pin | ui-1, styles.test.ts | 1024/1440 không chụp lại (e2e fb045 giữ) |

Cleanup staging (ticket): MSKU5500004 trên lô K2K4124325234 (staging build
9094e31c) — chờ bản build có nút này được deploy rồi QA xóa trực tiếp; ngoài
phạm vi local (AGENTS.md §2).
