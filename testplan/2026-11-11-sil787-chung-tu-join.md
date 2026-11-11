# Card SIL-787 — Hồi quy: cột CHỨNG TỪ trên /shipments nối số tờ khai bằng ', '

Ngày: 2026-11-11 · Ticket SIL-787 (id 913, low) · KB Ch3 §3.4.4

## Lỗi
Cột CHỨNG TỪ trên Tổng quan lô hàng (/shipments) render từng số tờ khai trên
dòng riêng (law SIL-532 cũ) thay vì nối bằng ", " như KB quy định. Ví dụ lô 164:
"TVU-BK1 / TVF687336 / TVUDECL01" thành 3 dòng thay vì một dòng
"TVU-BK1, TVF687336, TVUDECL01".

## Kỳ vọng
- Ô Chứng từ hiển thị TẤT CẢ số tờ khai nối bằng ", " — cùng chuỗi với cột
  CHỨNG TỪ trong sheet XLSX (cusExport.ts đã join ', ' từ card 262 AC3).
- Không truncate: chuỗi dài wrap nguyên vẹn (overflow-wrap), không cắt.
- Lô không số tờ khai vẫn hiện nhãn "Chưa có tờ khai".

## Rủi ro hồi quy

| # | Khu vực | Rủi ro | Kiểm |
|---|---|---|---|
| R1 | CusShipmentRow documents cell | đổi nhầm cell khác (debit/detail dùng badge riêng) | test chỉ trỏ `td[data-label="Chứng từ"]` trên /shipments |
| R2 | Fallback declarationNumber lẻ (wire cũ) | mất nhánh legacy | test giữ case union absent |
| R3 | Card mode ≤999px (mobile) | cell vẫn render đủ số, không mất dữ liệu | textContent chứa cả 3 số |
| R4 | XLSX export | không đổi (đã join ', ') | cusExport.test.ts giữ xanh |

## Kiểm chứng
- `frontend/src/features/shipments/cus/CusShipmentRow.cus-cards.test.tsx`
  (SIL-502 suite) — cập nhật pin SIL-532 → SIL-787.
- `frontend/src/pages/ShipmentsPage.test.tsx` — case SIL-532 tương tự.
