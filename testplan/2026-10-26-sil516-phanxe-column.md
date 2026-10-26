# SIL-516 — Chi tiết lô hàng: cột PHÂN XE quá hẹp (regression case)

Case ID: REG-SIL516-PHANXE
Opened: 2026-10-26 · Board: SIL-516 (id 578) · Lane: fix-516-phanxe-col

## Surface

`/shipments-detail` (Chi tiết lô hàng workboard) — `ShipmentContainerLedger`
table, cột PHÂN XE (`td[data-label="Phân xe"]`), editor BKS thực của một lô
hàng lẻ (lot-level row).

## Reproduction (card SIL-516)

1. Mở Chi tiết lô hàng, view Tháng 10/2026 (01/10–31/10).
2. Row: LOG COM / NEWEB-KHO 1 (KCN ĐỒNG VĂN, HÀ NAM), Bill UA1510005,
   NHẬP LẺ, 23/10/2026, "Chờ phân xe" (prod data; local repro dùng row
   tương đương R40B2-LCL03 — cùng khách/factory/ngày, cùng trạng thái).
3. Bấm "Nhập BKS thực" trong ô PHÂN XE.

## Actual (trước fix — đo local 2026-10-26, driver qa/2026-10-26_sil516-phanxe/)

1. Ô chọn BKS thực bị ép còn ~37px input → placeholder "Chọn hoặc nhập BKS"
   truncate thành "Chọn h…" (QA: "Chọn hc").
2. Helper "BKS thực là biển số xe chạy thực tế của lô." bị flex-footer kéo
   về min-content 1 ký tự (td `overflow-wrap: anywhere`) → wrap DỌC 1 ký tự/
   dòng, 33 dòng, cao ~607px.
3. Nút "Lưu" (`__edit-actions` flex 0 0 auto) tràn khỏi editor card và khỏi
   cell ~8.6px → đè mép cột PHÂN XE.
4. Header `table-sort-button` (nowrap, shared) tràn khỏi th cuối +3.6px →
   `region.scrollWidth (1133) > clientWidth (1129)` — horizontal overflow;
   ở geometry mép phải trùng viewport (màn QA) cột TRẠNG THÁI bị cắt.
   Header label dài ("KHÁCH HÀNG & LỘ TRÌNH") cũng tràn và bị th kế tiếp
   đè mất chữ.

## Expected (SIL-516)

1. Selector đủ rộng hiển thị FULL placeholder "Chọn hoặc nhập BKS".
2. Helper wrap ngang dòng bình thường (word boundaries).
3. Nút "Lưu" nằm gọn trong cell PHÂN XE.
4. Không cột nào bị cắt ở right edge — hết horizontal overflow.

## Doctrine (SIL-515, owner 26/10): không truncate, wrap full

Mọi text trong bảng wrap full — không ellipsis/clip/line-clamp trên data
cells (card 20260922_37 + `table-no-truncation.styles.test.ts`), header wrap
tại space (keep-all, balanced 2 dòng — card 20260925_47), không phần tử nào
tràn khỏi mép phải bảng.

## Verification

- `qa/2026-10-26_sil516-phanxe/drive.mjs` (before/after, 1440 + 390):
  placeholder fits, helper ≤3 dòng ngang, save button insideCell=true,
  region/table scrollW == clientW, doctrine scan 0 clipped.
- Scoped vitest + `tsgo --noEmit` + eslint files đụng.
