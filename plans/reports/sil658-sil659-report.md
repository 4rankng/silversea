# SIL-658 + SIL-659 — 2 fix CUS trên trang Chi tiết lô hàng

- **Lane:** `fix/sil658-sil659-cus-lot-detail` (base `main`, Paseo worktree `1njkloyy`)
- **Ngày:** 02–03/11/2026
- **Tickets:** SIL-658 (id 765), SIL-659 (id 766) — đã chuyển Todo → In Progress ngay đầu phiên; cuối phiên → **QA (columnId 26)** kèm comment evidence riêng từng ticket.
- **Stack verify:** LOCAL worktree stack — frontend `http://localhost:7210`, backend `http://localhost:3002`, DB shared `ss-prod-db` (5441). KHÔNG đụng production/staging. `make deploy` / `make demo` chưa từng chạy.

---

## Task 1 — SIL-658: Gộp hàng mất tích chọn khi tìm kiếm

### Root cause (systematic-debugging)
`ShipmentContainersPage.tsx` (trang "Chi tiết lô hàng", route `/shipments-detail`):
- `updateParam` / `applySort` / `resetFilters` / `writeDateRange` đều gọi `dropPicks()` — mọi filter/search/page/sort write đều xoá selection (luật SIL-547 cũ: "bar không đếm lot ngoài view").
- `selectedRows` derive từ `items.filter(...)` — danh sách ĐANG hiển thị → khi tìm kiếm rút gọn danh sách, bar về 0.

### Fix — pattern Điều vận (boss xác nhận đúng)
Copy nguyên luật selection của dispatch (`MasterPlanPage.selectedLcl` / `DispatchDetailPlanPage.selectedLclRows`):
- Selection là **mảng row đầy đủ** (`selectedLotRows: ShipmentCusContainerFlatRow[]`) sống NGOÀI danh sách lọc, keyed by `shipmentId`.
- `selectedLotIds` derive `Set` cho checkbox của ledger → tick render theo map, không phụ thuộc danh sách.
- Bar/tổng khối lượng/popup gộp đọc từ **row snapshot đã lưu** (`selectedRows = selectedLotRows`) — đếm đúng cả lot đang bị ẩn bởi filter.
- `selectLot`: gate cùng-khách-hàng đọc anchor từ `selectedLotRows[0]` (lot anchor có thể đang bị filter ẩn).
- Bỏ `dropPicks()` khỏi `updateParam` / `applySort` / `resetFilters` / `writeDateRange`. Chỉ còn 4 đường clear selection: thoát mode, hoàn tất gộp, [Bỏ chọn], bật lại toggle.

### Files
- `frontend/src/pages/ShipmentContainersPage.tsx` (duy nhất).

### Tests (vitest — `ShipmentContainersPage.gop-hang.test.tsx`, describe SIL-658)
1. AC1: tick → tìm theo bill (list còn 1 dòng) → bar vẫn đếm 1 → xoá tìm kiếm → tick **còn** (`checked=true`).
2. AC2: tick 2 lô → filter → bar đếm đủ 2, [Gộp hàng] vẫn armed, popup mở với Lô 1 = lô tick ĐẦU TIÊN (không phải dòng đầu nhìn thấy).
3. AC3: bỏ tick 1 lô khi đang filter → chỉ lô đó drop.
- 10/10 tests xanh trong file (7 SIL-547 cũ + 3 SIL-658 mới).

---

## Task 2 — SIL-659: dialog «Chỉnh sửa chứng từ và hãng tàu» thêm trường Số cont

### DESIGN LOCK
- Posted lên ticket SIL-659 (comment id 3517) TRƯỚC khi code, theo routing: consult **webchat/gemini** → phương án **C — field CUỐI form, sau Hãng tàu** (giữ nguyên thứ tự 4 trường FB-113 của vận hành); Untitled UI pattern = đúng pattern label-trên-input của editor-grid hiện tại (không引进 component mới); folio MCP không có trong session → lock đăng text trên ticket (limitation đã ghi rõ trong comment).

