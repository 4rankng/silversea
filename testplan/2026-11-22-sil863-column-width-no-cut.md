# SIL-863 — Hồi quy: bảng bị cắt/cắt chữ ở 1440px (2 màn còn lỗi sau vòng QA 22/11)

Ngày: 2026-11-22 · Ticket SIL-863 (id 999) · Epic 5 Task 5.2 · QA build `061739f9`

## Phạm vi đã QA (22/11, build 061739f9)

QA đo 5 màn ở 1440x900 + 1920x1080, per-column `getBoundingClientRect` +
per-cell `scrollWidth` vs `clientWidth`.

**PASS**: % shares màn 1 đúng spec (14 / 9.5 / 9.5 / 5.5 / 7 / 11 / 11.5 / 12 / 10 / 10);
không tràn ngang ở cả 5 màn; màn 1 phủ kín 100% bề rộng ở 1920; số tờ khai 12 chữ số
hiện trọn; màn 2, 3, 5 sạch; màn 4 đủ 9 cột (kể cả TIẾN ĐỘ XỬ LÝ).

**FAIL — 2 lỗi, đều ở 1440x900**:

| # | Màn | Cột | Hiện trạng đo được | Kỳ vọng |
|---|---|---|---|---|
| R1 | `/shipments-detail` | Cột 4 NHẬP/XUẤT (63px) | pill "Nhập" vỡ thành "Nhậ"/"p", "Xuất" thành "Xuấ"/"t" — cắt ngang âm tiết | pill hiện trọn từ, không cắt âm tiết |
| R2 | `/accounting/invoice-tracking` | Cột 2 KHÁCH HÀNG & LÔ (328px) | "CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH" rớt chữ "MINH" lẻ xuống dòng 2 | tên hiển thị cân đối, không rớt chữ lẻ |

## Nguyên nhân gốc (đo trong browser, không phải đoán)

**R1 — chip vỡ âm tiết.** `.shipment-container-ledger__multiline > *` đặt
`overflow-wrap: anywhere` cho MỌI con, kể cả pill `.shipment-container-ledger__direction`.
Pill là nhãn cố định ("Nhập" / "Xuất" / "Nhập lẻ" / "Xuất lẻ"), không phải chữ
tự do — nên không được vỡ. Đo tại 1440x900: cell 63.7px, trigger padding 10px mỗi
bên → hộp chip chỉ còn 42.7px, trong khi "Nhập" tự nhiên rộng 46px →
`overflow-wrap: anywhere` cắt "Nhập" thành "Nhậ"/"p" (11/20 pill vỡ).
Biến thể dài nhất "Nhập lẻ" rộng 59.4px → vẫn phải xuống dòng, nhưng theo
ranh giới TỪ (chữ "lẻ" nguyên vẹn), không theo âm tiết.

**R2 — cột 2 hẹp hơn tên dài.** Tên dài nhất đo được local: 274.9px (Be Vietnam
Pro 600 12px) / 279.5px (Inter Digits) / 277.3px (system-ui). QA staging đo cột 2
= 328px ⇒ hộp nội dung 316px; tên ở đó rớt "MINH" lẻ ⇒ bản render staging rộng
hơn bản đo local ≥15% (font/scale staging khác local — local vẫn vừa khít).
Vì vậy sửa đúng phải có HAI đòn: (1) mở rộng cột 2 bằng slack thật đo được của
các cột khác (tổng "mỡ" header của 8 cột còn lại ~25px ⇒ "+20px" là trần của
bài toán), và (2) luật cân bằng dòng cho tên — đảm bảo tuy tên vẫn phải xuống
2 dòng thì dòng cuối không còn là một chữ lẻ.

## Kỳ vọng sửa

- R1: pill NHẬP/XUẤT hiện trọn ("Nhập" / "Xuất" 1 dòng; "Nhập lẻ" xuống dòng
  theo ranh giới từ, không vỡ âm tiết), không tràn ra cột kề, không phình
  chiều cao hàng.
- R2: cột 2 KHÁCH HÀNG & LÔ rộng thêm ~20px (floor 320 → 338px), được bù bằng
  slack thật đo được của các cột khác (cột tiền ở giữa trước) mà KHÔNG làm
  header cột nào tràn ra cột kề; tên dài hiển thị cân đối, không rớt chữ lẻ.
