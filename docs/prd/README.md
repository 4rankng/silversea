# PRD — TTransport / Silver Sea

Yêu cầu sản phẩm nhìn từ khách hàng, chủ sản phẩm và người dùng cuối. Mỗi tài liệu
trong thư mục này mô tả người dùng cần làm gì, quy trình mong muốn, quy tắc nghiệp vụ
và tiêu chí nghiệm thu của một mảng nghiệp vụ.

Silver Sea hỗ trợ toàn bộ công việc từ tiếp nhận lô hàng, lập kế hoạch vận chuyển,
thực hiện giao nhận đến quản lý chi phí, hồ sơ và công nợ. Người dùng phải nhận biết
được việc cần làm, dữ liệu còn thiếu và kết quả của hành động ngay tại nơi làm việc;
không phải nhập lại cùng thông tin hoặc đối chiếu những trạng thái mâu thuẫn giữa các
màn hình.

Lịch sử các quyết định đã có hiệu lực nằm ở [CHANGELOG.md](CHANGELOG.md). Tài liệu
trong thư mục này chỉ mô tả quy tắc **đang áp dụng**.

## 1. Người dùng và kết quả cần đạt

| Vai trò | Nhu cầu chính |
|---------|---------------|
| Quản trị | Quản lý tài khoản, phạm vi quyền và danh mục nhất quán; người ngừng hoạt động không được nhận công việc mới, hồ sơ lịch sử vẫn đọc được |
| Quản lý | Nắm tiến độ, việc tồn đọng và tình hình tài chính bằng số liệu có ý nghĩa rõ; thực hiện các điều chỉnh thuộc thẩm quyền |
| Chứng từ / CUS | Nhập lô nhanh, lưu được thông tin chưa đầy đủ, bổ sung đúng lúc, chuyển dữ liệu chính xác sang điều vận và kế toán |
| Điều vận | Nhận biết phần chưa phân bổ, chọn nguồn lực phù hợp, phát lệnh và xử lý thay đổi mà không gây trùng lịch hoặc mất công việc |
| Lái xe | Nhìn thấy đúng lệnh được giao, hiểu việc cần làm và thông tin liên hệ, cập nhật chứng từ và hoàn thành với ít thao tác cần thiết |
| Nhân viên hiện trường / Ops | Xem kế hoạch, phối hợp tại cảng/nhà máy, ghi tiền thực nhận/thực chi, bổ sung chứng từ và đối chiếu quỹ |
| Kế toán | Đối chiếu hồ sơ và số tiền, lập bảng kê, ghi nhận thanh toán/phân bổ, quản lý lương và khóa kỳ trong phạm vi được cấp |
| Khách hàng | Theo dõi lô hàng của mình, hiểu tiến độ và các thông tin được chia sẻ; xác nhận thực tế giao nhận khi thuộc quy trình của mình |

Tên vai trò không đồng nghĩa được truy cập mọi dữ liệu hoặc thực hiện mọi hành động.
Mỗi màn hình chỉ cung cấp thông tin và thao tác trong phạm vi người dùng; cùng một
nghiệp vụ phải có ý nghĩa thống nhất giữa các vai trò.

## 2. Nguyên tắc chung

Áp dụng cho mọi nghiệp vụ trong mọi tài liệu của thư mục này. Tài liệu chuyên đề chỉ
bổ sung quy tắc riêng, không lặp lại các nguyên tắc dưới đây.

### 2.1 Thao tác trực tiếp, không phê duyệt nội bộ

- Người có quyền lưu, phát hành, điều chỉnh hoặc hủy **trực tiếp** sau khi đáp ứng
  quy tắc nghiệp vụ. Ứng dụng không có quy trình gửi duyệt, người duyệt, chờ duyệt
  theo cấp tiền hoặc tự động duyệt.
- Quyền thao tác, kiểm tra dữ liệu, lý do điều chỉnh, lịch sử thay đổi và khóa kỳ
  vẫn được giữ đầy đủ.
- Lái xe **nhận lệnh** và khách hàng **xác nhận thực tế giao nhận** là các sự kiện
  nghiệp vụ cần giữ. Xác nhận một thao tác của chính người dùng, chẳng hạn xác nhận
  hủy, không phải bước phê duyệt của người khác.
- **Yêu cầu ứng** chỉ là yêu cầu cấp tiền; chỉ giao dịch thực tế mới ghi tiền
  nhận/chi.

### 2.2 Internet, mất kết nối và thử lại

- Ứng dụng cần Internet để làm việc. Không hứa lưu ngoại tuyến.
- Khi mất kết nối, thông báo rõ chưa thể lưu; giữ nội dung đang nhập trong màn hình
  khi còn có thể và cho người dùng chủ động tiếp tục khi kết nối trở lại. Không tự
  gửi lại thay người dùng.
- Nếu chưa rõ lần lưu trước đã thành công hay chưa, ứng dụng giúp người dùng xác
  định kết quả trước khi thử lại, để không tạo bản ghi trùng.

### 2.3 Trạng thái và nhãn

Ghi nhận chi phí, thiếu chứng từ, hoàn thành vận chuyển, đã thanh toán và đã khóa kỳ
là những tình trạng khác nhau. Mỗi nhãn phải nói đúng sự kiện đã xảy ra; không dùng
một trạng thái chung để suy ra tất cả, và không đưa số 0 thay cho giá trị chưa biết.

### 2.4 Quy tắc cước đang áp dụng

Kẹp phụ phí dầu về 0 khi giá dầu kỳ thấp hơn giá mốc; luôn tính km khứ hồi theo hợp
đồng, kể cả chuyến một chiều; chọn **Ngày vận chuyển** làm mốc áp giá; không hồi tố
cước đã chốt. Giá trị, phạm vi và điều kiện cụ thể nằm trong các tài liệu cước.
Thông số khách hàng chưa xác định không được tự thay bằng số minh họa.

### 2.5 Phạm vi danh mục phí, trường chuyến và tạo lô

- CUS giữ phạm vi truy cập danh mục phí báo giá hiện tại; không mở thêm quyền
  danh mục hoặc tự thêm cột giá phí. Quyền đọc/xuất chi tiết công nợ là phạm vi riêng.
- Số lượng, đơn giá và tiền phụ cấp trên biểu mẫu chuyến phải không âm. Quy tắc
  dòng chi phí âm được hiển thị nhưng không cộng vào tổng vẫn áp dụng riêng.
- Tạo lô ở trạng thái DRAFT rồi tiếp tục theo luồng sẵn sàng, hồ sơ và thực hiện
  hiện tại; không thêm thao tác SUBMIT hoặc bước gửi duyệt nội bộ.

Chủ sản phẩm chốt giữ các quy tắc này ngày2026-10-01; xem
[quyết định220/245/252](../adr/2026-10-01-audit-todo-policy-rulings.md).

## 3. Chất lượng trải nghiệm cần đạt

- **Dễ nhận biết:** người dùng biết mình đang ở đâu, đang xem lô/công việc/kỳ nào, dữ
  liệu nào còn thiếu và hành động tiếp theo. Tên gọi, ngày, số tiền và trạng thái
  thống nhất trên danh sách, chi tiết và chứng từ.
- **Ít nhập lại:** thông tin đã biết được kế thừa đúng nơi; chọn nhà máy, xe hoặc
  công việc điền dữ liệu liên quan phù hợp. Đổi lựa chọn cập nhật các trường phụ
  thuộc mà không âm thầm mất nội dung đang sửa.
- **Lưu đáng tin cậy:** bấm nhiều lần không tạo bản trùng hoặc phát sinh tiền trùng.
  Khi có người khác sửa cùng dữ liệu, người dùng được xem thay đổi và quyết định cách
  tiếp tục; không bị ghi đè mà không biết.
- **Tận dụng diện tích:** bảng trên máy tính hỗ trợ so sánh; màn hình nhỏ ưu tiên
  định danh, lịch, trạng thái, số liệu chính và hành động. Thông tin phụ có thể mở
  thêm nhưng các mã quan trọng không bị cắt hoặc ngắt thành từng ký tự. Các nhóm
  trường dùng khoảng cách và tiêu đề rõ, tránh nhiều lớp khung.
- **Thao tác thuận tiện:** điều khiển dễ chạm, dùng được bằng bàn phím; chữ dễ đọc,
  lỗi nằm cạnh trường, nút lưu/đóng luôn tiếp cận được kể cả khi bàn phím điện thoại
  mở. Thông tin không chỉ phân biệt bằng màu hoặc chỉ xem được khi rê chuột.
