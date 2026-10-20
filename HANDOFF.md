# FB-045 lan 2 — dialog "Chi tiết container" clip cột GIỜ HẸN — 2026-10-20

Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/fix-fb045-lan2, branch fix-fb045-lan2 (off main 106a25e3).

**Status**: DONE — fix + UI DRIVEN evidence local 4 viewports × 2 dialog; staging tái hiện channel trước fix. Card 201026140000 (QA R27 FAIL lần 2). Testplan: `testplan/2026-10-20-fb045-lan2-gio-hen-clip.md`.

- **Root cause lần 2** (fix bb394516 không đủ — chỉ floored header cột giờ):
  1. `/dispatch` drawer: port `<select>` Nâng/Hạ (min-width 140px) tràn auto slice 114–127px, ĐÈ value "08:00 24/09/2037" → "0 24/09/2037" ở cả 4 viewport. Channel data-gated (chỉ render khi fieldAccess port DIRECT).
  2. `/shipments` drawer (`CusContainerLedger`): add-row segmented giờ hẹn input bị cột 15% bóp; Thêm/Hủy từ cột Thao tác 4% (~46px) tràn TRÁI đè "DD/MM/YYYY" (staging 106a25e3 tái hiện: `stg-before-driver.log` FAIL 1280/1440/1920).
- **Fix bền**: px floors theo content + table min-width + scroll-x band sẵn có. DispatchDrawer: cột port 150px + select 132px + min-width 960 + value nowrap pin. CusContainerLedger: GIỜ HẸN 164px, Thao tác 116px, min-width 1110px (doctrine "percentage sum 100% no scroll" bị brief lan 2 supersede — `ShipmentsPage.density.test.ts` contract đổi theo); trigger value nowrap+ellipsis.
- **Gates**: `npx tsgo -b` 0 · scoped vitest 55/55 + 221/221 + 540/540 · full FE **5306/5306 green rerun** (`gates-fe-vitest-full-rerun.log`; 1 parallel run trước đó flake `DebtListPage.filters` debounce + 2 fail `dist/assets` race — đều pass isolation/build, log kèm) · `pnpm lint` 0 · `make build` 0. Logs `qa/2026-10-20-fb045-lan2/gates-*.log`.
- **Evidence**: `qa/2026-10-20-fb045-lan2/` — before (clip: `before-dispatch-drawer-w1024.png` "0 24/09/2037", `probe4-shipments-drawer-w1280.png` Thêm đè input) → after 8 PNG 2 drawer × 4 viewport sạch + logs. Driver `testplan/qa/scripts/2026-10-20-fb045-lan2-probe.mjs` (env QA_BASE/QA_TAG/QA_ENTRY/QA_USER_A/QA_USER_B).
- **Not covered / nợ**: staging re-drive sau deploy ≥ fix; staging lot port DIRECT (4 lot đầu grid port READ_ONLY); sibling header shear `/shipments-detail` + `/dispatch-detail` w1024 (ngoài card — cần card riêng); viewport <1024 (card mode khác); add-row transient `adding` ("Đang thêm…") không submit live (không ghi data) — channel đóng bằng `flex-wrap: wrap` structural pin.
- **Independent review**: code-reviewer REQUEST CHANGES → 6/6 finding resolved trước commit (M1 add-actions wrap + pin, M2 probe spill selector SearchableSelect + fail-loud empty measurement, M3 full-suite green rerun sau build, L4/L5 doc updates, L6 noted).

---

# QA R26 d39ee741 — re-drive FB-014 + spot FB-113/FB-093 — 2026-10-20

Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/qa-r26-d39ee741, branch qa-r26-d39ee741 (off main d39ee741).

**Status**: DONE — **7/7 PASS** trên STAGING https://vantai.tingting.vip, UI DRIVEN (§9 rung 3) từng check. Build gate chạy trước mọi drive: `GET /api/health` → `buildHash d39ee741` ✅. QA-ONLY: không sửa source, không ghi data (editor BKS bấm Hủy, dialog ghép bấm Hủy).

