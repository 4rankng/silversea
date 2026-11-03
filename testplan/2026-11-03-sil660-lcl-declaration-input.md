# SIL-660 (id 767) — Form tạo lô hàng lẻ: bổ sung ô nhập Số tờ khai

- **Ngày báo cáo:** 02/11/2026 (owner ruling verbatim) · **Ngày fix:** 03/11/2026
- **Mức:** Regression trường nhập bị mất (chức năng nhập liếuếu — khách không thể nhập tờ khai cho hàng lẻ)

## Hiện trạng (trước fix — tái hiện rung-3)
Tab HÀNG LẺ của form Tạo lô mất ô Số tờ khai hoàn toàn. Khách: "sáng tôi test ok mà sao
giờ lại mất trường nhập số tờ khai" + "nhập số tờ khai xong ra ngoài ko cập nhật vào lô hàng".

Nguyên nhân gốc: `0a20bd1c` (SIL-521, 27/10) gỡ ô tờ khai CẤP LÔ theo luật "số tờ khai chỉ
nhập/sửa per-cont". Tab LCL không có bảng container ⇒ từ đó hàng lẻ KHÔNG còn chỗ nhập tờ khai
nào. ("Sáng còn" = form mặc định mở tab FCL — cột per-cont có ở đó; không phải deploy.)

## Mong đợi (owner ruling 02/11)
- Tab HÀNG LẺ (create) có ô "Số tờ khai" cạnh nhóm Số lượng/Trọng lượng/Thể tích — 1 ô duy nhất
  cho cả lô (SIL-601: lẻ = 1 lô 1 cont).
- Nhập + lưu ⇒ giá trị persist vào entity `shipment_declarations` (đọc phía đã merge 2 store từ
  SIL-657 nên điều vận/trip/data-status/ledger thấy NGAY).
- Edit form prefill + sửa được; view mode hiển thị + disabled.
- FCL không đổi: per-cont column giữ nguyên (SIL-600/SIL-701).

## Ràng buộc đã án (đã check)
- Ruling 02/11 **CẬP NHẬT** luật SIL-600 ("ô tờ khai cấp lô bị cấm") cho RIÊNG hàng lẻ — cơ sở
  SIL-601. Không phải vi phạm SIL-600; pin sil502 đã cập nhật có ghi rõ lý do.
- Đường ghi: API entity `/shipments/:id/declarations` có sẵn (SIL-521 chỉ gỡ FE wiring) — POST
  create / PUT update rowId; root payload KHÔNG mang declarationNumber (SIL-521 giữ nguyên).
- Không sửa BE (entity API dùng nguyên trạng); không đụng trip-container-link/forwarder/
  trip-create services (SIL-644/655).

## Regression case (đã pin)
- Pin đỏ→xanh: `frontend/src/features/shipments/create/ShipmentCreateWorkspace.sil660-lcl-declaration.test.tsx`
  — 3 tests (ô tồn tại + nhập được trên LCL; Lưu nháp → POST declarations đúng số, root payload
  sạch; FCL không có ô cấp lô).
- Pin đơn vị: `shipment-create-model.test.ts` (buildShipmentDeclarationPayload LCL/FCL/blank),
  `shipment-edit-prefill.test.ts` (prefill + seed rowId, legacy multi-row), `use-shipment-create-workflow.test.tsx`
  (POST/PUT/no-write/FCL-never, edit seed rowId, clear → PUT null, re-save không duplicate).
- Pin cập nhật luật: `ShipmentCreateWorkspace.sil502-declaration-draft.test.tsx` (máy chip-strip
  SIL-502 vẫn chết; ô cấp lô chỉ tồn tại tab LCL) + header comment sil600.
- UI drive (rung 3): `qa/scripts/2026-11-03-sil660-lcl-declaration-ui-drive.mjs` (PHASE=before tái
  hiện defect; PHASE=after full create→DB→view→edit→PUT→ledger) + `qa/scripts/2026-11-03-sil660-390-sweep.mjs`
  (390px). Artifacts `qa/2026-11-03_sil660/`.

## Expected behavior sau fix
1. Tab HÀNG LẺ có ô Số tờ khai; nhập + Lưu ⇒ persist `shipment_declarations` (assert DB/API).
2. Edit: prefill đúng; sửa + Lưu ⇒ PUT cùng row (không sinh row trùng).
3. View mode: hiện giá trị, disabled.
4. Giá trị hiện ở ledger Chứng từ (Tổng quan) + các aggregate merge 2 store (SIL-657).
5. FCL per-cont không đổi; máy chip-strip cấp lô cũ vẫn chết.
6. Chuyển mode LCL→FCL xoá giá trị (mode-scoped), có confirm như các dữ liệu LCL khác.