- **Phản hồi rõ và ổn định:** đang tải, không có dữ liệu, lỗi tải, đang lưu và đã lưu
  có cách thể hiện khác nhau. Chuyển động nhẹ, tôn trọng nhu cầu giảm chuyển động;
  cập nhật dữ liệu không làm nhảy hàng hoặc nút đang dùng.
- **Giữ ngữ cảnh:** quay lại danh sách giữ bộ lọc, trang và vị trí phù hợp; đổi tài
  khoản không để lại dữ liệu của người trước. Lỗi kết nối tạm thời không khiến người
  dùng bị đăng xuất khỏi phiên còn hợp lệ.

## 4. Danh mục tài liệu

> **All-markdown (owner directive 21/10/2026):** toàn bộ PRD trong repo giữ dạng **.md** —
> 10 file `.docx` đã r khỏi repo sau khi mọi file có bản .md twin đầy đủ. **Nguồn gốc .docx
> (kèm ảnh mockup nhúng) không mất**: lưu tại Google Drive — thư mục `SilverSea/Kanban` (docs
> tổng hợp 21/10) và bản đính kèm gốc (`~/.hermes/profiles/dev/attachments`); ảnh mockup của
> các file đã chuyển được mô tả đầy đủ bằng chữ tại các mục `### Mockup:` trong file .md tương ứng.

| Tài liệu | Phạm vi | Không thuộc tài liệu này |
|----------|---------|--------------------------|
| [QuyTrinhO2C.md](QuyTrinhO2C.md) | Quy trình từ tiếp nhận lô đến điều vận, giao nhận, hoàn thành hồ sơ và thu tiền; trách nhiệm từng vai trò | Công thức cước chi tiết, thiết kế bảng giá |
| [MasterDataNhaMay.md](MasterDataNhaMay.md) | Khách hàng, nhà máy, tuyến và địa điểm; lựa chọn dữ liệu theo quan hệ; lệnh chạy ngoài | Cách tính cước, phân xe, lương |
| [LoHangKepKetHop.md](LoHangKepKetHop.md) | Kẹp hai container đồng thời và kết hợp hai công việc nối tiếp; nguồn lực, tiến độ, chi phí và doanh thu | Quy trình chung mỗi lô đơn lẻ |
| [OpsVanHanh.md](OpsVanHanh.md) | Kế hoạch làm hàng, theo dõi phương tiện, tiền ứng, chi phí, chứng từ và quyết toán của nhân viên hiện trường | Lương lái xe, công nợ khách hàng |
| [ManHinhLaiXe.md](ManHinhLaiXe.md) | Hành trình lái xe: nhận lệnh, đọc thông tin, thực hiện, bổ sung ảnh/chứng từ và hoàn thành | Điều vận, kế toán |
| [CuocPhiPhuPhiDau.md](CuocPhiPhuPhiDau.md) | Công thức cước, tham số hợp đồng, bảng số tham chiếu và quy tắc làm tròn | Trải nghiệm cấu hình giá, luồng nhập kỳ giá |
| [CuocPhiThietKeDB.md](CuocPhiThietKeDB.md) | Yêu cầu đối với dữ liệu cước, ngày hiệu lực, giải thích số tiền và bảo toàn lịch sử | Công thức tính cước |
| [PhuongAnTinhCuocTuDong.md](PhuongAnTinhCuocTuDong.md) | Trải nghiệm cấu hình, tính cước theo ngày vận chuyển, xử lý thiếu giá và điều chỉnh giá trên bảng kê | Công thức gốc và bảng giá hợp đồng |
| [BaoGia.md](BaoGia.md) | Phân hệ báo giá: khung giá theo khách hàng, lưới giá nhà máy × tuyến × hạng xe, phụ phí theo kỳ giá dầu, nhập/xuất Excel, lịch sử phiên bản | Cách tính cước áp cho lô khi phát lệnh (ở QuyTrinhO2C.docx §7) |
| [PhanHeKeToan.md](PhanHeKeToan.md) | Giao diện và quy tắc phân hệ Kế toán: dashboard tiền/cược/quỹ/cảnh báo, phơi phiếu, công nợ vận tải, quỹ, chấm công/lương/nhân sự | Các phân hệ khác (Điều độ, Lái xe, CUS, Quản lý); quy trình O2C chung; công thức cước |
| [PhanHeKeToan.md](PhanHeKeToan.md) | Spec gốc khách hàng (nguyên văn) cho 2 đợt fix chi phí 19/10 + trạng thái land từng mục — bản truy vấn nguồn, không thay thế PhanHeKeToan.docx | Quy tắc đang áp dụng (nằm ở PhanHeKeToan.docx / QuyTrinhO2C.docx / CHANGELOG.md) |

## 5. Nguồn yêu cầu gốc

| Tài liệu | Nguồn |
|----------|-------|
| MasterDataNhaMay.docx | `2026.9.6_Logic_nghiep_vu.docx` Phần 1, kèm yêu cầu bổ sung về tên nhà máy, địa chỉ, liên hệ và thông tin xuất hóa đơn |
| LoHangKepKetHop.docx | `2026.9.6_Logic_nghiep_vu.docx` Phần 2 |
| OpsVanHanh.docx | `2026.9.6_Man_hinh_ops.docx`, `các chi phí.docx` |
| ManHinhLaiXe.docx | `2026.8.27_Man_hinh_lai_xe.docx` và yêu cầu màn hình bổ sung |
| CuocPhiPhuPhiDau.docx | `18.7 - BG Long Minh T7.xlsx` và trả lời khách hàng |
| CuocPhiThietKeDB.docx | Yêu cầu cước và phương án khách hàng |
| PhuongAnTinhCuocTuDong.docx | `Phương án tính cước tự động.docx` |
| QuyTrinhO2C.docx | Tổng hợp yêu cầu nghiệp vụ |
| BaoGia.docx | `22.9 - BÁO GIÁ MẪU 1.xlsx`, `các chi phí.pdf` (21/09) |
| PhanHeKeToan.docx | `5.10 - CHI TIẾT CÁC BỘ PHẬN.docx` Phần 1 (PHÂN HỆ KẾ TOÁN) |

Các file nguồn là bản minh hoạ logic, không phải bộ dữ liệu đầy đủ: ô trống trong file
nguồn là bình thường và không ảnh hưởng công thức. Khi nguồn và quy tắc đã chốt khác
nhau, quy tắc đã chốt trong tài liệu tương ứng thắng — xem
[CHANGELOG.md](CHANGELOG.md) để biết thời điểm chốt.

## 6. Quy ước đọc tài liệu

- **Thuật ngữ.** *Lô* là một shipment (FCL có thể gồm nhiều container). *Công việc*
  là một phần việc vận chuyển gắn với một container hoặc với hàng lẻ LCL. *Chuyến*
  (trip) là hành trình thực tế của một xe. *Kẹp* là hai container chạy đồng thời trên
  cùng xe; *kết hợp* là hai công việc nối tiếp dùng chung vỏ. *Lệnh chạy ngoài* là lô
  không do SilverSea tạo ra — xem [MasterDataNhaMay.md](MasterDataNhaMay.md) §4.
- **Một quy tắc chỉ có một nơi định nghĩa.** Tài liệu khác tham chiếu, không chép
  lại; khi cần sửa, sửa tại nơi định nghĩa.
- **Số mục ổn định.** Mã tham chiếu dạng `Tài liệu.docx §n.m` được dùng trong mã nguồn;
  không đánh số lại mục khi sửa nội dung. Từ 21/10/2026 file trong repo là bản `.md`
  (xem §4) — mã tham chiếu `§n.m` giữ nguyên, đọc trên file `.md` tương ứng.
- **Không ghi lịch sử trong tài liệu.** Quyết định đã chốt, việc đã bỏ và lý do nằm ở
  [CHANGELOG.md](CHANGELOG.md) hoặc hồ sơ công việc, không nằm trong yêu cầu sản phẩm.
- **Điểm còn mở** được nêu ở mục cuối của từng tài liệu, kèm hành vi tạm thời khi chưa
  đủ dữ liệu. Không tự đặt thêm điều khoản để lấp chỗ trống.

Tiêu chí cụ thể của từng quy trình nằm ngay trong tài liệu tương ứng. Sản phẩm cần đáp
ứng cả luồng thông thường và các tình huống thiếu dữ liệu, nhập sai, mất kết nối, thay
đổi đồng thời, tên/mã dài và nhiều bản ghi.

## 7. Ma trận truy vấn nguồn — yêu cầu → AC → hiện thực → QA (chốt 21/10/2026 · cập nhật rulings/verdicts 22/10/2026)

