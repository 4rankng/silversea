# Verify-fail regression cases — LCL form visible-by-default (21/10/2026)

Cards: 211026130115 (LCL-02), 211026130215 (LCL-03), 211026130315 (LCL-04),
211026130415 (LCL-05). Cùng một bề mặt: form tạo lô `/shipments/new`
(ShipmentCreateWorkspace). QA verify-fail: "code CÓ nhưng ẨN sau default" — QA mở
form mặc định (Nhập khẩu/FCL) không thấy feature → với khách cũng vậy = bug.
Owner instruction: **feature phải HIỆN THEO MẶC ĐỊNH, không cần biết trick**.

Before-evidence (máy local, FE :7176 → BE :3002, pin 9aab78d2): probe
`testplan/qa/scripts/2026-10-21-lcl-visible-probe.mjs before`, log +
screenshots `qa/2026-10-21-lcl-visible/before-*`.

## TC-211026130115 (LCL-02) — Thêm kho đơn giản: mở trước khi chọn KH, title theo hướng

- **Repro**: mở `/shipments/new` (mặc định Nhập/FCL) → chọn "Hàng lẻ" → section
  "Điểm vận hành & tuyến" → tìm nút "Thêm kho" **trước khi chọn khách hàng**.
- **Lỗi quan sát (before probe FAIL)**: KHÔNG có nút "Thêm kho" trước khi chọn KH
  (render gate `!sitesLoading && form.customerId`); `openCreateSiteDialog` chặn
  bằng toast "Vui lòng chọn khách hàng trước khi thêm nhà máy hoặc kho mới.";
  dialog `isOpen` cũng gate `&& Boolean(customerId)` → feature biến mất với
  khách mới vào form.
- **Kỳ vọng** (owner): dialog quick-add kho (3 trường Tên đầy đủ / Tên ngắn /
  Địa chỉ, KHÔNG form master-data) mở được **trước khi chọn KH** — dialog tự
  hiển thị picker Khách hàng (dòng `customerId == null` đã có sẵn trong
  OperationalSiteCreateDialog, chỉ bị caller chặn). Tiêu đề theo hướng hàng:
  Nhập/mặc định = "Thêm kho lấy hàng", Xuất = "Thêm kho trả hàng" (title law
  181026143000 §1a giữ nguyên). Không ẩn tính năng.
- **Ranh giới**: "Thêm nhà máy" (FCL + route section) GIỮ gate chọn KH trước +
  toast (contract `ClerkShipmentCreatePage.test.tsx` "keeps the factory creation
  action discoverable before a customer is selected").

## TC-211026130215 (LCL-03) — radio "Hàng lẻ" segmented control ở ĐẦU form

- **Repro**: mở `/shipments/new` mặc định → tìm radio "Hàng lẻ".
- **Lỗi quan sát (before probe FAIL)**: control "Loại hàng" nằm trong section
  "Thông tin hàng", topOffset=495px so với đầu form — bị vùi dưới Nhận diện lô +
  Điểm vận hành → "người dùng không biết phải chọn radio mới thấy" (Lịch & ghi
  chú chỉ rụng sau khi chọn).
- **Kỳ vọng (owner)**: radio "Hàng lẻ" nổi bật ở **đầu form** dưới dạng
  segmented control (giữ nguyên primitive `.csc-mode` segmented đã pin trong
  `ClerkShipmentCreatePage.styles.test.ts`). Chọn xong → "Lịch & ghi chú" rụng
  ngay (luôn conditional), các trường hàng lẻ hiện ngay trước mắt.

## TC-211026130315 (LCL-04) — "Ngày giao hàng" MỞ SẴN mặc định, không giấu sau nút "+"

- **Repro**: mở `/shipments/new` mặc định → chọn "Hàng lẻ" → tìm "Ngày giao hàng".
- **Lỗi quan sát**: (a) implementation cũ (0f7e1dfa) từng giấu field sau dashed
  "Thêm ngày giao hàng" reveal button (nút "+"); (b) với QA mở form mặc định,
  field nằm ngoài viewport (sau "Thông tin hàng", dưới fold) + chỉ render khi đã
  chọn Hàng lẻ → verify-fail "không thấy".
- **Kỳ vọng (owner)**: "Ngày giao hàng" MỞ SẴN mặc định — luôn là 1 field visible
  (id `shipment-expected-delivery`, wire `expectedDeliveryDate`), **không** reveal
  button, **không** "Ngày giao bổ sung" repeater (181026200700 law giữ nguyên) —
  và hiển thị ngay dưới segmented control ở đầu form nên vừa chọn "Hàng lẻ" là
  thấy trước mắt.
- **Ranh giới**: FCL không render field này (domain law: `expectedDeliveryDate` =
  non-FCL transport date, payload chỉ gửi khi `cargoMode === 'LCL'`) — FCL giữ
  "Lịch & ghi chú" đầy đủ.

## TC-211026130415 (LCL-05) — quy cách combobox: placeholder hint + gợi ý sẵn

- **Repro**: `/shipments/new` → "Hàng lẻ" → ô "Quy cách đóng gói" → quan sát
  placeholder + mở dropdown khi chưa gõ gì.
- **Lỗi quan sát (before probe FAIL)**: placeholder = "Chọn hoặc nhập quy cách
  (Pallet, Roll, Carton…)" — không phải hint owner yêu cầu.
- **Kỳ vọng (owner)**: placeholder chính xác `"Gợi ý quy cách (chọn hoặc gõ)"`;
  dropdown mở **có gợi ý sẵn từ đầu** (không cần gõ): click ô trống → list đủ
  curated options (Thùng gỗ, Pallet, Roll, Carton, Box, Crate, Khung, Bao, Can —
  `LCL_PACKAGE_TYPE_SUGGESTIONS`), free-text vẫn nhận (FB-079 law giữ nguyên).

## Pins sau fix

- `ShipmentCreateWorkspace.lcl-visible.test.tsx` — describe 4 card: mode control
  là block đầu `.csc-form` (trước Nhận diện lô); "Ngày giao hàng" render ngay
  dưới segmented control + không tồn tại reveal button/repeater; "Thêm kho" hiện
  trước khi chọn KH + dialog mở ra picker-mode (title theo hướng cả 3 nhánh
  mặc định/Nhập/Xuất); placeholder quy cách đúng chuỗi owner + menu gợi ý mở
  khi input trống.
- Existing pins giữ nguyên: `ShipmentCreateWorkspace.mode-toggle.test.tsx`
  (Lịch & ghi chú rụng khi Hàng lẻ), `ClerkShipmentCreatePage.test.tsx`
  (one always-visible Ngày giao hàng, no "Thêm ngày giao hàng" button, factory
  toast gate), `ShipmentCreateWorkspace.lcl-points.test.tsx` (title EXPORT +
  body gọn), `ClerkShipmentCreatePage.styles.test.ts` (segmented geometry).
