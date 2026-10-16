# W1 ketoan + chấm công — closed-loop staging QA (FB-096…FB-104)

- Run: 2026-10-16, staging `https://vantai.tingting.vip`, health `buildHash 7dcdcf33`
  (= W1 merge commit — build matches the wave, no stale-build caveat).
- Roles: ACCOUNTANT `hoapt` (original FB-100 reporter), ADMIN `admin`,
  DISPATCHER `dungnv`, OPS `hoangnh` (testplan/testaccounts.txt; passwords never
  echoed into artifacts). Demo `ketoan` does NOT exist on staging — ACCOUNTANT
  named accounts used instead.
- Method: puppeteer headless, token injection before SPA navigation, real
  clicks/typing; every write carries `Idempotency-Key`; fixtures prefixed
  `QA-W1-` and namespaced for the sanctioned qa-fixture purge
  (backend/src/seed/qa-fixture-registry.ts).
- Evidence: `testplan/qa/2026-10-16_w1-verify/` — per card: screenshots
  `<card>_NN-*.png`, DOM assertions `<card>_assertions.json`, driver log
  `<card>_ui-driver.log`, script `<card>-*.mjs`.
- FB numbering follows the testplan contracts + W1 commits (48ed1fe1…1623de28):
  FB-096 = Thêm cược (card …230730), FB-097 = Thêm khoản chi drawer (…230740),
  FB-098 = Khai chi phí on lot detail (…230750), FB-099 = chốt debit zones
  (…230760), FB-100 = tạm ứng/hoàn ứng approvals (…230770), FB-101…104 =
  chấm công (…230780…230810). The dispatcher's wave summary mislabeled
  FB-096/097 as advance/reimbursement — the advance/reimbursement surface is
  FB-100.

## FB-096 — Thêm cược: gợi ý bill 4 số cuối + tích hợp CUS — PASS (rung 3)

- UI: nav /accounting/deposit-tracker as `hoapt` → nút **"Thêm cược"** hiện
  (nhãn cũ "Thêm dòng" không còn); modal tiêu đề **"Thêm cược"**.
- Lookup `6159` (Bill BLCUS6159) → suggestion dòng
  `BLCUS6159 / Hãng tàu Accessibility / CÔNG TY TNHH MTV LONG MINH` → click →
  tự điền Số Bill + Khách hàng + Hãng tàu (CUS data: Bill/Booking – Hãng Tàu –
  Tên khách).
- Đổi Số Bill thành `QA-W1-DEP-6159` + Ghi chú fixture → **"Lưu dòng"** →
  dialog đóng, dòng hiện trên bảng.
- Persisted: `GET /api/accounting/deposits` trả về row **id 7**
  (`QA-W1-DEP-6159`). POST dùng Idempotency-Key (driver log).
- Evidence: fb096_01…04 png, fb096_assertions.json (10/10 checks true),
  fb096_ui-driver.log, fb096-deposit-tracker.mjs.

## FB-097 — Thêm khoản chi: form gọn + nhập liên tục — PASS (rung 3)

- UI: /accounting/phoi-phieu as `hoapt` → row **BLEHPH260900002** (trip 78,
 shipment 7, láixe Lương Văn Long) → "Xem chi tiết" (Chi tiết tiền đường
 JJCTCHPDY260305 khi mở thử lần đầu — dialog per-row) → **"＋ Thêm dòng"** →
 drawer **"Thêm khoản chi"**.
- TC-COSTUX-03: không còn **"Ghi chú khoản chi"**; cặp **"Số hóa đơn" /
 "Ngày hóa đơn"** hiển thị sẵn (tùy chọn); "Loại chi phí lái xe" + "Ngày chi"
 còn; Nhóm chi phí đúng 2 lựa chọn (Chi phí lô hàng / Tiền đường).
- Chọn Bên thực chi = "Nhà cung cấp" → trip không có nhà xe ngoài → hint đúng
 **"Chưa có nhà xe trên tuyến này — chọn thủ công."** (contract fallback).
- TC-COSTUX-04: "Lưu 1 khoản chi" → drawer KHÔNG đóng, dòng trạng thái
 **"Đã lưu khoản chi."**, ô Tên khoản chi làm trống, nút "Đóng" còn.
- Persisted: `GET /api/expense-accounting/entries?shipmentId=7` chứa
 **"QA-W1 phí tiền đường fixture"** (fee_name mang chữ ký purge QA%).
 POST batch dùng Idempotency-Key (driver log).