Truy vấn nguồn cho 222 phiếu yêu cầu Kanban (`FINAL-REQUIREMENTS-211026.docx`, 219 phiếu
đóng PASS + 3 phiếu nợ test đã xanh trên main 21/10 theo `qa/2026-10-21-be-canonical.md`
668/668), bảng trạng thái 35 yêu cầu chính thức + REQ-01..23
(`CUSTOMER-REQUIREMENTS-STATUS-FINAL-211026.docx`; spec text gốc 35 YC theo
`tonghop-35yc.json` — nguyên văn "hành vi mong muốn"), 5 spec docx gốc khách 19-18/10
(FIX CHI PHÍ / chiphispec / chungtu-dieuvan / lclspec1 / lclspec2 — text đầy đủ tại
[PhanHeKeToan.md](PhanHeKeToan.md), [OpsVanHanh.md](OpsVanHanh.md) §Spec gốc,
[LoHangKepKetHop.md](LoHangKepKetHop.md) §Spec gốc), audit đối kháng 9 card
(`qa-audit-verdicts.md`), evidence `qa/2026-10-2*/` và lịch sử commit. Quy tắc nghiệp vụ
đang áp dụng nằm ở tài liệu chuyên đề + [CHANGELOG](CHANGELOG.md); mục này chỉ tra cứu
nguồn — verdict ghi theo vòng QA (R14–R30) và build tương ứng.

Cột AC ghi: **URL · vai trò · trạng thái mặc định khi mở màn** (quan trọng với các bề mặt
progressive-disclosure — yêu cầu "hiện theo mặc định trên màn user mở đầu tiên" được nêu
rộng ra trong ô) · GIVEN/WHEN/THEN rút gọn.

### 7.1 CẦN RULING / còn mở (không bịa AC)

| # | Mục | Lý do còn mở |
|---|---|---|
| 1 | Xóa lô của Điều vận | Ruling 21/10 07:54 chốt **cho phép**; hiện trạng commit `903ec1cc` vẫn chặn phía server ("Chỉ CUS hoặc Quản trị viên") — chờ land quyền. |
| 2 | FB-061 residual | Soft-deleted entities vẫn in trên Kiểm soát phơi phiếu (phiếu 161026171000) — cần owner ruling chính sách demo-BU; ENV-01 (`make stgqa`) đã giải phần fixture QA. |
| 3 | REQ-05 (autocomplete Hãng tàu) + các mục "verify 9aab78d2" ở §7.2 chưa có verdict P | Cần QA verify trên build 9aab78d2 (CUS-01/02/04/05/06, DIS-06/07, DRI-02, REP-01/02). |
| 4 | FB-103 + nhóm chấm công (141026230780/0790/0800/0810) | Doc tổng hợp ghi PASS nhưng không tra được commit/test khóa trong nguồn nhập. |
| 5 | Phiếu không evidence tra được | FB-051, FB-055, FB-057, FB-069, FB-074, FB-115, 181026180300, 181026183500, 161026095800, 161026121500, QA1-003, QA1-004, QA2-003/006/007/010, 141026230700, 181026182300 — chỉ có trạng thái "QA ĐÃ TEST PASS" của doc tổng hợp. |

Spec text gốc 35 YC lấy từ `tonghop-35yc.json` (nguyên văn "hành vi mong muốn" của khách) —
cột Spec trong §7.2 trích nguyên văn, không diễn giải.

### 7.2 Yêu cầu chính thức 35 mục (CUS/DIS/LCL/DRI/REP/ENV)

Trạng thái 21/10 tối ưu: **LAND** = đã land trên main (9aab78d2 → 5b77082f) hoặc sắp merge ·
**IN-FLIGHT** = agent đang chạy (tên branch) · **VERIFY** = cần xác minh lại trên build 9aab78d2.
Spec («…») trích nguyên văn "hành vi mong muốn" từ tonghop-35yc.json.