### Implementation
- `ShipmentContainerLedger.tsx` (dialog — `features/shipments/detail/`, thuộc phạm vi được cấp trong "Files it may modify"; các luồng KHÁC của detail/ không đụng):
  - Field «Số cont» render CHỈ trên dòng có container thật (lot-level LCL row — không có cont — không render field); seed từ `line.raw.containerNumber`, uppercase khi gõ, maxLength 20 (y như ô container).
  - Lock law: `line.fieldAccess.containerNumber.mode === 'READ_ONLY'` ⇒ disabled + `title` = reason từ BE (y hệt ô container — không mở lỗ hổng).
  - ISO 6346 live hint + nút «Đổi thành …» (cùng affordance ô container — card 261022095235b).
  - `<small>` đồng bộ: "lưu theo từng container — đồng bộ với ô THÔNG SỐ CONTAINER trên bảng".
  - `ShipmentDocumentsDraft` thêm `containerNumber?: string | null` (optional — backward compatible).
- `use-cus-detail.ts` `saveDocuments` — **cùng một update path** với ô số container (ràng buộc bắt buộc):
  - `containerChanged` = draft khác baseline raw (trim hai bên) + không phải lot row.
  - Số cont rides **CÙNG MỘT** `updateCusShipmentContainerLine` command với tờ khai khi cả hai đổi (1 transaction, 1 idempotency key) — normalize + in-lot duplicate + **SIL-653 identity bridge** xử lý server-side y như ô container (service `cus-shipment-workspace-writes.service.ts` — code BE KHÔNG đổi).
  - Gate riêng: tờ khai theo `summary.fieldAccess.declarationNumber`, số cont theo `line.fieldAccess.containerNumber` (đúng gate ô container render).
  - Echo (không đổi gì) ⇒ không gọi API; clear ⇒ ghi `null`.
- Luật 409 REJECT_UNDECLARED: luật đó nằm ở đường GHI TỪ chuyến (driver/trip-container — `forwarder-container.service.ts`, SIL-655). Đường CUS (văn phòng) là đường KHAI BÁO số — luật của nó là normalize + duplicate-in-lot (400 rõ ràng) + bridge SIL-653; dialog đi đúng đường này = hành vi **giống hệt ô container** như ràng buộc yêu cầu ("cùng một update path... y như ô container"). BE không đổi.

### Files
- `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx`
- `frontend/src/features/shipments/cus/use-cus-detail.ts`

### Tests
- `ShipmentContainerLedger.sil659-docs-cont.test.tsx` (5 tests): field cuối form + seed + uppercase; đổi số ⇒ draft mang số (trim+upper); ISO hint đúng + nút sửa 1-chạm; READ_ONLY disabled kèm reason (lock law); lot-level row KHÔNG có field và draft không mang số.
- `use-cus-detail.sil659-container-number.test.tsx` (7 tests): cont-only save bỏ PATCH; echo không gọi gì; tờ khai + cont chung 1 command; PATCH rồi cont trên version PATCH trả về; clear ghi null; READ_ONLY bỏ write; lot row không bao giờ mang số.
- Cập nhật `ShipmentContainerLedger.test.tsx` FB-113 order test: 4 → **5** trường (Số cont cuối) — ghi chú SIL-659 ngay trong test.

---

## Gates (§5) — kết quả verbatim

| Gate | Command | Kết quả |
|---|---|---|
| Root lint | `pnpm lint` | ✅ 0 errors (4 warnings cũ, không thuộc files sửa — files MobileAccountSheet/Modal/usePopoverDialog/CustomersConfigPage) |
| FE typecheck | `cd frontend && npx tsc -b` | ✅ 0 errors |
| FE tests | `cd frontend && pnpm test` | ✅ 6121/6123 pass; 2 fail đều KHÔNG liên quan: `numeric-identity.styles.test` (thiếu `dist/` — pass sau `make build`) + `Modal.test` (flaky khi chạy full-suite parallel — pass 18/18 độc lập). Đã verify lại: 24/24 pass sau build. |
| Build | `make build` | ✅ built in 15.77s |
| BE typecheck/tests | — | BE không đổi (FE-only), theo §5 chỉ chạy gates bị ảnh hưởng. |
| Focus suites | `vitest run` (3 files mới + gop-hang + ledger dir + page + hook) | ✅ 15/15 + 152/152 + 77/77 |

## Rung-3 UI DRIVE (§9) — LOCAL stack, role CUS (`cus`)

Driver: `qa/scripts/2026-11-03-sil658-659-ui.mjs` — **DONE failures=0, exit 0**; log: `qa/2026-11-03-sil658-659/2026-11-03_sil658-659_ui-driver.log`; console errors: (none).

