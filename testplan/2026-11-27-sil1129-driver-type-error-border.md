# SIL-1129 — viền đỏ ô lỗi "Loại chi phí lái xe" trong form Thêm khoản chi

Case ID: SIL-1129-R1..R2 (QA report 27/11 — `/accounting/phoi-phieu`, drawer
"Thêm khoản chi", `ExpenseCreateDrawer`).

**Ticket:** SIL-1129 — lỗi hiển thị ĐÚNG ("Dòng 1: Chọn loại chi phí lái xe.")
nhưng ô select không có viền đỏ (borderColor transparent, outline transparent,
boxShadow none).
**Owner (implement):** frontend `ExpenseCreateDrawer.tsx` (field-addressed
error state → `UuiSelectField error` prop).
**Owner (verify):** qa
**Status (this doc):** READY — regression recorded prior to implementation per AGENTS.md §6
**KB:** Ch.10 §10.8.5 — lỗi gắn đúng trường: viền đỏ tại đúng ô + thông báo
gắn đúng trường.

---

## Root cause (verified in source)

`save()` ghi lỗi vào một chuỗi duy nhất ở mức drawer (`setError(row('Chọn loại
chi phí lái xe.'))`) và render một `role="alert"` duy nhất — không có state
nào nhắm đúng ô, nên `UuiSelectField` của "Loại chi phí lái xe" không bao giờ
nhận `error`/`invalid` (→ `isInvalid=false` → không `border-error`, không
`aria-invalid`).

## Case SIL-1129-R1 — bấm Lưu khi trống → viền đỏ tại đúng ô + thông báo khớp trường

- **Given** drawer Thêm khoản chi, dòng 1 chưa chọn Loại chi phí lái xe.
- **When** bấm Lưu.
- **Then** trigger combobox "Loại chi phí lái xe" của Dòng 1 có
  `aria-invalid="true"` (paint `border-error` — đỏ đo được), thông báo lỗi gắn
  trường ("Chọn loại chi phí lái xe." dưới ô + alert mức dòng "Dòng 1: …").
- **Assert** ô KHÁC (Ngày chi, Tên khoản chi, Thực chi) KHÔNG invalid; dòng 2
  (nếu có) không dính đỏ của dòng 1.

## Case SIL-1129-R2 — chọn giá trị → đỏ tắt tại đúng dòng

- **Given** đang có viền đỏ ở Dòng 1 sau một lần Lưu lỗi.
- **When** chọn một loại chi phí ở Dòng 1.
- **Then** viền đỏ Dòng 1 tắt ngay (patch đúng dòng + đúng trường); dòng khác
  không đổi.

## Verification

- FE scoped vitest (`ExpenseCreateDrawer.test.tsx`): R1/R2 — combobox theo
  house convention (`getByRole('combobox', { name })`), đo `aria-invalid` +
  message text; `pnpm exec tsc --noEmit` xanh.

## What is NOT covered

- Các trường lỗi khác (số hóa đơn, người chi/nhà cung cấp) giữ nguyên hành vi
  cũ — chỉ Loại chi phí lái xe là ô lỗi được ticket chỉ định.