| ID | Spec gốc (khách, nguyên văn) | Trạng thái | Commit/evidence | AC mặc định · G/W/T | QA verdict / verify-fail |
|---|---|---|---|---|---|
| CUS-01 | «Khi nhập đủ 2 chữ số giờ (ví dụ '08'), con trỏ tự động nhảy sang ô phút ('00'). Cho phép nhập tay hoặc chọn từ lịch mà không bị kẹt.» | VERIFY 9aab78d2 | FB-030/075: `22c9c80b`, `c58f570e`, `5ef5ace7` | /shipments/new · CUS · G gõ '08' ô giờ THEN focus tự sang phút; không rơi phím số | ◐ "đạt có điều kiện nhập" (R21–R27) — ma trận input-order còn mở |
| CUS-02 | «Khi vào sửa/bổ sung ngày giờ cho lô hàng chưa có lịch, nhấn phím Enter phải tự động lưu và thoát về danh sách chính thay vì lưu nhưng vẫn đứng ở bảng popup.» | VERIFY 9aab78d2 | FB-002 R27/28 PASS; lan 3 `c73c7bbc` (card 211026034109) | form giờ · CUS · G draft hoàn chỉnh W Enter THEN POST lưu + thoát về danh sách | ×N verify-fail; root-cause lan 3: 2 nút submit nằm ngoài `<form>` |
| CUS-03 | «Thêm nút 'Copy thời gian' để 1 lần thao tác có thể gán ngày giao chung cho tất cả các cont của lô nhiều cont, tránh phải nhập thủ công từng cont.» | LAND | FB-009 (101026163010) | bảng cont · CUS · G lô nhiều cont W bấm copy THEN mọi cont nhận chung ngày giờ | PASS (doc tổng hợp); từng flappy ×2 (nút biến mất 111026111200, 131026233500) |
| CUS-04 | «Sửa lỗi khi con trỏ ở ô 'Số cont' bấm phím TAB sang ô 'Loại cont', người dùng gõ phím phải kích hoạt danh sách gợi ý loại cont tự động thay vì bắt buộc phải click chuột.» | VERIFY 9aab78d2 | — | /shipments/new · CUS · G TAB sang ô Loại cont W gõ THEN dropdown gợi-y tự mở | R30 VERIFY chưa P |
| CUS-05 | «Cho phép nhập nhiều tờ khai trên một lô. Khi thêm số tờ khai cho 1 cont, tự động cập nhật đồng bộ cho tất cả các cont trong lô. Hỗ trợ sửa/thêm trực tiếp tại màn hình chi tiết.» | VERIFY 9aab78d2 | FB-085/109 (họ 1310262006xx) | chi tiết lô · CUS · G thêm tờ khai 1 cont THEN đồng bộ cả lô + header /shipments/:id cập nhật | P R17; regression 141026012500 + A1 verify-fail ×2 đã đóng; **ruling 22/10 (cards 221026095229/221026095329): inline edit @Chi tiết lô + nhập 1 cont sync mọi cont cùng lô — CUS-05 clarify** |
| CUS-06 | «Khắc phục lỗi người dùng đã nhập số tờ khai hải quan nhưng hệ thống không ghi nhận/lưu vào cơ sở dữ liệu sau khi bấm hoàn tất.» | VERIFY 9aab78d2 | FB-110 (171026122110) | G nhập tờ khai W lưu + mở lại THEN số còn đúng | PASS (doc) |
| CUS-07 | «Màn hình nhập liệu chỉ hiển thị gọn tên nhà máy. Thêm nút thu gọn/mở rộng ('Xem chi tiết') để xem địa chỉ đầy đủ và thông tin xuất hóa đơn khi cần thiết.» | LAND | (per tổng hợp 21/10) | /shipments/new · CUS · mặc định tên gọn · G bấm 'Xem chi tiết' THEN mở địa chỉ + xuất hóa đơn | chưa có verdict P riêng trên build mới |
| CUS-08 | «Bỏ 2 chữ số 0 thập phân không có ý nghĩa sau dấu phẩy tại trường trọng lượng hàng (ví dụ: '25,000.00 kg' chuyển thành '25,000 kg').» | LAND — đi xa hơn: hiển thị theo TẤN | CHANGELOG 21/10 (phiếu 211026125242/5715/5815) | mọi màn hiển thị trọng lượng · G cont 18.500 kg THEN "18,5 tấn"; ô nhập vẫn kg | P theo CHANGELOG; root-cause FB-069: dấu chấm nghìn vi-VN bị đọc nhầm thập phân |
| CUS-09 | «Sửa lỗi hệ thống khi chỉnh sửa số lượng cont của lô đã tạo. Khi bổ sung cont mới, tự động sao chép các trường thông tin chung xuống, chỉ để trống số cont và loại cont.» | **REVERSED 22/10 (ticket 221026173728)** — hủy ruling 21/10 (card 211026112600): quay về A.1 nguyên văn — copy TẤT CẢ TRỪ **Số cont + Loại cont** (Loại cont luôn trống "Chưa chọn") | `ef90a995` + `7d1f5c1f` + `017adf63` (21/10, bị hủy) + reversal 22/10 | drawer Tổng quan + Chi tiết trượt ngang (ledger dùng chung) · CUS · G thêm cont THEN copy Tuyến/Nhà xe/Nâng/Hạ/Trọng lượng/Giờ hẹn, Số cont + Loại cont TRỐNG; KHÔNG đặt nút ở Chi tiết *(theo TICKET-09 — SUPERSEDED 22/10, xem CUS-10)* | regpack fb111; R27 P; FB-086 verify-fail ×2 + lan 3 đóng; reversal pinned vitest (CusContainerLedger/ShipmentsPage) |
| CUS-10 | «Thêm nút 'Xóa cont' trực tiếp trong bảng chi tiết lô hàng CUS để xử lý nhanh trường hợp nhập thừa hoặc khách hủy bớt container.» | **REVERSED 22/10** — TICKET-09 (17/10) SUPERSEDED: bật lại nút Thêm/Xóa cont @Chi tiết | `171026182554` (TICKET-09, hết hiệu lực 22/10) | Chi tiết lô · CUS · G mở Chi tiết THEN thấy nút Thêm/Xóa container (bật lại theo yêu cầu mới); thao tác drawer Tổng quan giữ nguyên | ruling 22/10 (Zalo 09:50, QA xác nhận bỏ ruling by-design): FB-112 REVERSED — "nút @Chi tiết" MỞ LẠI, TICKET-09 > FB-086@detail không còn hiệu lực; chờ implement bật lại + gỡ pin vitest |
| CUS-11 | «Sắp xếp lại thứ tự hiển thị trường chứng từ theo chuẩn: 1. Số Booking -> 2. Số Tờ khai -> 3. Nhập/Xuất -> 4. Hãng tàu.» | LAND + lane IN-FLIGHT `fix-cus11-dri04-visible` | `ba9981c2` + `ca57c8fc` | /shipments/:id · CUS · G lô có tờ khai W mở header THEN đúng thứ tự 4 trường **BILL/BOOKING → SỐ TỜ KHAI → NHẬP/XUẤT → HÃNG TÀU** (ruling 22/10 card 221026095429 — ô đầu là BILL/BOOKING); thêm tờ khai cập nhật ngay | P R26 staging d39ee741 + standing 20/10 + audit UI DRIVEN; ×3 verify-fail do 3 màn trùng tên |
| DIS-01 | «Ô nhập văn bản ghi chú cho điều vận bị chặn phím Space. Yêu cầu sửa bộ gõ/input để người dùng soạn thảo nội dung bình thường có dấu cách.» | LAND | (Đã xử lý theo doc khách) | /dispatch-detail · dieuvan · G gõ 'a b' ô ghi chú THEN space giữ nguyên | PASS (doc) |
| DIS-02 | «Khách hàng không có nhu cầu hẹn giờ phát lệnh. Bỏ popup chọn ngày giờ khi bấm phát lệnh, chuyển sang icon phát lệnh trực tiếp một chạm.» | LAND | `a5e0039b` + `3349fd52` | /dispatch-detail · dieuvan · G dòng đủ xe/lịch W bấm icon phát lệnh THEN phát ngay, không popup hẹn giờ | R30 FAIL (6110af65) → fix; endgame spot P 9aab78d2 |
| DIS-03 | «Khi 1 xe đầu kéo chạy kế hoạch chở kẹp 2 container 20ft, phát lệnh cont thứ nhất thành công nhưng cont thứ hai bị chặn do báo trùng đầu kéo. Cần cho phép gán cùng 1 đầu kéo cho cả 2 cont kẹp.» | LAND | FB-012 `f6cbe97c` + `3349fd52` | /dispatch-detail · dieuvan · G cặp kẹp W phát lệnh cont 2 THEN không bị chặn "trùng đầu kéo" trong chính cặp (trùng khung giờ ngoài cặp → confirm "Vẫn lưu?") | R27 B2 write-test P; R30-endgame spot P (dialog confirm + lưu 200) |
| DIS-04 | «Bổ sung bộ lọc trạng thái xe rõ ràng: 'Chờ phân xe', 'Đang phân xe', 'Đã phân xe' / 'Chưa gán biển' vs 'Đã gán biển', tách bạch các lô đã gán xe khỏi danh sách chờ.» | LAND | REQ-08 | /dispatch(-detail) · dieuvan · mặc định có tab · G mở THEN tab "Chưa gán xe N \| Đã gán xe M" tách bạch | P R27 (screenshot tab "Chưa gán xe 52 \| Đã gán xe 47") |
| DIS-05 | «Cho phép nhập/sửa 'Giờ trả hàng' ngay lúc gán biển xe. Sửa lỗi khi điều vận sửa giờ điều xe (ví dụ thành 13:00) bấm lưu thì ngoài cột thời gian và lịch trình vẫn giữ giờ cũ.» | LAND | `3349fd52` (TimePanel mouse-flow commit) | /dispatch-detail · dieuvan · G TimePanel gõ 1645 W click ngoài panel THEN 16:45 commit, cột giờ + lịch trình sync | R30 FAIL → endgame P 9aab78d2 |
| DIS-06 | «Thêm danh mục tác vụ 'Lấy Lẻ' vào danh sách phân loại điều vận. Định nghĩa rõ nghiệp vụ dùng vỏ cont rỗng đi đóng hàng lẻ chuyển kho rồi hạ rỗng/đóng hàng hạ cảng.» | VERIFY 9aab78d2 | `007352d6` (enum + cont-flow) | /dispatch-detail · dieuvan · G chọn Lấy Lẻ THEN nghiệp vụ vỏ rỗng đúng luồng (LCL lot còn bị loại khỏi luồng) | ◐ một phần — luồng Lấy Lẻ còn verify |
| DIS-07 | «Khi điều vận chọn tác vụ 'Lấy Lẻ', hệ thống lại tự động chuyển thành 'Đảo vỏ'. Đồng thời sửa lỗi báo trùng/gập khung giờ với các tác vụ hợp lệ khác của xe.» | VERIFY 9aab78d2 | CHANGELOG 05/10 (bỏ auto-tag) + FB-038/072 `9d109c0d`/`07b54048` | G chọn Lấy Lẻ W lưu THEN không tự ĐẢO VỔ; không báo trùng giờ sai với tác vụ hợp lệ | auto-tag P (05/10); trùng giờ từng ×3 verify-fail → confirm dialog |
| DIS-08 | «Trên bảng danh sách kế hoạch điều xe, hiển thị IN ĐẬM số container để tăng khả năng nhận diện; tên Cảng chuyển sang kiểu chữ thường không in đậm.» | IN-FLIGHT `fix-dis08-lan2` — **đã merge `5b77082f` trên main**; deploy staging giữ đến wave close | `a5e0039b` → `3349fd52` → `c641f973` (law dùng chung `.ops-container-line`) | /dispatch + /dispatch-detail · dieuvan · 390/768/1440 · G mở THEN mọi dòng cont font 600, cảng 400 (kể cả cột "Tổng quan hàng hóa" + drawer) | verify-fail ×2 (R30 + QA 18:04 trên 9aab78d2 — wedge cột Hàng); lan 2 local driver 15/15 P; flappy ≥2 vòng — đề xuất thêm spec regpack |
| DIS-09 | «Đối với nhà xe ngoài, cho phép điều vận phát lệnh trước khi có biển số xe; biển số xe và thông tin tài xế sẽ được bộ phận CUS hoặc điều phối cập nhật bổ sung sau.» | LAND + lane IN-FLIGHT `fix-dri01-dis09-visible` | `a5e0039b` | /dispatch-detail · dieuvan · G xe ngoài chưa BKS W Phát lệnh THEN confirm "Vẫn phát lệnh?" → phát OK, BKS trống, chip chờ biển | audit SHIPPED UI DRIVEN (evidence 9cards, trip 194088 plate NULL) |
| DIS-10 | «Cung cấp chức năng cho phép điều vận thay đổi, chọn lại nhà xe hoặc biển số xe khác đối với các tác vụ đã phân bổ (đơn, ghép, lấy lẻ) khi có phát sinh thay đổi xe.» | LAND | `a5e0039b` (card B) | /dispatch-detail · dieuvan · mặc định nút GIẤU sau badge "Lẻ · Ghép (1/N)" cột Phân loại · G mở badge modal W "Đổi nhà xe/BKS" THEN sửa BKS thực/báo khách | PASS (doc + audit) |
| LCL-01 | «Lô hàng lẻ đã tạo hiển thị bình thường ở màn hình Tổng quan nhưng khi bấm vào Chi tiết thì không tìm thấy thông tin lô hàng.» | LAND (lan 2) — `fix-lcl01-lan2` merged `39a57de9`/`ddf45946` (card 211026180528) | repro + AFTER pass qa/2026-10-21-lcl01-dri03 + qa/2026-10-21-lcl01-lan2 (lot 133 SHP-2610-00069) | /shipments/:id · CUS · G lô LCL W mở Chi tiết THEN thấy đủ thông tin như Tổng quan | R30 FAIL → before-FAIL/after-PASS 21/10 → lan 2 land (root-cause: query còn lọt shape container-row chưa có ngày) |
| LCL-02 | «Thiết kế lại form thêm kho lấy hàng tương tự như trường bãi cảng (tối giản, nhập nhanh) để người dùng chủ động thao tác mà không bị phức tạp.» | LAND + lane IN-FLIGHT `fix-lcl-form-visible` | `032145a2` (FB-105 P 5040/5040) | /shipments/new · CUS · form mặc định **Nhập khẩu**, phải chọn KH · G radio Xuất khẩu W "+ Thêm kho" THEN dialog "Thêm kho trả hàng" (Nhập → lấy hàng), 3 trường gọn | audit SHIPPED UI DRIVEN; lane visibility (mặc định-hiện) |
| LCL-03 | «Cắt giảm các trường thời gian phụ không cần thiết trong phần lịch & ghi chú hàng lẻ, chỉ giữ lại trường trọng tâm duy nhất là 'Ngày giao hàng'.» | LAND + lane IN-FLIGHT `fix-lcl-form-visible` | `0f7e1dfa` | /shipments/new · CUS · FCL mặc định còn "Lịch & ghi chú" · G radio Hàng lẻ THEN section biến mất, còn nút "+ Thêm ngày giao hàng" | audit SHIPPED UI DRIVEN; QA từng trượt vì không chuyển radio |
| LCL-04 | «Trường quy cách đóng gói cần hỗ trợ gợi ý tự động (như trường nhà máy) và có sẵn danh mục các quy cách đóng gói phổ biến cố định.» | LAND + lane IN-FLIGHT `fix-lcl-form-visible` | `0f7e1dfa` | /shipments/new · CUS · LCL · G mở combobox THEN gợi-y (Bao/Kiện/Pallet…) + gõ tự do "Kiện gỗ" được chấp nhận | audit SHIPPED UI DRIVEN |
| LCL-05 | «Thay đổi nhãn hiển thị tại form thông tin hàng lẻ từ 'Ngày giao dự kiến' thành 'Ngày giao hàng' theo đúng thuật ngữ nghiệp vụ thống nhất.» | LAND + lane IN-FLIGHT `fix-lcl-form-visible` | FB-083 `131026190400` + `0f7e1dfa` | form LCL · G mở THEN nhãn "Ngày giao hàng" (reveal sau nút "+ Thêm ngày giao hàng") | audit SHIPPED UI DRIVEN |
| LCL-06 | «Chuyển trường Thể tích (CBM) từ bắt buộc (mandatory) thành không bắt buộc (optional), cho phép lưu lô hàng lẻ khi khách chưa cung cấp số khối.» | LAND | FB-084 (131026190410) | form LCL · G CBM trống W lưu THEN lô lưu OK | P R27 |
| LCL-07 | «Tính cước dựa trên loại tải trọng xe (tấn) và loại cont 20/40. Cho phép gom nhiều lô lẻ đi chung 1 xe: Trả cước nhà xe theo 1 chuyến gom; Thu cước khách hàng theo 1 cước gộp hoặc tách thành nhiều cước» | LAND — theo **ruling 21/10**: thu per-lot độc lập, trả 1 dòng/chuyến, tách money-neutral, lãi = Σ thu − trả | `ea200241` (advisory) + `d375239b` (merge 9aab78d2) | /dispatch-detail → Gán xe nhóm (advisory tải trọng không chặn); /shipments-debit + /accounting/chot-debit · GIVEN 2 lô lẻ cùng KH gom WHEN xem board THEN thu per-lot (2.500.000₫/lô) + trả 1 dòng (Lô 1 1.800.000₫, member 0₫); tách giữ tiền từng lô | endgame **P 6/6** staging 9aab78d2; xung đột kỳ vọng QA (đòi chia tỷ lệ) đóng bằng ruling; luật chi tiết QuyTrinhO2C §7.11 |
| DRI-01 | «Tại màn hình chi tiết nhận lệnh, số điện thoại kho/nhà máy phải là hyperlink hỗ trợ bấm vào để gọi ngay trên điện thoại (tel: link).» | LAND + lane IN-FLIGHT `fix-dri01-dis09-visible` | `f0986f4c` | /my-trips/:id · DRIVER (quyet) 390px · G lệnh có SĐT W mở THEN "SĐT kho"/"SĐT liên hệ" là `<a tel:>`; "0901.234.567"→tel:0901234567; nút Gọi mở sheet | audit SHIPPED UI DRIVEN (qa/2026-10-21-req14-tel); QA từng trượt do sai role/URL + desktop không tel handler |
| DRI-02 | «Mở tính năng cho phép điều vận tự cập nhật, bổ sung SĐT nhà máy/kho. Xử lý trường hợp đối tác chỉ có địa chỉ mà không có SĐT để không gây hiểu nhầm lỗi app.» | VERIFY 9aab78d2 | — | master data nhà máy/kho · dieuvan · G thêm SĐT THEN lái xe thấy ngay; đối tác thiếu SĐT hiển thị "—" (không gây hiểu nhầm lỗi) | — |
| DRI-03 | «Khắc phục lỗi ứng dụng tài xế hiển thị sai lộ trình và trình tự thao tác giao nhận đối với các chuyến container chạy kẹp (2 cont 20ft).» | LAND + lane IN-FLIGHT `fix-dri03-lan2` | `1a7fc73b` | /my-trips/:id · DRIVER 390px · G chuyến kẹp 2×20DC W mở THEN 2 thẻ cont riêng + nút "Sửa số cont N" riêng; sửa cont 2 không đụng cont 1 (PATCH per-cont) | R30 FAIL → P 21/10 (card 211026132357); root-cause: hard-code containers[0] |
| DRI-04 | «Sửa lỗi trong màn hình nhận lệnh lái xe: bãi hạ không hiển thị ở Cảng hạ mà lại nhảy nhầm sang Địa chỉ giao hàng, còn Cảng hạ báo 'Chưa có nơi trả rỗng'.» | LAND (đạt R24) + lane IN-FLIGHT `fix-cus11-dri04-visible` | FB-020 `da73a743`/`3fd77532` | /my-trips/:id · DRIVER 390px · G cont IMPORT không cảng hạ nhưng có điểm trả W mở THEN "Cảng hạ" = tên điểm trả + "Địa chỉ giao hàng" đầy đủ; không "Chưa có cảng hạ" (EXPORT giữ theo luật) | đạt R24; R27 B3 8P; regpack fb020 |
| REP-01 | «Xây dựng bảng tổng hợp đo lường hiệu suất toàn đội xe trong 1 ngày, phân tích theo cơ cấu tỷ lệ phần trăm (%): Kẹp ghép, Kết hợp, Lấy lẻ, Chuyển kho.» | VERIFY 9aab78d2 | `1eac0862` | /reports · G mở chế độ ngày THEN % cơ cấu kẹp/kết hợp/lấy lẻ/chuyển kho + Excel export | SHIP; chưa có verdict P đóng |
| REP-02 | «Xây dựng báo cáo chi tiết theo từng xe nội bộ trong chu kỳ 1 tháng, phân tích tỷ lệ phần trăm (%) cơ cấu chuyến: Kẹp ghép, Kết hợp, Lấy lẻ, Chuyển kho để tính KPI.» | VERIFY 9aab78d2 | `1eac0862` | /reports · G mở chế độ tháng THEN báo cáo từng đầu xe % cơ cấu | R30 VERIFY chưa P |
| ENV-01 | «Khách hàng phản ánh việc phải nhập liệu 2 lần giữa trang test QA (vantai.tingting.vip) và trang thật (silversea.tingting.vip) gây tốn thời gian. Cần có giải pháp clone dữ liệu hoặc tài khoản demo.» | LAND (pipeline) | feat-env01-stgqa | `make stgqa` (stgdb sync + purge + reset mật khẩu + seed fixture QA) / `make stgqa-seed` idempotent | probe 13/13 PASS local; chạy thật trên staging + UI drive chờ owner |

