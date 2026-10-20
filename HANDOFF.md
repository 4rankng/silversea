# FB-066 lần 3 — quick-add BKS trong dialog "Phân bổ nhà xe" (card 201026101600) — 2026-10-20

Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/fix-fb066-lan3, branch `fix-fb066-lan3` (off main 106a25e3).

**Status**: DONE — QA R27 repro trước fix (UI DRIVEN) → fix → after evidence UI DRIVEN (rung 3) trên local dev (`:7180` worktree vite → backend `:3002`), role dieuvan.

- **Surface (khớp chữ QA)**: dialog "Phân bổ nhà xe" (`DispatchAllocationPopover` shell, `/dispatch`). LCL field-set (`DispatchAllocationLclDialog`) có ô BKS thực/ảo — trước fix không nút quick-add, gõ BKS lạ dropdown chỉ "Không tìm thấy kết quả".
- **Fix**: (1) nút "+ Thêm nhanh" (component chung `QuickAddButton`) cạnh ô BKS thực → dialog "Thêm nhanh biển số xe" mở CHỒNG, tạo qua API catalog thật (OWN → POST /trucks, nhà xe ngoài → Xe ngoài), biển mới CHỌN NGAY vào ô + auto-copy BKS ảo — dialog phân bổ giữ trọn draft; (2) dropdown option "Thêm mới: &lt;số gõ&gt;" mở dialog quick-add ĐẦY số đã gõ; (3) lô chưa có nhà xe → picker "Nhà xe" (`UuiSelectField`, "hãng/nhà xe nếu cần"); (4) 2 fix shared `uui-searchable-field.tsx` (chosenKey = last REAL pick only; option `__create__` = pick thật) — hết bug dropdown đóng giữa chừng khi gõ / mở lại đè dialog / dialog quick-add bị react-aria `ariaHideOutside` che với AT.
- **FCL cont field-set**: NOT APPLICABLE — không có ô BKS/xe (contract cont = 20'/40' theo nhà xe theo ngày, card 191026181942 "FCL keeps the cont body untouched"); biển số lô cont gán ở Kế hoạch Chi tiết ("Xe / biển số") — surface đó đã có quick-add từ card 20261004_357. Trước/sau cùng ảnh (`before-fcl-dialog.png`/`after-fcl-dialog.png`). Nếu owner muốn affordance BKS trong dialog FCL → cần card mới chốt contract (ô nào, lưu đâu).
- **Evidence**: `qa/2026-10-20-fb066-lan3-dialog/` (report.md + before/after PNG + driver logs + `db-side-effect-proof.json`: trucks id 186310 `29C-066.99`, id 186311 `29C-066.97`). Test mới `DispatchAllocationLclDialog.quick-add.test.tsx` 5/5. Testplan: `testplan/2026-10-20-fb066-lan3-quickadd-dialog.md`.
- **Gates**: `make build` OK · FE `npx tsgo -b` 0 · root `pnpm lint` 0 · FE vitest full 5310/5310 (sau build cho 2 dist-pin) — `gates.log`.
- **Not covered**: role khác dieuvan; đường lỗi tạo trùng biển (unit test có); picker "Nhà xe" đổi lựa chọn khi tạo (unit test có); viewport mobile của dialog.

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
