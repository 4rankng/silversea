# Chi phí Ops, lái xe và phơi phiếu — tiêu chí và kế hoạch nghiệm thu

Ngày: 16/09/2026. Nguồn: `các chi phí.docx`, gồm toàn bộ nội dung và bảy hình bảng minh họa. Kế hoạch được viết trước triển khai. PRD: [Ops](../docs/prd/OpsVanHanh.md#9-chi-phí-ops-và-hoàn-ứng), [Lái xe](../docs/prd/ManHinhLaiXe.md#8-chi-phí-lái-xe), [O2C](../docs/prd/QuyTrinhO2C.md#74-phơi-phiếu-và-phân-công-kế-toán).

## Phạm vi và nguyên tắc

- Vai trò: OPS, DRIVER, CUS, ACCOUNTANT, ADMIN và người không có quyền để kiểm tra từ chối. Dùng tài khoản từ `testaccounts.txt`, không chép mật khẩu vào tài liệu/log.
- Chi phí, khoản tính cho khách, đối chiếu hồ sơ, tiền thực nhận/chi và khóa kỳ là các sự kiện khác nhau. Không kiểm tra theo chuỗi phê duyệt cũ.
- Không thay đổi quy tắc hoàn thành chuyến để chờ đối chiếu chi phí. Không ngoại tuyến, không tự gửi lại khi nối mạng.
- Tất cả số liệu thử dưới đây là fixture local; không reset hoặc seed đè dữ liệu đang có. Không thao tác tiền thật, không gửi ngân hàng.
- Mỗi case phải lưu bằng chứng và trạng thái PASS/FAIL/BLOCKED/NOT RUN. Chạy unit không thay thế click UI; ghi rõ local/staging, vai trò, đối tượng, thiết bị và giới hạn.

## Dữ liệu kiểm tra

Tạo khách QA-A/QA-B, lô FCL có hai container, lô LCL, hai xe nội bộ và một vendor; ít nhất hai Ops, hai lái xe, hai kế toán. Gồm chuyến đơn, kẹp, kết hợp, đã hủy, đã hoàn thành và kỳ đã khóa. Hai quỹ độc lập với tài khoản cấu hình hợp lệ, không dùng tài khoản thật. Dùng đồng Việt Nam nguyên cho các khoản thực chi.

Fixture tiền: phí có hóa đơn chi 500.000đ/thu 500.000đ; chi không hóa đơn 100.000đ/thu 0đ; phát sinh chi 120.000đ/thu 150.000đ; ứng 1.000.000đ với đợt chi 1.200.000đ và đợt riêng chi 800.000đ; phí hóa đơn 50.000đ trên hóa đơn 1.000.000đ; cược container 2.000.000đ. Mỗi đợt thử hoàn ứng có số dư đầu 0đ, các khoản do Ops thực chi từ quỹ và không có giao dịch khác. Không dùng chung khoản ứng vào cả hai đợt thử.

## OPS

| Case / AC tương ứng | Các bước chính | Kết quả cần thấy |
|---|---|---|
| TC-CP-OPS-01 / AC-CP-OPS-01 | Từ lô nhập lần lượt nâng, hạ, phí khác có hóa đơn; điền số hóa đơn/người chi; lưu, mở lại, mở bảng kế toán | Đúng từng nhóm và nguồn, mặc định số thu khách phù hợp; không có phiếu thu tiền tự sinh |
| TC-CP-OPS-02 / AC-CP-OPS-02 | Ghi chi 100.000, số thu 0, lý do nằm trong giá trọn gói; mở ví/chi phí/debit | Ví giảm chi thực tế một lần, chi phí còn, debit không thu thêm |
| TC-CP-OPS-03 / AC-CP-OPS-03 | Ghi phát sinh 120.000 và ghi chú đề nghị thu thêm; CUS/kế toán đặt số thu 150.000; mở lại và tạo chứng từ khách theo quy tắc hiện hành | Thu/chi độc lập, ghi chú ở đúng nơi; nguồn chỉ vào chứng từ khách một lần |
| TC-CP-OPS-04 / AC-CP-OPS-04 | Lưu khoản thiếu ảnh/hóa đơn, bổ sung sau; gây lỗi một lần tải ảnh và thử lại | Nợ chứng từ đúng; số chi/quỹ không đổi, không thêm khoản trùng |
| TC-CP-OPS-05 / AC-CP-OPS-05 | Nhập thay Ops B bởi tài khoản được quyền; đăng nhập Ops A và dùng URL/API ID của B | Giữ người nhập/người thực chi riêng; từ chối ngoài phạm vi và không lộ ảnh |
| TC-CP-OPS-06 / AC-CP-OPS-06 | Kế toán chọn một rồi nhiều dòng đối chiếu; thử dòng đã đối chiếu/khóa kỳ/đổi version | Lưu người/ngày một lần, không trừ quỹ lại; lỗi đúng dòng, không có duyệt cấp hai |
| TC-CP-OPS-07 / AC-CP-OPS-07 | Đợt chi 1.200.000 / ứng 1.000.000; xem báo cáo/ví; lập chi bổ sung 200.000 | Công ty cần trả 200.000, ví −200.000; sau chi cả nghĩa vụ và ví về 0 |
| TC-CP-OPS-08 / AC-CP-OPS-08 | Đợt chi 800.000 / ứng 1.000.000; đối chiếu nhưng chưa thu; ghi hoàn 200.000 | Cần hoàn 200.000 cho tới khi ghi tiền hoàn; đối chiếu không tự thu |
| TC-CP-OPS-09 / AC-CP-OPS-09 | Tạo hai đợt; thử chọn chi/ứng đã được phân bổ hết; lọc ngày/nhân viên và xuất | Không dùng trùng; cùng phạm vi cho cùng tổng và nguồn |
| TC-CP-OPS-10 / AC-CP-OPS-10 | Sửa khoản đang mở; thử sửa khoản đã chi tiền/đã phát hành/khóa; tạo điều chỉnh được phép | Lý do/version/lịch sử đầy đủ; không sửa đè tài chính đã chốt |

## Lái xe

| Case / AC tương ứng | Các bước chính | Kết quả cần thấy |
|---|---|---|
| TC-CP-LX-01 / AC-CP-LX-01 | Từ chi tiết chuyến được giao mở khai báo, đổi hai nhóm, nhập và lưu ở 390px | Đúng lô/xe/tài xế; nhập ít bước; xem lại khoản đã lưu |
| TC-CP-LX-02 / AC-CP-LX-02 | Ghi nâng 500.000 có số hóa đơn; kế toán mở chi hộ lô | Có nguồn lái xe và hóa đơn; chưa tự tạo thu/chi tiền |
| TC-CP-LX-03 / AC-CP-LX-03 | Ghi công nhân 100.000 không hóa đơn, kèm phiếu viết tay | Không vào phải thu khách; chi phí xe/nghĩa vụ thanh toán đúng một lần |
| TC-CP-LX-04 / AC-CP-LX-04 | Nhập vé cầu đường và sửa đèn/vá lốp với tên, số tiền, ảnh | Vào tiền đường/chi phí xe; không vào debit khách |
| TC-CP-LX-05 / AC-CP-LX-05 | Chọn trả đêm, quá tải; xem gợi ý; hủy; nhập lại lưu; kế toán sửa có lý do | Gợi ý 100.000/200.000; hủy không phát sinh tiền; sửa giữ lịch sử |
| TC-CP-LX-06 / AC-CP-LX-06 | Chuyến không có định mức; chọn soi/kiểm hóa | Không tự tính 0; nhập thực tế được theo quyền |
| TC-CP-LX-07 / AC-CP-LX-07 | Ghi phụ cấp 50.000 và phí nâng hóa đơn; kiểm tra kẹp/kết hợp | Hai loại phân biệt; không tự nhân hai theo số container |
| TC-CP-LX-08 / AC-CP-LX-08 | Ghi khoản công ty trả trực tiếp, sau đó lập thanh toán lái xe | Không hoàn tiền cho lái xe lần nữa; payer/recorder đúng |
| TC-CP-LX-09 / AC-CP-LX-09 | Với cả chuyến độc lập chưa gắn lô và chuyến đã gắn lô: click lưu nhanh hai lần; làm mất phản hồi; tra lại rồi thử lại; upload ảnh lỗi | Một nguồn chi duy nhất; phần ảnh lỗi có thể bổ sung |
| TC-CP-LX-10 / AC-CP-LX-10 | Thử công việc của người khác, chuyến hủy/kỳ khóa; hoàn thành chuyến còn chưa đối chiếu chi phí | Chặn ghi ngoài quyền/giai đoạn; vẫn hoàn thành theo điều kiện giao nhận hiện hành |

## Kế toán và CUS

| Case / AC tương ứng | Các bước chính | Kết quả cần thấy |
|---|---|---|
| TC-CP-KT-01 / AC-CP-KT-01 | Gán xe cho KT-A, đổi sang KT-B, thử người ngừng hoạt động; mở lịch sử | Phân công hiện hành đúng, không đổi Ops; lịch sử người cũ giữ nguyên, xe chưa gán không mất |
| TC-CP-KT-02 / AC-CP-KT-02 | Mở hai bảng, lọc ngày/người/xe/khách; đổi người dùng, thử URL ngoài quyền | Kết quả và tổng đúng phạm vi, quyền xem/ghi độc lập |
| TC-CP-KT-03 / AC-CP-KT-03 | Nhóm xe với đơn/kẹp/kết hợp và cùng biển số ở nhiều lô | Cùng xe liền nhau; nguồn/lịch riêng đọc được; không nhân khoản dùng chung |
| TC-CP-KT-04 / AC-CP-KT-04 | Mở tổng chi hộ/tiền đường của một dòng và quay lại | Chi tiết đủ hóa đơn/người chi/thu/trả; tổng khớp; giữ bộ lọc/vị trí |
| TC-CP-KT-05 / AC-CP-KT-05 | Bật/tắt Thu bằng trả, nhập 150.000/120.000, lưu, mở lại | Hai số độc lập sau tắt; không tạo phiếu tiền |
| TC-CP-KT-06 / AC-CP-KT-06 | Đối chiếu dòng; thêm/sửa khoản có lý do; hoàn thành chuyến | Thao tác trực tiếp, actor/date đúng; không chờ duyệt hoặc chặn vận chuyển |
| TC-CP-KT-07 / AC-CP-KT-07 | Tạo tài khoản BANK thuộc TM và CASH thuộc công ty; lấy danh mục thật rồi chọn quỹ trong phiếu. Tài khoản cũ chưa phân nguồn: thử ghi phiếu, phân nguồn bằng quản lý, mở lại danh mục; thử kế toán/sai phiên bản/giá trị quỹ lạ | Không suy ra nguồn từ tên/loại. API và UI khớp tài khoản đang hoạt động; chưa phân nguồn có hướng dẫn và không ghi tiền. Cấu hình trực tiếp đúng quyền, giữ nguyên số dư/giao dịch, phiên bản cũ bị chặn |
| TC-CP-KT-08 / AC-CP-KT-08 | Chọn tất cả, chuyển trang/đổi lọc; kiểm tra số dòng/tổng trước ghi | Phạm vi rõ, không âm thầm thanh toán dòng ẩn hoặc đối tượng không cùng phiếu |
| TC-CP-KT-09 / AC-CP-KT-09 | Ghi chi 300.000 phân bổ 100.000 + 200.000; click lặp/mở lại | Một phiếu, quỹ −300.000, đúng hai phân bổ, không nhân đôi |
| TC-CP-KT-10 / AC-CP-KT-10 | Khoản 500.000 thu 200.000; thử thu 300.001, rồi 300.000 | Còn 300.000; vượt bị chặn không ghi; thu đúng hết nghĩa vụ |
| TC-CP-KT-11 / AC-CP-KT-11 | Hai tab: sau chọn nhiều dòng, tab B thanh toán/khóa/sửa một dòng; tab A ghi | Không ghi một phần; chỉ rõ dòng lỗi, không báo thành công giả |
| TC-CP-KT-12 / AC-CP-KT-12 | Ngắt phản hồi sau ghi và gửi lại cùng yêu cầu | Tra được phiếu cũ; cùng mã yêu cầu không tạo tiền mới |
| TC-CP-KT-13 / AC-CP-KT-13 | Báo cáo tháng có nâng/hạ/khác, thu/trả một phần, hủy/đảo, dữ liệu giáp tháng; xuất. Phí hóa đơn của nhà cung cấp đang hoạt động rồi ngừng dùng; nhiều phí cùng nhà cung cấp | Tổng nguồn = chi tiết = bản xuất; đã thu/trả + còn lại = tổng; loại ngày/đến ngày rõ. Nhóm phải trả hiển thị tên nhà cung cấp từ hồ sơ gốc, kể cả ngừng dùng; không hiện VENDOR #id khi còn tên, không nhân tổng theo số khoản hoặc thay đối tượng |
| TC-CP-KT-14 / AC-CP-KT-14 | Mở báo cáo vendor và SilverSea nội bộ; đối chiếu chi lái xe | Nhóm nội bộ rõ, không phát sinh AP vendor giả hoặc trả lặp |
| TC-CP-KT-15 / AC-CP-KT-15 | Đưa khoản thu 0 và khoản thu 150.000 vào lựa chọn debit; thử chọn lại | Chỉ khoản có thu đủ điều kiện được tính một lần; chưa coi là tiền đã thu |
| TC-CP-KT-16 / AC-CP-KT-16 | Tạo hóa đơn kết hợp 1.000.000, phí NCC 50.000; gắn khoản nguồn; CUS mở | Chi phí hóa đơn 50.000, không chi tiền ngầm/nhân phí; CUS chỉ xem đúng phạm vi |
| TC-CP-KT-17 / AC-CP-KT-17 | Lưu cược 2.000.000, bổ sung các ngày thực tế và đã hoàn 500.000; thử hoàn vượt 2.000.000, thiếu ngày khi đã hoàn dương, ngày sai định dạng và trình tự bất thường | Còn cược 1.500.000; vượt tiền cược hoặc thiếu ngày nhận khi đã hoàn dương bị chặn. Ngày chưa xảy ra được để trống; trình tự bất thường được nêu để kiểm tra, không tự chặn tiền về trước ngày nộp khi quy tắc chưa chốt; đủ Bill/hãng/khách |
| TC-CP-KT-18 / AC-CP-KT-18 | Xem cược chưa về; ghi đã hoàn 500.000 trên cược 2.000.000 và ngày nhận; mở lại, đối chiếu quỹ/doanh thu | Còn 1.500.000, không báo đã hoàn đủ chỉ vì có ngày; theo dõi hồ sơ không tự tạo tiền hoàn hoặc doanh thu. Không gắn quá hạn bằng ngưỡng tự đặt |
| TC-CP-KT-19 / AC-CP-KT-19 | UI và API: âm, chi 0, thu 0, trống, thập phân, NaN/Infinity, chuỗi sai, vượt giới hạn. OPS tạo/sửa khoản chi và nhập tạm ứng: nhập `123.45`, không được đổi thành `12345`; giữ số thập phân và báo lỗi, không gửi API; sửa thành `123000` rồi lưu đúng `123000` | Validation nhất quán, thu 0 được giữ; không lưu tiền bị biến đổi âm thầm |
| TC-CP-KT-20 / AC-CP-KT-20 | Đổi quyền/khóa kỳ trong lúc mở form; sửa/hủy/đảo hai lần; lập phiếu thu khách/trả NCC/trả lái xe/hoàn ứng OPS từ màn hình chung rồi thử lại | Không vượt quyền/khóa; audit trước/sau/lý do và đúng nghiệp vụ nguồn; quỹ và phân bổ đối chiếu; thiếu khai báo hoặc lỗi ghi audit không để lại thay đổi tiền |
| TC-CP-KT-21 / AC-CP-KT-21 | Lặp danh sách, bộ lọc, chi tiết, nhập tiền, chọn nhiều dòng tại 390/820/1440px; tên/mã dài; bàn phím. Ở 390px mở phiếu thu/chi với tên tài khoản dài và kiểm tra phần thân có inset tối thiểu 12px, các cột trường co được và chọn được tài khoản mà không tràn. | Không tràn ngang trang/lệch chiều cao; hành động/tổng dễ đọc, focus/lỗi đúng, không thẻ lồng |
| TC-CP-KT-22 / AC-CP-KT-22 | Mất mạng đang nhập/đang lưu, trở lại, đổi tài khoản | Trạng thái thật, giữ nội dung chưa lưu khi có thể; không gửi lại tự động, không hàng đợi ngoại tuyến hoặc rò dữ liệu |

## Quyết định đã chốt và biến thể bắt buộc

- Thực thu là khoản tính cho khách và ghi nợ. Thực chi là Ops đã trả; Đã thu là tiền khách trả theo phiếu. OPS-03/KT-05/KT-10: chi 500.000, thu 300.000, chưa trả → đã thu 0, còn nợ 300.000, chênh lệch −200.000; thu 100.000 → còn nợ 200.000, hai số gốc không đổi. Thử thêm thu 0, bằng chi và lớn hơn chi; không phát sinh phí dịch vụ âm.
- LX-04/LX-07: giữ phụ cấp tiền đường/ca; cầu đường ước tính 100.000 được thay bằng vé đối chiếu 80.000 → giảm tổng 20.000. Phát sinh riêng 30.000 cộng một lần. Thử chuyến kẹp/kết hợp, sửa và đảo khoản phí; không nhân đôi phí hoặc làm mất lịch sử.
- KT-01/02: phân công kế toán là bộ lọc công việc, không thêm hạn chế quyền. Hai kế toán xem xe mình/người khác/chưa phân công qua UI và API trong quyền hiện hành.
- KT-03/04: bảng phơi phiếu là dòng công việc có lịch, khách, tuyến, container/loại, đơn/kẹp/kết hợp, nâng/hạ, xe/tài xế/nhà vận tải, ghi chú nghiệp vụ và ghi chú lái xe riêng; ba tổng mở chi tiết và thêm/sửa theo quyền.
- KT-08/11/12: chọn dòng/trang/toàn bộ kết quả có phạm vi rõ; tách nhóm cùng đối tượng/chiều/quỹ, mỗi phiếu nguyên tử. Kiểm tra hai tab, API cũ/mới cùng khóa idempotency, mất phản hồi sau commit, retry khác payload và đảo phiếu. Không có partial success giả.
- OPS-09/KT-14/16: một khoản chi/ứng chỉ tiêu thụ một lần giữa luồng cũ/mới. Tiền cũ không rõ phân bổ hiển thị Chưa phân bổ chi tiết, không đoán 0đ hay FIFO. Phí trước chuyến không tạo chuyến giả; phí hóa đơn không nhân đôi nguồn.
- KT-17/18: sau khi khóa chi phí lô, bổ sung ngày chứng từ/nhận tiền, hoàn một phần và ghi chú cược vẫn lưu có lịch sử; sửa số cược gốc/Bill/hãng tàu/ngày cược bị chặn. Không phát sinh giao dịch quỹ.
- KT-20: kiểm tra nguồn ảnh, URL tải trực tiếp, khóa nghiệp vụ theo đúng thao tác. Chi phí đã chốt không sửa đè; thu/chi công nợ còn lại không bị chặn chỉ vì kỳ chứng từ đã đóng.
- KT-21: kiểm tra 360/390/820/1440px, CUS shipments/new và chỉnh lịch, điều vận kế hoạch/ghi chú/phân xe, lái xe hành trình/chi tiết/POD/chi phí, bảng Ops và kế toán. Gõ/chọn ngày giờ không đóng giữa chừng; bộ lọc nhất quán; cuộn mobile hoạt động nhưng không hiện thanh dọc.
- KT-22: không heartbeat, không gọi health khi mở trang/timer/reconnect và không preflight chặn mutation. API nghiệp vụ được thử ngay, kể cả navigator.onLine báo false. Thử lỗi JSON/blob/text và mất phản hồi sau ghi; giữ field/File trong màn hình, manual retry cùng key; reconnect không gửi mutation. Tải lại dữ liệu nghiệp vụ và thông tin phiên bản khi chủ động mở vẫn được giữ.
- Chốt debit vendor giữ hiện hành vì nguồn ghi chưa hoàn thiện. Cược chỉ có danh sách hồ sơ/tiền còn thiếu, không tự đặt ngưỡng cảnh báo; trình tự ngày bất thường cảnh báo để kiểm tra, không thêm quy tắc chặn chưa được yêu cầu.
- Mức phụ cấp tài liệu là gợi ý nhập, không tự sinh theo ngày/cảng/container. TM là tên quỹ; loại tài khoản theo cấu hình thực tế.

## Các lớp kiểm tra trước bàn giao

1. Unit cho phân loại/mặc định, validation, chống trùng, tổng/chiều hoàn ứng, nhóm báo cáo, stale response và control states. Regression lỗi phải thất bại trước sửa khi có thể chứng minh.
2. Integration cho ghi nguồn, quyền theo đối tượng, version/kỳ, giao dịch phiếu–phân bổ–quỹ, rollback và idempotency. Migration mới giữ nguyên lịch sử; không tự backfill nghiệp vụ tiền chưa có chứng cứ.
3. Full shared/backend/frontend typecheck, lint, test suites, build và E2E vì có hợp đồng/tài chính/quyền.
4. Click UI local theo từng vai trò: ghi khoản → mở lại → đối chiếu → phiếu → báo cáo; kiểm chứng DB side-effect theo nguồn. Ảnh/DOM/log nằm trong `qa/`, không xuất cùng patch trừ khi được yêu cầu.
5. Review độc lập theo 42 AC; mọi hàng chưa thực hiện ghi NOT RUN/BLOCKED cùng lý do. Patch không chứa credentials, dữ liệu thử hoặc build output; không commit.

## Kết quả thực thi

Đã triển khai và chạy tại local ngày 16/09/2026. Các kết quả dưới đây áp dụng cho từng nhánh đã chạy, **không có nghĩa toàn bộ biến thể của 42 AC đã được kiểm tra bằng UI**. Ảnh/DOM/log và đối chiếu DB lưu tại `qa/2026-09-16-expense-implementation/`; không đóng gói ảnh hay dữ liệu thử vào patch.

| Nhóm | Kết quả và lớp bằng chứng | Giới hạn còn lại |
|---|---|---|
| OPS-01/03/04, KT-19/22 | UI DRIVEN: tạo chi có hóa đơn/ảnh; ngày không hợp lệ và chi 0 bị chặn; upload và lưu lỗi giữ nội dung, thử lại thủ công cùng mã. Tạo/sửa số nguyên; `123.45` giữ nguyên và bị chặn, không biến thành `12345`; kiểm tra tương tự ở nhập tạm ứng | Chưa chạy mọi loại chi, mọi tổ hợp locale và mất phản hồi sau commit trên trình duyệt |
| LX-01/02/04/09 | UI DRIVEN: nhập phí lô hàng do công ty trả và vé cầu đường do tài xế trả, mở lại đúng nguồn/ảnh/ngày; upload/lưu lỗi và thử lại. DB/API VERIFIED: ownership, kỳ khóa, chia/tách/ghép phí cầu đường, không nhân đôi và không đổi phụ cấp | Chưa chạy kẹp/kết hợp, hủy chuyến và trả tiền lái xe bằng UI trong vòng này |
| KT-05/07/10/20 | UI DRIVEN: tài khoản quỹ được cấu hình rõ; số thu thấp hơn chi, thu một phần, mở lại, đảo phiếu; giữ lịch sử và khôi phục công nợ. DB/API VERIFIED: khóa/version, rollback khi audit lỗi, quyền, idempotency API cũ/mới | Chưa chạy tranh chấp hai tab hoặc mất phản hồi sau commit qua trình duyệt; được kiểm tra tích hợp |
| OPS-08, KT-09 | UI DRIVEN: chi tạm ứng, chọn khoản ứng để đối chiếu, chưa tự thu tiền; ghi hoàn một phần, số còn phải hoàn giảm đúng. DB/API VERIFIED: dùng trùng ứng bị chặn giữa luồng cũ/mới | Nhánh công ty trả thêm và hoàn toàn bộ mới có bằng chứng tích hợp |
| KT-16/17/18 | UI DRIVEN: giá trị hóa đơn và phí nhà cung cấp độc lập; cược 2.000.000/hoàn 500.000 còn 1.500.000; ngày không tự ghi quỹ; lỗi lưu giữ form, retry cùng mã. DB/API VERIFIED: cập nhật chứng từ sau khi khóa chi phí, quyền và version | Không kiểm tra dữ liệu nhập từ máy khác hoặc môi trường staging |
| KT-13/14 | UI DRIVEN: lọc báo cáo theo cả chiều thu và trả; tải XLSX bằng nút thật, đối chiếu số tổng/đã thanh toán/còn lại với bảng; tên nhà cung cấp từ hồ sơ gốc và nhóm SilverSea riêng, tại 360/390/820/1440px | Chưa chạy mọi tổ hợp ngày/khách/nhà vận tải qua UI; lịch sử nhà cung cấp ngừng dùng có regression tích hợp |
| KT-21 | UI DRIVEN: các form, picker và drawer mới ở 360/390/820/1440 CSS px; chọn tài khoản tên dài không làm grid tràn, có inset 12px, nhãn khóa không giả định khóa kỳ | Chrome local dạng viewport/touch emulation; chưa kiểm tra thiết bị thật, Safari, mọi trang và mọi thao tác bàn phím |
| Các quyền, liên kết nguồn, báo cáo, chống trùng, concurrency và migration | DB/API VERIFIED qua các suite nguồn chi phí, tiền chuẩn, tài chính lô hàng và migration; xem các test `expense-accounting-source`, `expense-cash-authority`, `expense-cash-routes`, `shipment-finance-records`, `treasury-fund-contract` | Không suy diễn kết quả tích hợp thành bằng chứng UI cho nhánh chưa click |

Gates đã chạy: shared 212/212; frontend 2.297/2.297 qua 362 file; backend unit 212/212 và integration 2.121/2.121. Sau vòng đầy đủ: regression HTTP 20/20, nguồn/báo cáo 17/17 và thay đổi prod `90c1c278` về ID thanh toán 8/8. Schema mới và nâng cấp chạy thành công, sinh lại không có drift; lint/typecheck/build thành công. E2E được ghi riêng theo lần chạy và giới hạn bên dưới, không suy từ unit thành kết quả UI.

E2E 00–19: lần chạy đầu có 252 kiểm tra (246 PASS / 5 FAIL / 1 SKIP). Sau sửa và chạy lại các suite bị ảnh hưởng, tổng hợp kết quả mới nhất của từng suite có **254 kiểm tra: 253 PASS / 0 FAIL / 1 SKIP** qua 16 suite. Đây là tổng hợp rerun, không phải một lần full-run sạch mới. Suite 16 **BLOCKED** vì thiếu workbook `docs/quytrinh/29.7 - DATA PM.xlsx`, không được tính PASS; các số 12/13/17 không có script. Một case trạng thái lái xe rỗng SKIP vì tài khoản seed đang có chuyến.

Suite 20 chạy riêng sau cùng: **33 PASS / 0 FAIL / 0 SKIP**, exit 0; tạo đúng lô/fulfillment, điều vận phát lệnh trực tiếp, đúng tài khoản lái xe mở và nhận đúng chuyến, sau đó dọn đúng chuyến thử có kiểm tra định danh. Tổng hợp kết quả cuối từ các lần chạy: **286 PASS / 0 FAIL / 1 SKIP** (287 kiểm tra qua 17 suite đã thực thi); giữ nguyên BLOCKED của suite 16.

Bổ sung AC-CP-LX-09: chuyến độc lập được nhập/list/replay phí như hiện hành; không tạo lô giả hoặc registry thiếu nguồn. Khi gắn lô thật, liên kết giữ nguyên người chi, thực thu, nhóm phí, hóa đơn và ảnh.

Bổ sung AC-CP-KT-20: CUS là nhân viên nội bộ, giữ quyền xem lô đang tồn tại của nhân viên khác theo phạm vi hiện hành; không đặt thêm giới hạn khách hàng/phân công. Chi phí của lô đã xóa hoặc không tồn tại không xuất hiện trong danh sách và không đọc/sửa trực tiếp được. CUSTOMER không truy cập API chi phí nội bộ. Ảnh chứng từ vẫn áp dụng quyền nguồn và đối chiếu chính xác storage key.

Bổ sung AC-CP-KT-11: khi OPS và DRIVER có cùng mã số nguồn nhưng thuộc hai chuyến khác nhau, đối chiếu OPS chỉ khóa chuyến/cặp chuyến của đúng khóa `(sourceKind, sourceId)` được chọn; không khóa chuyến DRIVER không liên quan.

Bổ sung AC-CP-KT-20 về lịch sử tiền: tạo liên kết cho khoản chi cũ không biến số đã thu/đã trả chưa phân bổ thành 0đ. Giữ trạng thái chưa xác định và chặn việc đoán số dư để tạo thu/chi mới; nguồn vừa nhập có nguồn gốc rõ vẫn hoạt động bình thường.

Bổ sung AC-CP-KT-02: một nguồn cũ tham chiếu lô đã xóa/không tồn tại không làm lỗi danh sách và chi tiết nguồn hợp lệ khác; chi tiết truy vấn đúng khóa nguồn, không tải toàn bộ nguồn để tìm một dòng.

Bổ sung AC-CP-LX-07: vé cầu đường đã đối chiếu nằm ở công việc thứ hai; hủy công việc thứ nhất làm tách cặp, sau đó ghép công việc còn lại với công việc mới. Chi phí theo đúng chứng từ gốc, không mất vé hoặc nhân đôi; phụ cấp giữ theo thỏa thuận và điều chỉnh công việc đã ghi sổ có lịch sử.

Bổ sung kiểm tra tương thích AC-CP-KT-07 / AC-CP-KT-12: qua HTTP thật, API thu tiền hiện hành vẫn ghi một khoản thu hợp lệ vào tài khoản cũ có nguồn quỹ chưa xác định. Gửi cùng lệnh và khóa idempotency qua màn hình chi phí trả 409 trước khi tài khoản được phân nguồn; không mất hoặc ghi thêm khoản thu gốc. Quản trị phân nguồn bằng API cấu hình chuẩn, rồi gửi lại cùng khóa: liên kết đúng phiếu thu, bút toán và giao dịch quỹ ban đầu vào một phiếu/phân bổ chi phí. Thử lại tiếp vẫn chỉ một khoản tiền và một phân bổ nguồn; không chặn API tiền hiện hành chỉ dựa vào mã phiếu hoặc tự đoán nguồn quỹ.

Bổ sung kiểm tra kỹ thuật AC-CP-KT-20: HTTP thật qua middleware audit phải ghi đúng `payments.receive`, `payments.vendor`, `drivers.payout` hoặc `expenses.ops-reimburse` theo lệnh tiền được thực thi, cả tạo mới và replay. Chỉ chấp nhận alias nằm trong khai báo của route dùng chung; alias ngoài danh sách trả lỗi và không ghi tiền. Route thiếu material-write registry vẫn lỗi 500, rollback cả thay đổi nghiệp vụ và khóa idempotency.
