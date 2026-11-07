# Lane G1 — evidence (2026-11-07, worktree fix/g1-unlock-roaddcost-opssave @ base 95e2bd13)

## Gates (final code)

| Gate | Command | Result |
|---|---|---|
| BE typecheck | `cd backend && npx tsc --noEmit` | 0 errors |
| BE unit (full) | `cd backend && pnpm test:unit` | 971/971 pass |
| BE scoped rerun on final code | `npx tsx --test src/tests/unit/{expense-trip-cost,shipment-cost-unlock,shipment-cost-lock-history,cost-lock-debit-note-guidance}.test.ts` | 25/25 pass |
| FE typecheck (final) | `cd frontend && npx tsc -b` | 0 errors |
| FE scoped (final) | `npx vitest run ShipmentDebitWorkspace OpsExpenseFormModal.containers OpsOrdersPage numeric-identity` | 70/70 pass |
| FE full suite | `cd frontend && npx vitest run` | run A (pre-fix): 6271/6278 — 7 fails; run B (after fixes + `make build`): 6274/6278 — 4 fails: 2 lane regressions (OpsOrdersPage footer-dup + wording — FIXED, targeted rerun green) + 2 numeric-identity pins needing `dist/` (pass after build, verified in final scoped run). Run A's other 3 fails = PhoiPhieuControlPage selection TIMEOUT load-flakes (untouched surface), documented flake class. |
| Lint | `pnpm lint` | 0 errors (6 pre-existing warnings in files untouched by this lane) |
| Build | `make build` | exit 0 (dist/assets produced; unblocks the numeric-identity pins) |

## SIL-721 — Mở khóa lô cho Quản trị · Giám đốc (MANAGER) · Kế toán

- API (rung 2): `sil721_lot779247_run2_api.log` — lot 779247 (SHP-2611-00407):
  ketoan unlock **200**, giamdoc unlock **200**, dieuvan **403**; history
  **200**/200/403 cùng vai; UNLOCK event mang actor (Nguyễn Thị Mai) + reason;
  lot khôi phục trạng thái LOCKED. Run 1 trên lot 779253 dính luật Debit-Note
  claim (unlock 409 đúng luật) — `sil722_trip773_run1_api.log`.
- Unit pins: `shipment-cost-unlock.test.ts` (3-vai gate, vai khác cấm),
  `shipment-cost-lock-history.test.ts`, `cost-lock-debit-note-guidance.test.ts`
  (message "Cần Quản trị, Giám đốc hoặc Kế toán mở khóa").
- FE pins: `ShipmentDebitWorkspace.test.tsx` — it.each ADMIN/MANAGER/ACCOUNTANT
  thấy MỞ KHÓA + Lịch sử khóa; it.each CUS/OPS/DISPATCHER/DRIVER không thấy.
- UI (rung 3): `ui-driver.log` U1 (10/10 PASS) + `sil-721_ui-1..5-*.png` —
  ketoan @/shipments-debit, lô 1786 (SILW7114252A) @1440: KHÓA LÔ HÀNG →
  MỞ KHÓA + lý do → toast "Đã mở khóa chi phí lô SILW7114252A" → Lịch sử khóa
  hiện UNLOCK by Nguyễn Thị Mai; khôi phục nguyên trạng; @390 screenshot.
- DB: `db-proof.sql` — toàn bộ lock/unlock của lô 1786 do actor 147 (ketoan);
  lot kết thúc unlocked (nguyên trạng).

## SIL-722 — Tiền đường đã duyệt vào tổng chi chuyến

- API (rung 2): `sil722_trip773_run1_api.log` — trip 773 (lô 1138): ketoan tạo
  ROAD_ALLOWANCE 80.000₫ (entries/batch, DRIVER_ROAD), màn duyệt
  (phoi-phieu/tien-duong) hiển thị 80.000₫, confirm 200 → **totalCost
  0 → 80.000₫ (đúng +80.000)**, reconciledExtraCost 0 → 80.000.
- Unit pins: `expense-trip-cost.test.ts` — ROAD_ALLOWANCE vào extra (toll 80k +
  road 200k + other 30k → extra 230k); Trả đêm-style 100k row; negative road row
  = absent; TOLL giữ nhánh riêng; totalRoadAllowance (tuyến) không đụng.
- DB: `db-proof.sql` — driver_incidental_costs id 19, trip 773, ROAD_ALLOWANCE
  80.000₫ CONFIRMED.

## SIL-723 — Ops khai chi phí Lưu law (KB Chương 6)

- **Root cause điều tra**: drawer "Khai báo chi phí" — khi dòng chặn Lưu, footer
  không nói thiếu trường nào (vô hiệu im lặng); thông báo cũ không nêu đúng tên
  trường ("Ghi chú" nhập nhằng với "Ghi chú thu khách"); block có hóa đơn KHÔNG
  bắt buộc Số hóa đơn (ngược KB Chương 6). Ảnh biên lai/Thực thu đều đã tùy
  chọn sẵn (đúng luật) — vấn đề là thông báo + luật số hóa đơn.
- Fix: draftErrors nêu TÊN trường; footer lặp thông báo ngay cạnh Lưu
  (`role="status"`, loại trừ message Số tiền để không đè lỗi inline của
  NumberField); Số hóa đơn bắt buộc CHỈ trong block "Phí có hóa đơn"; server
  giữ nguyên luật 400 "dòng không thu khách ⇒ bắt buộc Ghi chú".
- UI (rung 3): `ui-driver.log` U2/U3 (8/8 PASS) + `sil-723_ui-1..4-*.png` —
  giaonhan (OPS) @/ops/orders, lô 1786: block có hóa đơn thiếu Số hóa đơn →
  Lưu disabled + footer "Nhập \"Số hóa đơn\" …"; điền xong → enabled; block
  không hóa đơn Loại+Số tiền+Ghi chú → toast "Đã ghi nhận 1 khoản chi";
  @390 footer nêu "Ghi chú" khi thiếu.
- DB: `db-proof.sql` — ops_expense_entries id 758 (lô 1786, 80.000₫, RECORDED).
- FE pins: `OpsExpenseFormModal.containers.test.tsx` B1–B4 + A2/A3/A5 re-pin;
  `OpsOrdersPage.test.tsx` 20/20 (footer không đúp lỗi Số tiền; phrase
  "ghi chú bắt buộc" giữ nguyên trong hint).

## Environment

- Worktree `/Users/dev/.paseo/worktrees/1njkloyy/g1-fix`, branch
  `fix/g1-unlock-roaddcost-opssave` (base origin/main 95e2bd13).
- Stack của lane: FE :7193 → BE :3014 (7175/3002 do lane khác giữ); DB/Redis
  chia sẻ :5441/:6391.
- Accounts (testplan/testaccounts.txt, password Abc123): admin (ADMIN),
  giamdoc (MANAGER), ketoan (ACCOUNTANT — Nguyễn Thị Mai), dieuvan
  (DISPATCHER), giaonhan (OPS).
- Drivers: `qa/scripts/lane-g1-sil721-722-verify.mjs` (API),
  `qa/scripts/lane-g1-ui-drive.mjs` (UI, puppeteer).
