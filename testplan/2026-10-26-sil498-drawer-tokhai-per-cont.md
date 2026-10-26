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

## Case SIL498-R3 — Regression: lô nhiều tờ khai khác nhau (LUẬT MỚI 26/10 — SIL-498 QA lot 257)

1. Lô 3 cont: cont A = TK-1, cont B = TK-2, cont C trống.
2. **Expected:** mỗi dòng hiển thị số riêng; sửa cont A sang TK-3 → cont C (trống) đi theo TK-3, cont B (diverge) giữ TK-2, **cont giữ số cũ TK-1 cũng GIỮ NGUYÊN nếu nó không phải cont vừa sửa**.
- ⚠️ **Superseded 26/10 (SIL-498 QA fail, owner ruling):** luật cũ "empty + số-cũ đi theo" (SIL-184, card 261022095235a) bị THÁO nửa "số-cũ đi theo" — sau fan-out tạo lô, mọi dòng đều là bản copy của số đầu, nên kéo số-cũ đi theo = normalize LOT-WIDE ở mỗi lần sửa (QA lot 257: sửa dòng 3 = TK3 → cả 3 dòng thành TK3; không bao giờ tạo được lô 2 tờ khai khác nhau). Luật mới: fan-out trên SỬA per-cont **chỉ điền dòng TRỐNG**; sibling giữ BẤT KỲ số nào — kể cả số cũ của dòng vừa sửa — giữ nguyên; clear vẫn local.

## Case SIL498-R5 — Lot-257 repro (API, luật mới)

1. Tạo lô 3 cont với tờ khai TK1 → cả 3 dòng TK1 (normalize-all ở TẠO là ĐÚNG).
2. Sửa dòng 3 → TK3 (drawer / detail cell / API cùng endpoint `POST /shipments/cus-workspace/:id/containers/:containerId`).
3. **Expected:** chỉ dòng 3 = TK3; dòng 1-2 giữ TK1 (không có declarationSync siblings); lô 2 số khác nhau tồn tại được.
4. Clear dòng 2 (local) → sửa dòng 1 TK1→TK5 → **Expected:** dòng trống đi theo TK5 (fill-trống), dòng TK3 (diverge) giữ TK3.
- Bằng chứng rung 2: qa/2026-10-26-sil498-502-tokhai/be498-create.json (bug trên code main: cả 3 dòng thành TK3), be498b-create/-edit-newcode.json + DB proof (code fix: 368=TK5, 369=TK5 (fill trống), 370=TK3 (giữ nguyên)).

## Case SIL498-R4 — Gate hiển thị

- Role DISPATCHER / lô khóa kế toán (`activeLock`): ô nhập thay bằng text thường, không có nút copy (BE `fieldAccess.declarationNumber` = READ_ONLY).
- Nút copy chỉ ở dòng ĐẦU và chỉ khi dòng đầu ĐÃ LƯU số (draft chưa lưu không copy được — số copy là số persisted).

## Gates

- Scoped vitest BE (unit: `cus-container-declaration-copy`, rerun bộ tokhai) + FE (`CusLotView.declaration` + rerun scoped).
- FE tsc + BE tsc + root lint.
- Screenshots drawer 390 / 768 / 1440 + DOM assertion + DB side-effect proof.
