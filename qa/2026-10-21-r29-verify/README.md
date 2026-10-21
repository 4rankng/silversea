# qa/2026-10-21-r29-verify — Re-verify 5 mục FAIL R29 trên staging c643ef1e

Staging `vantai.tingting.vip` = build **c643ef1e** (health: `buildHash: c643ef1e`,
đã đối chiếu đầu mỗi drive). Tài khoản: `testplan/testaccounts.txt` (staging
password chung `Abc123`). Driver logs + DOM dumps + PNG nằm cùng từng thư mục.

## Verdicts

| # | Mục | Verdict trên c643ef1e | Evidence | Fix trong branch này |
|---|---|---|---|---|
| 1 | FB-019 — banner nhận lệnh lái xe lộ mã TRP | **PASS-already-fixed** (UI DRIVEN) | `fb019/` | Không cần |
| 2 | FB-033 — chi phí vừa tạo bị "Đã lập phiếu" + khóa sửa/xóa | **PASS-already-fixed** (UI DRIVEN) | `fb033/` | Không cần |
| 3 | FB-093 — không có nút Tách nhóm phía Kế toán | **STILL-BROKEN** → **FIXED trong branch** (UI DRIVEN sau fix, local FE :7191 → staging API) | `fb093/` | `essentialWhenHasData` (2 FE files + 2 test files) |
| 4 | FB-002 Case A — Enter ô GIỜ (đủ ngày+giờ) không lưu | **PASS-already-fixed** (UI DRIVEN) | `fb002-case-a/` | Không cần |
| 5 | FB-048 — 5 ô hàng container thiếu viền đỏ | **PASS-already-fixed** (UI DRIVEN) | `fb048/` | Không cần |

## Chi tiết từng mục

### 1. FB-019 — `fb019/` — PASS 5/5
- Repro: bqhuong (DRIVER, 390px) mở `/my-trips/206` (NEW, truck 15H-117.55) →
  bấm "Nhận lệnh vận chuyển" → backend 409 vì truck đang chạy **TRP-202610-0122**
  (chính mã QA thấy lộ — `net-409-body.txt` giữ body 409 gốc có TRP).
- Banner `[data-testid="blocking-trip-banner"]`: **"Xe đang chạy chuyến
  R27E2E-001 — hoàn thành chuyến đó trước khi nhận lệnh mới."** + link "Mở
  chuyến đang chạy" (board vouch bằng bookingRef của blocker) — KHÔNG có TRP.
- Toast (5 surface): đều "R27E2E-001", 0 match `/TRP-\d{6}-\d+/` trên toàn trang.
- `01-before-accept.png` · `02-after-accept-banner.png` · `dom-after-accept.txt`
  · `net-409-body.txt` · `ui-driver.log` (kết quả từng assert).

### 2. FB-033 — `fb033/` — PASS 4/4
- Setup đúng điều kiện lỗi (data-dependent): tạo + kế toán duyệt (giải ngân)
  tạm ứng 50.000₫ cho hoangnh (Idempotency-Key; `setup-advance-funding.json` —
  request RECORDED, ledger 177, treasury 31). Trip 104 (CREATED) thuộc
  shipment 257 đã link hoangnh → auto-offset thật sự chạy lúc tạo.
- UI hoangnh `/my-forwarder-trips/104`: Thêm → "Phí chi hộ khác" 50.000₫
  OPS_ADVANCE, hóa đơn R29-VRF-001 → Lưu (POST **201**): dòng mới
  **không badge "Đã lập phiếu"**, Sửa/Xóa enabled, title "Điều chỉnh chi phí".
- Sửa NGAY → PATCH **200** (45.000₫, row cập nhật); Xóa NGAY → reason prompt →
  DELETE **200** → row VOIDED + "Lý do hủy".
- DB (`db-side-effect.txt`): expenses 90/91/92 VOIDED; settlement auto-offset
  23 (của 91) **REVERSED**, `auto_offset_expense_id` cleared. Lưu ý: expense 91
  là phí giữ lại từ lần drive giữa khi script lỗi — đã dọn bằng DELETE API đúng
  quy trình (Q10 reason).
