# SIL-588/589/590/591/592/593 — dispatch-detail: THAO TÁC hẹp + PHÂN LOẠI vỡ + dialog dense + cột Số tờ khai (regression cases)

Case IDs: REG-SIL588-ACTIONS-STACK · REG-SIL589-CLASSIFICATION-TAG · REG-SIL590-EDIT-DIALOG-DENSE · REG-SIL591-DECLARATION-COLUMN · REG-SIL592-GOP-HANG-ICON
Opened: 2026-10-27 · Board: SIL-588..593 (board ids 588..593, seq 525..530) · Lane: fix-588-593-dispatchcols

## Surface

`/dispatch-detail` (Kế hoạch Chi tiết Xe) — `DetailedPlanGrid` bảng chính; dialog
"Chỉnh sửa điều phối" (`DispatchPlanEditorCell`); toolbar lô `/dispatch`
(`MasterPlanPage` qua `LclMergeModeToggle` dùng chung).

## REG-SIL588 — cột THAO TÁC rộng, nút ngang hàng (SIL-588)

Repro: mở /dispatch-detail, nhìn cột THAO TÁC. Trước fix: "Hoàn thành" pill +
⋯ đứng NGANG một hàng (hoặc send + ⋯), cột chiếm 10.75% (~144px) chỉ để chứa 2
nút nhỏ. Expected (owner): cột hẹp; nút XẾP DỌC — send trên, ⋯ dưới; "Hoàn
thành" là ITEM trong menu ⋯ (menu đã có sẵn item này — card 3-dòng) thay vì
pill riêng. Nút nào vẫn nằm trong cell của nó (không đè Ghi chú).

## REG-SIL589 — pill "Lẻ · Ghép (n/2)" oval tràn cột (SIL-589)

Repro: /dispatch-detail, grouped Lẻ rows (KCN ĐỒNG VĂN 19C-888.99 Ghép 1/2,
2/2; KCN QUẾ VÕ 15C-222.22 Ghép 2/2). Trước fix: nhãn "Lẻ" lặp 2 lần trong
cell (span phân loại + prefix trong pill), pill oval `border-radius:999px` +
nền + viền wrap chữ DỌC 3 dòng ("Lẻ ·"/"Ghép"/"(1/2)"), tràn sang ĐIỀU PHỐI/
GHI CHÚ; header PHÂN LOẠI vỡ 2 dòng. Expected: nhãn đơn nhất không lặp
"Lẻ", tag compact chữ ngang gọn trong cột (§1 text-only — pill bị cấm cho
VALUE), header PHÂN LOẠI một dòng.

## REG-SIL590 — dialog "Chỉnh sửa điều phối" thưa (SIL-590)

Repro: mở Sửa điều phối cho lô (VD R42RV-02). Trước fix: Phân loại một mình
một hàng (checkbox Đóng kết hợp chỉ có trên FCL), Cước thu/Cước trả mỗi ô
rộng ~½ dialog (~470px) dù tiền không cần rộng. Expected (owner): Phân loại +
Cước thu dự kiến CÙNG một hàng; ô tiền hẹp theo nội dung (~200px); dialog giữ
width ~1000px của SIL-520 (không đổi width, chỉ density).

## REG-SIL591 — thiếu cột Số tờ khai (SIL-591 + SIL-593)

Repro: /dispatch-detail — bảng không có cột SỐ TỜ KHAI; tờ khai không xem/sửa
được từ bảng. Expected: thêm cột SỐ TỜ KHAI theo model per-container SIL-521:
- FCL: số tờ khai CỦA container đó (`shipment_containers.declaration_number`,
  đọc mới từ BE — trước fix payload chỉ mang list cấp lô từ entity
  `shipment_declarations`, thiếu giá trị ghi per-cont).
- LCL: list tờ khai cấp lô (read-only — lô lẻ không có container; sửa cấp lô
  đã có ở CusLotView/ledger/quick-edit).
- Click-to-edit FCL cho CUS/Quản trị/Quản lý (luật 261013200312: DISPATCHER
  bị cấm sửa tờ khai — cell để text tĩnh, không affordance); Enter lưu,
  Escape hồi; FB-109 auto-copy chạy server-side; 409 trùng lô khác báo đúng
  lý do.
SIL-593 (TẤT CẢ bảng liệt kê container theo dòng): audit các bảng container
row-by-row — ShipmentContainerLedger (/shipments-detail) ✓ có sẵn, CusLotView
(/shipments/:id) ✓ có sẵn, ShipmentQuickEditModal ✓ có sẵn, form TẠO lô bị
owner pin KHÔNG có tờ khai (SIL-521/522) → bảng còn thiếu duy nhất là
dispatch-detail, nên T4+T6 chung một commit.

## REG-SIL592 — nút "Gộp hàng" dùng emoji 📦 (SIL-592)

Repro: toolbar /dispatch (và /dispatch-detail filter strip — cùng component
`LclMergeModeToggle`): nút "📦 Gộp hàng" dùng emoji thay icon. Expected: icon
vector chuẩn — `Layers` (lucide), theo đúng tiền lệ /shipments-debit 23/10
("Gộp hàng — layers icon, never an emoji"); trạng thái active "✕ Thoát gộp
hàng" cũng đổi sang icon `X`.

## Doctrine

Không truncate (wrap full — SIL-515 law), không overlap, sage nền (SIL-523).
Mọi nút ≤40px desktop; touch floor giữ nguyên law GP-06 cho card.
