# PRD: Báo giá

**Dự án:** TTransport — Silver Sea

Tài liệu này là trang PRD của phân hệ **báo giá**: khung giá theo khách hàng, lưới giá nhà máy ×
tuyến × hạng xe, phụ phí theo kỳ giá dầu, nhập/xuất file Excel, và lịch sử phiên bản. Các quy tắc
chốt theo file yêu cầu của khách (`22.9 - BÁO GIÁ MẪU 1.xlsx`, `các chi phí.pdf` 21/09); bảng kiểm
nghiệm thu đầy đủ (ca TC-BG-01…60) nằm ở `testplan/2026-09-22-bao-gia-chi-phi-requirements.md`.
Cách tính cước áp cho lô khi phát lệnh nằm ở [QuyTrinhO2C.md](QuyTrinhO2C.md) §7.

## 1. Vấn đề cần giải quyết

Kế toán cần dựng và duy trì báo giá cho từng khách hàng: một khung giá có ngày hiệu lực, lưới giá
theo nhà máy và hạng xe, phụ phí chạy theo kỳ giá dầu, và phải trả lời được "báo giá này thay đổi
thì các lô đã chạy tính theo giá nào". Trước khi có phân hệ này, các số liệu này nằm rải trong file
Excel của khách — nhập tay từng ô, không có phiên bản, không có lịch sử.

## 2. Khung báo giá và lưới giá

- Một **khung báo giá** theo một khách hàng: tên mẫu, giá dầu tham chiếu, độ trễ áp giá dầu (lag),
  quy tắc làm tròn phụ phí, ngày hiệu lực, và chế độ làm tròn theo khách hàng.
- **Lưới giá** = nhà máy × tuyến đường × hạng phương tiện. Cột: 6 hạng hàng lẻ (1.25T–10T) và
  4 hạng container (Cont 20 <20t / >20t, Cont 40 nhẹ/nặng).
- Mỗi ô giữ: **hệ số** nhân phụ phí, **tổng lít dầu/chuyến**, **giá cos** = giá gốc × (1 + tỉ lệ
  chia sẻ của nhà máy).
- **Tổng lít/chuyến là số dẫn xuất**: lít/chuyến = km khứ hồi × định mức lít/km — không nhập tay,
  không tự chế định mức. Định mức theo hạng: 1.25T=0,10 · 2.5T=0,13 · 3.5T=0,13 · 5T=0,15 ·
  8T=0,20 · 10T=0,24 · CONT20=0,32 · CONT40=0,35.
- **Phụ phí** = chênh lệch giá dầu × lít/chuyến × hệ số của ô. Giá cos không nhân hệ số.

## 3. Hạng container theo trọng tải

- Thiếu trọng tải → **chặn** ra giá container và báo rõ "thiếu trọng tải"; không mặc định hạng nhẹ.
- Biên hạng nặng: trọng tải **≥ 20 tấn là nặng** (biên đúng 20,0 tấn = nặng).
- Ô giá cos hạng nặng để trống → **không chặn**: kế thừa giá hạng nhẹ, giao diện đánh dấu rõ
  "kế thừa hạng nhẹ / giá tạm". Thiếu trọng tải thì chặn, thiếu giá hạng nặng thì kế thừa —
  hai tình huống khác nhau, không gộp.

## 4. Nhập/xuất file Excel

- Kế toán/CUS có quyền nhập file cước (Excel) của khách hàng: hệ thống đọc tuyến và giá từ file,
  tạo **một khung báo giá mới** hiệu lực từ ngày nhập — không ghi đè bản cũ; bản cũ giữ nguyên để
  đối soát.
- **Danh mục phí kế thừa (ruling INHERIT)**: bản khung mới kế thừa nguyên vẹn danh mục phí của khung
  trước cùng khách (tên phí, loại phụ, mức mặc định, gán cột riêng, ghi chú, thứ tự). File cước chỉ
  mang số liệu cước; danh mục phí là cấu trúc quản lý mang theo giữa các hợp đồng, không reset về
  rỗng mỗi lần nhập. Lần nhập đầu tiên bắt đầu với danh mục rỗng; cấu hình phí sau đó như bình
  thường, thiếu cấu hình không tự thay giá minh họa. Phí kế thừa là phí bình thường — sửa được,
  áp dụng và lưu lịch sử theo khung.
- **Xem trước = lần ghi thật**: bảng ánh xạ hiện đúng những gì lần ghi sẽ tạo; bộ kiểm chứng của
  lần xem trước chính là bộ kiểm chứng của lần ghi thật (preview = commit). Hủy trước khi ghi không
  để lại vết.
- **Nhận diện khách theo tên đầy đủ + mã số thuế**; khách chưa có → báo lỗi, không tự tạo. Nhà máy
  hoặc tuyến không khớp danh mục → báo rõ từng dòng lỗi; **không ghi nửa vời** (nhập một phần rồi
  lỗi = lỗi hệ thống).
- Nhập lại cho khách đã có báo giá → **tạo phiên bản mới**, bản cũ vẫn đọc được — không ghi đè.
- **Xuất file** khớp bố cục mẫu; cột lít không có đuôi thập phân; cửa sổ phiên bản gồm cả hôm nay.
- Xuất bản cũ: khớp số liệu của chính bản đó, không phải bản mới nhất.

