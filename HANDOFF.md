# FB-061 lần 2 — /users sạch dữ liệu mẫu trên staging (card 201026112400) — 2026-10-20

Controller: agent, worktree /Users/dev/.paseo/worktrees/1njkloyy/fix-fb061-lan2, branch fix-fb061-lan2 (off main 106a25e3). Fix commit `0b870f61`, deployed staging `0b870f61`.

**Status**: DONE — giả thuyết DATA xác nhận, fix bằng purge-guard, staging UI DRIVEN sạch.

- Trước: staging build `106a25e3`, `GET /api/auth/users` = 77 users, 5 thuộc lớp mẫu: demo-seed trio `cus`/`dieuvan`/`customer` (fullname còn "Demo"), `e2e-dispatcher-37341` (prefix e2e-, suffix ngắn lọt regex epoch-13), `HAHA-email-probe2` (probe tay). Fix trước d4d686d6 chỉ quét /accounting/phoi-phieu nên không thấy mặt /users.
- Fix: `QA_FIXTURE_REGISTRY` users surface +2 branch (`e2e-%`, `HAHA-email-probe%`); surface users mới **staging-only** soft-delete trio demo dưới conjunct `(username IN (cus,dieuvan,customer) AND full_name ILIKE '%Demo%')` — bảo vệ account demo đã mang tên thật (admin, giamdoc, ketoan, laixe, giaonhan, khachhang, samsung-cs, canon-cs) và local dev-seed. Executor học `envs` scoping (skip không tính remaining, không gây exit 2).
- Deploy `make demo` (build `0b870f61`): purge users `deleted=2` (e2e+HAHA) + `deleted=3` (trio), remaining=0. Re-run `make qapurge` idempotent (deleted=0). API re-probe: 72 users, 0 flagged. UI DRIVEN 1440+390: 8 trang ×10 = 72 dòng, 0 signature, KPI 72/11/43/0, 0 console error.
- Gates: BE tsc 0 · BE unit 311/311 (+6 pin mới `qa-fixture-users-surface.test.ts`) · root lint 0.
- Trade-off: login `cus` trên staging (2 script FB-113 cũ) hết hiệu lực — lane CUS staging theo contract testaccounts: `thanhdc` (NV018)+. FB-113 đã PASS R26, không lane đứng nào gãy.
- Evidence: `qa/2026-10-20-fb061-lan2-users/` (deploy-demo.log, qapurge-rerun-idempotence.log, users-probe-before-stdout.md, users-census-after.json, 2 PNG + DOM + rows + driver log); case `testplan/cases/case-2026-10-20-fb061-lan2-users-demo-accounts.md`.

**Not covered**: các surface purge khác vẫn còn guarded survivors (remaining=34, pre-existing, non-gating — không thuộc card này); prod DB vẫn còn trio demo (purge từ chối prod theo thiết kế — cần owner instruction riêng nếu muốn dọn); role non-admin trên /users (non-ADMIN đã bị BE che ADMIN accounts — không đổi).

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
