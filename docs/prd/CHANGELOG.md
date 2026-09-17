# Lịch sử thay đổi PRD

Nhật ký các quyết định đã có hiệu lực. Quy tắc đang áp dụng nằm trong tài liệu
tương ứng; file này chỉ ghi **khi nào** và **vì sao** một quy tắc ra đời hoặc bị bỏ,
để tra cứu khi đối chiếu hồ sơ cũ. Không dùng file này làm nguồn yêu cầu.

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
