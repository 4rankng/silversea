# Luồng 6: Đối chiếu chi phí, chứng từ, công nợ và thu/chi — Kế toán

> **Vai trò:** Kế toán theo phạm vi được cấp; CUS phối hợp khoản thu khách; Ops/lái xe cung cấp khoản chi và chứng từ.
> **Tài khoản:** theo [`../testaccounts.txt`](../testaccounts.txt), chỉ dùng tài khoản/môi trường được phép.
> **Màn liên quan:** chi tiết lô `/shipments/:id`, bảng kế toán chi phí Ops, phơi phiếu/tiền đường, quỹ, công nợ `/debt`, `/payables` và báo cáo `/finance`. Xác nhận route thực tế trước khi chạy, không giả định route mới chưa được triển khai.
> **PRD nguồn:** [Quy trình O2C §5–8](../../docs/prd/QuyTrinhO2C.md), [Vận hành Ops §5/9](../../docs/prd/OpsVanHanh.md), [Màn hình lái xe §8](../../docs/prd/ManHinhLaiXe.md).
> **Kiểm thử bổ sung:** [Chi phí — yêu cầu ngày 16/09/2026](../2026-09-16-expense-requirements.md), [Luồng Ops](05-ops-quy-chi-phi.md).

## Phạm vi hiện hành và ánh xạ ca cũ

Cập nhật ngày 16/09/2026. Luồng chặn hoàn thành để duyệt e-POD/chi phí trước đây đã ngừng áp dụng. Giữ mã ca để truy vết nhưng thay kỳ vọng như bảng dưới; kết quả PASS theo đặc tả cũ không xác nhận các ca mới. **Không có hàng đợi hay cấp phê duyệt nội bộ.** Người có quyền đối chiếu, phát hành, ghi tiền và điều chỉnh trực tiếp; vẫn tôn trọng chứng từ thực tế, quyền, dữ liệu đồng thời và kỳ khóa.

| Mã TC-KT-CHOTO2C | Nội dung cũ đã thay | Phạm vi kiểm tra hiện hành |
|---|---|---|
| 001 | Chặn hoàn thành khi e-POD chưa được duyệt | Đủ bằng chứng giao nhận thì hoàn thành, không cần duyệt |
| 002 | POD giấy là điều kiện hoàn thành | Ghi nhận chứng từ giấy độc lập và theo thực tế |
| 003 | Chi phí chưa duyệt chặn hoàn thành | Thiếu dữ liệu tài chính chỉ chặn đúng thao tác tài chính |
| 004 | Duyệt e-POD | Đối chiếu chi phí trực tiếp, không tạo dòng tiền |
| 005 | Duyệt lại cùng phiên bản | Xung đột sửa/ghi cùng nguồn không ghi đè hoặc nhân đôi |
| 006 | Từ chối rồi nộp duyệt e-POD | Bổ sung chứng từ trên khoản cũ, giữ lịch sử và tiền |
| 007 | Kế toán hoàn thành chuyến để tự ghi sổ | Thu/chi thực tế có phân bổ và quỹ nguồn |
| 008 | CUS được chốt tài chính | CUS xác định khoản thu khách trong quyền của mình |
| 009 | AR tự sinh khi vận chuyển hoàn thành | Phải thu, đã thu và còn lại độc lập với hoàn thành chuyến |
| 010 | AP theo snapshot lúc hoàn thành | Phải trả đúng đối tượng, xe nội bộ không thành vendor ngoài |
| 011 | P&L từ snapshot close | Chi phí xe và báo cáo đối chiếu được, không cộng trùng |
| 012 | Debit chỉ nhận e-POD đã duyệt | Phát hành debit khách theo dữ liệu/chứng từ/quyền/kỳ |
| 013 | Dữ liệu đã duyệt khóa vĩnh viễn | Bảo vệ hồ sơ đã phát hành/thanh toán/kỳ khóa |
| 014 | Maker/checker duyệt điều chỉnh | Điều chỉnh trực tiếp theo quyền, có lý do và lịch sử |
| 015 | Đối chiếu năm snapshot | Truy nguồn lô/chuyến/chi phí/chứng từ/công nợ và tiền thực tế |

