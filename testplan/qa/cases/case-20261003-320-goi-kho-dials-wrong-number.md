# Case 20261003-320 — Nút 'Gọi kho' gọi nhầm số liên hệ khi SĐT kho trống

- **Case ID:** case-20261003-320-goi-kho-dials-wrong-number
- **Card:** 20261003_320 (P2 bug)
- **Reported:** 2026-10-03, QA per Zalo group 'Phần mềm QLVT Cty Silver Sea' (Tiệp Vũ): SĐT kho không hiển thị bên lái xe (/my-trips/79).
- **Surface:** Driver trip detail `/my-trips/:id` (`frontend/src/pages/driver/DriverTaskInfoSections.tsx`).
- **Repro:**
  1. Đăng nhập lái xe (DRIVER), mở chi tiết lệnh (/my-trips/:id) có nhà máy/kho chưa có SĐT (`khoPhone: null`), nhưng có SĐT liên hệ của lô hàng (`contactPhone: '0900000001'`).
  2. Mục 'SĐT kho' hiển thị '—' (trống, đúng vì kho chưa có số).
  3. Nút 'Gọi kho' (thanh xanh `driver-task-call-bar`) vẫn hiển thị và bấm được, link là `tel:0900000001` (SĐT liên hệ, KHÔNG phải số kho).
  4. Lái xe bấm 'Gọi kho' sẽ gọi nhầm sang số liên hệ chung mà tưởng là gọi kho.

## Nguyên nhân
Trong `frontend/src/pages/driver/DriverTaskInfoSections.tsx:132`:
```ts
const callContacts = operationalSiteContacts({
  contacts: fulfillment?.factoryContacts,
  contactName: fulfillment?.contactName,
  contactPhone: khoPhone ?? contactPhone,
});
```
Biểu thức `khoPhone ?? contactPhone` đã dùng `contactPhone` (SĐT liên hệ của lô hàng) làm fallback cho SĐT kho khi `khoPhone` trống. Kết quả là `callContacts` bị điền số `contactPhone`, khiến nút mang nhãn "Gọi kho" gọi sang số liên hệ chung.

## Kỳ vọng & Tiêu chí nghiệm thu (AC)
1. **AC1:** SĐT kho trống (`khoPhone: null` và `factoryContacts` rỗng) → không có nút 'Gọi kho' bấm được (ẩn thanh gọi kho).
2. **AC2:** SĐT kho có dữ liệu → nút 'Gọi kho' gọi đúng số kho (`khoPhone` hoặc chọn từ `factoryContacts`).
3. **AC3 (Không hồi quy):** SĐT liên hệ vẫn hiển thị và hoạt động bình thường khi khác số kho.

## Automated Verification
- `frontend/src/pages/driver/DriverTaskInfoSections.test.tsx`:
  - Verify that when `khoPhone: null` and `contactPhone: '0909000001'`, `queryByRole('link', { name: /Gọi kho/ })` is NULL.
  - Verify that when `khoPhone: '0901234567'`, `getByRole('link', { name: /Gọi kho/ })` has `href="tel:0901234567"`.
  - Verify that `showContactPhoneRow` still renders `SĐT liên hệ: 0909000001`.
