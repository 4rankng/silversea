# Regression: tạo khung báo giá không fail-im-lặng (card 221026040742)

## Symptom (QA 22/10)

Config → Báo giá → "＋ Tạo báo giá": điền form, bấm submit — KHÔNG có request
nào rời browser, list không có khung mới, không có error banner nào trong
dialog. Operator tin rằng form đã submit ("fail-im-lặng") → không có khung →
không set lag NEWEB được → chuỗi QA NEWEB-lag FAIL.

## Root cause (verified local 2026-10-22)

Submit handler chặn ở FE khi (a) Zod parse fail hoặc (b) native
`form.checkValidity()` fail, nhưng chỉ set per-field hint nhỏ — không có
dialog-level Alert. Các trường hợp thực tế bơm đúng triệu chứng:

- **C1** KH combobox: gõ tên → đóng popover không chọn (Escape/outside-click)
  → `customerId` state rỗng → submit bị chặn, hint "Chọn khách hàng." quá nhỏ.
- **C2** Ngày hiệu lực: segments hiển thị draft chưa hoàn chỉnh (vd `22/10/26`)
  → `effectiveDate` state rỗng → submit bị chặn, hint nhỏ
  "Nhập ngày hợp lệ theo DD/MM/YYYY.".
- **C3** (misattribution) Lag bỏ trống: Zod default 1 pass nhưng native
  required fail → lỗi bị gán nhầm vào "Ngày hiệu lực", lag không có message.

BE đã được bác bỏ nguyên nhân: POST /api/quotations với đúng dialog payload →
201 (qa/2026-10-22-quote-create/); 45/45 `quotations.create` idempotency rows
committed trên DB local; list invalidate/refetch hoạt động không cần F5.

## Expected behavior after fix

1. Mọi lần submit bị chặn phải render **dialog-level Alert** liệt kê tên
   trường còn sai ("Chưa tạo được báo giá — kiểm tra: khách hàng, ngày hiệu
   lực.") — không chỉ hint dưới field.
2. Lỗi được gán đúng trường: lag bỏ trống → lỗi "độ trễ áp giá dầu", không
   phải "ngày hiệu lực" (C3).
3. Happy path giữ nguyên: tạo xong dialog đóng, list hiện khung MỚI không
   cần F5 (đã pass trước fix — không được hồi quy).
4. KHÔNG weaken validation: mọi schema/ràng buộc giữ nguyên.

## Cases

- `RC-QC-CREATE-1` (C1): điền đủ, KH không chọn → Alert hiện "khách hàng",
  không POST. Chọn KH xong → Alert biến mất, submit thành công.
- `RC-QC-CREATE-2` (C2): ngày draft `22/10/26` → Alert hiện "ngày hiệu lực",
  không POST. Sửa đủ 4 chữ số năm → submit thành công.
- `RC-QC-CREATE-3` (C3): lag bỏ trống → Alert nhắc "độ trễ áp giá dầu"
  (không nhầm sang ngày hiệu lực).
- `RC-QC-CREATE-4`: happy path — tạo khung (KH, "Mẫu NEWEB", lag 1) → list
  có khung mới ngay không cần F5; frame strip set lag; preview-rate áp
  lag (ngày giao 22/10 → giá dầu kỳ 21/10).