### 7.3 REQ-01..23 (bảng trạng thái doc khách 21/10)

| REQ | Mã liên quan | Trạng thái 21/10 | Commit/evidence |
|---|---|---|---|
| REQ-01 | FB-002 | ✓ R27/28 PASS (Enter lưu); lan 3 `/shipments/new` phím chết fix `c73c7bbc` (card 211026034109) | regpack fb002 |
| REQ-02 | DIS-01 | ? CẦN VERIFY | — |
| REQ-03 | DIS-02 | ◐ a5e0039b đổi luồng; 1-chạm icon chưa commit riêng | useIssueOrder |
| REQ-04 | DIS-03 / FB-012 | ✓ R27 B2 write-test PASS (cont 2 có cảnh báo xác nhận, không chặn) + endgame spot P | 181026145600 → f6cbe97c → 3349fd52 |
| REQ-05 | FB-114 | ? CẦN VERIFY (autocomplete hãng tàu riêng) | nút "+ hãng tàu" persist `08325ed6` |
| REQ-06 | — | ✓ chọn-all số cont + Ngày mặc định (khai chi phí + tạo lô) | QA verify màn CUS |
| REQ-07 | — | ✅ SHIPPED + STG VERIFIED 21/10 (T-01/T-02 UI 390px staging 454fab6b; T-03 penalty unit-only — staging 0 penalties, cần owner fixture) | qa/2026-10-21-req07-tripcode-stgverify @ d9531452 |
| REQ-08 | DIS-04 | ✓ tab "Chưa gán xe 52 \| Đã gán xe 47" (screenshot R27) | — |
| REQ-09 | CUS-04 | ? CẦN VERIFY (focus event) | — |
| REQ-10 | CUS-07 | ? CẦN VERIFY | — |
| REQ-11 | REP-01/02 | ✓ 1eac0862 — verify đủ 2 chế độ còn mở | — |
| REQ-12 | DIS-06/07 | ◐ enum có Lấy Lẻ; 007352d6 chỉ cont-flow — QA verify luồng | — |
| REQ-13 | DIS-05 | ◐ FB-030/075 "đạt có điều kiện" — giữ mở chờ ma trận input-order | 22c9c80b, c58f570e, 3349fd52 |
| REQ-14 | DRI-01 | ✓ f0986f4c (+audit UI DRIVEN) | qa/2026-10-21-req14-tel |
| REQ-15 | DIS-09 | ✓ a5e0039b phát lệnh chờ biển số | — |
| REQ-16 | LCL-02/06 | ✓ kho quick-add 032145a2, FB-105 5040/5040 | — |
| REQ-17 | LCL-03 | ✓ field-cleanup + FB-084 R27 PASS | — |
| REQ-18 | DRI-04 | ✓ FB-020 đạt R24; FB-082 (121026141020) cùng họ | regpack fb020 |
| REQ-19 | LCL-07 | ✓ luật mới d375239b (ruling 15:22) | endgame 6/6 |
| REQ-20 | LCL-04 | ✓ FB-084 R27 PASS (CBM trống lưu OK) | — |
| REQ-21 | FB-085/109/110 | ✓ tờ khai tự copy R27; verify-fail A1 ×2 (201026090100, 201026124500) đã đóng; **ruling 22/10 cards 221026095229/221026095329 (CUS-05 clarify): inline edit @Chi tiết lô + nhập 1 cont sync mọi cont** | 131026200630 họ |
| REQ-22 | FB-111/086 | ✓ + **ruling 21/10: tự copy KỂ CẢ Loại cont** `017adf63` | regpack fb111; qa/2026-10-21-fb086-autocopy |
| REQ-23 | TICKET-09 + FB-113 | ✗ **SUPERSEDED 22/10** — FB-112 REVERSED: bật lại nút Thêm/Xóa @Chi tiết (Zalo 22/10 09:50, QA xác nhận bỏ ruling by-design); TICKET-09 không còn hiệu lực, "bỏ nút @Chi tiết" (R29) chỉ đúng tới hết 21/10 | pin vitest "no Thêm container affordance" cần gỡ khi implement bật lại |