- Cả hai màn: bảng vẫn vừa khung 1440px (không cuộn ngang), 1920px+ vẫn
  phủ kín 100%.

## Rủi ro hồi quy

| # | Khu vực | Rủi ro | Kiểm |
|---|---|---|---|
| R1 | Chip NHẬP/XUẤT | chip tràn sang cột kề | đo `textRight ≤ cellRight` mọi pill + chip trong 20 dòng |
| R2 | Ladder cột 2 | header cột khác tràn | đo gap header→ mép ô ≥ 0 mọi cột (9 cột + 8 cột CUS) |
| R3 | Tổng bề ngang | bảng tràn khung 1440 | `docScrollWidth` = 1440, `tableScrollWidth ≤ wrapperWidth` |
| R4 | Ladder base | base > canvas 1129 → cuộn ngang | base ≤ 1129 |
| R5 | Ô nhập liệu | ô bị bóp, giá trị bị cắt | `scrollWidth ≤ clientWidth` mọi ô |

## Ladder đã chốt (đo trong browser, 1440×900, canvas 1129px)

Cột 2 chỉ nhận được slack thật của các cột khác — tổng "mỡ" header của 8 cột
còn lại là ~25px, nên "+20px" là trần của bài toán. Bài toán tối đa hoá hộp nội
dung cột 2 với ràng buộc cứng: mọi header giữ ≥2px tới mép ô, mọi atom nowrap
giữ ≥1px dư, base ≤ 1124px (còn ≥5px dưới canvas), tổng % chia hết 100.00.

| cột | floor cũ | floor mới | % cũ | % mới | gap header (đo) |
|---|---|---|---|---|---|
| Chọn dòng | 25 | 26 | 2.24 | 2.32 | — |
| STT | 38 | 35 | 3.40 | 3.12 | 2.8 |
| **KHÁCH HÀNG & LÔ** | **320** | **338** | 28.65 | 30.12 | 214.1 |
| Cont & Chứng từ | 132 | 130 | 11.82 | 11.59 | 2.8 |
| Đầu vào (Mua HĐ) | 135 | 132 | 12.09 | 11.76 | 2.0 |
| Đối soát số tiền | 127 | 125 | 11.37 | 11.14 | 2.4 |
| Chênh lệch | 94 | 91 | 8.42 | 8.11 | 2.0 |
| Ghi chú & ĐNTT | 116 | 114 | 10.38 | 10.16 | 2.4 |
| Tiến độ xử lý | 130 | 131 | 11.64 | 11.68 | 31.9 |

Base 1117 → **1122** (vẫn 7px dưới canvas 1129). Cột 2 đo được 323.4 → **340.1px**
(bảng kế toán, 9 cột) và 330.8 → **348.1px** (bảng CUS, 8 cột).

Ngoài độ rộng, tên khách hàng có LUẬT cân bằng dòng (`text-wrap: balance` +
`overflow-wrap: break-word`), đây mới là bảo đảm chữ lẻ không rơi xuống dòng 2:
ép cột 2 còn 16% để tên buộc phải xuống 2 dòng — có `balance`: 2 dòng 124.8 /
147.3px (cân); không `balance`: 171.1 / 101.1px (lệch, dòng cuối lơ lửng).

## Kiểm chứng

- `frontend/src/pages/ShipmentContainersPage.css` — pill NHẬP/XUẤT: gutter trong
  4px (đủ cho "Nhập" 32px trong hộp 43.7px) + luật bẻ từ (`break-word`).
- `frontend/src/pages/AccountingInvoiceTrackingPage.css` + `.tsx` — ladder mới
  (cột 2 320 → 338px, base 1122px) + luật cân bằng dòng cho tên.
- `frontend/src/pages/ShipmentContainersPage.no-truncation.styles.test.ts`,
  `frontend/src/pages/AccountingInvoiceTrackingPage.styles.test.ts` — pin luật mới.
- `qa/scripts/2026-11-22-sil863-verify.mjs` — driver đo 2 màn ở 1440 + 1920
  (2 bảng của màn 4) + phép chứng chống rơi chữ lẻ.
  Kết quả: `qa/2026-11-22_sil863-column-width/2026-11-22_sil863_verify.log`.