- Không cover (giới hạn thật): (1) đường autofill NCC dương — không có trip nào
 trên staging mang `carrierSupplierId` (0/66 rows); (2) chọn tay NCC trong
 select Nhà cung cấp — select này render dạng listbox, driver không pick được;
 dòng lưu với Bên thực chi = Công ty trả trực tiếp. Cả hai là dữ liệu/UI-drive
 giới hạn, không phải defects.
- Evidence: fb097_01…05 png, fb097_assertions.json, fb097_ui-driver.log,
 fb097-expense-drawer.mjs.

## FB-098 — nút "Khai chi phí" trên chi tiết lô — PASS (rung 3)

- UI: /shipments/7 as `hoapt` (SHP-2609-00007, lot không khóa) → header có nút
  **"Khai chi phí"** + panel giữ "+ Thêm khoản chi" → click header → drawer
  **"Thêm khoản chi"** mở ở mức lô (subtitle tên lô, không gắn chuyến).
- Lưu 1 khoản DRIVER_SHIPMENT `QA-W1 khai chi phí lô fixture` (Thu = Trả) →
  dòng trạng thái "Đã lưu khoản chi."; **"Đóng"** → panel Chi phí / thực thu
  hiện dòng QA-W1 ngay (invalidate không cần reload).
- Persisted: `GET /api/expense-accounting/entries?shipmentId=7` chứa thêm
  **"QA-W1 khai chi phí lô fixture"**.
- Role gate: `tiepvv` (CUS) mở cùng lô → **không** có nút "Khai chi phí"
  (đúng cùng vai trò panel).
- Điều tra chuỗi lỗi "chưa có thông tin lô" (phần 1 của card): CODE-READ ONLY —
  chuỗi nguyên văn không tồn tại trong build hiện hành; guard gần nhất
  "Đang tải thông tin lô…" giữ nguyên hành vi (đúng hợp đồng testplan). Không
  tái hiện được lỗi khách trên build 7dcdcf33.
- Evidence: fb098_01…05 png, fb098_assertions.json, fb098_ui-driver.log,
  fb098-lot-cost.mjs.

## FB-099 — chốt debit: ba vùng rõ — PASS (rung 3)

- UI: /accounting/chot-debit as `hoapt` (kỳ 09/01→16/10, dữ liệu thật: 156 dòng).
- Vùng 1: SummaryRail **"Tổng hợp chốt debit"** với chip "Chờ xác nhận: 134".
- Vùng 2 riêng: h2 **"Chờ xác nhận"** + bảng caption "Chờ xác nhận — lô có
  yêu cầu điều chỉnh cước đang chờ" — đúng **134 dòng PENDING**, không dòng
  "Chờ xác nhận" nào còn trong bảng Kế hoạch điều động tổng hợp (0/22).
- Vùng 3: section **"Tổng hợp công nợ khách hàng"** (các đợt chốt) có mặt.
- Hai bảng dùng chung bộ cột (column parity true — một DebitBoardTable); ô
  trạng thái chữ thuần (0 pill/badge/chip trong bảng).
