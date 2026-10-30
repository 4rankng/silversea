# SIL-709 — Popup "Gán xe nhóm": dedup text, nhãn ngắn, một ghi chú luật cước

- Ticket: SIL-709 (board SIL, id 709) — BUG text/label trong popup Gán xe nhóm
  (Điều vận gán xe cho nhóm lô lẻ, ví dụ Lô 1 R42RV-D1 + Lô 2 R42RV-D2).
- Surface: `AssignTruckGroupDialog` (Kế hoạch Chi tiết Xe + Kế hoạch Tổng quát
  qua cùng dialog), vai Điều vận.
- Liên quan nhưng KHÔNG trùng scope: SIL-545 (nguồn xe theo Loại xe),
  SIL-537/492 (khía cạnh khác cùng popup) — ticket này chỉ sửa lớp text/bố cục.

## Repro

1. Gộp 2 lô lẻ thành một nhóm (vai Điều vận).
2. Mở popup "Gán xe nhóm" cho nhóm đó.
3. Quan sát text/bố cục popup.

## Hiện tượng (trước fix)

1. Luật "Lô 1 giữ 100% cước trả ĐV, các lô còn lại 0₫" lặp ≥3 chỗ trong popup:
   subtitle ("N lô lẻ · Lô 1 giữ 100%…"), tooltip `<ol>` ("…(giữ 100% cước)"),
   helpText ô "Cước trả ĐV Lô 1" (cả đoạn văn) — plus toast lặp lại luật đầy đủ.
2. Đoạn helpText dưới ô cước là một đoạn văn hướng dẫn (vi phạm design law §8
   "No lecturing copy").
3. Nhãn dài/wordy: "BKS thực (xe chạy chuyến)", hint nguồn xe lặp lại chính
   placeholder ("— chọn Đội xe nội bộ SilverSea hoặc Nhà xe"), warning reset dài.
4. `<ol>` không style → marker "1." + prefix "Lô 1 ·" đánh số trùng; rhythm
   các block không đồng nhất (không grid/gap) — "một mớ text".

## Case pin (expected sau fix)

1. Luật cước nói ĐÚNG MỘT LẦN trong popup dưới dạng ghi chú nhỏ (caption 11px)
   NGAY DƯỚI ô "Cước trả ĐV Lô 1" (webchat deepseek 2nd opinion 30/10 verdict
   1): "Lô 1 (theo thứ tự chọn) giữ 100% cước trả ĐV · các lô còn lại 0₫" —
   gloss "(theo thứ tự chọn)" trả lại thông tin thứ tự bị mất khi bỏ tooltip
   (uiux audit LOW, 30/10). Không nơi nào khác trong popup nhắc lại (subtitle =
   "N lô lẻ"; không tooltip; không helpText).
2. Không còn đoạn văn dưới ô "Cước trả ĐV Lô 1" — placeholder "Bỏ trống = tự
   tra bảng giá" giữ nguyên (house convention chung các surface cước).
3. Nhãn ngắn: "BKS thực" (bỏ gloss "(xe chạy chuyến)") — đúng tên fact theo
   lclspec; các nhãn contract "Loại xe tính cước trả ĐV" / "Nhà xe" / "Cước
   trả ĐV Lô 1 (đ)" giữ nguyên (lclspec/SIL-537 wording, pin test sẵn có).
4. Hint nguồn xe 1 dòng ngắn: "100% xe ngoài — chỉ lấy BKS từ nhà xe." /
   "Xe nội bộ hoặc xe ngoài."; warning FB-138 giữ substring pin
   "đã bỏ lựa chọn Đội xe nội bộ", bỏ tail "(xe ngoài)".
5. `<ol>` bỏ marker (mỗi lô chỉ hiện "Lô N · <Bill/Booking> — <KH>" một lần),
   body là grid rhythm đồng nhất; toast success chỉ còn outcome
   ("… — Lô 1 (<ref>) giữ 100% cước trả ĐV.").
6. Sibling sweep cùng defect class (label "BKS thực (xe chạy chuyến)" là shared
   copy bị 3 surface ĐV reuse verbatim): `LclGroupTruckEditDialog`,
   `DispatchAllocationLclDialog`, lỗi `Nhập BKS thực của xe chạy chuyến` ở
   `DetailedPlanGrid` → cùng rút về "BKS thực" / "Nhập BKS thực". Không đụng
   CUS "Gộp xe thu khách" (MergeRevGroupDialog — popup khác, wording thu khách).
7. Hành vi/payload không đổi: 4 field theo spec 23/10 §3, assignLclCostGroup
   payload y hệt (test hiện có giữ nguyên).
