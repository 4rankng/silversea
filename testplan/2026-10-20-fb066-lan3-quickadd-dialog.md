# FB-066 lần 3 — quick-add BKS trong dialog "Phân bổ nhà xe" (2026-10-20)

Card: 201026101600 (lần 3) · QA R27 build `d39ee741`.
Branch `fix-fb066-lan3` (off `main` = `106a25e3`).
Evidence: `qa/2026-10-20-fb066-lan3-dialog/` (before/after per surface).

## Case TC-201026101600-L3 — QA R27 verbatim

> "dialog 'Phân bổ nhà xe' vẫn không có nút thêm nhanh biển số xe (CẢ BẢN FCL
> LẪN LCL); gõ biển số chưa đăng ký vào ô BKS cũng không có tuỳ chọn thêm"

Surface (khớp chính xác): dialog **"Phân bổ nhà xe"** mở từ Kế hoạch Tổng quát
(`/dispatch`, MasterPlanPage → `DispatchAllocationPopover`) — gồm 2 field-set
theo cargoMode (card 191026181942):

- **LCL field-set** (`DispatchAllocationLclDialog`): ô BKS thực/BKS báo khách —
  TRƯỚC fix: không nút "+ Thêm nhanh", gõ BKS lạ dropdown chỉ có "Không tìm
  thấy kết quả" (repro driver `2026-10-20-fb066-lan3-dialog-repro.mjs`,
  `before-lcl-typed-plate-dropdown.png`, `before-dialog-driver.log`).
- **FCL field-set** (cont body `DispatchAllocationContBody`): TRƯỚC fix và SAU
  fix đều KHÔNG có ô BKS/xe — contract của nó là số cont 20'/40' theo nhà xe
  theo ngày; biển số của lô cont gán ở Kế hoạch Chi tiết ("Xe / biển số",
  `DispatchPlanEditorCell` — đã có quick-add từ card 20261004_357). Trước/sau
  cùng một ảnh (`before-fcl-dialog.png` / `after-fcl-dialog.png`).

## Repro (trước fix, UI DRIVEN)

1. dieuvan `/dispatch` → bấm cell "Phân bổ nhà xe" của lô hàng lẻ → dialog
   "Phân bổ nhà xe" mở, ô "BKS thực (xe chạy chuyến)" KHÔNG có nút thêm nhanh.
2. Gõ `29C-066.99` vào ô BKS thực → dropdown chỉ ["Không tìm thấy kết quả"] —
   không có option "Thêm mới".

## Expected

1. Ô BKS thực có nút "+ Thêm nhanh" cạnh label → mở dialog "Thêm nhanh biển số
   xe" (đúng dialog các surface khác dùng), nhập BKS → "Áp dụng" → biển mới
   đăng ký qua API catalog thật (OWN → POST /trucks; nhà xe ngoài → POST
   carrier-fleet-vehicles) và được CHỌN NGAY vào ô BKS thực — dialog phân bổ
   KHÔNG đóng, draft state giữ nguyên.
2. Gõ BKS chưa đăng ký → dropdown có option **"Thêm mới: &lt;số gõ&gt;"** → chọn
   nó mở dialog quick-add ĐẦY số đã gõ → xác nhận → chọn vào ô.
3. Lô CHƯA có nhà xe: dialog quick-add hỏi "Nhà xe" ("hãng/nhà xe nếu cần") —
   mặc định đội xe nội bộ.
4. BKS báo khách (ảo) KHÔNG mang quick-add/Thêm mới — ảo là biển báo khách,
   không phải xe thật để đăng ký (FB-094).

## Fix (thực thi)

- `DispatchAllocationLclDialog.tsx`: field-head "BKS thực" + `QuickAddButton`
  (component chung FB-066) + `createOption` "Thêm mới: &lt;số&gt;" trên
  `USearchableField`; interim plate list + fleet nonce (luật sibling
  AssignTruckGroupDialog/LclGroupTruckEditDialog); `QuickAddVehicleDialog` mount
  chồng — `handleVehicleCreated` set BKS thực + refetch, dialog phân bổ giữ
  state.
- `QuickAddVehicleDialog.tsx`: + `initialPlate` (seed từ option "Thêm mới") +
  `carrierChoices` ("hãng/nhà xe nếu cần" — chỉ hỏi khi lô chưa có nhà xe).
- `uui-searchable-field.tsx`: 2 fix hành vi chung (đúng invariant của module):
  1. `chosenKey` = last REAL pick only — fallback `?? value` cũ nạp phantom key
     mỗi phím gõ → react-aria auto-select → `KeepSuggestionsOpen` tưởng pick
     thật → dropdown đóng giữa chừng và KHÔNG mở lại (đúng triệu chứng QA
     "gõ … cũng không có tuỳ chọn thêm" — không còn gợi ý nào khi gõ);
  2. option `__create__` đánh dấu real pick (2 kênh key khớp) → dropdown đóng
     hẳn khi mở dialog quick-add, không mở lại đè dialog + không giữ
     ariaHideOutside scope (dialog quick-add tới AT).

## Regression tests

`DispatchAllocationLclDialog.quick-add.test.tsx` — 5 case: nút hiện cả lô có
nhà xe lẫn chưa; flow nút → tạo Xe ngoài → chọn vào ô, dialog phân bổ giữ;
option "Thêm mới: &lt;số&gt;" → dialog seeded → chọn vào ô; lô chưa nhà xe →
picker "Nhà xe" (nội bộ mặc định + đổi sang nhà xe ngoài); draft BKS báo khách
sống sót qua vòng quick-add.

## Verdict

FIXED — UI DRIVEN (rung 3): xem `qa/2026-10-20-fb066-lan3-dialog/report.md`.
FCL cont field-set: NOT APPLICABLE (không có ô BKS — xem coverage table).