- Read-only — không đổi dữ liệu (đúng hợp đồng TC-COSTUX-05 "chỉ chỉnh giao
  diện").
- Evidence: fb099_01…02 png, fb099_assertions.json, fb099_ui-driver.log,
  fb099-debit-zones.mjs.

## FB-100 — Tạm ứng & hoàn ứng: phê duyệt + tick + số âm — PASS với FINDINGS(1) (rung 3 trừ 1 nhóm)

- **Nút "Phê duyệt tạm ứng" (chạy đủ rung 3):** OPS `hoangnh` tạo yêu cầu
  `POST /api/ops/wallet/advance-requests` (Idempotency-Key) → row
  `QA-W1-mvaohgcf` **PENDING** hiện trên /advances?view=requests với nút
  **"Phê duyệt tạm ứng"** → click → dòng đổi **"Đã ghi nhận"**, nút biến mất,
  không banner lỗi. API: request **id 21 RECORDED, approvedBy=9 (hoapt),
  approvedAt stamp, version 1→2** = duyệt = giải ngân KP-148.
  Lưu ý điều tra: `/api/forwarder/me/advance-requests` là đường ghi thẳng
  RECORDED (fixture id 17 — không chạm tiền); đường PENDING đúng hợp đồng
  CPB-03 là `/api/ops/wallet/...`.
- **Phiếu hoàn ứng gắn chú thích:** phiếu **PT-2610-0002 (id 8)** tạo qua
  `POST /api/forwarder/me/advance-settlements` (refund +2,000,000 = cân đối
  với 0 chi phí), trang /settlements/8 hiện "Đã ghi nhận" + note QA-W1.
- **FINDING F-W1-1 (cho owner, không phải regression):** block "Xác nhận hoàn
  ứng" + "Ghi nhận phiếu" chỉ render khi phiếu **DRAFT**
  (`canEditExpenses = canManageSettlements && status==='DRAFT'`,
  SettlementPrintPage.tsx) nhưng `createAdvanceSettlement` sinh phiếu thẳng
  **RECORDED** và không có writer nào tạo phiếu DRAFT (staging: 0 phiếu
  DRAFT, 2 RECORDED, 1 REVERSED). Tick gate đã có + unit-pinned
  (SettlementPrintPage.test.tsx case FB-100 set status DRAFT) nhưng **không
  tới được trong luồng sống**. Cần owner xác nhận (a) luồng DRAFT dự kiến
  hoạt động thế nào hoặc (b) bỏ block chết. Root candidates:
  frontend/src/pages/SettlementPrintPage.tsx (gate),
  backend/src/services/advance-settlement.service.ts (birth status).
- **Số âm:** luật cân đối `assertSettlementBalanced` đếm chi phí từ các dòng
  trip-expense THẬT — hoàn ứng âm chỉ legal khi chi phí > tạm ứng; staging
  không có bộ trip-expense đủ điều kiện của forwarder (0 candidate) nên
  không dựng được phiếu âm thật. Schema signed + hiển thị −200.000 ₫ được pin
  unit (OpsReconciliationReportPage.test.tsx:151). Giới hạn cover, không
  phải defect.
- **Báo cáo /accounting/hoan-ung (rung 3):** bảng có cột **"Còn phải hoàn ứng
  (có dấu)"** + ghi chú **"Đề nghị thu tiền ứng"** (fb100_08-report-probe.png;
  lần chạy script đầu thấy false do bảng chưa load xong — probe sau xác nhận).
- **Cleanup:** phiếu 8 → **REVERSED** qua reversal endpoint (201) trước purge.
- Evidence: fb100_01…08 png, fb100_assertions.json, fb100_ui-driver.log,
  fb100-advances.mjs.

## FB-101 — chấm công hiện cho kế toán, lưới phân vai — PASS (rung 3)

- Nav + route (hoapt, ACCOUNTANT): "Chấm công lái xe" có trong mục Nhân sự;
  /timesheet tải bình thường; /timesheet/doi-chieu tải ("Đối chiếu chấm công");
  /timesheet/bao-cao tải ("Tổng hợp xếp lệnh tháng") — hết "bị ẩn".
- Lưới read-only cho kế toán: nút **"Lưu lưới" KHÔNG** hiện cho hoapt;
  backend chặn ghi lưới: `PUT /api/timesheet/months/:id/days` as hoapt →
  **403 "Không có quyền truy cập"**; `POST /api/timesheet/months` as hoapt →
  404 "Không tìm thấy lái xe." (route accountantOnly CHO hoapt đi qua — đúng
  vai trò mở bảng).
- DISPATCHER `dungnv`: nav có "Chấm công lái xe", KHÔNG có "Tổng hợp xếp lệnh
  tháng" (officeStaffOnly); /timesheet tải (ghi được lưới — dùng ở FB-102).
- ADMIN `admin`: cả grid + report nav.
- CUS `tiepvv`: /timesheet bị đá về /shipments (route guard) — không thấy mục.
- Nav chạy theo ngữ cảnh section (sidebar hiện mục của section đang đứng) —
  ma trận nav assert trên chính /timesheet (fb101_04-nav-*.png).
- Evidence: fb101_01…04 png, fb101_assertions.json, fb101_ui-driver.log,
  fb101-timesheet-visibility.mjs.

## FB-102 — ký hiệu xếp lệnh + Mở bảng chấm công — PASS (rung 3)

- Fixture period 2099-12 (namespaced cho purge; year 2099 không bao giờ là kỳ
  thật), lái xe 11 Bùi Quang Hường (15H-117.55) + lái xe 16 Bùi Tiến Dũng.
- **Điều vận không thấy nút:** `dungnv` chọn lái xe chưa có bảng (driver 16) →
  hint "chưa có bảng chấm công" hiện, **không** có nút "Mở bảng chấm công".
- **Kế toán thấy + mở được:** `hoapt` → nút "Mở bảng chấm công" → dialog có
  "Hình thức lương" + "Lương ngày (VND)" + hint "Để trống nếu chưa có mức" →
  Mở bảng → lưới 31 ô hiện (driver 16, tháng mở = month id 3, PER_TRIP).
  Driver 11 board mở từ drive trước (month id 2) — cùng luồng.
