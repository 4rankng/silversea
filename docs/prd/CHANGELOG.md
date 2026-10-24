# Lịch sử thay đổi PRD

Nhật ký các quyết định đã có hiệu lực. Quy tắc đang áp dụng nằm trong tài liệu
tương ứng; file này chỉ ghi **khi nào** và **vì sao** một quy tắc ra đời hoặc bị bỏ,
để tra cứu khi đối chiếu hồ sơ cũ. Không dùng file này làm nguồn yêu cầu.

## 2026-10-24 — SIL-168 ruling B: Hình thức XNK TRƯỚC Số Bill/Booking (lần đảo thứ 3)

Khách gửi lại đúng văn bản cũ lần 3 ("Đổi vị trí Số Bill/Booking và Hình thức
XNK; Số tờ khai đẩy xuống dưới cùng"). Owner chốt phương án B: đảo lại reading
của FB-127 (9f174360 đặt Bill/Booking trước XNK theo "luồng chứng từ giấy") —
trở lại bố cục 2425726d: XNK cạnh Khách hàng, Bill/Booking band 2, Số tờ khai
band cuối. Bỏ cụm divider "Chứng từ & định danh" / "Phân loại nghiệp vụ".
Gate blNumber XOR bookingRef (FB-113) và semantics tờ khai per-cont (CUS-05/
REQ-22) giữ nguyên. Chi tiết: docs/prd/TaoMoiLoHang.md §1 (bảng lịch sử 3 lần đảo).

## 2026-10-22 — Rulings 22/10: FB-112 đảo chiều (bật lại nút Thêm/Xóa @Chi tiết), LCL đóng/trả thay nâng/hạ, kho CFS chung, tờ khai inline+sync, thứ tự chứng từ, freight lag verified

- **FB-112 REVERSED — nút Thêm/Xóa container tại Chi tiết lô được BẬT LẠI** (yêu cầu khách
  Zalo 22/10 09:50; QA xác nhận bỏ ruling by-design): TICKET-09 (`171026182554`, 17/10 —
  "bỏ nút thêm/xóa container ở Chi tiết lô") **SUPERSEDED**; CUS-10 và REQ-23 đảo chiều theo.
  Thao tác thêm/xóa ở drawer Tổng quan giữ nguyên. Pin vitest "no Thêm container affordance"
  cần gỡ khi implement bật lại — trạng thái hiện tại: ruling chốt, chưa có commit bật lại nút.
- **REQ-22 REVERSED — thêm cont copy TẤT CẢ TRỪ số cont + Loại cont** (ticket 221026173728,
  22/10; **hủy ruling 21/10** card 211026112600): "Thêm container" quay về copy đúng A.1
  nguyên văn — auto-copy mọi trường chung (Tuyến/Nhà xe/Nâng/Hạ/Trọng lượng/Giờ hẹn) TRỪ
  **Số container** (ô nhập) và **Loại cont** (luôn trống "Chưa chọn" cho operator tự chọn —
  hành vi copy-kể-cả-Loại-cont của 21/10 là DEFECT theo ticket). Wire: type không seed,
  unpicked rides EXPLICIT `containerTypeId: null` để server lot-default inherit không thể
  re-copy. Áp dụng cả hai host dùng chung một ledger: drawer Tổng quan + Chi tiết trượt ngang
  (`ShipmentDetailContainerManagement`).
- **LCL không có khái niệm nâng/hạ** (card 261022093846): cột Nâng/Hạ tại Chi tiết lô hiển
  thị **điểm đóng / điểm trả** đúng nghĩa lô lẻ, hết placeholder "Chưa cập nhật"
  (`ca57c8fc`; chi tiết tại [OpsVanHanh.md](OpsVanHanh.md) mục Cập nhật 22/10 và
  [LoHangKepKetHop.md](LoHangKepKetHop.md) §6.3).
- **Kho lấy hàng (CFS) = danh mục dùng chung** (card 261022093245, Zalo 22/10 09:31): combobox
  kho lấy hàng của form LCL **KHÔNG lọc theo khách hàng** đã chọn
  ([LoHangKepKetHop.md](LoHangKepKetHop.md) §7.2).
- **Tờ khai: inline edit + sync (CUS-05 clarify, cards 221026095229/221026095329):** sửa/thêm
  số tờ khai ngay tại Chi tiết lô (không tab ra tab vào); nhập cho 1 cont → **mọi cont cùng lô
  tự sync** — hành vi đã land FB-085/109, ruling 22/10 xác nhận clarify.
- **Thứ tự chứng từ (card 221026095429): BILL/BOOKING → SỐ TỜ KHAI → NHẬP/XUẤT → HÃNG TÀU**
  (`ca57c8fc`) — ô đầu chốt là BILL/BOOKING, không chỉ "Số booking" như spec A.3/CUS-11 cũ.
- **Freight lag QA verified 22/10 (R32) — PASS:** UI lag mặc định 1 (NEWEB) · route NEWEB
  id=12 130km đã tạo · engine áp (transport_date − lag) — evidence
  `testplan/cases/case-QA-2026-10-22-quote-engine-wiring.md` (QE-R4/R5) + `qa/2026-10-22-quote-ui/`.
  **Outstanding:** tạo khung giá qua UI fail-im-lặng — đang điều tra.

## 2026-10-21 — PRD all-markdown: bỏ file .docx khỏi repo, nguồn gốc giữ ở GDrive

Chủ sản phẩm chốt docs/prd giữ **toàn bộ dữ liệu dạng Markdown** — không còn file .docx
trong repo. `PhanHeKeToan.docx` được chuyển nội dung đầy đủ sang `PhanHeKeToan.md`
(kèm 12 ảnh mockup mô tả bằng chữ tại các mục `### Mockup:` — dựng từ caption docx + OCR,
session không có vision; chú thích trong ảnh dịch thành behavior, không phải UI text);
9 file còn lại đã có sẵn bản .md twin. Mọi liên kết chéo `.docx` → `.md`. Bản .docx gốc
(kèm ảnh nhúng) lưu ở Google Drive `SilverSea/Kanban` và attachments — không mất. Mã tham
chiếu `§n.m` giữ nguyên trên file .md.

## 2026-10-21 — Đợt rulings 21/10: luật tiền gom hàng lẻ (LCL-07), xóa lô, tự-copy container (REQ-22/FB-086), chi phí vừa tạo (FB-033)

- **Luật tiền gom nhiều lô hàng lẻ (LCL-07 / REQ-19, boss chốt 21/10 15:22):** cước **THU khách**
  tính **per-lot độc lập** = đơn giá bảng giá Tuyến × Khách hàng (loại xe của chính lô đó) × số
  lượng — gom nhóm không chia tỷ lệ kg/CBM và **không dồn 100%/0₫ ở chiều thu** (thay quy tắc thu
  100%/0₫ của DEV SPEC 15/10 — quy tắc 100%/0₫ cũ chỉ còn đúng ở chiều trả). Cước **TRẢ nhà xe
  thuê ngoài** là **một khoản duy nhất mỗi chuyến** (Lô 1 gánh 100% cước trả, lô ghép còn lại
  0₫ kèm nhận diện ghép). **Tách nhóm giữ nguyên tiền thu của từng lô** (money-neutral), ghi chú
  ghép dọn sạch. **Lãi chuyến = Σ thu − trả.** Triển khai `d375239b` (merge `9aab78d2`), QA
  R30-endgame xác nhận 6/6 trên staging 9aab78d2 (`qa/2026-10-21-r30-endgame/`). Chủ sản phẩm
  đồng thời chốt **không làm**: phân bổ tỷ lệ, fit-line cho dialog Ghép cước thu khách
  (MergeRevGroupDialog), bảng giá ngoài 5T/3.5T.
- **Xóa lô (Frank 21/10 07:54):** CUS và **Điều vận được phép xóa lô**; Ops KHÔNG có quyền; nút
  "Xóa lô" trên Kế hoạch Chi tiết Xe của Điều vận **GIỮ** (đóng spec-question FB-095). Hiện trạng
  21/10 (commit `903ec1cc`): nút đã hiển thị cho Điều vận nhưng máy chủ vẫn giữ luật "Chỉ CUS
  hoặc Quản trị viên" (cards 20261007_396/204710) — việc nới quyền xóa cho Điều vận theo ruling
  còn chờ triển khai.
- **Tự-copy khi thêm container (REQ-22, Frank 21/10 sáng + bổ sung 11:26 — card 211026112600):**
  thêm container mới vào lô đã có **tự copy toàn bộ trường chung, KỂ CẢ Loại cont** (ghi đè chữ
  "để trống" trong spec gốc; điều khoản "loại cont là người dùng nhập" của A.1 phiên bản 20/10
  bị thay cho riêng trường này). Cách hoà luật: copy Loại cont phía client khi mở dòng mới
  (per-column first non-null, chỉ nhận giá trị trong danh mục loại cont), người dùng xoá sạch
  vẫn gửi explicit null; contract server A.1 không đổi. **TICKET-09/REQ-23 vẫn giữ:** không có
  nút thêm/xóa container tại màn Chi tiết lô — thêm container chỉ ở drawer Tổng quan. Xung đột
  CUS-10 ("bổ sung nút Xóa cont tại chi tiết lô") chốt theo TICKET-09: **không thêm lại**.
  *(**SUPERSEDED 22/10** — FB-112 REVERSED, Zalo 22/10 09:50: khách đảo chiều, bật lại nút
  Thêm/Xóa @Chi tiết; xem mục 2026-10-22.)*
  Triển khai `4a35d3cf` (merge `017adf63`), evidence `qa/2026-10-21-fb086-autocopy/`.
- **Chi phí vừa tạo không bị khóa (FB-033, chốt 21/10):** khoản chi hộ **vừa tạo sửa/xóa được
  cho tới khi có settlement thủ công** — bút toán tự đối trừ tạm ứng (auto-offset) không còn làm
  guard hiểu nhầm "đã gửi kế toán"; phiếu hoàn ứng thủ công vẫn giữ bất biến sau khi lập.
  Triển khai `19a9cc5b` (merge `9d60f507`), QA R29 PASS-already-fixed trên staging c643ef1e.

## 2026-10-21 — Trọng lượng hiển thị theo TẤN, không còn số-nhóm-kg (CUS-08)

Phản hồi QA 21/10 (ticket nhóm 211026125242 / 211026125715 / 211026125815):
khách đọc trọng lượng container theo **tấn** và chấm các giá trị kiểu
"5.000" / "18.500" là số 0 thập phân vô nghĩa —
chúng thực chất là kg hiển thị với dấu chấm nhóm nghìn của vi-VN. Quyết định
2026-10-05 ("Trọng lượng container hiển thị bỏ số 0 thập phân dư") chỉ bỏ phần
thập phân lưu trữ nên chưa đủ. Toàn bộ vị trí HIỂN THỊ trọng lượng (tổng quan
CUS, bảng cont trong drawer, chi tiết lô, điều phối, xuất XLSX) đọc tấn qua
`formatWeight` (kg ÷ 1000, dấu phẩy thập phân, tối đa 3 số lẻ, bỏ số 0 dư):
lưu `18500.00` kg → "18,5 tấn", `5000` kg → "5 tấn". Ô NHẬP trọng lượng vẫn
đơn vị kg (chỉ hiển thị thay đổi, không đổi dữ liệu/API); thẻ lái xe giữ kg
theo card 20261004_356.

## 2026-10-05 — Tên hiển thị nguồn quỹ theo đặc tả khách hàng 5.10: Quỹ TM → Quỹ tiền mặt

Theo đặc tả giao diện 5.10 của khách hàng nhận ngày 05/10/2026, hai nguồn quỹ được
gọi tên là **Quỹ tiền mặt** và **Quỹ công ty**. Tên hiển thị cũ **Quỹ TM** trong tài
liệu và trên giao diện được đổi thành **Quỹ tiền mặt**; phạm vi quy tắc nguồn quỹ
theo dòng chi tại [QuyTrinhO2C.docx §7.5](QuyTrinhO2C.md#75-nguồn-quỹ-và-phiếu-thuchi)
và tiêu chí AC-CP-KT-07 giữ nguyên. Đây chỉ là đổi tên hiển thị: mã nội bộ
`COMPANY` / `TM` gắn với dòng tài khoản quỹ và bút toán không đổi.

## 2026-10-05 — Toàn bộ PRD nội dung chuyển sang .docx; bổ sung PhanHeKeToan (phân hệ Kế toán)

Theo chỉ đạo của chủ sản phẩm, 9 tài liệu PRD nội dung chuyển từ .md sang .docx
(pandoc; bảng, tiêu đề và số mục §n.m giữ nguyên; sơ đồ mermaid trong
QuyTrinhO2C và OpsVanHanh được render PNG nhúng). README.md và CHANGELOG.md
giữ định dạng .md làm bề mặt chỉ mục và lịch sử. Tham chiếu tên tài liệu ở mã
nguồn, testplan/flows, testplan/roles, docs/adr và BACKLOG.md được cập nhật
phần mở rộng; các bản ghi lịch sử có ngày (testplan/cycles, docs/memory,
script một lần) giữ nguyên như thời điểm ghi. Tài liệu mới `PhanHeKeToan.docx`
tổng hợp yêu cầu phân hệ Kế toán từ `5.10 - CHI TIẾT CÁC BỘ PHẬN.docx` Phần 1,
kèm 12 ảnh mockup gốc. Bổ sung thêm hàng BaoGia còn thiếu ở README §4.

## 2026-10-02 — Tờ khai của lô chỉ còn Số tờ khai, bỏ Luồng hải quan

Chủ sản phẩm phủ nhận trường **Luồng hải quan** (đỏ/vàng/xanh) là phạm vi tự
thêm ngoài yêu cầu gốc 21/09: "there's no such thing". Yêu cầu gốc chỉ là cho
phép **nhiều tờ khai cho mỗi lô hàng**. Trường đã bị bỏ khỏi màn hình, khỏi API và
khỏi cơ sở dữ liệu; số tờ khai vẫn thêm/xóa tự do theo lô, cột CHỨNG Từ và tệp
XLSX hiện **đủ số**, nối bằng ", ". Ô nhập Luồng trong khóa lô và câu chữ luồng
trong tài liệu vận hành cũng dọn theo. Quyết định chủ sản phẩm trong nhóm chat
TingTing 02/10/2026 (thẻ 20261002_262).

## 2026-10-01 — Giữ chính sách hiện tại cho các đề xuất220/245/252

Chủ sản phẩm chọn giữ phạm vi CUS đối với danh mục phí báo giá, các trường số
lượng/đơn giá/phụ cấp chuyến không âm, và tạo lô DRAFT rồi tiếp tục theo luồng
hiện tại. Quy tắc dòng chi phí âm được hiển thị nhưng không cộng vào tổng không
đổi. Đây là quyết định không mở thêm quyền hoặc thao tác SUBMIT, không phải
một thay đổi đã triển khai trên môi trường sản xuất. Quy tắc đang áp dụng nằm ở
[README §2.5](README.md#25-phạm-vi-danh-mục-phí-trường-chuyến-và-tạo-lô);
lý do và phạm vi ở [ADR220/245/252](../adr/2026-10-01-audit-todo-policy-rulings.md).

## 2026-09-28 — Chi phí: số âm có kiểm soát, lý do bắt buộc khi không thu khách, nhóm chi hộ theo danh mục, nguồn quỹ khớp dòng chi

- **Số tiền của một dòng chi phí được phép là số âm, và số âm không được cộng vào tổng nào**
  (QuyTrinhO2C.docx §7.8 — tiêu chí AC-CP-KT-19): một dòng chi phí có thể mang số âm; khi đó mọi
  tổng (chi hộ của lô, phải thu khách, bảng kê, bảng quyết toán) xử sự như thể dòng đó không tồn
  tại — không lấy số dương trừ đi số âm — trong khi dòng vẫn hiện để đối soát, chỉ số tiền là
  không được tính. Màn hình nhập của Ops, lái xe và kế toán vẫn yêu cầu số dương; việc mở nhập
  số âm trên giao diện là mặt việc riêng. (card 20260928_181)
- **Khoản chi không thu khách bắt buộc có lý do, và lý do đó đọc được ở nơi xử lý**
  (OpsVanHanh.docx §3.3 và §9.1): hệ thống chặn lưu một khoản chi Ops mà khách không phải trả
  (thu khách 0đ) nếu thiếu ghi chú nêu lý do; lý do này hiện trên bảng kế hoạch điều động cho kế
  toán và trên danh sách phơi phiếu cho CUS/kế toán — chỉ nội dung lý do, không kèm số tiền hay
  thông tin quỹ. Trước đó trường lý do được lưu nhưng không nơi nào đọc. (card 20260928_162)
- **Nguồn quỹ của phiếu phải khớp với dòng chi phí trên phiếu** (QuyTrinhO2C.docx §7.5): dòng chi
  hộ có hóa đơn (kể cả chi phí hóa đơn) phải chi từ Quỹ tiền mặt; ứng Ops, chi phí lô hàng không hóa
  đơn, phát sinh Ops, tiền đường và cược container phải chi từ Quỹ công ty. Chọn sai nguồn thì
  phiếu bị từ chối kèm tên dòng sai quỹ; phiếu trộn dòng của hai nguồn bị từ chối và yêu cầu tách
  phiếu. Trước đó chỉ kiểm tài khoản đã được phân nguồn hay chưa, chưa so nguồn với dòng chi.
  (card 20260928_167)
- **Phí làm tờ khai hải quan thuộc nhóm "yêu cầu hóa đơn"** (OpsVanHanh.docx §9.1): loại phí này
  trước đây không nằm trong nhóm nào — không bắt buộc hóa đơn nhưng cũng không được dùng bằng
  chứng thay thế, nên nó không có đường chứng từ nào hợp lệ. Nay thuộc nhóm yêu cầu hóa đơn như
  nâng, hạ, cân hàng, cơ sở hạ tầng và kiểm hóa. Danh sách loại phí được cân nhắc bằng chứng thay
  thế vì vậy chỉ còn Phí khác (không hóa đơn), dịch vụ kiểm hóa, phụ phí vùng và phí sửa chữa dọc
  đường. (card 20260928_181)
- **Nhóm chi hộ Nâng / Hạ / Phí khác suy từ nhóm quyết toán của danh mục, không từ mã phí**
  (OpsVanHanh.docx §9.1): đổi nhóm quyết toán của một loại phí trong danh mục thì màn hình nhập
  chi phí và máy chủ đổi theo, không cần sửa phần mềm. Trước đây chỉ hai mã cố định (phí nâng
  container, phí hạ container) được nhận đúng nhóm; các loại còn lại — nâng vỏ, nâng hàng, lưu
  bãi lúc nâng, hạ vỏ, hạ hàng, lưu vỏ, lưu bãi lúc hạ — bị dồn vào Phí khác dù danh mục đã ghi
  đúng nhóm. (card 20260928_161)
- **Màn hình công nợ khách hàng có tick "Bỏ xe công ty"** (QuyTrinhO2C.docx §7.10): bỏ các lô chạy
  bằng xe công ty khỏi số liệu công nợ đang xem; phép tính chạy ở máy chủ theo chủ sở hữu chuyến
  thực tế, không phải phép trừ ở trình duyệt, tệp xuất dùng đúng bộ lọc đang bật nên số trên màn
  hình và trong tệp khớp nhau, và tick không ẩn khách hàng nào khỏi danh sách. Nguyên tắc phân
  biệt xe nội bộ với nhà xe ngoài đã ghi tại §7.6. (card 20260928_177)
- **Gán nhiều xe cho một kế toán trong một thao tác** (QuyTrinhO2C.docx §7.4; tiêu chí
  AC-CP-KT-01 tại §7.8): chọn nhiều xe rồi gán cùng lúc thay vì gán từng xe; cả lượt gán là một giao dịch —
  một xe sai thì không xe nào bị gán nửa vời. Lịch sử người đã đối chiếu/chi tiền vẫn giữ như khi
  gán từng xe. (card 20260928_166)

## 2026-09-24 — Đợt 24/09: chốt debit theo đợt, sổ quỹ Ops chỉ-đọc, báo giá nhập/xuất, guard phôi phiếu

- **Chọn Debit — chốt công nợ theo đợt, VAT gắn từng đợt** (QuyTrinhO2C.docx §7): popup "Chọn Debit"
  trên màn hình kế toán chốt đợt lần 1, 2, 3… theo cặp khách hàng + nhà xe, riêng chiều phải thu /
  phải trả; VAT 0/5/8/10% gắn với từng đợt, tiền VAT và tổng tiền tự tính, kèm ghi chú; kỳ theo dõi =
  lần + tháng; dữ liệu tự điền bảng TỔNG HỢP CÔNG NỢ KHÁCH HÀNG; một lô chỉ thuộc một đợt chốt —
  popup là hành động chốt, không phải bộ lọc. (card 20260923_12)
- **Sổ quỹ cho tài khoản Ops — chỉ-đọc, đúng phạm vi của mình** (OpsVanHanh.docx §5.2): Ops thấy một
  mục sổ quỹ chỉ-đọc trên trang Quỹ tạm ứng, chỉ gồm dòng tiền của chính mình (tạm ứng đã nhận, chi
  đã ghi, hoàn trả, phiếu thu/chi liên quan) — không mở quyền quỹ công ty, máy chủ tự thu hẹp phạm vi,
  không nhận tham số định danh từ client. (card 20260923_13; ADR 2026-09-24-ops-fund-book-scoped-read)
- **Theo dõi hoàn cược: cảnh báo quá hạn công văn có hình thức rõ** (OpsVanHanh.docx §9.6): dòng đếm lô
  quá 7 ngày chưa có ngày nộp công văn hiển thị đỏ kèm số lượng, báo ngay bằng toast, cho phép tắt
  trong phiên làm việc; hai cảnh báo song song (quá hạn CV, tổng chưa hoàn cược) giữ nguyên. (card 20260923_14)
- **Báo giá: nhập file Excel = đúng lần ghi thật, khung phí kế thừa, định tuyến trung tính cơ sở**
  (BaoGia.docx — trang PRD mới của báo giá): bản xem trước nhập file chạy đúng bộ kiểm chứng của lần
  ghi thật (preview = commit); lần ghi kế thừa danh mục phí Chi-phí-khác của khung giá trước (ruling
  INHERIT); cột lít xuất không còn đuôi thập phân; mã định tuyến tuyến chuyên dụng bỏ định danh một
  cơ sở cụ thể — Lạch Huyện chỉ còn là dữ liệu cơ sở, không còn trong mã. (cards 20260922_57, 20260922_62, _64)
- **Phôi phiếu: phiếu quỹ chỉ trả nguồn đã duyệt, mỗi chuỗi trả một phạm vi** (OpsVanHanh.docx §9.2):
  phiếu thu/chi gộp trên bảng phôi phiếu chỉ tiêu nguồn chi hộ (OPS); chuỗi phiếu quỹ tiền mặt chỉ
  tiêu nguồn tiền đường (DRIVER); chi trả chỉ tính nguồn đã duyệt — máy chủ từ chối khoản chưa duyệt
  kèm **tên khoản phí**, không nêu mã nội bộ. (audit c12 cluster B; ADR 2026-09-24-expense-payer-scope-split)
- **Chốt debit: tiền không gắn chuyến hiển thị minh bạch** (QuyTrinhO2C.docx §7): màn L1 tách các khoản
  phí không gắn chuyến thành dòng bóng riêng — không lẫn vào tổng cước; L2 (workspace đợt chốt) thêm
  mục chỉ-đọc liệt kê các chuyến chưa gắn lô. (cards 20260924_2, 20260924_3)
- **Sửa lỗi theo audit chi phí 24/09** (Lead phê duyệt bổ sung): các mặt tài chính áp đúng quy tắc
  hiển thị hiện hành sau audit — nút xóa/xử lý nêu đúng tên nghiệp vụ thay mã nội bộ, dòng chi đã hủy
  hiển thị đúng trạng thái với hành động bị vô hiệu, và các nút xóa khoản tài chính luôn đi kèm lý do
  bắt buộc. (audit c12 cluster A/B — không sinh quy tắc mới, chỉ áp đúng quy tắc đang hiệu lực)
- **Ràng buộc kỹ thuật phục vụ nghiệp vụ**: mọi lệnh ghi tài chính bắt buộc khai báo trong sổ lệnh ghi
  (material-write registry) — kiểm tra tự động chặn endpoint thiếu khai báo (card 20260924_5); bộ ba
  migration journal + snapshot + .sql phải landed cùng lúc và nhật ký drizzle phải khớp tên file .sql
  (restamp coherence, strip-collision heal).

## 2026-09-22 — Giao diện đồng bộ: quản lý container ngay tại danh sách lô, bảng lọc và hiển thị trạng thái thống nhất

Đợt 22/09 đồng bộ hóa trải nghiệm hiển thị toàn ứng dụng: dữ liệu trong bảng hiển thị
trọn vẹn không bị cắt cụt, giá trị trạng thái hiển thị dạng chữ, các trang danh sách
dùng chung một kiểu thanh lọc, màn hình trống thể hiện thống nhất, và bảng màu nền
được hiệu chuẩn lại để mọi chữ đều đọc rõ. Toàn bộ quy tắc hiển thị đã chốt từ 16/09
đến 22/09 được hợp nhất thành một cuốn quy tắc hiển thị nội bộ làm chuẩn chung cho
việc xây dựng và nghiệm thu giao diện.

- **Thêm/bớt container ngay trên danh sách lô** (QuyTrinhO2C.docx): lô FCL có hộp thoại
  "Quản lý container" mở từ ô Tổng quan hàng hóa trên danh sách lô; lịch trình, phân xe
  và các tham số theo từng container vẫn thao tác tại trang chi tiết lô. Xóa container
  đang có chuyến bị chặn kèm lý do ngay trên hộp thoại.
- **Dữ liệu trong bảng không bị cắt cụt** (README.md): văn bản dài tự xuống dòng; mã,
  biển số, số điện thoại hiển thị trọn cụm — bỏ dấu "…" trên ô dữ liệu; cột tự rộng theo
  nội dung.
- **Một kiểu thanh lọc dùng chung** (QuyTrinhO2C.docx): các trang danh sách (danh mục khách
  hàng, tuyến đường, màn hình kế toán chốt debit) dùng chung thanh lọc — một hàng khi đủ
  chỗ, xuống đúng hàng thứ hai khi thiếu chỗ, điều khiển co giãn theo nội dung, nền phẳng
  không đổ bóng.
- **Màn hình trống thống nhất** (README.md): các trạng thái không có dữ liệu / chưa chọn /
  không có kết quả hiển thị cùng một kiểu trên mọi trang, dùng chung một bộ hình minh họa
  chọn theo ngữ cảnh (một số vị trí giữ hình riêng đang có để giữ nguyên diện mạo).
- **Lớp nổi đồng bộ** (QuyTrinhO2C.docx): hộp thoại, menu, gợi ý và thông báo đều dùng cùng
  nền trắng chuẩn — tín hiệu nổi duy nhất trong giao diện phẳng.
- **Trạng thái hiển thị dạng chữ** (README.md): bỏ khối màu bo tròn / hình viên thuốc cho
  giá trị trạng thái; trạng thái là văn bản (kèm chấm màu nhỏ khi cần), biểu tượng chỉ dùng
  cho nút hành động.
- **Bảng màu hiệu chuẩn lại** (README.md): các lớp nền, đường kẻ và chữ nhạt được đo và
  điều chỉnh giữ khoảng cách đủ đọc (chữ luôn ≥4,5:1 so với nền); xanh "thành công" chỉ
  dùng cho việc đã hoàn thành hoặc tiền đã thu — tiền chưa thu hiển thị màu vàng cảnh báo.
- **Kiểm tra tự động bảo đảm quy tắc**: bổ sung các kiểm tra tự động chốt dữ liệu bảng
  không bị cắt, màu trạng thái đủ tương phản và lớp nổi đúng nền — thay đổi vi phạm sẽ
  fail kiểm tra ngay.

## 2026-09-22 — Vai trò: mặt hình làm việc theo vai (quyết định Điều vận/Lái xe)

- **Điều vận và Lái xe không có work-in-box — by design** (QuyTrinhO2C.docx §3 đối chiếu; quyết định 2026-09-22,
  operator ủy quyền): Điều vận làm việc trên `/dispatch`, `/dispatch-detail` và Sổ chuyến đi; Lái xe trên
  `/my-trips`; work-in-box (`RoleWorkInbox`) chỉ dành cho Ops (`/my-orders`) và CUS (`/portal/shipments`).
  Endpoint `/driver/me/work-in-box` giữ nguyên như API dự phòng, chưa có màn hình dùng — nếu sau này cần, dựng
  mặt hình riêng thay vì gán vào màn hình hiện có. (Đóng card 20260922_73.)

## 2026-09-22 — Chi phí theo lô: danh mục dữ liệu, sổ quỹ hai nguồn, phôi phiếu, hoàn ứng, hoàn cược

- **Danh mục phí là dữ liệu, phân loại lái xe theo danh mục dùng chung** (`OpsVanHanh.docx` §9.1, §9.4): danh mục phí chi hộ và định mức tiền đường nạp theo cấu hình (fill-only — không ghi đè sửa tay của người dùng), tên phí và mức tiền là dữ liệu; lái xe chọn loại phí từ danh mục dùng chung, lớp có-hóa-đơn/không-hóa-đơn do máy chủ quyết từ cờ của danh mục; dòng có hóa đơn phải kèm số hóa đơn và thu khách sau khi kế toán đối chiếu, dòng không hóa đơn không bao giờ thu khách.
- **Định mức tiền đường nạp trong bước seed của lần dựng** (`OpsVanHanh.docx` §9.5): môi trường mới có đủ danh mục + định mức ngay sau khi dựng; chạy lại không nhân đôi, không ghi đè; nhãn "Lưu bãi" tách theo họ nâng/hạ ("Lúc nâng"/"Lúc hạ") theo chốt của khách.
- **Sổ quỹ tách hai nguồn và đọc theo nguồn** (`OpsVanHanh.docx` §5.2): mỗi phiếu thu/chi gắn đúng một nguồn quỹ (TK công ty ACB hoặc Tiền mặt); sổ theo từng nguồn đọc được riêng, tài khoản chưa gắn nguồn được đếm riêng, không lẫn vào sổ nào.
- **Bảng kiểm chi phí Ops và báo cáo hoàn ứng tháng** (`OpsVanHanh.docx` §9.2): kế toán tích xác nhận từng dòng hoặc tích tất cả, ghi ngày và người xác nhận; báo cáo tổng hợp hoàn ứng theo nhân viên: tiền ĐNTT (chỉ đếm khoản đã xác nhận) − tạm ứng còn giữ = còn phải hoàn ứng, kèm nhãn chiều số (công ty thanh toán hoàn ứng / công ty thu lại), không hiện số âm trần trụi.
- **Bảng điều khiển phôi phiếu và theo dõi hóa đơn kết hợp** (`OpsVanHanh.docx` §9.2): kế toán quản lý phiếu thu/chi theo chuyến trên một bảng điều khiển, gom dòng cùng xe liền nhau; theo dõi số hóa đơn, số tiền hóa đơn và tiền trả nhà cung cấp theo lô, CUS xem chỉ-đọc.
- **Theo dõi hoàn cược container** (`OpsVanHanh.docx` §9.6): lô khách khai "có cược" tự vào bảng theo dõi; kế toán điền ngày nộp công văn (dd/mm/yy hoặc lịch), ngày dự kiến hoàn cược mặc định +14 ngày và vẫn sửa được; tick "đã hoàn cược" ghi nhận đã thu và đổ tiền về quỹ công ty (ACB) qua engine kho quỹ hiện có; hai cảnh báo chạy song song (lô quá 7 ngày chưa có ngày nộp công văn; tổng tiền chưa hoàn cược).

- **Kế toán chốt debit — KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP** (`QuyTrinhO2C.docx`): màn hình kế toán theo lô với
  đầy đủ cột thu/trả cước vận chuyển, bộ lọc excel 2 cột, luồng "gửi yêu cầu điều chỉnh cước" theo cơ chế
  **cột xác nhận** (không tái lập luồng phê duyệt — quyết định 21/09); lô đang chờ đối soát không xuất được
  debit; thiếu dữ liệu hiển thị "Chưa xác định", không gán 0; phần Debit tab/VAT/Lần-Tháng/TỔNG HỢP CÔNG NỢ
  giữ ĐỂ LẠI chờ đặc tả.
- **Lồng ghép lịch sử sổ quỹ vào ACB** (`OpsVanHanh.docx` §5.2, chốt 22/09): nhập sổ đơn nguồn cũ vào dòng
  tiền TK công ty bằng phân loại tài khoản — bút toán cũ giữ nguyên vẹn, hiện ngay trong sổ ACB, số dư chạy
  liên tục; nguồn Tiền mặt bắt đầu trống từ thời điểm bật.
- **Mười lệnh ghi tài chính bắt buộc mang Idempotency-Key** (ràng buộc kỹ thuật phục vụ nghiệp vụ): ba lệnh
  điều chỉnh cước, ba lệnh theo dõi hoàn cược và bốn lệnh phơi phiếu — gửi lại không bao giờ nhân đôi bút toán.

## 2026-09-21 — Quyền chi phí Ops theo xe, guard giai đoạn, Lớp 1 đọc bản chốt mới nhất

- **Quyền khai chi phí của Ops sinh từ gán xe (auto-link theo xe)** (`OpsVanHanh.docx` §3.3): chủ sản phẩm chốt — Ops được gán đầu xe (phân công xe–Ops) tự có quyền lưu chi phí trên các lô do xe đó chở; gán tay từng lô qua form người dùng (Admin) vẫn hoạt động song song; thu hồi gán xe làm mất quyền trên các lô chưa có khoản chi đã lưu. Trước đó cổng `user_shipment_links` chỉ có writer gán tay nên Ops thật không thể lưu chi phí.
- **Đường ghi-chú nhanh không nuốt guard giai đoạn Điều vận** (`QuyTrinhO2C.docx` §3): quyết định "ghi chú tách khóa kế toán" chỉ áp cho khóa kế toán — Điều vận vẫn chỉ được sửa lô trong giai đoạn tiếp nhận kể cả khi payload chỉ-có-ghi-chú (sửa hồi sau khi phát hiện exception bỏ quên guard vai; bản đã ship đêm 20-09 từng nuốt guard này).
- **Lớp 1 cước vận tải (AUTO) đọc theo bản chốt mới nhất** (`QuyTrinhO2C.docx` §7.9): snapshot cước là INSERT-only (đổi Ngày vận chuyển/phát lệnh = chốt bản mới thay bản cũ); bản bị thay thế KHÔNG cộng vào bất kỳ tổng nào — chân chuyến cộng dồn theo từng leg, lô chỉ có bản chốt lúc tiếp nhận tính một lần, lô khóa kỳ đọc số đóng băng; Lớp 1 luôn khớp Bảng 2.1 và giá đè `final_debit_freight`.
- **Cước FCL chốt theo cont của chuyến khi phát lệnh** (`QuyTrinhO2C.docx` §7.9): anchor cước lấy từ cont của chính fulfillment được điều vận (loại + lịch hẹn), nên lô FCL không còn trường hợp "không bao giờ chốt cước" khi `route_id` cấp lô trống; lệnh chạy ngoài vẫn miễn và không tự bịa giá.
- **Xuất đề nghị thanh toán Ops: trung thực định dạng** (`OpsVanHanh.docx`): định dạng không hỗ trợ trả lỗi rõ thay vì im lặng trả xlsx; xlsx là chuẩn xuất, in A4 là đường giấy theo PRD.
- **Không lộ mã số nội bộ trên sheet đề nghị thanh toán** (`OpsVanHanh.docx`): lô thiếu mã hiển thị Số Bill/Booking hoặc "—", không bao giờ hiện DB id.
- **Kỳ giá dầu ghi Người nhập** (`CuocPhiPhuPhiDau.docx` §4): kỳ mới lưu người tạo; kỳ cũ hiển thị "Không xác định".
- **Lịch sử theo lô bỏ khỏi giao diện, điều chỉnh phân công vẫn giữ lý do và lịch sử** (`LoHangKepKetHop.docx` §3.3/§4/§7, `QuyTrinhO2C.docx` §3.2): chủ sản phẩm chốt 21/09 — lịch sử audit theo lô chỉ dựng lại khi khách yêu cầu; các bản ghi cặp trước đây/xem lại lịch sử ghép bị bỏ khỏi PRD (đối chiếu tài liệu 22/09). Riêng điều chỉnh phân công của Điều vận giữ nguyên "lý do và lịch sử" qua bản ghi nghiệp vụ vận hành, tách khỏi màn lịch sử lô.

## 2026-09-20 — Quick-edit lịch & ghi chú mở cho đủ ba vai

- **Quyền chỉnh nhanh lịch trình lô và ghi chú trên Tổng quan lô hàng mở cho CUS, Quản trị viên và Điều vận** (`QuyTrinhO2C.docx` §3): khi lô chưa khóa kế toán, cả ba vai đều bấm được ô lịch và ô ghi chú để sửa trực tiếp; khóa kế toán vẫn chặn mọi vai; các ô khác giữ quyền như cũ — điều vận chỉ mở đúng hai ô này.
- **Ghi chú (khách hàng + điều hành) tách khỏi khóa kế toán** (`QuyTrinhO2C.docx` §3): chủ sản phẩm quyết định "both notes can be edit" — trên lô đã khóa kế toán, CUS, Quản trị viên và Điều vận vẫn sửa được cả hai ô ghi chú trên Tổng quan lô hàng; lịch trình, tờ khai và các trường khác vẫn bị khóa chặn như cũ (điều chỉnh mệnh đề "khóa kế toán vẫn chặn mọi vai" của quyết định mở quick-edit cùng ngày).

## 2026-09-20 — Đối chiếu toàn diện: ngưỡng ≥, 0 khác thiếu, bảng kê đủ dữ liệu, dọn phê duyệt

- **Ngưỡng điều chỉnh áp khi đạt ngưỡng (≥)** (`PhuongAnTinhCuocTuDong.docx` §3.2, `CuocPhiPhuPhiDau.docx` §10): thay đổi giá dầu đúng bằng ngưỡng được coi là đạt ngưỡng và mở kỳ giá mới. Cả hai tài liệu ghi mở trước đó ("chưa thể tự chọn một cách"); engine đang chạy đúng hướng này (thay đổi == ngưỡng đã áp thay đổi), nên đây là quyết định khớp engine — không đổi hành vi runtime. Phần còn mở: giá trị ngưỡng theo hợp đồng, so kỳ liền trước hay mốc, kỳ đầu.
- **Giá dầu mốc F lưu chính xác đầy đủ, hiển thị rút gọn** (`CuocPhiPhuPhiDau.docx` §2.3/§2.8): 19.270/1,08 = 17.842,5926 là giá trị chuẩn (DB numeric(12,4), seed và engine đều đã dùng đúng); 17.842,59 chỉ là cách hiển thị rút gọn. Không phải mâu thuẫn — quy tắc đã có được đối chiếu xác nhận. Rào chắn: không bao giờ lưu F đã làm tròn — mỗi đồng surcharge trôi theo.
- **Phân biệt 0 thật và thiếu nguồn trên mọi màn hình** (`QuyTrinhO2C.docx` §7.9, `CuocPhiPhuPhiDau.docx` §5/§9): vắng nguồn hiển thị "—"; số 0 tính ra từ đầu vào đầy đủ thì hiển thị 0 đúng nghĩa; thi hành ở lớp formatter dùng chung. `finance-derived.ts` đang gộp null→0 — tách thẻ lỗi riêng. Phép nhập tay duy nhất được phép cho cước: giá cuối thực tế đàm phán của Kế toán khi lập bảng kê (`PhuongAnTinhCuocTuDong.docx` §5); cước tự tính thiếu điều khoản (lag/ngưỡng/kỳ/giá gốc) thì chặn tính tự động và nêu đúng phần thiếu, không có cơ chế ghi đè.
- **Đủ dữ liệu lập bảng kê = bốn điều kiện §7.2** (`QuyTrinhO2C.docx` §7.2): hàng hóa, giá, chứng từ, điều kiện kỳ — trong đó "chứng từ" đúng nghĩa §7.1: đã nhận chứng từ gốc với người và ngày nhận thực tế. Ba thông tin §7.1 (đủ bằng chứng / vận chuyển hoàn thành / đã nhận chứng từ giấy) là quy tắc ghi nhận riêng biệt, không phải cổng phát hành bổ sung. Đường phát hành hiện chưa có gate máy chủ cho bốn điều kiện này — tách thẻ lỗi riêng.
- **Quy tắc ghép 40FT định nghĩa tại `LoHangKepKetHop.docx` §1.1**: bốn cách diễn đạt hiện có (LoHang §1.1, §7; QuyTrinhO2C §5.4, §9) cùng nghĩa, không lệch số. §1.1 là nơi định nghĩa; các chỗ khác tham chiếu, thu gọn khi có lần chỉnh sửa tiếp theo; số mục giữ ổn định.
- **Ngoại tuyến: mục kiểm tra "xung đột README §2.2 vs LoHang §3.3" là đọc nhầm** — toàn bộ tài liệu cùng cấm offline (17 chỗ, 9 file), README §2.2 là nơi định nghĩa; các câu còn lại là lời nhắc, không viết lại (số mục được mã nguồn tham chiếu).
- **Dọn ngôn ngữ phê duyệt trong `BACKLOG.md`**: mục A-2 theo dõi một test "accountant approval" cho cấu hình chia sẻ phụ phí dầu — hành vi phê duyệt đã bỏ 2026-09-15, test thuộc diện xóa (không sửa). Các mục cùng họ (A-1, A-3, A-5, B-1, E-1, E-2) và `CHANGELOG.md` cũ còn nói "đường phê duyệt" được đánh dấu dọn cùng đợt.
- **D1/D2 đã trả lời dứt khoát**: 58 ô "0" trên /finance là thiếu nguồn bị gộp null→0 trong `finance-derived.ts` (thẻ lỗi riêng, kèm phép đo 58 ô); dòng thiếu giá 15T trên /trips hiển thị "—" tại ô giá + nhãn gọn "Thiếu giá 15T" trong ô, căn phải, kèm chú giải — quy cách ghi nhận tại đây.

## 2026-09-20 — Khóa hiển thị nghiệp vụ, phụ phí vùng, chính sách hóa đơn

- **Khóa hiển thị là khóa nghiệp vụ** (`QuyTrinhO2C.docx` §7.9): Số Bill/Số Booking là khóa nhận diện trên mọi màn hình, số tờ khai thứ hai, tên khách + ngày chi khi vắng chứng từ, vắng hết hiển thị "—". Mã nội bộ (SHP-*, TRP-*, mã chứng từ, #thứ tự) chỉ là khóa kỹ thuật, không bao giờ hiển thị; tiêu đề/thông báo sinh lại theo khóa nghiệp vụ bằng một bộ sinh dùng chung.
- **Phụ phí vùng và Phí khác hai số** (`QuyTrinhO2C.docx` §7.9): cột phụ phí vùng Bảng 2.3 đối xứng cột thu 2.1, nhãn đọc từ cấu hình danh mục; nguồn theo bậc điều vận › lái xe ứng trước › cấu hình cảng; vắng nguồn hiển thị "—" không tự 0; lô khóa giữ số snapshot. Dòng Phí khác mang hai số tách biệt (chi hộ / thu khách) nhập riêng.
- **Dòng có hóa đơn giữ nguyên khóa** (`QuyTrinhO2C.docx` §7.9): dòng chi phí đã có số hóa đơn không sửa số trên màn quyết toán — đổi tại nguồn chi phí theo quy trình.
- **Năm loại yêu cầu hóa đơn** (`OpsVanHanh.docx` §9.1): nâng, hạ, cân hàng, cơ sở hạ tầng, kiểm hóa là nhóm "yêu cầu hóa đơn" trên đường phê duyệt — không chấp nhận bằng chứng thay thế; chỉ Phí khác/kiểm dịch vụ cân nhắc bằng chứng thay thế. Cờ là cờ đường phê duyệt, không phải khóa sửa theo loại.
- **Báo phiên bản mới trên tab mở lâu** (`QuyTrinhO2C.docx` §8.2): tab mở qua một đợt cập nhật hệ thống được ứng dụng báo có phiên bản mới và cho làm mới khi người dùng chọn; không tự tải lại giữa chừng làm mất nội dung đang nhập.

## 2026-09-19 — Danh mục là dữ liệu, nhóm quyết toán, khóa lô và bảng quyết toán

- **Cảng và vùng phụ phí là dữ liệu** (`MasterDataNhaMay.docx` §8): thêm/đổi tên/ngưng dùng cảng thuần thao tác danh mục — không cần thay đổi phần mềm; gán cảng vào vùng phụ phí theo cấu hình trên cảng; vùng có cờ mặc định; lô đã khóa giữ nhãn cảng/vùng tại thời điểm khóa.
- **Nhóm quyết toán trên loại chi phí** (`OpsVanHanh.docx` §9.1): mỗi loại chi phí do người có quyền gán một Nhóm quyết toán; bảng quyết toán của lô nhóm tiền theo nhóm này, nhóm Chưa phân loại giữ mọi đồng chưa phân; tổng luôn khớp; đổi nhóm không viết lại chứng từ đã phát hành. Phí cân hàng mặc định nhóm Phát sinh.
- **Khóa lô và bảng quyết toán theo lô** (`QuyTrinhO2C.docx` §7.9): khóa lô đóng băng số tiền, luồng hải quan và nhãn cảng tại thời điểm khóa; bảng quyết toán hai lớp — dòng có hóa đơn tự tính lại theo quy tắc loại chi phí, chỉ Phí khác do CUS tự nhập; chưa xác định hiển thị Chưa xác định, không tự 0; nhóm Chưa phân loại bảo toàn mọi đồng; lô đã thuộc bảng kê không vào đợt khác — khoảng ngày theo ngày giao của các lô được chọn.
- **Cước chân hủy và khóa hiển thị** (`QuyTrinhO2C.docx` §7.9): chân vận chuyển đã hủy không tính cước vào lớp tổng — chân không chạy thì không tính tiền khách, lớp tổng luôn khớp lớp chi tiết; cước đóng băng khi phát hành lô (chưa gắn chân) vẫn tính vào lớp tổng dù lớp chi tiết chưa hiển thị được — ngoại lệ đã ghi nhận. Trên mọi màn hình, lô được nhận diện bằng khóa nghiệp vụ Số Bill/Số Booking, không hiển thị mã nội bộ.

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
- Phạm vi: `MasterDataNhaMay.docx` §1, §4, §6; `QuyTrinhO2C.docx` §4.4.

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

## 2026-10-05 — Điều phối: bổ sung cảng sau điều xe + danh mục nhiên liệu

Cảng nâng / Cảng hạ được phép bổ sung sau khi điều xe (khóa kế toán vẫn chặn);
tuyến đường vẫn khóa. Danh mục Khai chi phí OPS thêm "Phí nhiên liệu / dầu"
(không yêu cầu hóa đơn). Trọng lượng container hiển thị bỏ số 0 thập phân dư.
Chọn phân loại "Lấy Lẻ" không còn tự gắn tag "ĐẢO VỎ" — tác vụ là lựa chọn
thủ công của điều vận. Ô ngày-giờ phân đoạn: popup chọn giờ không còn cướp
focus khi gõ; gõ phím số đầu tiên đóng popup để gõ tay.
