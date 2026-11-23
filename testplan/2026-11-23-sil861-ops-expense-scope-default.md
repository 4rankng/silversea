# Card SIL-861 — Hồi quy: validation Popup Khai báo chi phí Ops (scope mặc định + cổng 0-cont)

Ngày: 2026-11-23 · Ticket SIL-861 (id 997, reopen 23/11 09:56 SGT) · QA build 6bcc081e FAIL

## Lỗi (2 DEFECT QA as hoangnh/Ops, /ops/orders, lot EHPH26080202, 1 cont MNBU0000848)

- **DEFECT A** — tab PHÍ CÓ HÓA ĐƠN, 0 container (Bỏ chọn tất cả): 1 dòng đầy đủ
  (Phí hạ container 200.000, HĐ QAHĐ-861-D01) → KHÔNG có lỗi "Bắt buộc chọn Số
  container", footer chỉ "Tổng", [Lưu] BẬT. Submit Serialize chung lô (empty set).
  Nguyên nhân: `noInvoiceScopeBlocked` chỉ đếm dòng tab KHÔNG HÓA ĐƠN — dòng
  hóa đơn với scope rỗng/'Phí chung lô' đi qua canSubmit và ghiLot-wide.
- **DEFECT B** — trạng thái DEFAULT của popup: picker hiển thị "1 đã chọn"
  (đếm cả lựa chọn 'Phí chung lô' init `[LOT_CHOICE]`) trong khi validation thấy
  0 container → 1 dòng hợp lệ (Đảo vỏ 100.000) bị chặn "Bắt buộc chọn Số
  container" + [Lưu] TẮT. Display và validation lệch nhau ở init.

Nguyên nhân gốc: init `containerValues=[LOT_CHOICE]` + gate scope chỉ áp tab
không hóa đơn (cùng một mối: scope không-cont trên lô có cont).

## Kỳ vọng

- Lô CÓ cont: mở popup = CHỌN SẴN toàn bộ cont (01 bản ghi đầy đủ tập cont —
  SIL-881); picker "N đã chọn" đúng sự thật từ first paint, "Chọn tất cả" tick.
- Cả HAI tab: scope rỗng hoặc 'Phí chung lô' trên lô có cont → footer "Bắt buộc
  chọn Số container" + [Lưu] TẮT + submit không ghi gì (DEFECT A law).
- Default popup + 1 dòng hợp lệ → không error, [Lưu] BẬT, ghi 01 bản ghi với
  full set (DEFECT B law).
- Lô KHÔNG có dòng cont: giữ 'Phí chung lô' — scope duy nhất, picker khóa kèm
  hint, serialize empty set (không đổi).
- TC1–TC5 giữ nguyên; các luật trùng (loại phí cùng cont, số hóa đơn cùng lô,
  SIL-886 giao thoa) KHÔNG đụng.

## Bằng chứng kiểm

- `frontend/src/features/ops/OpsExpenseFormModal.containers.test.tsx` — A1/A2/A4/
  B4/G1/G4 cập nhật theo luật mới; **G8** pin DEFECT A, **G9** pin DEFECT B;
  G5 giữ serialization chung lô cho lô không cont. 28/28 pass.
- QA artifacts: `qa/2026-11-23_sil861_ops-expense-scope_vitest.txt`,
  `qa/2026-11-23_sil861_ops-expense-scope_tsc-frontend.txt` (exit 0 cả hai).

## Rủi ro hồi quy

| # | Khu vực | Rủi ro | Kiểm |
|---|---|---|---|
| R1 | SIL-881 one-record law | default full-set ghi K bản ghi × tiền | G9/A3/S1 pin 01 record, amount as typed |
| R2 | Lô không cont | mất scope chung lô duy nhất | G5/S2 pin [LOT] init + empty set |
| R3 | Chung lô hóa đơn chủ động | bị chặn oan khi lot không cont | G5 pass (chung lô vẫn ghi khi picker trống) |
| R4 | TC1–TC5 | luật cũ bị đụng | toàn file 28/28 pass, không đổi luật trùng |