- **Nhập ký hiệu qua UI:** `dungnv` gõ K,Q,Đ,L,N,P,K vào 7 ô đầu (ô 3 "Đ" không
  qua được CDP keyboard — headless diacritic; đặt lại qua API PUT days, cùng
  đường ghi chính thức) → **"Lưu lưới"** → server chốt: **trips=5, workdays=5**
  với symbols KQĐLNPK: K=1,Q=2,Đ=1 chuyến; N=0; P(Chủ nhật 06/12) ghi nhưng 0
  ngày công — đúng bảng quy tắc card 230790.
- **.strict() law:** PUT kèm `trips: 99` smuggled → **400 "Unrecognized key(s)
  in object: 'trips'"** — client không thể tự khai chuyến.
- Evidence: fb102_01…05 png, fb102_assertions.json, fb102_ui-driver.log,
  fb102-grid.mjs.

## FB-103 — 2 chế độ lương ghi nhận qua UI — PASS (rung 3)

- Bàn đối chiếu /timesheet/doi-chieu?m=12&y=2099 as `hoapt`: panel **"Chế độ
  lương"** (select "Hình thức lương" 2 lựa chọn + ô tiền) đổi lái xe 11 sang
  **FLAT_MONTHLY / 10.000.000** → "Lưu chế độ lương" → API:
  `salaryMode=FLAT_MONTHLY, flatAmount=10000000` (month id 2).
- Lưới Điều vận phản ánh read-only:
  **"Hình thức lương: Lương theo tháng (trốn vé) · Lương tháng 10000000 ₫"**.
- Panel "Tổng hợp tháng" có mặt trên bàn đối chiếu (cột Hình thức lương).
- Bảng đã đối chiếu thì khóa (disabled khi RECONCILED) — fixture giữ OPEN nên
  đường khóa không drive được (giới hạn cover; luật disabled có pin test).
- Giới hạn: fixture để lại ở FLAT_MONTHLY (restore click bị page re-render
  nuốt — vô hại, month 2099-12 bị purge sạch ở bước cleanup).
- Evidence: fb103_01…03 png, fb103_assertions.json, fb103_ui-driver.log,
  fb103-salary-modes.mjs.

## FB-104 — báo cáo Tổng hợp xếp lệnh tháng — PASS (rung 3) + 1 ghi chú

- /timesheet/bao-cao?m=12&y=2099 as `hoapt` — bảng đúng mẫu Excel khách:
  tiêu đề **"TỔNG HỢP XẾP LỆNH THÁNG 12/2099"**; cột STT · Loại xe · Biển
  kiểm soát · Hình thức lương · Lái xe · lưới ngày 1..31 (header số + thứ,
  CN đánh dấu) · Tổng lệnh đơn · Tổng lệnh kẹp · Số chuyến quay đầu · Tổng số
  chuyến · Số ngày công.
- Mapping với dữ liệu fixture (K,Q,Đ,L,N,P,K): đơn=**1**, kẹp=**2**,
  quay đầu=**2** (=2×Q ✓), tổng số chuyến=**5** (server-chốt), ngày công=**5**.
- Hai dòng chân bảng: **"Tổng lệnh kẹp/ngày"** = d1:1, d7:1;
  **"Tỷ lệ %"** = **100% / 0% / 0% / … / 100%** (= kẹp / (K+Q+Đ) của ngày;
  L/N/P không tính vào mẫu số — đúng hợp đồng).
- Màu ô: K/Q/Đ **xanh** (trip), L **vàng** (standby), N/P **đỏ** (off), P rơi
  vào Chủ nhật vẫn **đỏ** (off thắng sunday) — khớp mô tả khách đã tài liệu
  hóa trong case (ảnh mẫu Excel chưa từng có).
- Quy ước ký hiệu in đầu báo cáo: đủ K/Q/Đ/L/N/P + dòng Chủ nhật
  (fb104_02-legend.png).
- **Ghi chú (không phải regression):** build không có surface tải file
  (.xlsx) — "mẫu Excel" là bảng báo cáo on-screen theo mẫu. Nếu khách yêu cầu
  file Excel thật thì đó là scope mới. Task ngữ cảnh yêu cầu "verify Excel
  export downloads" — ghi nhận rõ: **không có export để tải**.
- Evidence: fb104_01…02 png, fb104_assertions.json, fb104_ui-driver.log,
  fb104-report.mjs.
