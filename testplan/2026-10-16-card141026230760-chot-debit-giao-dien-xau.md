# Case FB-099 (card 141026230760) — Kế toán chốt debit: giao diện xấu, bảng quá rộng

Nguồn: `.backlog-cards/141026230760-ketoan-chot-debit-giao-dien-xau.docx`
(wave W1 2026-10-16) + hợp đồng `testplan/2026-10-14-cost-ux-accounting-five-features.md`
TC-COSTUX-05 ("chỉ chỉnh giao diện"). Môi trường gốc: staging, 14/10.

## Tái hiện (trước sửa)

/accounting/chot-debit: dòng PENDING ("Chờ xác nhận") trộn thẳng vào bảng
"Kế hoạch điều động tổng hợp" — không có vùng chờ xác nhận riêng; ba vùng
(tổng hợp / chờ xác nhận / tổng hợp công nợ) không tách bạch.

## Kỳ vọng (TC-COSTUX-05)

- Ba vùng rõ: tổng hợp (SummaryRail) / chờ xác nhận (dòng PENDING) / tổng hợp
  công nợ (các đợt chốt).
- Trạng thái trong ô bảng vẫn là chữ thuần + color-dot nhà (đã đúng sẵn).
- Không đổi logic nào: dữ liệu, nút, quyền, câu chữ nghiệp vụ giữ nguyên.

## Trạng thái — FB-099 đã sửa

- Dòng PENDING chuyển sang vùng **"Chờ xác nhận"** riêng (heading + bảng cùng
  bộ cột với bảng tổng hợp — 1 component `DebitBoardTable` dùng chung cho cả hai
  vùng, không lo hai bảng lệch cột); bảng "Kế hoạch điều động tổng hợp" chỉ còn
  dòng không-PENDING. Điều khiển Xác nhận/Rút của dòng PENDING đi theo dòng.
- Bảng tổng hợp công nợ (các đợt chốt) giữ nguyên ở cuối — vùng 3.
- Không đổi dữ liệu/nút/quyền/câu chữ nghiệp vụ; cột "Thiếu …" (luật nhà: nêu
  đúng tên trường thiếu) và autoHideWhenEmpty giữ nguyên — chiều rộng bảng vẫn
  do ẩn cột trống + cuộn ngang kiểm soát.
