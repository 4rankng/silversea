# Lịch sử thay đổi PRD

Nhật ký các quyết định đã có hiệu lực. Quy tắc đang áp dụng nằm trong tài liệu
tương ứng; file này chỉ ghi **khi nào** và **vì sao** một quy tắc ra đời hoặc bị bỏ,
để tra cứu khi đối chiếu hồ sơ cũ. Không dùng file này làm nguồn yêu cầu.

## 2026-09-22 — Chi phí theo lô: danh mục dữ liệu, sổ quỹ hai nguồn, phôi phiếu, hoàn ứng, hoàn cược

- **Danh mục phí là dữ liệu, phân loại lái xe theo danh mục dùng chung** (`OpsVanHanh.md` §9.1, §9.4): danh mục phí chi hộ và định mức tiền đường nạp theo cấu hình (fill-only — không ghi đè sửa tay của người dùng), tên phí và mức tiền là dữ liệu; lái xe chọn loại phí từ danh mục dùng chung, lớp có-hóa-đơn/không-hóa-đơn do máy chủ quyết từ cờ của danh mục; dòng có hóa đơn phải kèm số hóa đơn và thu khách sau khi kế toán đối chiếu, dòng không hóa đơn không bao giờ thu khách.
- **Định mức tiền đường nạp trong bước seed của lần dựng** (`OpsVanHanh.md` §9.5): môi trường mới có đủ danh mục + định mức ngay sau khi dựng; chạy lại không nhân đôi, không ghi đè; nhãn "Lưu bãi" tách theo họ nâng/hạ ("Lúc nâng"/"Lúc hạ") theo chốt của khách.
- **Sổ quỹ tách hai nguồn và đọc theo nguồn** (`OpsVanHanh.md` §5.2): mỗi phiếu thu/chi gắn đúng một nguồn quỹ (TK công ty ACB hoặc Tiền mặt); sổ theo từng nguồn đọc được riêng, tài khoản chưa gắn nguồn được đếm riêng, không lẫn vào sổ nào.
- **Bảng kiểm chi phí Ops và báo cáo hoàn ứng tháng** (`OpsVanHanh.md` §9.2): kế toán tích xác nhận từng dòng hoặc tích tất cả, ghi ngày và người xác nhận; báo cáo tổng hợp hoàn ứng theo nhân viên: tiền ĐNTT (chỉ đếm khoản đã xác nhận) − tạm ứng còn giữ = còn phải hoàn ứng, kèm nhãn chiều số (công ty thanh toán hoàn ứng / công ty thu lại), không hiện số âm trần trụi.
- **Bảng điều khiển phôi phiếu và theo dõi hóa đơn kết hợp** (`OpsVanHanh.md` §9.2): kế toán quản lý phiếu thu/chi theo chuyến trên một bảng điều khiển, gom dòng cùng xe liền nhau; theo dõi số hóa đơn, số tiền hóa đơn và tiền trả nhà cung cấp theo lô, CUS xem chỉ-đọc.
- **Theo dõi hoàn cược container** (`OpsVanHanh.md` §9.6): lô khách khai "có cược" tự vào bảng theo dõi; kế toán điền ngày nộp công văn (dd/mm/yy hoặc lịch), ngày dự kiến hoàn cược mặc định +14 ngày và vẫn sửa được; tick "đã hoàn cược" ghi nhận đã thu và đổ tiền về quỹ công ty (ACB) qua engine kho quỹ hiện có; hai cảnh báo chạy song song (lô quá 7 ngày chưa có ngày nộp công văn; tổng tiền chưa hoàn cược).

## 2026-09-21 — Quyền chi phí Ops theo xe, guard giai đoạn, Lớp 1 đọc bản chốt mới nhất

