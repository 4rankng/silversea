# Case QA-2026-10-04-344 — Dropdown "Loại container" phải mở NGAY DƯỚI ô nhập (card 20261004_344)

- Card: 20261004_344-loai-container-dropdown-mispositioned (P2, khách báo lần 2 — hiểu nhầm "gõ không gợi ý")
- Environment: staging vantai.tingting.vip (QA build 813a2b0d); local dev cho red-first unit
- Account: thanhdc / Abc123 (Khách hàng)
- mutates: none (form nhập nháp, không submit)

## Repro (pre-fix)
1. Đăng nhập thanhdc, vào /shipments/new.
2. Bấm ô "Số container", TAB sang ô "Loại container", gõ "20".
3. Listbox (20DC, 20HC, 20OT, 20RF + "＋ Thêm loại") MỞ nhưng neo ~165–215px PHÍA TRÊN ô nhập, đè dòng "Loại hàng", ngay dưới header "Thông tin hàng".
4. Cuộn để header khuất → dropdown mở ra ngoài vùng nhìn → người dùng kết luận "gõ không gợi ý".

## Expected (post-fix)
- Listbox mở NGAY DƯỚI ô đang nhập (popoverTop ≥ inputBottom, data-placement="bottom"), bám trigger; khi cuộn ngoài menu đóng (RAC default) — không bao giờ "kẹt" một chỗ.
- Cùng hành vi ở mọi picker gợi ý trong form tạo lô (Tuyến/Cảng/Khách hàng/Hãng tàu/LCL) — lớp popoverPlacement="top" đã gỡ toàn bộ 9 site; prop API chết đã xóa (TS chặn tái nhập).

## Rungs
- UI DRIVEN: red trên staging e16ddebc (data-placement="top", mép trên menu cách ô 187px — khớp đo của khách) → green trên a5a5f82c/813a2b0d (placement="bottom", 11px dưới ô, 5 options). Matrix 1280/1440/1920/2560 × FCL+LCL: menuPlacement=bottom cả 4 width.
- TEST VERIFIED: ContainerTypeCellPicker.test.tsx placement pin (red-first: Received "top") + combobox.test.tsx house-default pin; consumers 142/142.

## Status
- [x] staging matrix rung executed (lead) — 04/10, build 813a2b0d
