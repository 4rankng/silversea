# SIL-498 — Drawer Tổng quan: nhập Số tờ khai THEO TỪNG CONT + copy nhanh

- **Ticket:** SIL-498 (id 560, board SIL) — khách hàng 25/10: drawer chưa cho thêm số tờ khai sau khi SIL-485 thay body drawer bằng CusLotView read-only.
- **Branch:** `fix-drawer-tokhai-cont` (off main `7b7180fe`).
- **SPEC:** (1) mỗi dòng container trong drawer Thông tin hàng thêm ô nhập Số tờ khai inline; (2) nút copy ở dòng ĐẦU — set cùng tờ khai cho MỌI dòng TRỐNG, không ghi đè dòng có giá trị khác; (3) BE dùng sẵn `syncDeclarationOntoEmptyContainers` (SIL-166/173) — verify cả 2 đường tạo+sửa; (4) per-cont là luật.

## Case SIL498-R1 — Nhập tờ khai per-cont lưu đúng dòng

1. Mở `/shipments` (role CUS), bấm một lô FCL ≥ 2 cont → drawer Tổng quan.
2. Card **Thông tin hàng**: cột **Số tờ khai** hiện theo từng dòng (giá trị hiện có hoặc "—").
3. Nhập số tờ khai vào dòng cont 2 → Enter/blur.
4. **Expected:** toast "Đã lưu tờ khai…"; chi tiết reload; dòng 2 giữ số vừa nhập; dòng khác KHÔNG đổi (nếu đang có số khác).

## Case SIL498-R2 — Copy nhanh điền các dòng TRỐNG

1. Lô ≥ 2 cont, dòng đầu đã có tờ khai, còn dòng trống → nút **Copy tờ khai** ở dòng đầu (aria "Copy tờ khai cho các dòng dưới").
2. Bấm nút.
3. **Expected:** mọi dòng trống nhận số của dòng đầu; dòng đã có số KHÁC giữ nguyên; toast báo số cont đã copy; reload detail khớp DB.

## Case SIL498-R3 — Regression: lô nhiều tờ khai khác nhau

1. Lô 3 cont: cont A = TK-1, cont B = TK-2, cont C trống.
2. **Expected:** mỗi dòng hiển thị số riêng; sửa cont A sang TK-3 → cont C (trống) đi theo TK-3, cont B (diverge) giữ TK-2 (fan-out SIL-184: empty + số-cũ đi theo, diverge không đụng, clear local).

## Case SIL498-R4 — Gate hiển thị

- Role DISPATCHER / lô khóa kế toán (`activeLock`): ô nhập thay bằng text thường, không có nút copy (BE `fieldAccess.declarationNumber` = READ_ONLY).
- Nút copy chỉ ở dòng ĐẦU và chỉ khi dòng đầu ĐÃ LƯU số (draft chưa lưu không copy được — số copy là số persisted).

## Gates

- Scoped vitest BE (unit: `cus-container-declaration-copy`, rerun bộ tokhai) + FE (`CusLotView.declaration` + rerun scoped).
- FE tsc + BE tsc + root lint.
- Screenshots drawer 390 / 768 / 1440 + DOM assertion + DB side-effect proof.