**Chuẩn bị và ghi kết quả:**

- Dùng cả FCL/LCL, xe nhà/xe ngoài, lệnh đơn/kẹp/kết hợp và hai kế toán có phạm vi xe khác nhau. Chuẩn bị khoản đủ/thiếu chứng từ theo quy tắc đã xác định, khoản công ty trả trực tiếp, khoản Ops/lái xe thực chi và khoản đã thanh toán một phần.
- Mỗi ca ghi mã nguồn, người thực chi/người nhập, ngày chi/ngày vận chuyển/ngày đối chiếu/ngày tiền và loại ngày lọc. Chạy số tiền tính tay được và không có giao dịch ngoài fixture làm thay số dư.
- Chạy trực tuyến trên 390px/820px/desktop. Kiểm tra bộ lọc/trường/nút nhất quán; tên dài, tổng tiền, bàn phím, trạng thái tải/rỗng/lỗi, không tràn toàn trang hoặc thẻ lồng thẻ. Không hiện thanh cuộn dọc trên mobile nhưng vẫn cuộn/chạm được.
- Các kỳ vọng chưa có quy tắc tài chính đầy đủ ghi **CẦN LÀM RÕ**, không tự chọn tỷ lệ VAT, thời điểm ghi AP, đơn vị phụ cấp, ngưỡng cảnh báo hay ý nghĩa quỹ TM. Phần chốt debit vendor trong nguồn được hoãn; không lấy mô tả tạm thời đó làm tiêu chí đạt.
- Đây là kế hoạch kiểm thử, không phải bằng chứng chức năng đã đạt. Phân biệt lỗi quan sát được, tính năng chưa triển khai và điều kiện môi trường thiếu.

---

## 6.1 — Vận chuyển, chứng từ và tài chính là các trạng thái riêng

### TC-KT-CHOTO2C-001 — Hoàn thành giao nhận không cần phê duyệt kế toán

- **Vai trò:** `laixe`, `ketoan`, `cus`; **Mức độ:** P0; **PRD:** O2C §5, AC-CP-LX-10, AC-CP-KT-06.
- **Dữ liệu:** FCL đã được lái xe tự nhận; có đủ hai nhóm bằng chứng giao nhận bắt buộc đã lưu; chi phí chưa đối chiếu và chưa ghi nhận chứng từ giấy.
- **Các bước:** lái xe hoàn thành công việc; mở lại trên màn lái xe, CUS và kế toán; thử cùng thao tác lần nữa. Đối chứng với công việc thiếu một nhóm bằng chứng thật.
- **Kết quả mong đợi:** công việc đủ điều kiện hoàn thành một lần, các màn phản ánh đúng. Không yêu cầu e-POD được duyệt, POD giấy, đối chiếu chi phí hoặc người duyệt khác. Công việc thiếu bằng chứng thật báo đúng nhóm thiếu. Hoàn thành không tạo phiếu thu/chi hoặc đánh dấu đã thanh toán.
- **Bằng chứng:** trạng thái và bằng chứng trước/sau, thông báo thiếu thật, lịch sử phiếu tiền không đổi.

---

### TC-KT-CHOTO2C-002 — Chứng từ giấy ghi riêng theo người và ngày nhận thực tế

