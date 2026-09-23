# Test plan nghiệm thu yêu cầu — Báo giá & Chi phí (2026-09-22)

**Nguồn yêu cầu:**
- `22.9 - BÁO GIÁ MẪU 1.xlsx` — sheet `BÁO GIÁ 1` (khách LONG MINH), sheet `LOG COM` (khách LOGCOM VIỆT NAM)
- `các chi phí.pdf` (khách gửi 2026-09-21) — 12 trang

**Mục tiêu:** mỗi yêu cầu của khách có ÍT NHẤT một ca kiểm thử. Người dùng hoặc agent chạy
theo danh sách này để trả lời được câu hỏi "yêu cầu đã làm chưa, làm đúng chưa".

**Môi trường:** local dev `http://localhost:7175`, API `:3002`, DB `:5441`.
**Tài khoản** (mật khẩu `Abc123`, roster đầy đủ ở `testplan/testaccounts.txt`):
`admin`, `thanhdc` (CUS), `dungnv` (Điều vận), `dvthuc` (Lái xe), `ketoan` (Kế toán).
**Thư mục bằng chứng:** `testplan/qa/evidence/2026-09-22_bao-gia-chi-phi/` (gitignored).

**Bậc bằng chứng** — mỗi ca ghi rõ một trong ba:
- `UI DRIVEN` — ảnh chụp ứng dụng chạy thật, thao tác chuột thật (không dùng `el.click()`).
- `TEST VERIFIED` — output test tự động, nêu số liệu thật.
- `DB·API VERIFIED` — transcript API hoặc truy vấn DB.

**Quy ước PASS/FAIL:** ca chỉ PASS khi bằng chứng cho thấy đúng kỳ vọng. Ảnh chụp mâu thuẫn
với lời kết luận = FAIL, bất kể chỉ số nào xanh.

---

## PHẦN 0 — Số liệu đối chứng (oracle) dùng chung

Mọi ca tính tiền ở Phần A đối chiếu với các số này. Đây là số LẤY TỪ FILE KHÁCH, không phải
số tự chế; sai một đồng là FAIL.

**Tham số đầu sheet:** Giá dầu tham chiếu `17.842,593` · Giá dầu theo thời điểm `29.940`
→ chênh lệch **`12.097,407` đ/lít**.

| Nhà máy (khách) | Km khứ hồi | Lít/chuyến theo hạng (1.25T / 2.5T / 3.5T / 5T / 8T / 10T / C20 / C40) |
|---|---|---|
| ASKEY (LONG MINH) | 200 | 20 / 26 / 26 / 30 / 40 / 48 / 64 / 70 |
| SUNRISE, SJ TECH, SCONECT (LONG MINH) | 240 | 24 / 31,2 / 31,2 / 36 / 48 / 57,6 / 76,8 / 84 |
| NEWEB (LOGCOM) | 260 | 26 / 33,8 / 33,8 / 39 / 52 / 62,4 / 83,2 / 91 |

Quan hệ bắt buộc đúng: **lít/chuyến = km khứ hồi × định mức lít/km**, với định mức
`1.25T=0,10 · 2.5T=0,13 · 3.5T=0,13 · 5T=0,15 · 8T=0,20 · 10T=0,24 · CONT20=0,32 · CONT40=0,35`.

**Phụ phí đối chứng (hệ số = 1):**

| Ô | Phép tính | Kỳ vọng |
|---|---|---|
| ASKEY Xe 1.25T | 12.097,407 × 20 | **241.948,14** |
| ASKEY Cont 20 | 12.097,407 × 64 | **774.234,048** |
| SUNRISE Xe 10T | 12.097,407 × 57,6 | **696.810,6432** |
| NEWEB Cont 40 | 12.097,407 × 91 | **1.100.864,037** |

**Giá cos đối chứng** (giá gốc × (1 + tỉ lệ chia sẻ của nhà máy)):