### 7.4 FB / phiếu theo mảng (consolidate từ 222 phiếu)

Legend: 🔒 = regression-pack locked (`testplan/2026-10-21-regpack-regression-pack.md`, 12 spec Playwright, `pnpm reg:local` 17/17).

**CUS — form & chứng từ**

| ID | Nguồn | Spec 1 dòng | Commit | QA verdict | Verify-fail / root-cause |
|---|---|---|---|---|---|
| FB-005 | 121026141000 | Nút "+ Thêm tờ khai" bị mất → khôi phục | — | PASS (doc) | — |
| FB-006 🔒-họ | 101026163000 + 121026185510 + 171026113500 | Cell Nhà máy hiện tên + kính lúp, không full combobox | card 2026-10-10 picker-reveal | PASS (doc) | ×2 verify-fail: combobox lingers sau chọn |
| FB-007 | 111026175000 + 121026185520 | SĐT nhà máy hiển thị ở picker + popup chi tiết | — | PASS 1/2 → PASS (doc) | Một nửa (picker) trượt vòng đầu |
| FB-009 | 101026163010 + 111026111200 + 131026233500 | Nút copy thời gian per-row | — | PASS (doc) | ×2 verify-fail: nút không tồn tại ở vòng sau (flaky) |
| FB-085 họ | 131026200630/131026201700 + 141026012500 | Số tờ khai per-container + auto-copy; regression mất input → FIXED | — | P R17 + regression đóng | — |
| FB-086 🔒-họ | 131026201000 + 171026113520 + 201026234505 + 211026112600 + 221026173728 | Sửa lô @Chi tiết (containers giữ read-only theo TICKET-09 — **TICKET-09 superseded 22/10**); thêm cont tự copy — **kể cả Loại cont theo ruling 21/10, REVERSED 22/10 (ticket 221026173728): Loại cont TRỐNG lại như A.1 nguyên văn** | 7d1f5c1f (Sửa lô) + 4a35d3cf/017adf63 (autocopy, type-copy bị hủy) | R29 invalid-at-surface 1 phần → land; autocopy P (local repro); reversal 22/10 | QA tick lại phần "thêm cont@chi tiết" = INVALID theo TICKET-09 (**hết hiệu lực 22/10** — FB-112 REVERSED); loại cont: A.1 cũ → ruling 11:26 khôi phục client-side → **22/10 hủy ruling 11:26 — trống lại** (ticket 221026173728) |
| FB-105 | 171026115800 + 181026143000 | Kho lấy/trả trống + label theo chiều → fix + dialog quick-add | 032145a2 | P (5040/5040) | — |
| FB-106 | 171026115810 | FCL sau tạo lô chuyển chi tiết + nút "Tạo lô mới" | — | PASS (doc) | — |
| FB-107 | 171026115820 | "Nơi giao/Nơi nhận" trống → thay bằng Nâng/Hạ; **LCL @Chi tiết lô: cột Nâng/Hạ hiển thị điểm đóng/trả** (ruling 22/10 card 261022093846 — LCL không có khái niệm nâng/hạ, hết "Chưa cập nhật") | `ca57c8fc` (LCL đóng/trả) | PASS (doc) + LCL đóng/trả P 22/10 | — |
| FB-108 | 171026115830 | Cụm thao tác cuối trang tạo lô | — | PASS (doc) | — |
| FB-109 | 171026122100 | Popup tờ khai auto-copy/lưu chạy đúng | — | PASS (doc) | — |
| FB-110 | 171026122110 | Nhập tờ khai lưu được, không mất | — | PASS (doc) | — |
| FB-111 🔒 | 171026122120 + 191026090405 | Thêm cont copy trường chung | ef90a995 + 017adf63 (Loại cont) | P R27 + regpack | Copy thiếu trường từng vòng |
| FB-112 | 171026122130 | Bổ sung nút Thêm/Xóa cont @Chi tiết | **REVERSED 22/10** — bật lại nút @Chi tiết (ruling Zalo 22/10 09:50; QA xác nhận bỏ ruling by-design TICKET-09) | — | TICKET-09 `171026182554` superseded; chờ implement bật lại + gỡ pin vitest |
| FB-113 🔒 | 171026122140 | Thứ tự chứng từ — **BILL/BOOKING → SỐ TỜ KHAI → NHẬP/XUẤT → HÃNG TÀU** (ruling 22/10 card 221026095429) | ba9981c2 + `ca57c8fc` | P (R26 + standing + audit) | 3 surface trùng tên |
| FB-114 | 171026122150 + 171026185348 | Nút "+" hãng tàu + persist danh mục | 08325ed6 | P sau verify-fail | Chưa lưu danh mục chung vòng 1 |
| FB-115 | 171026122160 | Gán xe nhóm hàng lẻ thực hiện được | (đóng qua LCL-07) | PASS (doc) | — |
| 171026000406 | — | Bỏ bit "thiếu thông tin" tờ khai per-cont khỏi completeness | — | PASS (doc) | — |
| 171026000407 | — | FCL cũng hiện 2 dòng phân xe khi BKS báo khách ≠ thực | — | PASS (doc) | — |
| 161026232339/49/59/69 | — | Chi tiết lô: loại xe thu/trả + 2 dòng phân xe; tách cước chọn loại xe từng lô; checkbox ghép cước desktop; BKS báo khách chọn từ danh mục | — | PASS (doc, DEV COMPLETED 18-19/10) | — |
| 171026154000 / 161026100400 | — | Lô hàng lẻ ngoài trang 1 + bộ lọc loại hàng; lô lẻ lúc hiện lúc không | — | PASS (doc) | — |
| 191026181942 họ (8 phiếu) | — | Tổng quan/chi tiết LCL: lịch trình sai, phân xe thừa, ẩn CBM, wording, dialog phân bổ cont, chi phí thiếu màu đỏ, chốt debit nhiều cột, tên ngắn KH/nhà xe/tuyến | 191026100000..2030 + 201026095604a/b | DEV XONG → PASS (doc) | — |

