# Lịch sử thay đổi PRD

Nhật ký các quyết định đã có hiệu lực. Quy tắc đang áp dụng nằm trong tài liệu
tương ứng; file này chỉ ghi **khi nào** và **vì sao** một quy tắc ra đời hoặc bị bỏ,
để tra cứu khi đối chiếu hồ sơ cũ. Không dùng file này làm nguồn yêu cầu.

## 2026-09-20 — Khóa hiển thị nghiệp vụ, phụ phí vùng, chính sách hóa đơn

- **Khóa hiển thị là khóa nghiệp vụ** (`QuyTrinhO2C.md` §7.9): Số Bill/Số Booking là khóa nhận diện trên mọi màn hình, số tờ khai thứ hai, tên khách + ngày chi khi vắng chứng từ, vắng hết hiển thị "—". Mã nội bộ (SHP-*, TRP-*, mã chứng từ, #thứ tự) chỉ là khóa kỹ thuật, không bao giờ hiển thị; tiêu đề/thông báo sinh lại theo khóa nghiệp vụ bằng một bộ sinh dùng chung.
- **Phụ phí vùng và Phí khác hai số** (`QuyTrinhO2C.md` §7.9): cột phụ phí vùng Bảng 2.3 đối xứng cột thu 2.1, nhãn đọc từ cấu hình danh mục; nguồn theo bậc điều vận › lái xe ứng trước › cấu hình cảng; vắng nguồn hiển thị "—" không tự 0; lô khóa giữ số snapshot. Dòng Phí khác mang hai số tách biệt (chi hộ / thu khách) nhập riêng.
- **Dòng có hóa đơn giữ nguyên khóa** (`QuyTrinhO2C.md` §7.9): dòng chi phí đã có số hóa đơn không sửa số trên màn quyết toán — đổi tại nguồn chi phí theo quy trình.
- **Năm loại yêu cầu hóa đơn** (`OpsVanHanh.md` §9.1): nâng, hạ, cân hàng, cơ sở hạ tầng, kiểm hóa là nhóm "yêu cầu hóa đơn" trên đường phê duyệt — không chấp nhận bằng chứng thay thế; chỉ Phí khác/kiểm dịch vụ cân nhắc bằng chứng thay thế. Cờ là cờ đường phê duyệt, không phải khóa sửa theo loại.
- **Báo phiên bản mới trên tab mở lâu** (`QuyTrinhO2C.md` §8.2): tab mở qua một đợt cập nhật hệ thống được ứng dụng báo có phiên bản mới và cho làm mới khi người dùng chọn; không tự tải lại giữa chừng làm mất nội dung đang nhập.

## 2026-09-19 — Danh mục là dữ liệu, nhóm quyết toán, khóa lô và bảng quyết toán

- **Cảng và vùng phụ phí là dữ liệu** (`MasterDataNhaMay.md` §8): thêm/đổi tên/ngưng dùng cảng thuần thao tác danh mục — không cần thay đổi phần mềm; gán cảng vào vùng phụ phí theo cấu hình trên cảng; vùng có cờ mặc định; lô đã khóa giữ nhãn cảng/vùng tại thời điểm khóa.
- **Nhóm quyết toán trên loại chi phí** (`OpsVanHanh.md` §9.1): mỗi loại chi phí do người có quyền gán một Nhóm quyết toán; bảng quyết toán của lô nhóm tiền theo nhóm này, nhóm Chưa phân loại giữ mọi đồng chưa phân; tổng luôn khớp; đổi nhóm không viết lại chứng từ đã phát hành. Phí cân hàng mặc định nhóm Phát sinh.
- **Khóa lô và bảng quyết toán theo lô** (`QuyTrinhO2C.md` §7.9): khóa lô đóng băng số tiền, luồng hải quan và nhãn cảng tại thời điểm khóa; bảng quyết toán hai lớp — dòng có hóa đơn tự tính lại theo quy tắc loại chi phí, chỉ Phí khác do CUS tự nhập; chưa xác định hiển thị Chưa xác định, không tự 0; nhóm Chưa phân loại bảo toàn mọi đồng; lô đã thuộc bảng kê không vào đợt khác — khoảng ngày theo ngày giao của các lô được chọn.
- **Cước chân hủy và khóa hiển thị** (`QuyTrinhO2C.md` §7.9): chân vận chuyển đã hủy không tính cước vào lớp tổng — chân không chạy thì không tính tiền khách, lớp tổng luôn khớp lớp chi tiết; cước đóng băng khi phát hành lô (chưa gắn chân) vẫn tính vào lớp tổng dù lớp chi tiết chưa hiển thị được — ngoại lệ đã ghi nhận. Trên mọi màn hình, lô được nhận diện bằng khóa nghiệp vụ Số Bill/Số Booking, không hiển thị mã nội bộ.

## 2026-09-18 — Các mốc ngày cước thuộc năm 2026

Chủ sản phẩm xác nhận các nhãn kỳ giá dầu trong tài liệu cước (mốc 26/02, kỳ 11/7
và 18/7) thuộc **năm 2026**. Tài liệu ghi năm đầy đủ; kỳ giá sau này sang năm mới
phải ghi năm rõ, không dùng lại nhãn không năm.

## 2026-09-18 — Lệnh chạy ngoài: sửa định nghĩa, bỏ cơ chế "bỏ qua kiểm tra cước"

- Định nghĩa đúng: lô/con hàng **không do SilverSea tạo ra**, đi xin từ bên ngoài
  để chạy những hôm thiếu lệnh hoặc đoạn xa nhà; trường hợp này **chỉ có cước do
  khách báo và các phí chi hộ**; là dạng lô đặc biệt **bỏ qua nhiều thao tác hoặc
  chi phí** không áp dụng.
- Bỏ cách gọi **"Cuốc vãng lai để tối ưu xe rỗng"** và hậu tố "(Tối ưu xe rỗng)"
  trên nhãn chọn.
- Bỏ quy tắc **"tích chọn chạy ngoài ⇒ bỏ qua (bypass) kiểm tra định mức cước phí
  để đẩy nhanh lệnh sang Điều vận"**. Việc không áp bảng định mức cước nội bộ là
  bản chất của loại lô này, không phải một van bỏ kiểm tra.
- Phạm vi: `MasterDataNhaMay.md` §1, §4, §6; `QuyTrinhO2C.md` §4.4.

## 2026-09-17 — Không còn ngoại lệ phê duyệt nội bộ

Quy tắc thao tác trực tiếp áp dụng cho mọi nghiệp vụ hiện hành, gồm tạo khách
hàng/danh mục, sửa lô, điều vận, hồ sơ giao nhận, chi phí, tạm ứng/hoàn ứng, nhiên
liệu, hạn mức tín dụng, chấm công, lương và khóa/mở kỳ. Không giữ màn hình, hàng đợi,
nút hoặc thông báo phê duyệt để chờ triển khai sau; không mô phỏng các bước
kiểm tra/duyệt phía sau một nút lưu. Người đủ quyền thực hiện đúng nghiệp vụ trực
tiếp, người thiếu quyền vẫn bị từ chối. Lịch sử quyết định cũ vẫn đọc được khi cần
đối chiếu, nhưng không tạo thao tác duyệt mới hay làm thay đổi tiền đã ghi. Yêu cầu
ứng chỉ là yêu cầu cấp tiền; chỉ giao dịch thực tế mới ghi tiền nhận/chi. Nhận lệnh,
xác nhận giao hàng, đối chiếu và khóa kỳ giữ đúng ý nghĩa nghiệp vụ riêng.

## 2026-09-16 — Chi phí Ops/lái xe, phơi phiếu và thu/trả

Yêu cầu từ `các chi phí.docx` được ghi tại [Ops](OpsVanHanh.md) §9,
[Lái xe](ManHinhLaiXe.md) §8 và [O2C](QuyTrinhO2C.md) §7.4. Chi thực tế, số tính cho
khách và tiền đã thu/trả là những thông tin tách biệt; đối chiếu không tạo thêm dòng
tiền hoặc cấp duyệt. Các điểm nguồn chưa hoàn thiện được giữ tại nghiệp vụ liên quan,
không tự suy ra giá hay ngưỡng cảnh báo.

## 2026-09-14 — Thao tác trực tiếp, cần Internet, trải nghiệm gọn trên mọi thiết bị

- Người có quyền lưu, phát hành, điều chỉnh hoặc hủy trực tiếp sau khi đáp ứng quy
  tắc nghiệp vụ. Ứng dụng không có quy trình gửi duyệt, người duyệt, chờ duyệt theo
  cấp tiền hoặc tự động duyệt.
- Lái xe nhận lệnh và khách hàng xác nhận thực tế giao hàng là các sự kiện nghiệp
  vụ cần giữ. Xác nhận một thao tác của chính người dùng, chẳng hạn xác nhận hủy,
  không phải bước phê duyệt của người khác.
- Ứng dụng cần Internet để làm việc.
- Ghi nhận chi phí, thiếu chứng từ, hoàn thành vận chuyển, đã thanh toán và đã khóa
  kỳ là những tình trạng khác nhau.

## 2026-09-09 — Các quyết định cước đã được khách hàng xác nhận

Kẹp phụ phí dầu về 0 khi giá dầu kỳ thấp hơn giá mốc (Câu 1 = B); luôn tính km khứ
hồi theo hợp đồng, kể cả chuyến một chiều (Câu 4 = A); chọn **Ngày vận chuyển** làm
mốc áp giá; không hồi tố cước đã chốt. Giá trị, phạm vi và điều kiện cụ thể nằm
trong các tài liệu cước.