## 4b. Định tuyến tuyến chuyên dụng trung tính cơ sở

Mã định tuyến tuyến chuyên dụng không gắn một cơ sở cụ thể — bổ sung cơ sở (depot) mới là **dữ
liệu**, không phải sửa mã. Lạch Huyện là dữ liệu cơ sở, không nằm trong mã định tuyến. (ruling
09-24, card _64 A2; hai cơ sở SITC = hai bản ghi dữ liệu phân biệt)

## 5. Hệ số và làm tròn phụ phí

- Hệ số áp ở mức ô; hệ số = 1 thì mọi số giữ nguyên (hồi quy an toàn); đổi hệ số một ô không ảnh
  hưởng ô khác cùng nhà máy.
- **Làm tròn phụ phí = hàm ROUND của Excel**: làm tròn nửa RA XA số 0. Ví dụ 823.250 quy tắc 4 số →
  820.000; mốc giữa 825.000 quy tắc 4 số → 830.000 (phân biệt với cắt cụt). **Chỉ phụ phí được làm
  tròn; giá cos không bị làm tròn.** Khách chưa cấu hình quy tắc → hành vi xác định (không làm tròn
  hoặc chặn), có test khoá hành vi.
- Snapshot lưu vết: giá dầu kỳ, giá tham chiếu, lít/chuyến, hệ số, phụ phí thô và phụ phí sau làm tròn.

## 6. Kỳ giá dầu mới — "Đồng ý cập nhật báo giá"

- Kế toán nhập kỳ giá dầu mới → hiện **một danh sách** các khách bị ảnh hưởng, tích chọn tất cả
  hoặc từng dòng.
- **Đồng ý**: báo giá tính theo giá dầu mới. **Không**: giữ nguyên. **Để sau**: giữ giá cũ nhưng còn
  ở trạng thái chờ — tải lại trang vẫn thấy; vào lại tích Đồng ý sau khi "Để sau" → giá nhảy đúng
  theo kỳ mới.
- Lô phát sinh TRONG lúc chờ "Để sau": **giữ giá cũ, không hồi tố** — cước đã khóa tại Ngày vận
  chuyển.
- Phân quyền: vai trò **Kế toán** tích được Đồng ý.

## 7. Lịch sử phiên bản

- Đổi giá dầu + đồng ý cập nhật → sinh đúng **một phiên bản mới**; bản cũ đọc lại nguyên vẹn.
- Màn hình khi chưa lọc chỉ hiện bản **mới nhất** của mỗi khách; lọc theo khách + khoảng ngày liệt
  kê đủ các bản trong khoảng, sắp theo thời điểm; mở lại bản cũ thấy đúng số liệu tại thời điểm đó
  (giá dầu, giá cos, phụ phí); tải bản cũ về xlsx khớp chính bản đó.

## 8. Phí Lạch Huyện — hai cơ sở SITC

- **Cột Lạch Huyện** tính theo đầu nâng/hạ: chỉ một đầu trong vùng Lạch Huyện = **1×** mức phí; cả
  hai đầu = **2×** (ví dụ khách: nâng Hateco, hạ SITC Lạch Huyện = 2× = 1.000.000đ); cả hai ngoài
  vùng = **0**.
- Mức phí đọc từ cấu hình — đổi cấu hình thì số tiền đổi theo, không cắm cứng trong mã.
- Danh mục cảng có **hai bản ghi phân biệt**: Bãi SITC - Đình Vũ (vùng Hải Phòng) và SITC -
  Lạch Huyện (vùng Lạch Huyện) — cùng thương hiệu, hai cơ sở; bổ sung cơ sở mới không đổi bản ghi cũ.

## 9. Danh mục "Chi phí khác" của báo giá

- Danh mục đủ dòng theo file khách: mở tờ khai (thông thường / đặc thù), hải quan giám sát
  (luồng xanh-vàng / luồng đỏ), nâng-hạ Lạch Huyện, lưu ca xe, soi chiếu (thủ tục soi / kéo cont đi
  soi), kiểm hóa, kẹp chì.
- **Hải quan giám sát** và **Nâng/Hạ Lạch Huyện** vào **cột riêng**; các phí còn lại vào cột chi phí
  khác VÀ tên phí xuất hiện trong ghi chú bảng kê.
- Mức tiền là giá trị mặc định sửa được — sửa mức cho một khách không ảnh hưởng khách khác; không
  cắm cứng số trong mã. "Kiểm hóa" và "Mở tờ khai - hàng đặc thù" để trống mặc định, nhập tay theo
  từng lô.

## 10. Ngoài phạm vi (khách ghi rõ để lại)

- **Kế toán chốt debit chi tiết** (Debit tab, xuất biểu mẫu) — vẫn ĐỂ LẠI chờ đặc tả hoàn chỉnh;
  phần đã land (popup Chọn Debit) xem [QuyTrinhO2C.md](QuyTrinhO2C.md) §7.
- **Định mức Lạch Huyện theo dải giá dầu** — chờ khách chốt; khi khách chốt, bổ sung quy tắc vào
  trang này trước khi code.