**SIL-658 = UI DRIVEN** (repro boss, browser thật, puppeteer + token pre-inject):
1. Tick `R34-LCL1` → bar "Đang chọn 1 lô".
2. Gõ bill `LCL07-BK6` → list còn lô khác → **bar VẪN "Đang chọn 1 lô"** (bug cũ: về 0).
3. Xoá tìm kiếm → `R34-LCL1` quay lại **`checked=true`** + bar đếm 1.
4. Tick thêm `LCL07-BK6` → bar "Đang chọn 2 lô", [Gộp hàng] armed (2 lô cùng khách, chưa ghép).
- Ảnh: `02-sil658-tick1.png`, `03-sil658-filtered-bk6.png`, `04-sil658-restored-tick-kept.png`, `05-sil658-two-picks.png`.

**SIL-659 = UI DRIVEN** (lot 761 / container id 842 `TSTU6006004`, fieldAccess DIRECT pre-lock):
1. Mở dialog bằng cell Bill/Booking (trigger "Chỉnh sửa ô chứng từ và hãng tàu TSTU6006004") → ô «Số cont» hiện **CUỐI form sau Hãng tàu**, seed đúng số cũ.
2. Gõ `TSTU6006011` (sai check digit) → hint ISO hiện, nút «Đổi thành TSTU6006010» → click → giá trị chuẩn.
3. Lưu → editor đóng, không lỗi inline; API CUS trả số mới; **DB side-effect**: `shipment_containers.id=842` `TSTU6006004 → TSTU6006010` (psql verbatim trong log).
4. Restore số gốc **qua cùng dialog** → DB `restored=TSTU6006004` (dev DB sạch như trước).
- Ảnh: `06-sil659-dialog-field.png`, `07-sil659-iso-hint.png`, `08-sil659-saved.png`, `09-sil659-restored.png`.
- SIL-653 bridge: lô chưa có chuyến ⇒ bridge no-op (luật server-side đã pin bằng wire tests); hành vi đồng bộ = cùng command ô container.

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| SIL-658 tick sống qua search + bar đếm đúng | **UI DRIVEN** | qa/2026-11-03-sil658-659/02,03,04,05*.png + driver.log (checked=true) | staging env (verify trên local); mobile viewport; vai trò khác (DISPATCHER/ADMIN thấy toggle cùng logic — unit pinned quyền qua test reader); path sort/pagination đổi (unit pinned qua remove dropPicks, không drive riêng) |
| SIL-658 AC3 bỏ tick khi filter | **UI DRIVEN** | vitest SIL-658 test 3 (jsdom) — không drive browser riêng | browser shot cho đúng step này |
| SIL-659 field + lưu + DB + đồng bộ CUS | **UI DRIVEN** | 06,07,08,09*.png + driver.log (psql before/after/restore) | lô CÓ chuyến (bridge mirror chạy thật — wire test pin path; drive chỉ trên lô không chuyến); mobile <768px; trường hợp 400 duplicate-in-lot (pin bằng BE test có sẵn + luật không đổi); vai trò DISPATCHER/ADMIN |
| SIL-659 lock law (READ_ONLY disabled + reason) | CODE-READ + unit test (jsdom disabled+title) | sil659-docs-cont test 4 | UI DRIVEN trên lô đã khóa kế toán (không có fixture khóa trong local DB) |
| 409/400 thông báo rõ (không im lặng) | UNIT + BE law đọc code | saveDocuments rethrow → editor `saveError` inline (luật sẵn có, không đổi); BE normalize/duplicate 400 | drive một lỗi thật trong dialog |

## Test plan (regression)
- `testplan/2026-11-03-sil658-merge-selection-persist.md`
- `testplan/2026-11-03-sil659-docs-dialog-so-cont.md`

## Commit
- `SIL-658 fix` + `SIL-659 feat` — 2 commit trên `fix/sil658-sil659-cus-lot-detail`, push origin (KHÔNG đụng main).

## Concerns
- Không có folio MCP → DESIGN LOCK dạng text comment (id 3517) — orchestrator lưu ý nếu cần mockup ảnh.
- `qa/` artifacts là output local, không force-track (§7).
- Server verify dừng sau board ops (ports 3002/7210 freed).