| Ô | Phép tính | Kỳ vọng |
|---|---|---|
| ASKEY Xe 1.25T | 1.200.000 × 1,04 | **1.248.000** |
| NEWEB Xe 1.25T | 1.300.000 × 1,02 | **1.326.000** |
| SUNRISE Xe 1.25T | 1.300.000 × 1,025 | **1.332.500** |

---

# PHẦN A — BÁO GIÁ (từ file xlsx)

Thẻ kanban tương ứng: `20260922_56` … `20260922_66`.

## A1. Mô hình dữ liệu và API báo giá — thẻ `_66`

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-BG-01` | Lưu rồi đọc lại phần đầu báo giá của 1 khách | Giữ đúng: tên mẫu, giá dầu tham chiếu, lag day, quy tắc làm tròn, ngày hiệu lực | DB·API |
| `TC-BG-02` | Lưới giá theo nhà máy × tuyến đường | Đủ 10 cột hạng (6 hàng lẻ + 4 container); mỗi ô giữ đủ Hệ số / Tổng lít dầu/chuyến / Giá cos | DB·API |
| `TC-BG-03` | Dựng báo giá cho LONG MINH (ASKEY, SUNRISE, SJ TECH, SCONECT) và LOGCOM (NEWEB) | Khớp file khách tới từng đồng — đối chiếu bảng oracle Phần 0 | DB·API |
| `TC-BG-04` | Tổng lít dầu/chuyến là số DẪN XUẤT | Bằng đúng km khứ hồi × định mức lít/km; kiểm 4 ô: ASKEY 1.25T=20, ASKEY C20=64, SUNRISE C40=84, NEWEB C20=83,2 | TEST |
| `TC-BG-05` | Hồi quy sau khi thêm lớp báo giá | Toàn bộ số tiền cước/phụ phí của dữ liệu LONG MINH hiện có KHÔNG đổi | TEST |

## A2. Màn hình Báo giá — thẻ `_56`

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-BG-06` | Chọn 1 khách, xem lưới giá | Đúng nhóm cột `HÀNG LẺ` và `HÀNG CONTAINER`, thứ tự và nhãn cột khớp file khách | UI |
| `TC-BG-07` | Sửa từng ô (Hệ số / lít / Giá cos) rồi tải lại trang | Giá trị mới còn nguyên sau reload | UI |
| `TC-BG-08` | Sửa phần đầu (giá dầu tham chiếu, lag day, làm tròn) | Lưu thành công, đọc lại đúng | UI |
| `TC-BG-09` | Bộ lọc khách hàng + từ ngày/đến ngày | Trả đúng tập báo giá | UI |
| `TC-BG-10` | Ma trận trạng thái toàn trang: 1280 / 1440 / 1920 / 2560 × (chưa chọn khách / có dữ liệu / lỗi) | Ảnh chụp TOÀN TRANG đủ 12 tổ hợp; không control nào bị xén ở mép | UI |
| `TC-BG-11` | Đối chiếu luật thiết kế `docs/design-guidelines.md` | Không pill, không icon trang trí trong ô dữ liệu, mật độ gọn | UI |

