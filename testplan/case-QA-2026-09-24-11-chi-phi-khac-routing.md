# Case QA-2026-09-24-11 — Bảng 2.2 routing columns + bảng kê note (card `20260922_64` Phase B)

- **Case ID:** QA-2026-09-24-11
- **Reported:** 2026-09-24, card `20260922_64` (docx nghiệm thu chi phí PHẦN 6-related; PM Q9 rulings
  chốt defaults TẠM sửa được, Kiểm hóa/đặc thù null = manual per-lot; A2 rename DEDICATED_DEPOT).
- **Verbatim requirement (customer):** *"Ở PHẦN CHI PHÍ KHÁC, CÓ THỂ SỬA HOẶC TỰ ĐỘNG ĐIỀN THÊM - TÊN
  CHI PHÍ PHÁT SINH ĐƯỢC NOTE VÀO MỤC GHI CHÚ Ở BẢNG KÊ (TRỪ CHI PHÍ HẢI QUAN GIÁM SÁT, LẠCH HUYỆN -
  đã vào cột có tên tương ứng)"*.
- **Surface:** Chi phí - Quyết toán L2 (`ShipmentDebitWorkspace` → Bảng 2.2 ChiHoTable + Bảng 2.3
  PayablesTable Ghi chú). Column headers = the customer's own catalog fee names, verbatim data.
- **Mutation surface:** mutates via the existing draft-save path only — single named-fee amount edit +
  save on the fixture lot; declare per-run: "mutates: 1 fixture row via Lưu điều chỉnh".
- **Status:** case PREPARED — code landed (Phase A `8fb54074`, A2 `077355b6`, B1 `c4ecda9d`, B2 <sha>),
  UI DRIVEN rung owed at wave cut.

## Steps

1. Fresh census (DB reseeded mid-wave — trust nothing): pick the fixture CUSTOMER with an active
   quotation frame carrying the 10-row catalog (seed-quotation-fixtures; LONG MINH / LOG COM).
2. Login `ketoan`/Abc123 (or CUS account per testaccounts) → Chi phí - Quyết toán.
3. Select the fixture customer + delivery range; open the lot's L2 workspace.
4. Bảng 2.2: dedicated columns exist — header verbatim "Hải quan giám sát" / "Nâng/Hạ Lạch Huyện"
   (data-driven, never '—' placeholder for cataloged customers).
5. Add/name a fee on the container row matching a dedicated catalog name → it lands in that column;
   add "Phí mở tờ khai" → stays in Phí khác.
6. Bảng 2.3 Ghi chú: after save, the container's note shows "Phí khác: …" with the fee names in
   stored order appended to any user note ("Chưa có hóa đơn · Phí khác: …").
7. F1 line (card 20260924_2): with excluded trips in scope, the red line "N chuyến chưa gán
   fulfillment — X ₫ chưa vào chốt" renders above the L1 table; hidden at zero.
8. Full-page state matrix 1280/1440/1920/2560 + 390 mobile of the L2 workspace with dedicated
   columns + note; L1 with + without the shadow line.

## Expected behavior

| # | Expectation |
|---|---|
| 1 | Dedicated headers = catalog feeName verbatim (port-names-are-data; A2 key DEDICATED_DEPOT travels opaque). |
| 2 | Hải quan giám sát fees never appear in Phí khác (AC2); depot fees in their own column (AC3). |
| 3 | Remaining fee names surface in Bảng 2.3 Ghi chú, stored order, user note authoritative (AC4). |
| 4 | No catalog (customer without frame fees) → NO dedicated columns — prior contract intact. |
| 5 | Null amounts render 'Chưa xác định'/'—', never 0; text-only cells; VN-first; 44px mobile. |
| 6 | F1 line hidden at excludedCount === 0 (card _2 AC4 never-zero-render). |
