# Card FB-109 — Tờ khai inline thêm/sửa: auto-copy + persist

- Card: `171026122100-fb109-to-khai-inline-them-sua-auto-copy.docx`
- Scope: popup "Chỉnh sửa chứng từ và hãng tàu" (CUS Chi tiết lô, nhiều
  container) — ô Số tờ khai, nút Lưu, luồng API `saveDocuments`.

## Design (ghi chú trong popup)

"số đầu tiên của lô được tự copy sang các cont còn trống, cont đã có số không
bị ghi đè; reload trang vẫn còn số."

## Case FB-109-01 — Lưu persist số tờ khai (reload trang vẫn còn số)

Reproduction:

1. Lô nhiều container; mở popup chứng từ trên một cont, nhập Số tờ khai.
2. Bấm Lưu.
3. Reload trang / refetch workspace.

Expected: số tờ khai vẫn còn trên cont đã lưu (persist xuống DB, không phải
client-only state). Submit path: FE `useCusDetail.saveDocuments` →
`updateCusShipmentContainerLine` (per-cont, card 261013200312) → BE
`cus-shipment-workspace-writes.service` ghi `shipmentContainers.declarationNumber`.

## Case FB-109-02 — auto-copy sang cont còn trống; cont đã có số không bị ghi đè

Reproduction:

1. Lô có cont A ĐÃ có số tờ khai, cont B và cont C còn trống.
2. Lưu số tờ khai mới trên cont B qua popup.
3. Kiểm tra cả lô sau khi lưu.

Expected (một transaction):

- cont B (đang lưu) và cont C (còn trống) cùng mang số mới;
- cont A (đã có số) GIỮ NGUYÊN số cũ — không bị ghi đè;
- số đã lưu sống sót qua reload (đọc lại từ DB);
- version của lô tăng đúng 1 lần.

Note: law 171026180010 ("sync every sibling") được thu hẹp về auto-copy
"chỉ cont còn trống" theo đúng design note của card FB-109 ở trên; nút copy
explicit (`copyCusShipmentContainerDeclaration`) giữ nguyên luật never-overwrite.

## Evidence

- BE test: `backend/src/tests/shipment-declaration-container.test.ts`
  → `FB-109 — copy tờ khai của một container sang các container còn trống`
  (R1/R3/R4) + SYNC-02 (đổi kỳ vọng theo never-overwrite);
  `FB-110 R1/R2` pin persist path.
- FE wire test: `frontend/src/features/shipments/cus/use-cus-detail.declarations.test.tsx`.