## A3. Tải lên / tải về xlsx — thẻ `_57`

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-BG-12` | Tải lên đúng file `22.9 - BÁO GIÁ MẪU 1.xlsx` | Tạo báo giá cho CẢ HAI khách trong file; số liệu khớp từng đồng | UI + DB·API |
| `TC-BG-13` | Nhận diện khách theo tên đầy đủ + MST (`2300540419` LONG MINH, `2300975219` LOGCOM) | Khớp đúng khách đã có; khách chưa có thì BÁO LỖI, KHÔNG tự tạo | UI |
| `TC-BG-14` | Nhà máy / tuyến đường không khớp danh mục | Báo rõ dòng nào lỗi; KHÔNG ghi nửa vời (nhập một phần rồi lỗi = FAIL) | UI |
| `TC-BG-15` | Xem trước ánh xạ trước khi ghi | Hiện bảng ánh xạ, cho huỷ trước khi ghi | UI |
| `TC-BG-16` | Tải về báo giá vừa nhập | Mở lại file khớp bố cục mẫu và đúng số liệu | UI |
| `TC-BG-17` | Tải lên lần thứ hai cho khách đã có báo giá | TẠO PHIÊN BẢN MỚI, bản cũ vẫn đọc được — KHÔNG ghi đè | DB·API |

## A4. Bốn hạng container theo trọng tải — thẻ `_58`

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-BG-18` | Danh mục hạng phương tiện | Có đủ 4 hạng container, nhãn tiếng Việt khớp file khách | DB·API |
| `TC-BG-19` | Lô Cont 20 trọng tải **18 tấn** | Lấy giá cột `Cont 20 <20t` | TEST |
| `TC-BG-20` | Cùng lô đổi thành **22 tấn** | Lấy giá cột `Cont 20 >20t` | TEST |
| `TC-BG-21` | Tương tự cho Cont 40 nhẹ / nặng | Chọn đúng cột theo trọng tải | TEST |
| `TC-BG-22` | **Biên đúng 20,0 tấn** | Xếp vào hạng **NẶNG** (quy tắc `>= 20` là nặng) — có test khoá hành vi | TEST |
| `TC-BG-23` | **Chưa nhập trọng tải** | **CHẶN** ra giá container, báo rõ "thiếu trọng tải"; KHÔNG mặc định hạng nhẹ | TEST + UI |
| `TC-BG-24` | Ô Giá cos hạng nặng **để trống** | **KHÔNG chặn** — kế thừa giá hạng nhẹ, giao diện đánh dấu rõ "kế thừa hạng nhẹ / giá tạm" | UI + TEST |
| `TC-BG-25` | Hồi quy giá container hiện hành sau migration | Tính ra đúng số tiền như trước | TEST |

> `TC-BG-23` và `TC-BG-24` là hai tình huống KHÁC NHAU, đừng gộp: thiếu trọng tải thì chặn,
> còn thiếu giá hạng nặng thì kế thừa. Ca nào xử sai thành ca kia = FAIL.

## A5. Hệ số nhân phụ phí — thẻ `_59`

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-BG-26` | Hệ số = 1 (mặc định) | Mọi số tiền GIỮ NGUYÊN so với trước khi có tính năng — test hồi quy trên dữ liệu LONG MINH | TEST |
| `TC-BG-27` | Bốn ô đối chứng ở hệ số 1 | Khớp bảng oracle Phần 0 tới từng đồng | TEST |
| `TC-BG-28` | Hệ số = 1,1 | Phụ phí nhân đúng 1,1; **Giá cos KHÔNG đổi** — khoá cả hai vế | TEST |
| `TC-BG-29` | Hệ số áp ở mức ô | Đổi hệ số một ô không ảnh hưởng ô khác cùng nhà máy | TEST |
| `TC-BG-30` | Lưu vết snapshot | Đọc lại thấy đủ: giá dầu kỳ, giá tham chiếu, lít/chuyến, hệ số, phụ phí | DB·API |

## A6. Quy tắc làm tròn phụ phí — thẻ `_60`

Ngữ nghĩa đã chốt: đúng hàm `ROUND` của Excel — **làm tròn nửa RA XA số 0**.

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-BG-31` | Ví dụ khách đưa, quy tắc 4 số | `823.250` → **`820.000`** | TEST |
| `TC-BG-32` | Ví dụ khách đưa, quy tắc 3 số | `823.250` → **`823.000`** | TEST |
| `TC-BG-33` | Mốc giữa (phân biệt nửa-lên với cắt cụt) | `825.000` quy tắc 4 số → **`830.000`** | TEST |
| `TC-BG-34` | Phạm vi áp dụng | CHỈ làm tròn phụ phí; **Giá cos không bị làm tròn** | TEST |
| `TC-BG-35` | Khách chưa cấu hình quy tắc | Hành vi xác định (không làm tròn hoặc chặn), có test khoá | TEST |
| `TC-BG-36` | Lưu vết | Snapshot giữ cả phụ phí thô và phụ phí sau làm tròn | DB·API |