- **Vai trò:** `ketoan` hoặc người có quyền hồ sơ; **Mức độ:** P0; **PRD:** O2C §7.1.
- **Các bước:** xem lô đã hoàn thành/có ảnh nhưng giấy chưa nhận; ghi nhận khi thực nhận với người/ngày; tải lại và thử bằng tài khoản ngoài quyền.
- **Kết quả mong đợi:** có ảnh/hoàn thành không tự đánh dấu đã nhận giấy. Ghi nhận lưu đúng người/ngày và không đổi tiền hoặc bắt hoàn thành chuyến lần nữa. Ngoài quyền bị chặn, không lộ hồ sơ. Ngày ảnh tải lên không thay ngày nhận giấy.
- **Bằng chứng:** hồ sơ điện tử, trường nhận giấy và lịch sử.

---

### TC-KT-CHOTO2C-003 — Thiếu dữ liệu chỉ chặn đúng thao tác tài chính

- **Vai trò:** `ketoan`, `laixe`; **Mức độ:** P0; **PRD:** O2C §7.2, AC-CP-KT-06/20.
- **Dữ liệu:** lô đủ điều kiện vận chuyển nhưng khoản dùng để lập chứng từ còn thiếu giá hoặc giấy tờ bắt buộc theo quy tắc đã xác định; một trường hợp kỳ đã khóa.
- **Các bước:** thử lập/phát hành chứng từ tài chính; xem toàn bộ lý do; bổ sung đúng dữ liệu trong kỳ được phép. Kiểm tra thao tác hoàn thành giao nhận độc lập.
- **Kết quả mong đợi:** chặn thao tác tài chính vì thiếu dữ liệu thật/kỳ khóa, nêu từng dòng và cách xử lý. Không tạo một bước gửi duyệt để thay câu trả lời; không chặn hoàn thành vận chuyển chỉ vì chi phí chưa đối chiếu. Không tự mở kỳ hoặc tự đặt giấy tờ chưa có quy định.
- **Bằng chứng:** thiếu sót, thông báo tài chính, trạng thái vận chuyển và bản đã bổ sung.

---

## 6.2 — Đối chiếu và sửa sai có căn cứ

### TC-KT-CHOTO2C-004 — Kế toán đối chiếu trực tiếp một hoặc nhiều khoản

- **Vai trò:** `ketoan`; **Mức độ:** P0; **PRD:** AC-CP-OPS-06, AC-CP-KT-02/04/06.
- **Các bước:** mở hai bảng Ops và phơi phiếu/tiền đường trong quyền; mở tổng để xem từng phí và chứng từ; chọn khoản hợp lệ, ghi nhận đối chiếu; mở lại bằng tài khoản liên quan.
- **Kết quả mong đợi:** thấy đúng tên phí, lô/container, người thực chi, số chi/số thu khách và tài liệu; tổng khớp từng dòng. Lưu người/ngày đối chiếu trực tiếp; không cần người thứ hai duyệt, không trừ lại ví hoặc giả đã trả người chi. Không xem/sửa khoản ngoài phạm vi.
- **Bằng chứng:** nguồn chi tiết, kết quả đối chiếu và số dư không đổi.

---

### TC-KT-CHOTO2C-005 — Hai phiên thao tác không ghi đè hoặc ghi tiền trùng

- **Vai trò:** hai kế toán có quyền trên cùng bản ghi; **Mức độ:** P0; **PRD:** AC-CP-KT-11/12/20.
- **Các bước:** mở cùng khoản ở hai phiên; phiên A sửa số tiền/người nhận hoặc ghi thanh toán; phiên B lưu dữ liệu cũ hay lập phiếu nhiều dòng có khoản đó. Thử mất phản hồi sau lưu rồi tra lại/thử lại cùng thao tác.
- **Kết quả mong đợi:** phiên B được biết dữ liệu đã đổi, giữ nội dung để đối chiếu, không ghi đè A. Phiếu nhiều dòng có dòng không hợp lệ không ghi một phần rồi báo thành công toàn bộ. Mất phản hồi có cách tra kết quả; thử lại cùng thao tác chỉ có một phiếu/phân bổ. Không dùng hàng đợi ngoại tuyến.
- **Bằng chứng:** hai phiên, lỗi theo dòng, mã phiếu/phân bổ và lịch sử trước/sau.