- Stereo lưu ý: 3 lần chạy setup tạo 3 tạm ứng test 50.000₫ cho hoangnh
  (req 34/37/38 — mỗi lần chạy chỉ tái sử dụng request PENDING; request đã
  RECORDED không dùng lại được) — là dữ liệu test staging có chủ đích, reason
  đều gắn "R29 re-verify FB-033".

### 3. FB-093 — `fb093/` — STILL-BROKEN → FIXED
- **BEFORE (staging c643ef1e, UI DRIVEN)**: ghép 809 CL4C-01 + 810 CL4C-02
  (YUANFANG, LCL, cùng KH, lock OPEN) qua UI tiepvv `/shipments-debit` →
  revGroup chung, Lô 2 = 0₫ + note "Ghép cước cùng Bill CL4C-01" ✓. Kế toán
  `ketoan` `/accounting/chot-debit` (profile MỚI — không có stored choice):
  board render CL4C-01/02 nhưng **0 nút "Tách nhóm"** — cột "Thông số container"
  KHÔNG được render (`ketoan-dom-tach-buttons.txt`, `debug-ketoan.png`,
  `05-ketoan-tach-nhom-buttons.png`).
- Root cause: KT4 (card 191026181942) `defaultVisible: 'essential'` ẩn MỌI cột
  không essential/pinned trên máy trạm mới — trong đó có cột chứa nút. Test cũ
  của fix ép `localStorage '[]'` nên không bắt được va chạm 2 luật.
- **FIX (branch này)**: flag `essentialWhenHasData` trong
  `frontend/src/lib/column-visibility.ts` + cột `container` của
  `AccountingDebitClosePage.columns.tsx` opt-in kèm `raw` (hasData = có dữ liệu
  lcl thật). Cột tự hiện khi có dữ liệu lcl/nhóm; board thuần FCL vẫn ẩn như
  cũ; choice tường minh của operator vẫn thắng. KT4 không đổi: cột tiền
  breakdown vẫn ẩn (assert trong test).
- **AFTER (UI DRIVEN trên build fix)**: FE :7191 (worktree) proxy → staging API;
  ketoan profile mới: `storedChoice=null`, cột hiện, **nút "Tách nhóm" cho cả
  CL4C-01 lẫn CL4C-02** + mọi nhóm khác (`08-afterfix-ketoan-tach-visible.png`,
  `afterfix-dom-tach-buttons.txt`); click CL4C-02 → ConfirmDialog → **unmerge
  200** → API cả 2 lô `revGroup=null`, note ghép=null, board hết nút CL4C
  (`09/10 PNG`, `db-3/4*.json`).
- DB final (`db-5-final-state.txt`): 809/810 `rev_group_id` NULL; cost group
  74c58bee GIỮ NGUYÊN (có TRƯỚC lane — note "Ghép cùng Bill" còn lại trên dòng
  810 là note NHÓM CHI PHÍ, đúng luật); audit 3 chu kỳ ghép (tiepvv) + 3 lần
  `SHIPMENT_LCL_GROUP_UNMERGED` (ketoan).
- Regression case: `testplan/2026-10-21-r29-fb093-ke-toan-column-visibility.md`.
- Residual (ngoài phạm vi card, khuyến nghị card riêng): kênh debit-summary
  hiển thị `freightAuto=0` KHÔNG kèm reason cho lô member không-trip sau tách —
  snapshot `freight_rate_snapshots` id 378 ĐÃ giữ đúng reason D02 "Tách khỏi
  nhóm ghép — chờ định giá lại" (`0₫`), nhưng kênh đọc không surface. Không
  phải defect "thiếu nút"; backend c643ef1e chưa từng đổi trong branch này.