## A7. Cảnh báo "ĐỒNG Ý CẬP NHẬT BÁO GIÁ" — thẻ `_61`

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-BG-37` | Kế toán nhập kỳ giá dầu mới | Hiện MỘT danh sách các khách bị ảnh hưởng, có tích chọn tất cả và tích từng dòng | UI |
| `TC-BG-38` | Chọn **Đồng ý** | Báo giá khách đó tính theo giá dầu mới — kiểm chứng phụ phí đổi đúng số | UI + TEST |
| `TC-BG-39` | Chọn **Không** | Báo giá giữ nguyên, phụ phí không đổi | UI |
| `TC-BG-40` | Chọn **Để sau** | Giữ giá cũ NHƯNG còn ở trạng thái chờ; tải lại trang vẫn thấy | UI |
| `TC-BG-41` | Vào lại tích Đồng ý sau khi đã "Để sau" | Giá nhảy đúng theo kỳ mới | UI |
| `TC-BG-42` | Lô phát sinh TRONG lúc chờ "Để sau" | **Giữ giá cũ, không hồi tố** (cước đã khoá tại Ngày vận chuyển) | TEST |
| `TC-BG-43` | Phân quyền | Vai trò Kế toán tích được Đồng ý | UI |

## A8. Lịch sử phiên bản báo giá — thẻ `_62`

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-BG-44` | Đổi giá dầu và đồng ý cập nhật | Sinh đúng MỘT phiên bản mới; bản cũ đọc lại nguyên vẹn | DB·API |
| `TC-BG-45` | Màn hình khi chưa lọc | Chỉ hiện bản MỚI NHẤT của mỗi khách | UI |
| `TC-BG-46` | Lọc theo khách + khoảng ngày | Liệt kê đủ các bản trong khoảng, sắp theo thời điểm | UI |
| `TC-BG-47` | Mở lại một bản cũ | Hiện đúng số liệu tại thời điểm đó (giá dầu, giá cos, phụ phí) | UI |
| `TC-BG-48` | Tải bản cũ về xlsx | Khớp số liệu của CHÍNH BẢN ĐÓ, không phải bản mới nhất | UI |

## A9. Phí Lạch Huyện — thẻ `_63`

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-BG-49` | Nâng Hateco (Lạch Huyện), hạ cảng NGOÀI Lạch Huyện | Cột Lạch Huyện = **1 ×** mức phí | TEST |
| `TC-BG-50` | Nâng Hateco, hạ **SITC - Lạch Huyện** | Cột Lạch Huyện = **2 ×** mức phí = **1.000.000** (đúng ví dụ khách đưa) | TEST |
| `TC-BG-51` | Cả nâng và hạ đều ngoài Lạch Huyện | Cột Lạch Huyện = **0** | TEST |
| `TC-BG-52` | Mức phí đọc từ cấu hình | Đổi cấu hình thì số tiền đổi theo; không cắm cứng `500000` trong mã | TEST |
| `TC-BG-53` | Danh mục cảng sau khi bổ sung | Tồn tại HAI bản ghi phân biệt: `Bãi SITC - Đình Vũ` (vùng Hải Phòng) và `SITC - Lạch Huyện` (vùng LACH_HUYEN) | DB·API |
| `TC-BG-54` | Bản ghi cũ không bị đổi vùng | `Bãi SITC - Đình Vũ` VẪN thuộc vùng Hải Phòng | DB·API |

## A10. Danh mục "Chi phí khác" của báo giá — thẻ `_64`

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-BG-55` | Danh mục đủ dòng theo file khách | Có: mở tờ khai (thông thường / đặc thù), hải quan giám sát (luồng xanh-vàng / luồng đỏ), nâng-hạ Lạch Huyện, lưu ca xe, soi chiếu (thủ tục soi / kéo cont đi soi), kiểm hóa, kẹp chì | UI |
| `TC-BG-56` | Phí **Hải quan giám sát** phát sinh trên lô | Vào **CỘT RIÊNG**, không gộp vào cột chi phí khác | UI + DB·API |
| `TC-BG-57` | Phí **Nâng/Hạ Lạch Huyện** | Vào **CỘT RIÊNG** | UI + DB·API |
| `TC-BG-58` | Các phí còn lại | Vào cột chi phí khác VÀ **tên phí xuất hiện trong ghi chú bảng kê** — kiểm trên bảng kê thật | UI |
| `TC-BG-59` | Mức tiền là giá trị mặc định sửa được | Sửa mức tiền cho 1 khách KHÔNG ảnh hưởng khách khác; không cắm cứng số trong mã | TEST |
| `TC-BG-60` | "Kiểm hóa" và "Mở tờ khai - hàng đặc thù" | Để trống mặc định, nhập tay được theo từng lô | UI |