---

### TC-KT-CHOTO2C-006 — Bổ sung/chỉnh chứng từ trên khoản chi hiện có

- **Vai trò:** `giaonhan`, `laixe`, `ketoan` theo quyền; **Mức độ:** P0; **PRD:** AC-CP-OPS-04/05, AC-CP-LX-09.
- **Các bước:** dùng khoản đã ghi với ảnh mờ/thiếu; thêm/thay ảnh, thử ảnh lỗi rồi tiếp tục; mở lại trên màn kế toán và tài khoản đã bị thu hồi phân công.
- **Kết quả mong đợi:** thông báo thiếu/chưa đọc được đúng tài liệu; ảnh sửa thuộc cùng khoản, còn lịch sử cần thiết; không tạo dòng tiền/chi phí mới hoặc hoàn tiền do ảnh mờ. Quyền hiện tại được kiểm tra; người mất quyền không mở lại ảnh qua liên kết cũ. Không có từ chối rồi gửi duyệt lại.
- **Bằng chứng:** mã khoản trước/sau, ảnh đọc lại, số tiền và kết quả ngoài quyền.

---

## 6.3 — Thu/chi thực tế và vai trò CUS

### TC-KT-CHOTO2C-007 — Lập phiếu thu/chi trực tiếp và phân bổ đúng nguồn

- **Vai trò:** `ketoan`; **Mức độ:** P0; **PRD:** AC-CP-KT-07/08/09/11/12.
- **Dữ liệu:** hai khoản phải trả hợp lệ 100.000đ và 200.000đ, cùng đối tượng phù hợp một phiếu; quỹ/tài khoản đã cấu hình, số dư đầu đã ghi.
- **Các bước:** chọn từng dòng rồi chọn tất cả trong phạm vi hiển thị; đổi bộ lọc; chọn lại hai khoản, chọn quỹ/tài khoản, ghi phiếu chi 300.000đ; mở lại. Lặp với một dòng đã thanh toán/khóa kỳ trước lúc lưu.
- **Kết quả mong đợi:** hiển thị rõ phạm vi, số dòng và tổng; không âm thầm thanh toán dòng ẩn sau đổi lọc. Phiếu thành công phân bổ đúng 100.000 + 200.000đ, quỹ giảm 300.000đ một lần; không trộn thu/chi thành số ròng hoặc gộp đối tượng không hợp lệ. Một dòng không hợp lệ chặn cả phiếu và chỉ rõ dòng. Phân công/đối chiếu/hoàn thành vận chuyển không thay thế sự kiện thực trả.
- **Bằng chứng:** lựa chọn, phiếu, hai phân bổ, lịch sử quỹ; kết quả tình huống lỗi.

---

### TC-KT-CHOTO2C-008 — CUS xác định số tính khách, không tự được cấp quyền quỹ

- **Vai trò:** `cus`, `ketoan`; **Mức độ:** P0; **PRD:** AC-CP-OPS-02/03/05, AC-CP-KT-05/15/16.
- **Các bước:** CUS có quyền xem ghi chú phát sinh của lô, đánh dấu khoản được thu khách theo thỏa thuận; thử chi 120.000đ/thu khách 150.000đ và chi 100.000đ/thu khách 0đ vì giá trọn gói. Xem hóa đơn kết hợp trong phạm vi; thử mở lô ngoài quyền và chức năng chi quỹ không được cấp.
- **Kết quả mong đợi:** ghi chú/nguồn phí rõ; số thu khách độc lập số thực chi và tiền đã thu. 0đ không thêm khoản vào debit; 150.000đ chỉ tính một lần. Quyền xác định khoản thu không mặc định cấp quyền thanh toán/xem quỹ hoặc chốt tài chính; dữ liệu ngoài phạm vi bị chặn.
- **Bằng chứng:** khoản nguồn, ghi chú, số thu khách sau lưu và kết quả quyền.

