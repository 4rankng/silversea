# SIL-862 — /timesheet + /dispatch chặn nhầm vai, denial toast dính qua điều hướng (regression case)

Case ID: TC-SIL862-GUARD-01
Feature: ma trận quyền route-guard FE (`frontend/src/App.tsx`) + quyền API backend (`casbin/policy.csv`, `routes/timesheet.ts`) cho `/timesheet`, `/dispatch`, `/dispatch-detail`; và vòng đời denial toast "Bạn không có quyền truy cập trang này."

## Bối cảnh (QA 2 vòng trên staging — build 4db2d62f rồi 09069560, đều FAIL)
- `hoangnh` (Nguyễn Huy Hoàng, NV003 — role **OPS** 'Vận hành', ghế "Vận hành / Điều vận" theo cách gọi của ticket) mở `/timesheet` → redirect `/ops/orders` + toast "Bạn không có quyền truy cập trang này." Sai ngữ cảnh: Chấm công lái xe là tính năng của chính người này. Toast còn DÍNH qua điều hướng (vẫn thấy trên trang login sau đăng xuất).
- `/dispatch` không mở được cho ai trong 2 tài khoản QA: `hoangnh` → `/ops/orders`, `hoapt` (Kế toán) → `/accounting`, cùng toast → chặn luôn vòng QA CSS của SIL-863.
- Root cause (3 lớp cùng thiếu seat OPS — review round 2 xác nhận): (1) FE guard `timesheetStaffOnly`/`dispatchOnly` (App.tsx) thiếu OPS (tài khoản repro là OPS, không phải DISPATCHER); (2) page-level gate `canEditGrid`/`canOpenBoard` (TimesheetGridPage.tsx) và `requireRoles` board-read sets (dispatch-planning.routes.ts: dispatch-queue/handoffs/fleet/detail-rows/facets) cũng thiếu OPS — mở được route vẫn read-only/403; (3) backend `/api/timesheet` (casbin resource `timesheet`) thiếu OPS. Lưu ý: `p, OPS, dispatch, read` là policy CHẾT (không có `casbinAuthz('dispatch')`); authority thật của board là `casbinAuthz('shipments')` ở mount + requireRoles sets. Premise đã pin "ACCOUNTANT and OPS read the dispatch board" (SIL-694) trước đó không khớp guard.

## Bề mặt sửa
- `frontend/src/App.tsx`: `timesheetStaffOnly` + OPS; `dispatchBoardOnly` mới cho `/dispatch` + `/dispatch-detail` (ADMIN/MANAGER/DISPATCHER/OPS/ACCOUNTANT); `dispatchOnly` giữ nguyên cho catalog `/fleet/*` + lookup nhà xe; `DenialToastReset` dismiss denial toast ở lần đổi pathname SAU redirect của chính nó (navigate/sign-out là reset).
- `frontend/src/pages/TimesheetGridPage.tsx`: `canEditGrid`/`canOpenBoard` + OPS (qua `getModernRole` — seat legacy FORWARDER đúng ghế).
- `backend/src/routes/shipments/dispatch-planning.routes.ts`: `DISPATCH_BOARD_READERS` (+OPS) cho 9 GET đọc của 2 bảng điều vận; write sets giữ nguyên.
- `backend/src/casbin/policy.csv` + `backend/src/routes/timesheet.ts`: OPS `timesheet read|write`; `TIMESHEET_MONTH_OPENERS` + `TIMESHEET_GRID_EDITORS` gồm OPS (tạo tháng khi mở trang + ghi lưới). Kế toán-only (mode/adjustment/reconcile/reopen) giữ nguyên.

## Expected (sau khi sửa)
- `hoangnh` (OPS) mở `/timesheet`: lưới Chấm công lái xe render, KHÔNG toast, KHÔNG redirect; tạo tháng (POST /months) và ghi lưới (PUT days) không 403.
- `hoangnh` (OPS) và `hoapt` (ACCOUNTANT) mở `/dispatch` (và `/dispatch-detail`): board render, không toast, không redirect. DISPATCHER/ADMIN/MANAGER giữ nguyên quyền cũ.
- Vai thật sự sai quyền (CUS/DRIVER/CUSTOMER) vào `/timesheet` hay `/dispatch`: vẫn redirect về home role + toast denial đúng luật (toast CHỈ hiện khi thực sự sai quyền).
- Denial toast: hiện đúng 1 lần/đợt (burst window QA2-003 giữ nguyên), sống sót qua redirect của chính nó (thông báo trên trang home), và bị dismiss ở lần điều hướng kế tiếp (kể cả đăng xuất → `/login`) — không còn dính sang trang login.
- Không phá các point đang PASS: 'Xuất Excel' (/accounting/invoice-tracking), `/timesheet` as `hoapt`, Drawer 'Chi tiết lô hàng' as `hoapt`, App.denial-toast QA2-003, App.chot-debit-access, nav-sweep.

## Automated pins
- `frontend/src/App.timesheet-route.test.tsx`: + OPS mở được (repro hoangnh); CUS vẫn bị chặn có toast.
- `frontend/src/App.dispatch-route.test.tsx` (mới): role matrix `/dispatch` — OPS/ACCOUNTANT/DISPATCHER mở được không toast; CUS bị chặn có toast; `/dispatch-detail` mở cho OPS/ACCOUNTANT.
- `frontend/src/pages/TimesheetGridPage.test.tsx`: + OPS (và seat legacy FORWARDER) nhập lưới được, có "Lưu lưới"; OPS mở bảng chấm công được — pin page-level gate (lớp review round 2 chỉ ra).
- `frontend/src/App.denial-toast.test.tsx`: + denial sống qua redirect của chính nó; lần navigate kế tiếp (→ /login) dismiss.
- `backend/src/tests/timesheet-role-matrix.test.ts` (mới): casbin `timesheet` admit OPS read+write, từ chối DRIVER/CUS; `TIMESHEET_MONTH_OPENERS`/`TIMESHEET_GRID_EDITORS` gồm OPS, ACCOUNTANT chỉ ở MONTH_OPENERS.
- `backend/src/tests/dispatch-board-read-authz.test.ts` (mới): `DISPATCH_BOARD_READERS` gồm đủ 5 seat đọc, loại DRIVER/CUS/CUSTOMER.

## Not covered bởi hồ sơ này
- Bằng chứng UI DRIVEN (rung 3, AGENTS §9) trên staging: QA ticket tự chạy các vòng build như quy trình hiện tại (unit/typecheck ở lane = rung tự động, không imply rung 3).
- Ghi lưới `/dispatch` cho OPS/ACCOUNTANT (phát lệnh, phân xe): giữ server-gated như hiện tại — scope ticket là mở trang + hết toast sai ngữ cảnh; verb per-row vẫn theo SIL-694. REVIEW FLAG (cần owner ruling): row-menu 'Hủy phân xe'/'Sửa điều phối' vẫn render cho ACCOUNTANT/OPS theo đúng pin SIL-694 ("the gate hides one affordance, not the row's whole action surface") — ACCOUNTANT có `trips write` (policy) nên 'Hủy phân xe' là verb CHẠY ĐƯỢC (mới UI-reachable qua /dispatch-detail); với OPS là dead verb (click → 403). Không tự đổi pin của SIL-694 trong lane này.
- Sidebar nav entries cho OPS/ACCOUNTANT (`Layout.tsx`) chưa thêm — ngoài scope brief (sửa route/guard); nav-sweep một chiều (nav → guard) nên không vỡ. Quyết định hiển thị menu để chủ sở hữu chốt sau.