---

# PHẦN B — CHI PHÍ (từ file pdf)

Phần lớn các yêu cầu này ĐÃ được triển khai ở các đợt trước. Các ca dưới đây là **kiểm tra
nghiệm thu** để trả lời "đã làm đúng chưa", không phải yêu cầu làm mới. Bốn lỗi đã phát hiện
nằm ở `testplan/2026-09-22-cac-chi-phi-audit-bugs.md` (`TC-CCP-01`…`TC-CCP-04`) — không lặp lại ở đây.

## B1. Phân loại chi phí OPS (pdf tr.1–2)

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-CP-01` | Phí chi hộ CÓ hóa đơn: nâng (vỏ/hàng/lưu bãi), hạ (vỏ/hàng/lưu vỏ/lưu bãi), phí khác | Mặc định là khoản THU ĐƯỢC của khách hàng | UI + DB·API |
| `TC-CP-02` | Phí KHÔNG hóa đơn | Có cặp **Thực chi / Thực thu** riêng cho phí giao nhận OP và phí phát sinh ops | UI |
| `TC-CP-03` | Phí không hóa đơn có thu khách | Ghi chú được lên bảng kế hoạch điều vận để kế toán/cus tính vào debit | UI |

## B2. Chi phí lái xe nhập (pdf tr.3)

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-CP-04` | Lái xe nhập phí nâng / phí hạ | Vào mục **phải thu khách hàng**, kèm số hóa đơn; kế toán tích xác nhận trên phơi phiếu | UI |
| `TC-CP-05` | Phí khác CÓ hóa đơn (vệ sinh, lưu bãi, lưu kho) | Vào phải thu khách hàng, mục phí khác có hóa đơn | UI |
| `TC-CP-06` | Phí khác KHÔNG hóa đơn (chi công nhân, hàn cont, cân lốp, đảo vỏ, đóng/trả 2 điểm, đảo hàng) | **KHÔNG thu khách**; kế toán tích xác nhận và thanh toán; tính vào doanh thu xe | UI + DB·API |
| `TC-CP-07` | Tiền đường | **KHÔNG thu khách**; vào danh mục tiền đi đường, thanh toán theo xe hàng tháng | UI |
| `TC-CP-08` | Định mức cố định | Nâng/hạ Lạch Huyện–TIL–Hateco `50.000`; trả đêm `100.000`; quay đầu `100.000`; quá tải `200.000`; đảo chuyển ICD/Đăng Khoa `200.000`; chủ nhật `200.000`; lưu ca `200.000`; cont 45'HC / cont lạnh `200.000` | Đọc từ cấu hình, sửa được | DB·API |
| `TC-CP-09` | Vé cầu đường | Lái xe nhập được; kế toán duyệt hoặc sửa số tiền | UI |

