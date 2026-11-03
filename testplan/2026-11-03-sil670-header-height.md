# SIL-670 — Header driver view quá cao: thu gọn chiều cao, badge đè icon được

Case ID: TC-SIL670-01
Feature: Header driver view (`.topbar--driver`, `NotificationBell`, `MonthNavigator`, `DriverIdentity`)

## Quyết định owner (03/11, kèm screenshot)
Header của driver view (trái: tên tài xế 'Đường Văn Thực' + biển xe '15H-021.39'; phải: ô chọn 'Tháng 11/2026 · 01/11 – 30/11' + chuông thông báo badge '3') QUÁ CAO — thu gọn chiều cao.
1. Giảm chiều cao header: bỏ padding dọc thừa — nội dung (2 dòng text trái, controls phải) quyết định chiều cao, không phải padding.
2. Badge số: absolute top-right overlap icon chuông (không tạo thêm chiều cao).
3. Giữ nguyên chức năng: dropdown thông báo mở được (commit 311473cf), chọn tháng hoạt động.
4. Mobile 390px: không vỡ, vẫn compact.
5. KHÔNG đổi typography 2 dòng trái.

## Repro (trước khi sửa — commit base 3c3ff847, dev DB :5441, driver dvthuc / bqhuong)
- 1440 Viewport:
  - Header height: 61px (border-box, padding top=10px, bottom=10px).
  - Badge `.icon-btn .badge`: `top: -8px` (sticking 8px above the button top edge), y=2 vs button y=10.
  - Controls: Month trigger 40px, bell button 40px.
- 390 Viewport:
  - Header height: 57px.
  - Badge: `top: -8px`, y=-1 (sticking 8px above button and protruding above header top edge).
  - Center box (MonthNavigator): 54px (do `.topbar-date` có padding: 5px 8px).

## Expected (sau khi sửa)
- 1440 Viewport:
  - Header height giảm rõ: từ 61px xuống 40.58px (giảm 20.42px, tương đương 33.5% reduction, đạt target ≥30-40%).
  - Padding dọc header thu gọn về 2px (`padding: 2px max(...)`).
  - Controls bên phải: MonthNavigator trigger 32px, Bell button 32px.
  - Badge số thông báo: `top: 1px, right: 1px`, overlap góc trên-phải icon chuông, hoàn toàn nằm trong button box, không tạo thêm chiều cao.
  - 2 dòng text bên trái (tên tài xế + biển số xe) giữ nguyên typography (left box height 35.58px).
- 390 Viewport:
  - Header height giảm từ 57px xuống 39.98px (giảm 17.02px, tương đương 29.9% reduction, compact).
  - Không bị vỡ hàng, không tràn.
- Chức năng:
  - Dropdown thông báo mở/đóng bình thường (modal popover panel mở đúng với danh sách và nút tương tác).
  - Month picker mở/đóng và chọn kỳ làm việc bình thường.
- Không hồi quy:
  - Non-driver topbars (Admin, Manager, Accountant, CUS) giữ nguyên height 56px (`--topbar-h`) và padding 0 24px.
  - Pill ban contract (`.icon-btn .badge` giữ `border-radius: 4px`) không bị vi phạm.

## Automated pins
- `frontend/src/components/layout/Topbar.styles.test.ts`: pin test SIL-670:
  - `.topbar--driver` có padding dọc compact 2px.
  - `.icon-btn .badge` có `top: 1px, right: 1px` overlap chuông.
  - `.topbar--driver .icon-btn` và `.topbar--driver .topbar-date__trigger` có height compact 32px.
- `frontend/src/styles/pill-ban-nav-badges.styles.test.ts`: pin `.icon-btn .badge` giữ border-radius: 4px.
- Scoped vitest: 10 test files, 39 tests pass.
- TypeScript compilation: `pnpm exec tsc -p frontend/tsconfig.json --noEmit` 0 errors.

## Bằng chứng rung-3 (local dev, driver dvthuc & bqhuong, 1440/390)
Artifacts tại `qa/2026-11-03_sil670/`:
- `before/screenshot-1440.png`, `before/screenshot-390.png`, `before/metrics.json`, `before/ui-driver.log`
- `after/screenshot-1440.png`, `after/screenshot-390.png`, `after/screenshot-1440-dropdown.png`, `after/screenshot-390-dropdown.png`, `after/screenshot-1440-monthpicker.png`, `after/screenshot-390-monthpicker.png`, `after/metrics.json`, `after/ui-driver.log`
- Số đo chi tiết:
  - Viewport 1440: 61px → 40.58px (-33.5%)
  - Viewport 390: 57px → 39.98px (-29.9%)

## Not covered
- Các viewport siêu nhỏ < 320px không thuộc target mobile standard (390px iPhone baseline).
- Môi trường production/staging (chỉ chạy local dev stack).
