# SIL-621 (id 725) — Popup «Sửa cước thu khách» (lô lẻ): 2 đoạn text hướng dẫn dài

## Case ID
SIL-621-LCL-EDITOR-TEXTS

## Bug (owner 30/10, evidence sil-616-lcl-editor-texts.jpg)
Popup «Sửa cước thu khách» (ShipmentContainerLedger §4.1, surface Chi tiết lô
hàng /shipments-detail, cột THÔNG SỐ CONTAINER, dòng lô lẻ) hiển thị 2 đoạn
text hướng dẫn dài gây nhiễu:

1. «Lô đã thuộc nhóm gộp xe (ghép cước trả ĐVVC) — tách nhóm (Hủy ghép) trước
   khi sửa cước thu khách riêng cho lô này.» (hint khóa, lô trong nhóm ghép
   cước trả ĐVVC — `revOutputGroupLock` costGroupId branch)
2. «Nhập tay giá thỏa thuận — thắng giá tra bảng theo loại xe. Bỏ trống: tự tra
   bảng giá thu khách (KH × tuyến × loại xe).» (helpText ô giá)

## Ruling (owner 30/10)
- XOÁ CẢ HAI đoạn text. Popup còn lại CHỈ: Loại xe tính cước thu khách (select)
  · Giá cước thu khách ₫ (input) · Lưu/Hủy.
- GIỮ placeholder «Bỏ trống = tự tra bảng giá» (owner chỉ bảo 2 đoạn văn).
- GIỮ NGUYÊN hành vi khóa (lô thuộc nhóm ghép → editor disabled) — chỉ bỏ text.
- Grep toàn src: 0 hit còn sót 2 chuỗi.

## Fix
- `LotRevFactsEditor` (ShipmentContainerLedger.tsx): bỏ `hint={groupLock.hint}`
  và `helpText` — popup không render text hướng dẫn nào (cả AUTO hint).
- `revOutputGroupLock` (shipment-operations.ts): nhánh costGroupId trả
  `hint: null` (chuỗi dài bị xóa khỏi src — grep-zero); nhánh revGroupId giữ
  nguyên (chỉ strip debit còn render); unlocked giữ AUTO hint (dùng ở strip).
- `DebitLotLclFacts.tsx`: `hint={groupLock.hint ?? undefined}` (type `string |
  null`); helpText dạng NGẮN của strip không thuộc 2 chuỗi ruling → giữ nguyên.

## Repro / Expected
1. Mở /shipments-detail, tìm lô lẻ CHƯA ghép (vd SIL587-998894, id 669) → bấm
   «Sửa cước thu khách cho lô …».
   - EXPECT: popup CHỈ có select + ô giá (placeholder «Bỏ trống = tự tra bảng
     giá») + Lưu/Hủy. KHÔNG có text «Nhập tay giá thỏa thuận…», KHÔNG có
     «CƯỚC VẬN TẢI (AUTO) của lô…». Fields bật.
2. Lô trong nhóm ghép cước trả ĐVVC (vd R41B1-LCL01, id 184, «Ghép 2/2») → mở
   popup.
   - EXPECT: các field KHÓA (disabled) và KHÔNG có text «Lô đã thuộc nhóm gộp
     xe…» / «tách nhóm (Hủy ghép)…». Lưu disabled.
3. Lô trong nhóm ghép THU (revGroupId) → mở popup: KHÓA, không text (test pin
   `ShipmentContainerLedger.sil548-rev-facts.test.tsx`).
4. Grep `Lô đã thuộc nhóm gộp xe` + `Nhập tay giá thỏa thuận — thắng giá tra
   bảng theo loại xe. Bỏ trống: tự tra bảng giá thu khách (KH × tuyến × loại
   xe)` toàn src: 0 hit chuỗi đầy đủ (chỉ còn pin test âm + comment).

## Evidence (30/10/2026, local worktree stack fe :7180 / be :3010)
- `qa/2026-10-31_sil621_lcl-editor-ungrouped-1307.png` — case 1, 1307px.
- `qa/2026-10-31_sil621_lcl-editor-costlocked-1307.png` — case 2, 1307px.
- `qa/2026-10-31_sil621_lcl-editor-driver.log` — rung-3 driver JSONL, exit 0;
  cả 2 AC PASS (acNoTexts/acStructure/acLock).
- Driver: `testplan/qa/scripts/2026-10-31-sil621-lcl-editor-rung.mjs`.