## B3. Phơi phiếu và quỹ (pdf tr.4–6)

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-CP-10` | Kế toán phơi phiếu xem danh sách xe | Chỉ thấy nhóm xe mình được phân công (phân chia 13/26 trên tổng 39 xe) | UI + DB·API |
| `TC-CP-11` | Hai nguồn quỹ | Có TK công ty (ACB) và TK tiền mặt (TM), phân biệt đúng khoản chi/thu của từng nguồn | UI |
| `TC-CP-12` | Bảng `QUẢN LÝ THANH TOÁN TẠM ỨNG` | Đủ cột theo mẫu; lọc theo ngày ĐNTT, nhân viên thanh toán, loại theo dõi, tiến độ TT | UI |
| `TC-CP-13` | Duyệt chi phí Ops | Tích **tất cả** hoặc tích **từng dòng** ở cột Ngày duyệt | UI |
| `TC-CP-14` | Sổ Quỹ tài khoản OPS sau khi duyệt | Số dư còn lại khớp với "Còn phải hoàn ứng" ở báo cáo tổng hợp | DB·API |
| `TC-CP-15` | `BÁO CÁO TỔNG HỢP HOÀN ỨNG` | `Còn phải hoàn ứng = Số tiền ĐNTT − Số tiền đã ứng`; dương thì công ty thanh toán, âm thì đòi hoàn lại | TEST + UI |
| `TC-CP-16` | Bảng `KIỂM SOÁT PHƠI PHIẾU - TIỀN ĐƯỜNG` | Đủ cột theo mẫu; có tổng theo bộ lọc | UI |
| `TC-CP-17` | Lập phiếu thu/chi | Tích tất cả hoặc từng dòng; chọn được STK; quỹ tự cộng/trừ tương ứng | UI + DB·API |
| `TC-CP-18` | Hộp thoại chi tiết Chi hộ | Đủ cột STT / Nội dung phí / Hoá đơn / Số tiền thu / Số tiền trả / Người thanh toán + dòng TỔNG CỘNG | UI |
| `TC-CP-19` | Ô tích "Thu và Trả phơi bằng nhau" | Tích vào thì số tiền trả khớp số tiền thu | UI |
| `TC-CP-20` | Sửa số tiền nhập sai trong hộp thoại chi tiết | Kế toán sửa được và lưu đúng | UI + DB·API |
| `TC-CP-21` | Cột "Người thanh toán" | Tự điền người đã tạo lệnh nâng/hạ (lái xe hoặc ops) | DB·API |
| `TC-CP-22` | Hộp thoại chi tiết Tiền đường | Số tiền do lái xe nhập; kế toán tích xác nhận hoặc sửa/điều chỉnh trước khi thanh toán | UI |
| `TC-CP-23` | Cột trọng tải container | Có trong nhóm cột "Thông số container" | UI |
| `TC-CP-24` | Thứ tự dòng | Các chuyến trùng số xe xếp LIỀN NHAU (xe kẹp cont 20' hoặc 40' kết hợp) | UI |

## B4. Báo cáo tổng hợp phơi (pdf tr.7)

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-CP-25` | `BÁO CÁO TỔNG HỢP PHƠI PHẢI THU` theo tháng | Đủ cột: Tiền nâng, Tiền hạ, PS khác, Tổng phải thu, Số đã thu, Số còn phải thu; lọc từ ngày–đến ngày | UI |
| `TC-CP-26` | `BÁO CÁO TỔNG HỢP PHƠI PHẢI TRẢ` theo tháng | Cấu trúc y hệt bảng phải thu nhưng theo Nhà xe | UI |
| `TC-CP-27` | Xe nội bộ Silver Sea trong báo cáo phải trả | Được theo dõi như một mã nhà xe thông thường | DB·API |