---

## 6.4 — Phải thu, phải trả và chi phí xe

### TC-KT-CHOTO2C-009 — Phải thu, đã thu và còn lại không lẫn nhau

- **Vai trò:** `ketoan`; **Mức độ:** P0; **PRD:** AC-CP-KT-10/13/15.
- **Dữ liệu:** khoản phải thu khách hợp lệ 500.000đ đã được ghi nhận theo quy tắc hiện hành, chưa thu tiền; cùng bộ lọc và ngày chốt.
- **Các bước:** xem tổng và nguồn; ghi thực thu 200.000đ, phân bổ vào khoản; mở báo cáo/chi tiết; thử thu vượt phần còn lại. Đối chiếu thêm ảnh, đối chiếu chi phí và hoàn thành chuyến.
- **Kết quả mong đợi:** phải thu 500.000đ, đã thu 200.000đ, còn 300.000đ; vượt số còn lại bị chặn. Tổng nâng/hạ/khác đúng khách và khớp nguồn/xuất báo cáo. Thêm ảnh/đối chiếu/hoàn thành không tạo tiền đã thu. Không suy ra thời điểm ghi sổ hoặc tiền mặt chỉ từ tên “Thực thu” chưa làm rõ.
- **Bằng chứng:** khoản phải thu, phiếu thu/phân bổ và báo cáo cùng bộ lọc.

---

### TC-KT-CHOTO2C-010 — Phải trả đúng người nhận, xe nhà không thành vendor ngoài

- **Vai trò:** `ketoan`; **Mức độ:** P0; **PRD:** AC-CP-KT-13/14, AC-CP-LX-08.
- **Các bước:** mở các khoản xe ngoài, xe SilverSea, driver/Ops thực chi và công ty đã trả trực tiếp; đối chiếu nhà vận tải, người được thanh toán, số phải trả/đã trả/còn lại. Mở tổng theo tháng và nguồn chi tiết.
- **Kết quả mong đợi:** đúng đối tượng nhận tiền và phân loại xe. SilverSea có nhóm đối chiếu nội bộ nhưng không vì vậy tạo thêm AP vendor ngoài. Công ty đã trả trực tiếp không đồng thời thành khoản hoàn cho lái xe/Ops. Một nguồn không nằm trong hai nghĩa vụ thanh toán trùng; báo cáo/xuất khớp. Không áp quy tắc mới về chốt debit vendor/VAT từ phần nguồn đang hoãn.
- **Bằng chứng:** phân loại xe, người nhận, nguồn khoản phải trả, phân bổ và báo cáo.

---

### TC-KT-CHOTO2C-011 — Tiền đường và chi phí xe không cộng trùng

- **Vai trò:** `ketoan`, người xem báo cáo được cấp quyền; **Mức độ:** P0; **PRD:** AC-CP-LX-03/04/07/08, AC-CP-KT-03/04/14.
- **Các bước:** dùng phí không hóa đơn công ty chịu, tiền đường/vé cầu đường và khoản có hóa đơn; nhóm các dòng cùng biển số cạnh nhau, gồm kẹp/kết hợp; mở từng tổng và báo cáo chi phí xe.
- **Kết quả mong đợi:** phí không hóa đơn lái xe/tiền đường không tự vào phải thu khách; mỗi chi phí vào đúng xe một lần. Phí chung không nhân theo số dòng container. Phụ cấp cảng 50.000đ khác phí nâng/hạ có hóa đơn. Tổng nhóm khớp nguồn; khoản hủy rời số hiện hành nhưng còn lịch sử. Chỉ kiểm lợi nhuận/VAT theo chính sách đã xác định; không tự quyết phân loại chi hộ là doanh thu/chi phí khi quy tắc chưa chốt.
- **Bằng chứng:** các nguồn phí, tổng xe và worksheet; ghi riêng quy tắc còn thiếu.

