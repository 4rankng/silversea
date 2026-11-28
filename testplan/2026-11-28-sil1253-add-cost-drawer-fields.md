# SIL-1253 (id 1530) — Ngăn 'Thêm khoản chi': ô 'Ngày chi' chỉ hiện '28/11/202' (regression case)

Case ID: TC-SIL1253-01
Feature: Ngăn "Thêm khoản chi" (`ExpenseCreateDrawer`, mount qua `ShipmentExpensePanel` "Khai chi phí" / `ExpenseAccountingWorkspace` / 2 dialog Phôi phiếu) — dòng khai chi "Khoản N" trong hai khu "Tiền đường" / "Chi phí lô hàng" (SIL-1028, KB K6.9).

## Đặc tả (nguồn: thẻ SIL-1253, build 61999831, staging 28/11/2026)
- Môi trường: vai Kế toán (ngocntm), /shipments/1600 (lô P2-K235) → "Khai chi phí" → ngăn "Thêm khoản chi" tại 1440px.
- Trước fix: ô "Ngày chi *" chỉ hiện "28/11/202" (mất số 6 của năm) + icon lịch; "Người chi" → "Chọn nhâ…", "Nhà cung cấp" → "Chọn nhà…", "Loại chi phí lái xe" → "Chọn loại…"; "Bên thực chi" quấn 3 dòng ("Công ty / trả trực / tiếp"). Ô Số hóa đơn/Ngày hóa đơn (khi bật "Có hóa đơn") cùng tế bào 104px — cùng lớp lỗi.
- Mong đợi: ô ngày hiện đủ "28/11/2026"; các ô chọn hiện đủ chữ; "Bên thực chi" không quấn 3 dòng.

## Nguyên nhân (chẩn đoán 28/11)
- Chuỗi bóp (cố định theo container): `Drawer.css:22` max-width 580px → `ExpenseAccounting.css:135-138` `.expense-accounting-group-panels` 2 cột → mỗi khu 272px → `.expense-accounting-draft-row` (padding 12px) còn 220px → `.expense-accounting-fields` (`ExpenseAccounting.css:18`) `repeat(2, minmax(0,1fr))` chia ô **104px**.
- `DateTimeSegments.css` DD/MM/YYYY min-content ~90px + strip icon 20px + padding ~20px > 104px → năm bị cắt (lớp lỗi squeeze đã biết SIL-1004). Select 104px: placeholder vendor truncate "Chọn nhâ…"; value `white-space: normal` (UuiSelectField no-truncation) quấn 3 dòng.
- Hàng ngày chi còn để ô lưới trống thứ hai (1 con trong grid 2 cột) — orphan cell.

## Thiết kế đã chọn
- GIỮ nguyên SIL-1028 (KB K6.9): hai khu "Tiền đường" / "Chi phí lô hàng" hiển thị cạnh nhau ở canvas >900px — không đảo ruling của owner.
- Sửa ở lớp field: trong `.expense-group-panel`, `.expense-accounting-fields` về 1 cột `minmax(0,1fr)` — mỗi control lấy trọn 220px của dòng nháp thay vì nửa ô 104px. Base `.expense-accounting-fields` 2 cột giữ nguyên cho các drawer canvas rộng (ExpenseEntryDrawer...).
- Không đụng shared `Drawer` cap 580px (primitive sizing không cần cho acceptance).

## Automated pins
- `frontend/src/features/expense-accounting/ExpenseAccounting.styles.test.ts`:
  - `.expense-group-panel .expense-accounting-fields` = 1 cột `minmax(0, 1fr)` (red tại HEAD — rule chưa có);
  - base `.expense-accounting-fields` vẫn `repeat(2, minmax(0, 1fr))` (canvas rộng giữ cặp);
  - `.expense-accounting-group-panels` vẫn 2 cột cạnh nhau + collapse ≤900px (SIL-1028 không bị đảo).
- Kế cận (không sửa, chỉ re-run): `ExpenseCreateDrawer.test.tsx` (thứ tự trường KB §10.7.2, SIL-1028 panels), `ExpenseCreateDrawer.catalog-keys.test.tsx`, `ExpenseCreateDrawer.defaults.test.tsx`, `ExpenseCreateDrawer.sil1105-network.test.tsx`.

## Quy tắc hiển thị (shipmate-uiux doctrine)
- Không truncate giá trị đã chọn / placeholder cắt chữ (trigger: truncated content) — control đủ rộng hiển thị trọn "28/11/2026", "Chọn nhà cung cấp", "Công ty trả trực tiếp" 1 dòng.
- Không orphan grid cell (design-guidelines §5) — hàng ngày chi hết ô trống.
- Mobile ≤900px: khu xếp 1 cột như hiện tại; field 1 cột tự nhiên full-width.

## Not covered bởi hồ sơ này
- Rung 3 UI DRIVEN (screenshot px trên staging) thuộc cột QA theo chỉ đạo lane "Scoped tests + tsc".
- Thẻ "Tiền đường" trống khi chưa có dòng nháp — hành vi SIL-1028 (khu luôn hiện + "+ Thêm dòng"), ngoài scope mô tả ticket.