- **Quyền khai chi phí của Ops sinh từ gán xe (auto-link theo xe)** (`OpsVanHanh.md` §3.3): chủ sản phẩm chốt — Ops được gán đầu xe (phân công xe–Ops) tự có quyền lưu chi phí trên các lô do xe đó chở; gán tay từng lô qua form người dùng (Admin) vẫn hoạt động song song; thu hồi gán xe làm mất quyền trên các lô chưa có khoản chi đã lưu. Trước đó cổng `user_shipment_links` chỉ có writer gán tay nên Ops thật không thể lưu chi phí.
- **Đường ghi-chú nhanh không nuốt guard giai đoạn Điều vận** (`QuyTrinhO2C.md` §3): quyết định "ghi chú tách khóa kế toán" chỉ áp cho khóa kế toán — Điều vận vẫn chỉ được sửa lô trong giai đoạn tiếp nhận kể cả khi payload chỉ-có-ghi-chú (sửa hồi sau khi phát hiện exception bỏ quên guard vai; bản đã ship đêm 20-09 từng nuốt guard này).
- **Lớp 1 cước vận tải (AUTO) đọc theo bản chốt mới nhất** (`QuyTrinhO2C.md` §7.9): snapshot cước là INSERT-only (đổi Ngày vận chuyển/phát lệnh = chốt bản mới thay bản cũ); bản bị thay thế KHÔNG cộng vào bất kỳ tổng nào — chân chuyến cộng dồn theo từng leg, lô chỉ có bản chốt lúc tiếp nhận tính một lần, lô khóa kỳ đọc số đóng băng; Lớp 1 luôn khớp Bảng 2.1 và giá đè `final_debit_freight`.
- **Cước FCL chốt theo cont của chuyến khi phát lệnh** (`QuyTrinhO2C.md` §7.9): anchor cước lấy từ cont của chính fulfillment được điều vận (loại + lịch hẹn), nên lô FCL không còn trường hợp "không bao giờ chốt cước" khi `route_id` cấp lô trống; lệnh chạy ngoài vẫn miễn và không tự bịa giá.
- **Xuất đề nghị thanh toán Ops: trung thực định dạng** (`OpsVanHanh.md`): định dạng không hỗ trợ trả lỗi rõ thay vì im lặng trả xlsx; xlsx là chuẩn xuất, in A4 là đường giấy theo PRD.
- **Không lộ mã số nội bộ trên sheet đề nghị thanh toán** (`OpsVanHanh.md`): lô thiếu mã hiển thị Số Bill/Booking hoặc "—", không bao giờ hiện DB id.
- **Kỳ giá dầu ghi Người nhập** (`CuocPhiPhuPhiDau.md` §4): kỳ mới lưu người tạo; kỳ cũ hiển thị "Không xác định".

## 2026-09-20 — Quick-edit lịch & ghi chú mở cho đủ ba vai

- **Quyền chỉnh nhanh lịch trình lô và ghi chú trên Tổng quan lô hàng mở cho CUS, Quản trị viên và Điều vận** (`QuyTrinhO2C.md` §3): khi lô chưa khóa kế toán, cả ba vai đều bấm được ô lịch và ô ghi chú để sửa trực tiếp; khóa kế toán vẫn chặn mọi vai; các ô khác giữ quyền như cũ — điều vận chỉ mở đúng hai ô này.
- **Ghi chú (khách hàng + điều hành) tách khỏi khóa kế toán** (`QuyTrinhO2C.md` §3): chủ sản phẩm quyết định "both notes can be edit" — trên lô đã khóa kế toán, CUS, Quản trị viên và Điều vận vẫn sửa được cả hai ô ghi chú trên Tổng quan lô hàng; lịch trình, tờ khai và các trường khác vẫn bị khóa chặn như cũ (điều chỉnh mệnh đề "khóa kế toán vẫn chặn mọi vai" của quyết định mở quick-edit cùng ngày).

## 2026-09-20 — Đối chiếu toàn diện: ngưỡng ≥, 0 khác thiếu, bảng kê đủ dữ liệu, dọn phê duyệt