---

## 6.5 — Chứng từ khách hàng

### TC-KT-CHOTO2C-012 — Lập và phát hành debit khách trực tiếp, không tính trùng

- **Vai trò:** `ketoan`; **Mức độ:** P0; **PRD:** O2C §7.2–7.3, AC-CP-KT-15/20.
- **Các bước:** chọn khách/kỳ hợp lệ với dữ liệu hàng hóa, giá và chứng từ đủ theo quy định; xem các khoản nguồn, gồm khoản thu 0đ và khoản có thu; phát hành, xuất Excel; thử lấy lại nguồn đã được tính ở chứng từ đang có hiệu lực và nguồn thiếu dữ liệu/kỳ khóa.
- **Kết quả mong đợi:** khoản có thu đúng khách/lô/số tiền, nguồn 0đ không tính thêm. Không dùng duyệt e-POD làm điều kiện. Thiếu dữ liệu/kỳ khóa có lý do rõ; không tính lặp nguồn. Excel khớp chứng từ đã phát hành, Bill/Booking và tổng; VAT chỉ theo quy tắc có hiệu lực đã xác định. Phát hành không có nghĩa khách đã trả tiền; không phát triển phần debit vendor đang hoãn.
- **Bằng chứng:** mã chứng từ, nguồn, Excel và các tình huống chặn.

---

## 6.6 — Điều chỉnh và kỳ khóa

### TC-KT-CHOTO2C-013 — Hồ sơ đã phát hành/thanh toán/kỳ khóa không bị sửa đè

- **Vai trò:** `ketoan`, người ngoài quyền; **Mức độ:** P0; **PRD:** AC-CP-OPS-10, AC-CP-KT-20.
- **Các bước:** với từng trạng thái đã phát hành, thanh toán một phần/toàn bộ và kỳ khóa, thử sửa/hủy trực tiếp số tiền/đối tượng; thử cùng thao tác bằng người ngoài quyền.
- **Kết quả mong đợi:** áp đúng ràng buộc hiện hành, chỉ ra cách điều chỉnh hợp lệ nếu có. Không ghi đè số gốc, xóa lịch sử hoặc mở kỳ ngầm. Chỉ có nhãn đã đối chiếu không đồng nghĩa khóa vĩnh viễn mọi sửa đổi; quyền/giai đoạn/kỳ quyết định thao tác được phép.
- **Bằng chứng:** trạng thái, thông báo và bản gốc/lịch sử không bị mất.

---

### TC-KT-CHOTO2C-014 — Điều chỉnh trực tiếp có lý do, nguồn và lịch sử

- **Vai trò:** người có quyền điều chỉnh tài chính; **Mức độ:** P0; **PRD:** O2C §7.3, AC-CP-OPS-10, AC-CP-KT-20.
- **Các bước:** dùng khoản cho phép điều chỉnh trong kỳ mở; thử thiếu lý do, sau đó nhập lý do và số đúng; lưu trực tiếp, đọc lại khoản gốc/điều chỉnh/báo cáo. Với phiếu tiền, thử hủy/đảo theo quyền và thử lại cùng thao tác.
- **Kết quả mong đợi:** bắt buộc lý do và lưu người, thời điểm, trước/sau, liên kết gốc. Không maker/checker hay người duyệt thứ hai. Tổng hiện hành/quỹ/công nợ chỉ đổi theo bản chất nghiệp vụ một lần; sửa chi phí không tự giả thêm tiền ngân hàng. Kỳ khóa vẫn được bảo vệ, lịch sử và phân bổ cũ còn truy được.
- **Bằng chứng:** bản gốc, điều chỉnh liên kết, lịch sử và các tổng trước/sau. Lập và thử lại phiếu thu khách, trả NCC, trả lái xe và hoàn ứng OPS trên màn hình chung: nhật ký phải ghi đúng nghiệp vụ tiền nguồn. Thiếu khai báo nghiệp vụ, chọn alias chưa khai báo hoặc lỗi ghi nhật ký phải giữ nguyên dữ liệu tiền và không lưu khóa giao dịch thành công.