### 4. FB-002 Case A — `fb002-case-a/` — PASS 4/4
- Repro đúng QA: tiepvv `/shipments/new` → click ô GIỜ → gõ `1630` (tự sang ô
  NGÀY) → gõ `22112026` (draft hoàn chỉnh 16:30 22/11/2026) → **Enter**.
- Form còn thiếu trường (case A của ma trận): Enter → save attempt CHẠY
  (summary "Cần bổ sung 5 thông tin" paint, focus về field thiếu) và TOÀN BỘ
  input GIỮ NGUYÊN (customer/booking/cont/16|30|22|11|2026), 0 POST — không còn
  phím chết, không mất trắng (`02-after-enter-incomplete.png`).
- Form đủ: Enter (yyyy focus) → **POST /api/shipments/quick 201** → navigate
  `/shipments/971` (`04-after-enter-create.png`, log `mutation_status`).
- DB (`db-side-effect.txt`): shipment 971 SHP-2610-00571, container TEMU1234565,
  `customer_appointment_at = 2026-11-22 09:30+00` = **16:30 +07:00** đúng giờ gõ.

### 5. FB-048 — `fb048/` — PASS 2/2
- Repro: `/shipments/new` để trống → bấm "Tạo lô hàng".
- Cả 5 ô (Loại container, Nhà máy, Tuyến đường, Cảng nâng, Cảng hạ):
  chữ lỗi đỏ `.csc-container-cell__error` + **viền đỏ thật** trên
  `.csc-container-cell__display`: `1px solid rgb(160, 68, 78)` (house danger) —
  dump computed style từng ô trong `fb002-fb048-driver.log` (`fb048_borders`),
  `01-empty-submit-errors.png`.
- Trạng thái mở menu: display ẩn (opacity 0), combobox `[aria-invalid]` hiện
  với viền đỏ cùng màu — không mất viền ở trạng thái nào (`02-cell-menu-open.png`).

## Gates

| Gate | Kết quả | Log |
|---|---|---|
| `cd frontend && npx tsgo -b` | exit 0 | `gates_tsgo.txt` |
| vitest scoped (column-visibility + tach-nhom + lcl-columns) | 31/31 pass | `gates_vitest_scoped.txt` |
| `pnpm lint` (root) | 0 errors | `gates_lint.txt` |

(BE không đổi trong branch này — FB-093 fix là FE-only; các mục PASS khác
không có code change.)

## Coverage table (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| FB-019 banner/toast không lộ TRP | UI DRIVEN (staging) | `fb019/02-after-accept-banner.png`, `dom-after-accept.txt`, `net-409-body.txt`, `ui-driver.log` | variant blocker KHÔNG thuộc board tài xế (generic copy) — chỉ pin test unit; tablet/other drivers |
| FB-033 chi hộ vừa tạo không khóa | UI DRIVEN (staging) | `fb033/04-just-created.png` → `07-after-delete.png`, `expense-api-log.json`, `db-side-effect.txt` | surface ví OPS thường (không auto-offset); ACCOUNTANT phiếu hoàn ứng thủ công (luật cũ không đụng) |
| FB-093 nút Tách nhóm phía Kế toán | BEFORE: UI DRIVEN (staging) / AFTER FIX: UI DRIVEN (FE fix local → staging API) | `fb093/05…png` (before) · `fb093/08…10…png`, `afterfix-*.{txt,json,log}`, `db-5-final-state.txt` | staging chưa deploy fix — R-next sau deploy phải nhìn lại board trên chính staging; operator có stored choice ẩn cột |
| FB-002 Case A Enter ô giờ lưu | UI DRIVEN (staging) | `fb002-case-a/02/04 PNG`, `db-side-effect.txt`, driver log | mobile 390 trên chính staging (local qua các lane trước đã PASS; đợt này chỉ chạy 1440) |
| FB-048 viền đỏ 5 ô container | UI DRIVEN (staging) | `fb048/01/02 PNG`, `fb048_borders` trong `fb002-fb048-driver.log` | 768/390 widths; trạng thái picker đã mở menu có type-picker (không phải searchable) |
