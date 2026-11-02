# SIL-659 (id 766) — dialog «Chỉnh sửa chứng từ và hãng tàu» thêm trường Số cont

- **Ngày báo cáo:** 02/11/2026 · **Ngày fix:** 03/11/2026
- **Mức:** Feature bổ sung (CRUD thiếu trường)

## Hiện trạng
Dialog mở bằng click ô Bill/Booking (Chi tiết lô hàng) chỉ có 4 trường: Số Bill/Booking, Số tờ khai, Nhập/Xuất, Hãng tàu. Số cont chỉ hiện ở tiêu đề (VD `MNBU0006620`) — không có ô nhập.

## Mong đợi
- Thêm ô nhập «Số cont», nhập và lưu được.
- **CHỈ bổ sung** — giữ nguyên cách sửa số cont từ ô container như cũ.
- Số cont nhập từ dialog phải lưu và **đồng bộ như khi sửa từ ô số cont** (SIL-653: CUS/điều vận/lái xe thấy cùng một số), không lệch bản ghi.

## Ràng buộc đã án (đ check)
- Đường ghi đi qua **cùng một update path** với ô số container: `updateCusShipmentContainerLine` — normalize + in-lot duplicate + SIL-653 identity bridge server-side (BE không đổi).
- Lock law giữ nguyên: `fieldAccess.containerNumber` READ_ONLY ⇒ ô disabled kèm reason (không sửa được số sau khi khóa kế toán).
- DESIGN LOCK (comment id 3517 trên ticket): field CUỐI form sau Hãng tàu — giữ nguyên thứ tự 4 trường FB-113.

## Regression case (đã pin)
- Vitest dialog: `frontend/src/features/shipments/detail/ShipmentContainerLedger.sil659-docs-cont.test.tsx` — 5 tests (field cuối form/seed/uppercase; draft mang số; ISO hint + 1-chạm sửa; READ_ONLY disabled + reason; lot-level row không có field).
- Vitest wire: `frontend/src/features/shipments/cus/use-cus-detail.sil659-container-number.test.tsx` — 7 tests (cont-only bỏ PATCH; echo không gọi; chung 1 command với tờ khai; PATCH-then-line đúng version; clear ghi null; READ_ONLY bỏ write; lot row không bao giờ mang số).
- UI drive (rung 3): `qa/scripts/2026-11-03-sil658-659-ui.mjs` — PASS trên lô 761/cont 842, có DB side-effect proof + restore số gốc; artifacts `qa/2026-11-03-sil658-659/`.

## Expected behavior sau fix
1. Dialog có ô «Số cont» cuối form; nhập → Lưu → số hiện ở ô THÔNG SỐ CONTAINER của dòng + CUS thấy ngay trong read model.
2. Gõ sai ISO 6346 → hint cảnh báo + nút «Đổi thành …» (giống ô container).
3. Lô đã khóa kế toán ⇒ ô disabled + lý do.
4. Số chưa hợp lệ/trùng trong lô ⇒ 400/409 với thông báo rõ, hiện inline trong dialog (không im lặng).
5. Lot-level (lô lẻ không cont) ⇒ không render ô này.
