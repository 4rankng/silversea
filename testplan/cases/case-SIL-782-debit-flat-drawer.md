# SIL-782 (id 905) — Màn Chi tiết Debit CUS: danh sách phẳng + drawer Chốt giá bán, giấu 100% giá vốn

- Ticket: SIL-782 (board SIL, id 905; tiếp nhận phạm vi từ SIL-776 — bị CANCELED
  khi REV2 đảo thiết kế 2 lớp; owner steer 09/11/2026).
- Nguồn: 2026.11.09.Ticket.docx REV2 `/tmp/ticket-v2.txt` Phần VI mục 2 —
  "Đồng bộ hoàn toàn với kiến trúc Danh sách phẳng + Ngăn trượt (Drawer) đã
  chốt (KHÔNG dùng bảng 2 lớp xổ xuống Expandable Row)".
- Design consult (webchat gemini 09/11): "Dual-Input" = mỗi dòng phí 2 ô
  [Thực chi Ops khai][Giá chốt thu khách]; giá vốn nền/cước trả hãng ẩn 100%.

## Cấu trúc REV2 (màn /shipments-debit)

1. **Bảng phẳng** — các cột gộp multi-line: Thông tin lô & khách (Số
   Bill/Booking + chứng từ badge · tờ khai copy · nhà máy/tuyến) | Cước vận
   tải (Auto) | Tổng Chi hộ (Có HĐ) | Tổng Dịch vụ (Không HĐ) | TỔNG PHẢI THU
   KHÁCH | Trạng thái. TUYỆT ĐỐI ẨN Cước trả Vendor / Tổng chi phí đầu vào /
   Biên lợi nhuận với CUS — server strip (`viewerRole` CUS) + FE không render.
   Hai cột bán mới bảo toàn tổng: chiHoSellTotal + serviceSellTotal +
   freightAuto = receivableTotal (knowns-sum; null = chưa xác định).
2. **Drawer Chốt giá bán** — click lô mở drawer phải: khối Phí Có HĐ
   read-only; khối Phí Không HĐ dual-input [Thực chi Ops 🔒 | Thu Khách Hàng
   ✏️ CUS điền]; [+ Thêm chi phí]; [Điều chỉnh cước]; [Khóa Lô] hard-lock
   (đóng băng ô nhập để xuất Debit Note). Không có bảng payables trên drawer
   (chi hộ trả nằm ở Bảng Kiểm soát lô hàng — chot-debit).

## Case pin (expected)

1. Bảng phẳng hiển thị 4 cột tiền doanh thu; KHÔNG có cột/nhãn giá vốn nào
   (Cước trả (₫)/Chi nội địa (₫)/Tổng chi (₫)/LN gộp (₫) đã retirement).
2. Wire CUS: `payableTotal`/`profit`/`carrierCostTotal`/`opsCostTotal` = null
   (server strip); KE toán vẫn nhận đủ (không strip).
3. Click lô → drawer Chốt giá bán: dual-input Phí khác [Thực chi Ops
   read-only | Thu khách hàng input]; Lưu điền sell qua `PUT /debit-edits`
   (edits[].sellAmount — không bao giờ buyAmount).
4. [Khóa Lô] hard-lock: mọi ô edit vô hiệu sau khóa; [Điều chỉnh cước] giữ
   nguyên luồng hiện có; [+ Thêm chi phí] thêm Phí khác.
5. Lô ghép (REV group): tag «Ghép thu cước cùng Lô 1» ride cột Cước vận tải;
   pending law giữ nguyên (freightAuto null → ô trống, không dựng 0).

## Regression evidence

- BE unit `shipment-debit-summary-sil782.test.ts` (cột bán + strip CUS
  + schema skew-safe) 3/3.
- FE pinned suites cập nhật theo REV2 (xóa pin hành vi đã retirement, giữ pin
  hành vi còn lại) — DebitTestSweep agent.
- UI DRIVEN hoangnh/hoapt (qa/2026-11-09_r9b-ops-debit/, drive
  `qa/scripts/r9b-ops-debit-drive.mjs`).