## B5. Theo dõi hóa đơn kết hợp (pdf tr.11)

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-CP-28` | Bảng `THEO DÕI HÓA ĐƠN KẾT HỢP` | Đủ 14 cột theo mẫu, có dòng tổng, lọc từ ngày–đến ngày | UI |
| `TC-CP-29` | Cột Tiến độ | Đủ 3 trạng thái: chưa gửi / có HĐ / Gửi HĐ | UI |
| `TC-CP-30` | Thêm chi phí lô hàng | Nhập số hóa đơn + số tiền hóa đơn + số tiền trả nhà cung cấp; khoản trả NCC tính vào chi phí khác (chi phí hóa đơn) của lô | UI + DB·API |
| `TC-CP-31` | Quyền xem | Vai trò CUS cũng xem được mục này | UI |

## B6. Theo dõi hoàn cược container (pdf tr.11–12)

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-CP-32` | CUS tích "có cược" và điền số tiền cược dự kiến | Bảng theo dõi tự sinh dòng: Khách hàng / Hãng tàu / Bill / Số tiền cược | UI + DB·API |
| `TC-CP-33` | Kế toán điền tay | Điền/sửa được các trường khi CUS chưa nhập | UI |
| `TC-CP-34` | Ngày nộp công văn | Chọn bằng lịch HOẶC gõ tay theo mẫu `dd/mm/yy` | UI |
| `TC-CP-35` | Ngày dự kiến hoàn cược | Mặc định = **Ngày nộp CV + 14 ngày**, vẫn sửa tay được | TEST + UI |
| `TC-CP-36` | Tích "đã hoàn cược" | Hệ thống ghi nhận ĐÃ THU và đổ tiền về quỹ tài khoản ACB | DB·API |
| `TC-CP-37` | Thứ tự mặc định | Các cont CHƯA hoàn cược đẩy lên đầu, theo ngày xa nhất → gần nhất | UI |
| `TC-CP-38` | Cảnh báo 1 — quá hạn nộp công văn | Sau ngày cược + 7 ngày: "kiểm tra check cược số lượng: N lô hàng", đếm đúng số lô chưa có ngày nộp CV và chưa hoàn cược | TEST + UI |
| `TC-CP-39` | Cảnh báo 2 — tổng tiền | Chạy liên tục: "Chưa hoàn cược số tiền: … - Vui lòng kiểm tra lại!" với tổng đúng | TEST + UI |
| `TC-CP-40` | Bộ lọc | Lọc theo trạng thái (đã / chưa hoàn cược) và theo khoảng ngày; có dòng Tổng | UI |

## B7. Yêu cầu xuyên suốt (pdf tr.12)

| Case | Nội dung kiểm thử | Kỳ vọng PASS | Bậc |
|---|---|---|---|
| `TC-CP-41` | Thêm/xóa dòng chi phí ở MỌI phân hệ nhập chi phí | Mỗi màn hình nhập chi phí đều thêm được dòng (+) và xóa được dòng (−); thêm → lưu → tải lại còn; xóa → lưu → tải lại mất | UI |
| `TC-CP-42` | Xóa dòng không làm sai tổng | Tổng tiền của lô/chuyến đúng trước và sau khi xóa | UI + DB·API |
| `TC-CP-43` | Xóa dòng chi phí ĐÃ DUYỆT | Cho xóa nhưng bắt nhập lý do, lưu người thao tác + thời điểm; KHÔNG xóa cứng | UI + DB·API |

---

## PHẦN C — Ngoài phạm vi (khách yêu cầu để lại)

Không viết ca kiểm thử cho các mục sau vì khách ghi rõ chưa chốt:

- **Kế toán chốt debit** (pdf tr.8–10): bảng `KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP`, gửi yêu cầu điều
  chỉnh cước, hộp thoại Debit, bảng `TỔNG HỢP CÔNG NỢ KHÁCH HÀNG` — khách đánh dấu
  *"PHẦN NÀY CHƯA HOÀN THIỆN, ĐỂ LẠI"*.
- **Định mức Lạch Huyện theo dải giá dầu** (xlsx, ghi chú cạnh dòng phí 3): khách ghi
  *"tạm thời để lại giúp em nha"*.

Khi khách chốt hai mục trên thì bổ sung ca vào file này trước khi code.

---

## Cách dùng file này

1. Chạy theo từng bảng; ghi kết quả PASS/FAIL và tên bằng chứng ngay cạnh mã ca.
2. Bằng chứng lưu vào `testplan/qa/evidence/2026-09-22_bao-gia-chi-phi/REPORT.md` với bảng
   coverage một dòng mỗi ca: `Claim | Rung | Evidence | Not covered`. Mục nào chưa phủ phải
   ghi thật, "not covered" trung thực tốt hơn một PASS bịa.
3. Ảnh chụp đưa VÀO thẻ docx trên Drive, không để đường dẫn local trong thẻ.
4. Ca FAIL thì mở thẻ rework theo quy trình QA FAILED (các bước tái hiện, vì sao sai, phạm vi).