- **FB-014 (PRIMARY, fix 37838c06) PASS 3/3** — dieuvan `/dispatch`:
  - row body lô trong tháng → **`/dispatch-detail?q=R15B3-FCL-01&date=2026-10-12`**, "Kế hoạch Chi tiết Xe" 2 dòng (12/10/2026), scope Từ=Đến=12/10/2026;
  - row body lô NGOÀI tháng → **`/dispatch-detail?q=JJCTCHPDY260305&date=2026-09-07`**, bảng 2 dòng 07/09/2026 trong khi topbar vẫn `Tháng 10/2026 · 01/10 – 31/10` → `date` thắng month bounds;
  - quick-view `.master-plan-grid__container-detail-trigger` vẫn mở drawer "Chi tiết container", URL giữ `/dispatch`.
- **FB-113 spot PASS 2/2** — cus:
  - **`/shipments/176`** header có `<dt>Số tờ khai</dt>` = `102250318903`, thứ tự `Số Bill / Số Booking → Số tờ khai → Xuất / Nhập → Hãng tàu`;
  - **`/shipments-detail?dateScope=all&searchSuffix=DNKM13337`** ledger `td[data-label]` = `Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu` + nút `Sửa` inline (ô Số tờ khai).
- **FB-093 spot PASS 2/2** — ketoan `/accounting/chot-debit` (search `GAP-TEST`, bật cột `Phân xe` qua nút `Cột` vì bảng mở theo bộ ESSENTIAL):
  - badge `Báo khách (Ảo): 15C-99999` là `<button type=button>` (`aria-label="Sửa BKS báo khách: …"`) → panel `Sửa BKS báo khách — GAP-TEST-01` seeded `15C-99999`, có Lưu/Hủy;
  - 2 lô chưa ghép (`GAP-TEST-01` + `GAP-TEST-03`) → `Đã chọn 2 lô` → nút `Ghép cước thu khách` hết `aria-disabled` → dialog "Ghép cước thu khách" mở (Lô 1/Lô 2 cùng LONG MINH).
- Evidence + coverage table: **`qa/2026-10-20-r26-verify/report.md`**, 7 PNG `fb014-*`/`fb113-*`/`fb093-*`, log `fb014-ui-driver.log` `fb113-ui-driver.log` `fb093-ui-driver.log`, driver `.mjs` + `recon-lots.mjs` (đọc API trước để chọn lô có dữ liệu thật).
- Not covered: keyboard row-click (Enter/Space); role khác dieuvan/cus/ketoan; viewport ≤760 + card-mode ledger; portal (cố ý không đổi); **không bấm Lưu BKS / không xác nhận ghép / không mở inline editor** (QA-only — đường lỗi server chưa thấy); lần chạy probe trước (badge khi cột Phân xe còn ẩn, cặp CL5B-L02/L03 đã ghép) chỉ là recon hành vi.

---

# FB-113 standing verdict + fix — 2026-10-20 (card 171026122140)


Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/fix-fb113-investigate, branch fix-fb113-investigate (off main bf3a0ff9).

**Status**: DONE — verdict + fix committed on branch, pushed.

- Verdict: surface mismatch lần 3. Ledger /shipments-detail PASS 11/11 trên staging bf3a0ff9 (3 lot shapes, bảng+card mode, UI==API); /shipments/:id (CÙNG tên nav 'Chi tiết lô hàng', tới được qua drawer 'Chi tiết lô hàng') FAIL đúng chữ QA — header thiếu Số tờ khai + thứ tự sai (UI DRIVEN staging, lô 176 DNKM13337/102250318903).
- Fix: ShipmentDetailPage header card trình bày nhóm chứng từ Bill/Booking (merged billBookingReference) → Số tờ khai (declarations entity = cùng nguồn section Tờ khai hải quan) → Xuất/Nhập → Hãng tàu. Không đụng BE contract; portal là non-goal (audience khác).
- Gates: FE tsgo 0; vitest scoped 44/44; eslint đổi file 0; root lint 0. Evidence qa/2026-10-20-fb113-standing/ (before-staging fail + after-local pass + ledger phase-1), chi tiết testplan/2026-10-20-fb113-standing.md.

**Not covered**: staging re-drive sau deploy (QA R26); role khác ngoài CUS trên detail header; viewport ≤760 của detail (không đổi CSS).

Stack note: vite :7178 chạy từ worktree này (background) cho after-drive; :7175 (r25 worktree) + :7176 (SSD main) + backend :3002 (SSD main, tsx) là của task khác — KHÔNG đụng. Local DB ss-prod-db :5441 có sẵn, chỉ đọc.
