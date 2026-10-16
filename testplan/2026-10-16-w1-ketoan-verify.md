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