**Điều vận**

| ID | Nguồn | Spec 1 dòng | Commit | QA verdict | Verify-fail / root-cause |
|---|---|---|---|---|---|
| FB-012 | 181026145600 | Cont 2 cặp kẹp không báo nhầm "trùng đầu kéo" | f6cbe97c | P R27 B2 | Regression sau guard overlap |
| FB-014 | 201026112500 + R26 | Click lô mở dispatch detail (date thắng month bounds) | 37838c06 | P R26 staging d39ee741 3/3 | — |
| FB-038/072 | 101026043000 + 121026185530 + 171026121100 (xem DIS-07 phần trùng lịch) | Cảnh báo trùng lịch khi gán xe (confirm "Vẫn lưu?") | 9d109c0d + 3349fd52 | P endgame | ×3 verify-fail |
| FB-043 | 141026001010 + 201026164000 | Hàng bảng đều chiều cao | 0245b9f5 | P sau regression #33 | Dòng lịch trình kéo cao hàng |
| FB-045 🔒 | 201026140000 | Dialog giờ không clip cột GIỜ HẸN | bb394516 + 31bcbb2a (lan 2) | P lan 2 (4 viewport × 2 drawer) | Lan 1 floored header chưa đủ: select min-width tràn + cột % bóp |
| FB-066 🔒 | 101026043010 + 121026141040 + 141026012020 + 191026102040 + 201026101600 | Quick-add biển số xe (editor + dialog Phân bổ nhà xe LCL) | 22c9c80b + 22b8b65a (lan 3) | P lan 3 + flake test đóng d19c82b5 | ×3 verify-fail nút thiếu; flake Escape đua focus async react-aria |
| FB-081 🔒 | 181026003045 | Phân xe lại kẹp không bị chặn "tuyến không hợp lệ" | 7562ea7a/89dc27dd | P + regpack | Reassign không pair-aware; cặp kẹp chỉ xe nội bộ (owner law) |
| 161026232309 | — | Popup gán xe lẻ chọn Nhà xe + BKS từ danh sách xe ngoài | — | PASS (doc) | — |
| 171026133000 | — | Popup Gán xe nhóm giữ lựa chọn khi mở lại | — | PASS (doc, verify-fail đóng) | — |
| 171026142500 | — | Gán xe nhóm tự tra cước trả ĐV từ bảng giá | — | PASS (doc, verify-fail đóng) | — |
| 181026185900 A–D | — | DEV COMPLETED 18/10: chứng từ/cont/tờ khai; form LCL; đổi nhà xe + phát lệnh; lái xe bãi hạ | a5e0039b, 0f7e1dfa, 032145a2… | PASS (doc) | — |

**Kế toán — chi phí & debit**

| ID | Nguồn | Spec 1 dòng | Commit | QA verdict | Verify-fail / root-cause |
|---|---|---|---|---|---|
| FB-033 | 111026164510 + QA1-002 + 121026185500 + 171026121110 + 141026230710/720 + 191026160000 | Ops/kế toán khai chi phí lô; chi phí vừa tạo sửa/xóa được tới settlement thủ công | 19a9cc5b/9d60f507 | P R29 (PASS-already-fixed c643ef1e) + UI DRIVEN | Auto-offset settlement tạo trong tx tạo chi phí → guard đọc nhầm "đã gửi kế toán" |
| FB-061 🔒 | 141026012010 + 121026185570 + 161026171000 + 201026112400 | Dữ liệu seed/test không lộ trên staging (/users, phơi phiếu) | 285e20e8 → 0b870f61 (lan 2) → 3ac4b779 (lan 3) | P lan 3 UI DRIVEN; residual soft-delete in — CẦN RULING | Registry mis-classify; /users catalog không bị quét; demo-BU cần hard-delete; ENV-01 `make stgqa` giải fixture |
| FB-093 🔒 | 191026100833 a/b + 211026024348 + R29 | BKS-ảo click sửa; nút Ghép cước thu khách; nút Tách nhóm (CUS + Kế toán) | 43919840 → 3651d0d0 → a2ff0f56 → ebd032fb → 0c263b00 (lan 3) | P R29F 5/5 (staging-built FE 806acf89) | Kế toán: `defaultVisible:'essential'` ẩn cột chứa nút; test cũ ép localStorage không bắt va chạm 2 luật |
| FB-094 | 181026145620 + 201026112300 + 161026232429/439 + 171026004331 + 171026022737 + 171026004332 | Xuất Debit Note: BKS/Loại xe in đúng (BKS báo khách cho KH, BKS thực cho nhà xe), chú thích "Ghép xe cùng Bill", renderData endpoint HTML/PDF | 239556ec + 150acee0 + 006ba100 | P sau verify-fail 201026112300 | Endpoint bỏ renderData; renderer generic bỏ cột template; thiếu chữ "xe" (171026140000) |
| FB-095 | 171026105447 + 181026145610 + 161026054700 (C-2) + 211026005623 | Nút Hủy ghép/Tách nhóm; nhóm ma unmerge; Xóa lô (Điều vận) | 0e325cc4 + 903ec1cc | P (UI DRIVEN qa/2026-10-21-fb095) | Nút giấu sau badge; role-law xóa lô chờ nới theo ruling 07:54 (§7.1-2) |
| FB-096 🔒 | 141026230730 + 171026212000 + 201026112200 | Thêm cược gợi ý bill 4 số cuối | 295dd98a + 150acee0 | P + regpack | Digit-tail match sai chiều; regression B5 |
| QA2-001/002 | 121026084633/643 | Kế toán mở /users (đã chặn); đọc /trips /fleet /penalties theo quyền | — | PASS (doc) | — |
| 141026230740/760/770 + 181026183600 + 191026201900/202000 + 201026090200 | — | Gọn form thêm khoản chi; giao diện chốt debit; tạm ứng/h hoàn ứng nút duyệt + tick + số âm; rút gọn tên chi phí | hoanung-am evidence (số âm/duyệt) + 191026202000 | PASS (doc) + UI DRIVEN qa/2026-10-21-hoanung-am | — |
| 161026232319/329 | — | Lô 1 tự tra cước trả nhà xe; cont nội bộ tiền đường/lương tính 1 lần Lô 1 | — | PASS (doc) | — |
| 171026013117 | — | Snapshot cấp lô mất chú thích formula_text + gợi ý sai | — | PASS (doc) | — |
| 261019135404 | — | BE standing red card 7 fee norms AC3 | (đóng qua canonical) | P 668/668 main 21/10 | — |

**Lái xe**

| ID | Nguồn | Spec 1 dòng | Commit | QA verdict | Verify-fail / root-cause |
|---|---|---|---|---|---|
| FB-019 | 211026005621 | Banner "xe đang chạy chuyến" không lộ mã TRP nội bộ (dùng Bill/Booking) | 2fffbc7b | P R29 c643ef1e 5/5 | 409 message điều vận render thẳng vào banner lái xe |
| FB-020 🔒 | xem DRI-04 + 171026180006 | Cảng hạ/địa chỉ bãi hạ đúng | da73a743/3fd77532 | P R24→R27 + regpack | Map nhầm bãi hạ vào địa chỉ giao |
| FB-036 | 201026135900 | SĐT lái xe regression | bb394516 | P (doc) | — |
| FB-049 | 181026145630 | Nhãn kỷ luật thiếu dấu cách | — | PASS (doc) | — |
| FB-055 | 111026164500 + 121026185550 | Card Chứng từ giao hàng ≤60px | — | PASS (doc) | Verify-fail 180px sau fix 65px (flappy) |
| FB-069 | 101026163030 + 121026141030 | Trọng lượng không số thập phân | → CUS-08 (tấn) | P theo luật mới 21/10 | "500.00"/"15000.00" là định dạng kg |
| FB-082 | 121026141020 | Địa chỉ giao hàng ≠ cảng hạ | (cùng FB-020 họ) | P | — |
| 141026230700 / 181026182300 / 261019135404 | — | Redesign 2 bảng chi phí lái xe; lái xe sửa tiền đường; card 7 AC3 | — | PASS (doc) | — |
| QA2-009 | 121026084753 | /users empty state + hint sai ngữ cảnh kế toán | — | PASS (doc) | — |

