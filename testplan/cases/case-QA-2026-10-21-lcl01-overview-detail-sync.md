# Case QA-2026-10-21-lcl01-overview-detail-sync — lô LCL hiện Tổng quan nhưng mất ở Chi tiết

Card 211026132257 (lcl-01, PARTIAL từ trước — "detail sync chưa rõ").

## Trạng thái trước fix

Lô hàng LCL (lô lẻ, KHÔNG có container — chỉ kiện/bao bì/kg/CBM) hiển thị đủ
trên `/shipments` ("Tổng quan lô hàng") nhưng KHÔNG có trên `/shipments-detail`
("Chi tiết lô hàng"). Hai màn dùng 2 query khác nhau; filter/loại-hàng/join
nào đó làm rớt lô lẻ ở màn Chi tiết.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| LCL01-R1 | Tạo lô LCL LOCAL (không cont) | lô hiện ở TỔNG QUAN `/shipments` |
| LCL01-R2 | Mở CHI TIẾT `/shipments-detail` cùng filter | CÙNG lô lẻ hiện ở Chi tiết — không rớt |
| LCL01-R3 | So sánh API response 2 màn cho lô LCL | lô lẻ có mặt ở CẢ 2 payload; không màn nào filter theo cont |
| LCL01-R4 | Lô FCL có cont | 2 màn vẫn đồng bộ như trước (không regression) |
| LCL01-R5 | Test unit query/projection | pin: containerless LCL lot sống sót qua detail query |

## Verify (sẽ điền sau khi fix)

## Not covered

(điền sau)