- **Ngưỡng điều chỉnh áp khi đạt ngưỡng (≥)** (`PhuongAnTinhCuocTuDong.md` §3.2, `CuocPhiPhuPhiDau.md` §10): thay đổi giá dầu đúng bằng ngưỡng được coi là đạt ngưỡng và mở kỳ giá mới. Cả hai tài liệu ghi mở trước đó ("chưa thể tự chọn một cách"); engine đang chạy đúng hướng này (thay đổi == ngưỡng đã áp thay đổi), nên đây là quyết định khớp engine — không đổi hành vi runtime. Phần còn mở: giá trị ngưỡng theo hợp đồng, so kỳ liền trước hay mốc, kỳ đầu.
- **Giá dầu mốc F lưu chính xác đầy đủ, hiển thị rút gọn** (`CuocPhiPhuPhiDau.md` §2.3/§2.8): 19.270/1,08 = 17.842,5926 là giá trị chuẩn (DB numeric(12,4), seed và engine đều đã dùng đúng); 17.842,59 chỉ là cách hiển thị rút gọn. Không phải mâu thuẫn — quy tắc đã có được đối chiếu xác nhận. Rào chắn: không bao giờ lưu F đã làm tròn — mỗi đồng surcharge trôi theo.
- **Phân biệt 0 thật và thiếu nguồn trên mọi màn hình** (`QuyTrinhO2C.md` §7.9, `CuocPhiPhuPhiDau.md` §5/§9): vắng nguồn hiển thị "—"; số 0 tính ra từ đầu vào đầy đủ thì hiển thị 0 đúng nghĩa; thi hành ở lớp formatter dùng chung. `finance-derived.ts` đang gộp null→0 — tách thẻ lỗi riêng. Phép nhập tay duy nhất được phép cho cước: giá cuối thực tế đàm phán của Kế toán khi lập bảng kê (`PhuongAnTinhCuocTuDong.md` §5); cước tự tính thiếu điều khoản (lag/ngưỡng/kỳ/giá gốc) thì chặn tính tự động và nêu đúng phần thiếu, không có cơ chế ghi đè.
- **Đủ dữ liệu lập bảng kê = bốn điều kiện §7.2** (`QuyTrinhO2C.md` §7.2): hàng hóa, giá, chứng từ, điều kiện kỳ — trong đó "chứng từ" đúng nghĩa §7.1: đã nhận chứng từ gốc với người và ngày nhận thực tế. Ba thông tin §7.1 (đủ bằng chứng / vận chuyển hoàn thành / đã nhận chứng từ giấy) là quy tắc ghi nhận riêng biệt, không phải cổng phát hành bổ sung. Đường phát hành hiện chưa có gate máy chủ cho bốn điều kiện này — tách thẻ lỗi riêng.
- **Quy tắc ghép 40FT định nghĩa tại `LoHangKepKetHop.md` §1.1**: bốn cách diễn đạt hiện có (LoHang §1.1, §7; QuyTrinhO2C §5.4, §9) cùng nghĩa, không lệch số. §1.1 là nơi định nghĩa; các chỗ khác tham chiếu, thu gọn khi có lần chỉnh sửa tiếp theo; số mục giữ ổn định.
- **Ngoại tuyến: mục kiểm tra "xung đột README §2.2 vs LoHang §3.3" là đọc nhầm** — toàn bộ tài liệu cùng cấm offline (17 chỗ, 9 file), README §2.2 là nơi định nghĩa; các câu còn lại là lời nhắc, không viết lại (số mục được mã nguồn tham chiếu).
- **Dọn ngôn ngữ phê duyệt trong `BACKLOG.md`**: mục A-2 theo dõi một test "accountant approval" cho cấu hình chia sẻ phụ phí dầu — hành vi phê duyệt đã bỏ 2026-09-15, test thuộc diện xóa (không sửa). Các mục cùng họ (A-1, A-3, A-5, B-1, E-1, E-2) và `CHANGELOG.md` cũ còn nói "đường phê duyệt" được đánh dấu dọn cùng đợt.
- **D1/D2 đã trả lời dứt khoát**: 58 ô "0" trên /finance là thiếu nguồn bị gộp null→0 trong `finance-derived.ts` (thẻ lỗi riêng, kèm phép đo 58 ô); dòng thiếu giá 15T trên /trips hiển thị "—" tại ô giá + nhãn gọn "Thiếu giá 15T" trong ô, căn phải, kèm chú giải — quy cách ghi nhận tại đây.

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