**Ops / Admin / hệ thống**

| ID | Nguồn | Spec 1 dòng | Commit | QA verdict | Verify-fail / root-cause |
|---|---|---|---|---|---|
| QA1-001/003/004/006/007 | 1210260845xx | Placeholder Bill; login flaky; duplicate API calls; chip "Bắt buộc" khớp validation | — | PASS (doc; QA1-007 ×2 verify-fail) | Flaky single-observation |
| QA2-003/004/006/007/008/010 | 1210260846xx-8xx | Deep-link denial; /my-orders search/filter/sort; caps-lock hint; password recovery; sidebar taxonomy; date placeholders | — | PASS (doc; qa2-004 sort + qa2-008 ×2 verify-fail) | — |
| FB-030/075 🔒-họ | 121026084613 + 171026215500 + 191026102040 | Segmented date/time auto-advance, không rơi phím số | 22c9c80b + c58f570e + 5ef5ace7… | ◐ "đạt có điều kiện nhập" — giữ mở chờ ma trận input-order | auto-advance và Enter tương tác phức tạp (fb002 spec) |
| FB-051 | 101026163020 | Penalty config save có toast | — | PASS (doc) | — |
| FB-057 | 111026105620 + 121026185560 + 141026012000 | Topbar search mở rộng khi focus (không cap 360px) | — | PASS (doc sau ×2 verify-fail) | Cap 360px giữ nguyên qua 2 vòng |
| FB-063 🔒 | 181026021137 + 201026101500 | Header bảng không wrap nhiều dòng | 597e4c84/38857051 + 2072d933 | P + regpack | ×2 regression |
| FB-074 | 101026163040 | LCL overview vs detail data mismatch (caveat) | — | PASS (doc) | — |
| Unaccented seed | 111026105610 + 171026123000 | Dữ liệu seed không dấu sạch khỏi UI | (FB-061 họ) | P (doc sau verify-fail) | — |
| R27 session | — | Không tự rớt phiên/đổi user: multi-role = 1 trình duyệt/role; toast swap | (r27-session fix) | P probe 10 phút 0 rớt | Root-cause: shared-token multi-tab trong 1 profile — chuẩn thiết kế, không bug |
| PWA standalone | user report 20/10 | Ẩn footer/branding khi cài PWA (iOS navigator.standalone) | (fix-pwa-standalone) | P local; iPhone thật sau deploy | iOS WebKit không evaluate media query |
| ENV-01 | đề xuất 21/10 | `make stgqa`: clone prod→staging + auto-purge + fixture QA riêng | (feat-env01-stgqa, f0877875-related) | DONE pipeline 13/13 local; staging chạy thật + UI drive còn chờ owner | — |
| Chấm công họ | 141026230780/0790/0800/0810 | Mục chấm công hiện; ký hiệu K/Q/Đ/L/N/P; 2 chế độ lương; báo cáo xếp lệnh tháng | — | PASS (doc) — chưa tra được test khóa (§7.1-5) | — |
| Bảng giá | 161026095800 + 161026121500 | Thêm giá theo Loại xe; phantom duplicate sau xóa | — | PASS (doc) | — |

### 7.5 Vòng QA R14–R30 ↔ build

| Vòng | Build | Ghi chú |
|---|---|---|
| R16 | staging 10-12/10 | Verify-fail batch FB-006/007/048/057/061/066… |
| R17 | 5ef12393 | Batch 1-8 toàn diện (CUS/ĐV/lái xe/kế toán/ops) |
| R20 | c7dcc286 | Verify 4 fix R19 |
| R21 | 17/10 | Verify-fail FB-030/075, FB-103, thêm cược, ghi chú "Ghép cùng Bill" thiếu chữ "xe" |
| R22 | 18/10 | Regression FB-002, FB-063, FB-012, FB-081 |
| R24–R25 | 17-19/10 | FB-020 đạt R24; FB-113 standing bf3a0ff9 |
| R26 | d39ee741 | 7/7 PASS (FB-014 + spot FB-113/FB-093) |
| R27 | 106a25e3 | FB-002/030/075 có điều kiện; FB-084 PASS; session probe |
| R29 | c643ef1e | FB-019/033/002/048 PASS-already-fixed; FB-093 → fix ebd032fb |
| R29F | 806acf89 (drive-time) | FB-093 PASS 5/5 trên staging-built FE |
| R30 (QA) | 6110af65 | 9 card chấm "chưa implement" → audit lật toàn bộ (surface mismatch); dis-02/03/05/08/10 FAIL → 3349fd52 |
| R30-endgame | 9aab78d2 | PASS 6/6 staging: LCL-07 a-d + dis-03 + dis-05 |
| QA 18:04 21/10 | 9aab78d2 | DIS-08 verify-fail lần 2 (wedge cột Hàng) → lan 2 `5b77082f` P local, deploy giữ đến wave close |
| QA 22/10 (R32 freight-lag) | local dev `839d0577` (feat-quote-engine-wiring) | **PASS**: UI lag mặc định 1 (NEWEB) · route NEWEB id=12 130km đã tạo · engine áp (transport_date − lag) — case `testplan/cases/case-QA-2026-10-22-quote-engine-wiring.md` QE-R4/R5. **Outstanding:** tạo khung giá qua UI fail-im-lặng (đang điều tra) |

Ghi chú: lúc chốt bản này còn lane in-flight theo nguồn 21/10 (main `18f8abd9`):
`fix-cus11-dri04-visible` (CUS-11+DRI-04), `fix-dri01-dis09-visible` (DRI-01+DIS-09),
`fix-dri03-lan2` (DRI-03 lan 2), `fix-lcl-form-visible` (LCL-02/03/04/05) — verdict các bề
mặt đó có thể đổi khi wave đóng. Đã merge vào main: `fix-dis08-lan2` (`5b77082f`) và
`fix-lcl01-lan2` (`39a57de9`); deploy staging được giữ đến wave close.

### 7.6 Chưa có test khóa

CUS-01, CUS-02, CUS-04, CUS-05, CUS-06, DIS-06 luồng Lấy Lẻ, DIS-07, DRI-02, REP-01/02
(cả nhóm "verify 9aab78d2"), FB-005, FB-009, FB-051, FB-055, FB-057, FB-069 (đóng bằng luật
hiển thị CUS-08, formatWeight), FB-074, FB-106..FB-110, FB-112 (REVERSED 22/10 — mở lại nút
Thêm/Xóa @Chi tiết theo Zalo 22/10 09:50, TICKET-09 superseded; chưa có test khóa cho nút bật lại),
FB-115, nhóm phiếu 16/10 CUS (161026232xx), 171026000406/0407, 171026154000, 161026100400,
191026181942 họ đã DEV XONG nhưng spec khóa = unit suite theo lane, nhóm chấm công
(1410262307xx), bảng giá (161026095800/121500), 181026180300, 181026183500, QA1-003/004,
QA2-003/006/007/010, FB-103, PWA trên iPhone thật, ENV-01 staging-run. Các bề mặt 🔒 đã có
spec regression-pack (`frontend/e2e/regression/`, chạy `pnpm reg:local`).

<!-- rows merged from fix-cus-tokhai-cont (union 22/10) -->
| REQ-23 | TICKET-09 + FB-113 | ✓ bỏ nút @Chi tiết ("regression" R29 là ĐÚNG); thêm cont chỉ ở TỔNG QUAN | pin vitest |
| FB-107 | 171026115820 | "Nơi giao/Nơi nhận" trống → thay bằng Nâng/Hạ | — | PASS (doc) | — |
| FB-112 | 171026122130 | Bổ sung nút Thêm/Xóa cont @Chi tiết | MỞ LẠI 22/10 — card 261022095235b (Zalo 09:50) supersede TICKET-09 | `261022095235b` | Đóng theo TICKET-09 17/10 → khách yêu cầu bật lại; /shipments/:id host ledger chia sẻ của drawer (thêm/xóa hoạt động, QA 15/15 UI) |
| FB-113 🔒 | 171026122140 | Thứ tự chứng từ | ba9981c2 | P (R26 + standing + audit) | 3 surface trùng tên |