---

## 6.7 — Đối chiếu toàn luồng

### TC-KT-CHOTO2C-015 — Truy nguồn lô, chuyến, chi phí, chứng từ, công nợ và dòng tiền

- **Vai trò:** `ketoan` / QA; **Mức độ:** P0; **PRD:** O2C §7.4–7.8, AC-CP-OPS-07/08/09.
- **Các bước:**
  1. Lập worksheet cho FCL và LCL, gồm xe nhà/xe ngoài: lô → chuyến/công việc → chi phí → chứng từ khách → khoản phải thu/phải trả → phiếu tiền/phân bổ.
  2. Ghi riêng thực chi, số tính cho khách, nghĩa vụ người nhận, tiền đã thu/đã trả và còn lại; mở nguồn từ từng tổng.
  3. Đối chiếu Ops chi vượt/ít hơn ứng, thanh toán một phần, khoản bị hủy, phí chung kẹp/kết hợp và công ty trả trực tiếp; so sánh màn hình/Excel cùng bộ lọc/ngày chốt.
- **Kết quả mong đợi:** mỗi số có nguồn và truy vết hai chiều; không lẫn người nhập/người chi/người nhận tiền. Phải thu/trả trừ đã thu/trả bằng còn lại. Hoàn ứng `chi − ứng được phân bổ` ghi rõ chiều công ty trả thêm/Ops hoàn lại; số dư ví chiều ngược không bị ép cùng dấu. Không dùng trùng phí/ứng/phân bổ, không tự tạo tiền từ chứng từ hoặc hoàn thành. Chưa có quy tắc ngày/VAT/chi hộ thì ghi rõ phần chưa thể kết luận thay vì báo toàn luồng PASS.
- **Bằng chứng:** worksheet theo nguồn, mã chứng từ/phiếu tiền, bộ lọc/ngày chốt và danh sách điều kiện còn thiếu.

---

## Bảng nghiệm thu — Đối chiếu kế toán hiện hành

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|---|---|---|---|---|---|
| __/__/__ | TC-KT-CHOTO2C-001 | | | Hoàn thành không cần duyệt | |
| __/__/__ | TC-KT-CHOTO2C-002 | | | Chứng từ giấy độc lập | |
| __/__/__ | TC-KT-CHOTO2C-003 | | | Chặn tài chính đúng điều kiện | |
| __/__/__ | TC-KT-CHOTO2C-004 | | | Đối chiếu trực tiếp | |
| __/__/__ | TC-KT-CHOTO2C-005 | | | Đồng thời và thử lại | |
| __/__/__ | TC-KT-CHOTO2C-006 | | | Bổ sung chứng từ trên khoản cũ | |
| __/__/__ | TC-KT-CHOTO2C-007 | | | Phiếu tiền và phân bổ | |
| __/__/__ | TC-KT-CHOTO2C-008 | | | CUS và số thu khách | |
| __/__/__ | TC-KT-CHOTO2C-009 | | | Phải thu/đã thu/còn lại | |
| __/__/__ | TC-KT-CHOTO2C-010 | | | Phải trả đúng đối tượng | |
| __/__/__ | TC-KT-CHOTO2C-011 | | | Chi phí xe không trùng | |
| __/__/__ | TC-KT-CHOTO2C-012 | | | Debit khách trực tiếp | |
| __/__/__ | TC-KT-CHOTO2C-013 | | | Bảo vệ hồ sơ đã chốt | |
| __/__/__ | TC-KT-CHOTO2C-014 | | | Điều chỉnh có lịch sử | |
| __/__/__ | TC-KT-CHOTO2C-015 | | | Đối chiếu toàn luồng | |
