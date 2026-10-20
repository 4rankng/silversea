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

# FB-061 lần 3 — /users sạch nốt "Đơn vị CUS Demo" khỏi catalog Đơn vị phụ trách (card 201026112400) — 2026-10-20

Controller: agent, worktree fix-fb061-lan3 (off main d6d04ce6). Fix commit `3ac4b779`, deployed staging `3ac4b779`, pushed branch.

**Status**: DONE — residual là business unit demo-seed, purge-guard staging-only, UI DRIVEN sạch.

- Trước: staging `d6d04ce6` — 72 user rows sạch (thành quả lan 2 giữ vững) NHƯNG `/users` vẫn render thẻ **"Đơn vị CUS Demo — Mã CUS-DEMO · Đang sử dụng"** trong section "Đơn vị phụ trách" (BusinessUnitsManager, admin-only). Lỗ hổng lan 2: registry comment mis-classify CUS-DEMO là "single real unit", và UI drive lan 2 chỉ assert `table tbody tr` nên catalog không bị quét.
- Root cause: `seedClerkScope()` (demo seed, `backend/src/seed.ts`) tạo unit; staging mirror prod giữ nguyên. Reference census (SSH psql): đúng 1 link (user 78 `cus` — đã soft-delete lan 2), 15 shipment cùng tạo ngày seed 2026-09-19, 0 salary close. `business_units` không có `deleted_at`, `listBusinessUnits()` trả mọi row (lifecycle surface) → chỉ hard-delete clears /users.
- Fix: `QA_FIXTURE_REGISTRY` +2 surface **staging-only** hard-delete (links children-first rồi unit), predicate exact-match từng byte với seed literal (`code = 'CUS-DEMO' OR name = 'Đơn vị CUS Demo'`) — không wildcard, không đụng unit admin tạo sau; local dev giữ CUS-DEMO (`envs` gate); prod bị executor từ chối. Mọi `make stgdb` sau này restore unit → purge 4/5 tự dọn lại (self-healing).
- Deploy `make demo` (build `3ac4b779`): purge `user_business_unit_links matched=1 deleted=1` + `business_units matched=1 deleted=1`, remaining=0 trên cả hai. `qapurge-dry` rerun matched=0 (idempotent). DB proof `units_cus_demo=0`, `units_total=0`.
- UI DRIVEN (probe `PHASE=after --gate` exit 0): wire `businessUnits: []`, DOM @1440+@390 0 signature (before: 2 hit), 72/72 rows, 0 console error, KPI 72/11/43/0 nguyên vẹn.
- Gates: BE tsc 0 · BE unit 322/322 (+6 pin BUDEMO-1..6, gồm seed-drift pin đọc `seed.ts`) · root lint 0 · independent reviewer 0 blocker (4 tightenings applied).
- Evidence: `qa/2026-10-20-fb061-lan3-users/` (deploy-demo.log, qapurge-dry-idempotence.log, before/after PNG+DOM+rows+driver logs); case `testplan/cases/case-2026-10-20-fb061-lan3-users-demo-business-unit.md` (coverage table §9).

**Not covered**: prod vẫn còn CUS-DEMO + trio demo (cần owner instruction riêng); 15 seed shipments mất tên đơn vị hiển thị (dangling id — demo rows); role non-admin không thấy catalog (admin-only, không đổi); re-drive thật sau `make stgdb` kế tiếp chưa có (purge đã wire sẵn trong pipeline).

---

# QA R27 fix — staging session instability (tự rớt phiên + tự chuyển user) — 2026-10-20

Controller: agent, worktree fix-session-instability (off main 106a25e3).

**Status**: DONE — root-cause + fix + gates xanh + UI DRIVEN local + probe staging.

- **Root cause** (điều tra full-stack): KHÔNG có TTL ngắn (JWT 7d stateless, không
  refresh endpoint, không cookie), không proxy cache /api, không multi-instance.
  Cả 2 triệu chứng QA R27 đều là lớp **shared-token multi-tab** trong 1 browser
  profile (localStorage `token` duy nhất): (1) login role khác ở tab khác ghi đè
  token → tab đang test **đổi user im lặng** (5 phút staleTime /me làm việc đổi
  trễ "sau vài phút") → FAIL ma khi test sai role; (2) logout/đổi-mật khẩu ở bất
  kỳ tab nào thu hồi token dùng chung → các tab khác 401 → "tự rớt"; admin sửa
  user đang test (role/status/customer-links) cũng 401 theo thiết kế bảo mật.
- **Fix** (giữ nguyên chuẩn 1 session/browser theo owner ruling — KHÔNG
  sessionStorage per-tab / cookie per-role):
  - FE: cross-tab identity swap/logout giờ **LOUD** — toast warning "Thẻ khác đã
    đăng nhập — phiên này chuyển sang <tên> (<role>)…" và info "Phiên đăng nhập
    đã kết thúc ở thẻ khác." (`lib/api/session.ts` bus, `useAuth.syncStoredSession`
    notify, `SessionNoticeToaster` trong `App.tsx`).
  - BE: `/api/health` thêm `authTokenTtlSeconds` (một curl trả lời "TTL ngắn
    không?"); `authenticateToken` log `[Auth] reject reason=revoked|expired|
    role-drift|scope-drift` để phân loại rớt phiên từ server log.
- **QA multi-role TỪ NAY (quan trọng — chống FAIL ma)**: mỗi role = 1 cửa sổ
  riêng (Chrome profile riêng hoặc incognito riêng). KHÔNG mở 2 role trong cùng
  profile ở tab thường — token dùng chung ghi đè lẫn nhau là hành vi chuẩn của
  thiết kế, KHÔNG phải bug. Thấy toast "Thẻ khác đã đăng nhập" = tab đang chạy
  sai tài khoản → dừng test, kiểm tra role. Sau khi admin sửa user → user đó
  phải đăng nhập lại (401 "Quyền tài khoản đã thay đổi" là chủ đích).
- Evidence: `qa/2026-10-20-r27-session_stability-probe.log` (staging 8dfb6e4f,
  2 phiên riêng 10 phút poll /me: 0 rớt, 0 đổi user — triệu chứng không tái hiện
  khi mỗi phiên một token); `qa/2026-10-20-r27-session/` UI DRIVEN 5/5 checks
  (toast swap + toast logout + /login + server 401 thu hồi + identity /me);
  testplan/2026-10-20-r27-session-instability.md (TC-1..4).
- Not covered: staging re-drive sau deploy (cần `make demo`); toast trên mobile
  viewport; role ngoài ADMIN/ACCOUNTANT.

---

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
