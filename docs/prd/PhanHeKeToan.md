# PRD: Phân hệ Kế toán

**Dự án:** TTransport — Silver Sea

Tài liệu này ghi lại yêu cầu của chủ sản phẩm về giao diện và quy tắc nghiệp vụ của phân hệ Kế toán, tổng hợp từ `5.10 - CHI TIẾT CÁC BỘ PHẦN.docx` Phần 1 (PHÂN HỆ KẾ TOÁN), nhận ngày 05/10/2026. Tài liệu mô tả yêu cầu, không phải hiện trạng đã triển khai; các mục ghi "đã làm – chưa test" là phần đã dựng trên hệ thống nhưng chưa có rung kiểm thử.

Vai trò chính: Kế toán. Các vai trò liên quan: Lái xe và Ops nhập chi phí, CUS khai báo cược, Điều vận ghi chú vận tải. Quyền luôn theo vai trò và phạm vi được cấp — xem [README.md](README.md) §2. Quan hệ với tài liệu khác: [QuyTrinhO2C.md](QuyTrinhO2C.md) §7 (hồ sơ, bảng kê, lập phiếu thu/chi), [OpsVanHanh.md](OpsVanHanh.md) §9 (tạm ứng và hoàn ứng của Ops), [BaoGia.md](BaoGia.md) (danh mục phí báo giá).

> **Ghi chú chuyển đổi (21/10/2026, owner directive all-markdown):** nội dung dưới đây chuyển
> nguyên văn từ `PhanHeKeToan.docx` (bản .docx gốc lưu ở GDrive Kanban / attachments). Ảnh
> mockup nhúng trong docx được mô tả đầy đủ bằng chữ tại các mục `### Mockup:` — được dựng từ
> caption trong docx + OCR (session không có khả năng vision); chú thích viết tay trong ảnh
> được dịch thành **BEHAVIOR** (in nghiêng), không phải UI text. Các chi tiết thuần thị giác
> (màu chính xác, vị trí pixel) không xác nhận được thì ghi "không xác nhận được bằng OCR".

## 1. Mục tiêu và phạm vi

Kế toán vào phân hệ phải thấy ngay bức tranh tiền — phải thu, phải trả, cược, quỹ, nợ đến hạn — và thao tác được phơi phiếu, công nợ, quỹ, nhân sự tại một nơi, không phải đối chiếu thủ công nhiều màn hình.

| Danh mục | Nội dung chính |
|---|---|
| Phơi phiếu | Tổng hợp chi phí chuyến, xác nhận/sửa chi phí lái xe và Ops, thu/trả phơi, hóa đơn, cược, tạm ứng |
| Công nợ vận tải | Kế hoạch điều động tổng hợp, yêu cầu điều chỉnh cước, xuất Debit, chi tiết phải thu/trả |
| Quỹ | Quỹ tiền mặt, quỹ công ty |
| Khác | Chấm công, lương, danh sách nhân sự |

Ngoài phạm vi: các phân hệ khác (Điều độ, Lái xe, CUS, Quản lý). Chủ sản phẩm sẽ gửi tiếp các phần sau của "5.10 - CHI TIẾT CÁC BỘ PHẬN"; mỗi phân hệ sẽ có tài liệu riêng.

## 2. Dashboard khi đăng nhập

### 2.1 Tổng quát về tiền

Tổng hợp các khách hàng có công nợ: phải thu / phải trả trong tháng theo cả số lượng và số tiền (ảnh 1). Cột Số lượng nhấp vào mở chi tiết phải thu / phải trả theo từng khách hàng, để có dự kiến nguồn tiền hợp lý.

### Mockup: rId10.png (ảnh 1 — tổng quát tiền / cảnh báo hạn nợ)

Hai card cạnh nhau, cùng cấu trúc: **"Nợ phải thu theo hạn nợ"** và **"Nợ phải trả theo hạn nợ"**. Mỗi card: số Tổng cỡ lớn trên cùng (thu 67.913.410.802₫ / trả 460.904.640₫), dưới là 2 chip trạng thái **"Quá hạn"** (mang số tiền) và **"Trong Hạn"** (đang 0₫), chân card ghi **"Số liệu tính đến: 0:12"** kèm nút **"Tải lại"**. *Behavior từ chú thích: tổng nợ nhóm theo hạn; chip phân tách quá hạn/trong hạn; mốc "số liệu tính đến" là timestamp lần làm mới — nút Tải lại lấy số mới.*

### 2.2 Tổng hợp cược container

Biểu đồ cột so sánh theo tuần (nếu có thể): số lượng container, số tiền cược, đã hoàn cược.

### 2.3 Thông báo nhanh về Quỹ

Góc phải màn hình: số tiền còn tại ngày hôm đó (quỹ tiền mặt + quỹ công ty), có dự phòng về dòng tiền.

### 2.4 Cảnh báo công nợ

Biểu đồ cột theo các nhóm: các khoản nợ chuẩn bị đến hạn (trước 5 ngày); quá hạn 1–10 ngày; quá hạn 30 ngày; quá hạn 60 ngày.

### 2.5 Cảnh báo chạy song song

Container chưa hoàn cược: số lượng và tổng tiền. Nợ quá hạn: số khách và tổng tiền. Quỹ âm: chỉ hiện khi cả hai quỹ < 0 — "Cảnh báo Quỹ âm …. (số tiền)đ, kiểm tra lại."

## 3. Danh mục Phơi phiếu

### 3.1 Bảng tổng hợp phơi phiếu

Bảng 1.1.1 — Tổng hợp phơi phiếu (ảnh 2). Cột: thông tin lịch trình, khách hàng, thông số container (bổ sung thêm trọng tải), địa điểm nâng/hạ, thông tin xe. Xe ngoài (không phải xe Silver Sea): kế toán mặc định được phép điền/sửa chi phí bằng tay lên hệ thống. Xe nhà (xe Silver): chi phí do lái xe điền lên; kế toán tích xác nhận, từ chối, hoặc sửa chi phí (khi chi phí sai lệch / lái xe điền nhầm). Trạng thái: đã nhận phơi / chưa nhận phơi; nếu đã nhận phơi, ngày là ngày tích chọn nhận phơi trên desktop. Ghi chú vận tải: các ghi chú lưu sẵn từ điều vận và cus note trong quá trình làm hàng. Ghi chú lái xe: lái xe ghi chú để kế toán kiểm tra lại.

### Mockup: rId19.png (ảnh 2 — bảng 1.1.1 phơi phiếu, phân đoạn TIỀN ĐƯỜNG)

Thanh công cụ trên: dropdown **"Hình thức phơi"**, dropdown **"Trạng thái"**, nút **"Lọc"**, nút **"Lập phiếu thu/chi"**; dòng filter kế: ô **Search** + **Từ ngày / Đến ngày** + nút **"+ Lệnh SUBTOTAL(cột F)"** *(behavior: helper tính tổng nhanh kiểu Excel trên cột đang chọn)*. Bảng header **2 tầng grouped**: nhóm **THÔNG TIN LÔ HÀNG** (Lịch trình · Khách hàng & Nhà máy · Thông số container · Tuyến đường), nhóm **ĐỊA ĐIỂM NÂNG/HẠ** (Nâng · Hạ), nhóm **CHI HỘ** (3 cột tiền), cột **TIỀN ĐƯỜNG**, rồi **Ngày · [trạng thái nhận phơi] · Ghi chú lái xe**; mỗi dòng có 3 link-action **"Xem chỉnh · Xem chi tiết · Xem chi tiết"** *(thao tác mở editor / drawer chi tiết)*. Dữ liệu mẫu: LOG COM (LOGTU0900001, Nâng VP, Hạ An…, xe GFT 15H-100.01), Long Minh (HASUI001015, Nâng/Hạ Teco), KCN Quế Võ (15H-052.82), ngày 17/9.

### 3.2 Bộ lọc mini và thứ tự sắp xếp

Trên cột Khách hàng và Thông tin xe có bộ lọc mini để tìm nhanh tên khách hàng cần thu hoặc nhà xe cần thanh toán (ảnh 3). Sắp xếp: ưu tiên các số xe trùng nhau, số container trùng nhau xếp thứ tự liên tiếp (ảnh 4). Mục đích: với xe nhà tiện kiểm tra, thanh toán tiền đường; với xe ngoài tiện theo dõi phơi phiếu.

### Mockup: rId23.png (ảnh 3 — bộ lọc mini cột Khách hàng)

Dropdown nhỏ inline tại cột: nhãn **"Khách hàng ▾"**, dòng lọc **"Lọc Khách hàng: Tất cả ▾"**, danh sách gợi-y hiện các tên có "VIỆT NAM…". *Behavior: mini-filter ngay trên đầu cột, gõ/chọn để thu hẹp bảng theo khách hàng — không phải mở dialog filter riêng.*

### Mockup: rId26.png (ảnh 4 — phân rã tổng theo người chi)

Panel chi tiết nhỏ mở từ một tổng: bảng **"Nội dung phí | Số tiền | Người thanh toán (tổng)"**, 2 dòng khoản (một dòng 1.250.800₫), dòng **"TỔNG CỘNG 2.250.000₫"**. Chú thích tay dưới bảng ≈ *"(Áp dụng cho chi hộ Thu và Trả phơi bình thường)"* → *behavior: bảng phân rã này dùng cho cả hai chiều thu/trả của phơi; mỗi dòng hiện đúng người chi*. (Màu/đường viền không xác nhận được bằng OCR.)

### 3.3 Chi tiết chi phí

Xem chi tiết thu/trả từ Bảng 1.1.1: Người thanh toán tự hiển thị tên user người làm thanh toán (ví dụ lái xe/ops làm lệnh nâng/hạ từng ứng); kế toán có thể thêm để điền chi phí, hoặc tích duyệt các chi phí Ops và Lái xe nhập cho lô hàng. Chi hộ: tương tự cơ chế trên. Tiền đường: do lái xe nhập lên hệ thống; kế toán tích xác nhận, hoặc sửa/điều chỉnh để lưu lại và thanh toán. Lưu ý: bảng tổng hợp phơi phiếu chỉ hiện chi tiết từng nguồn chi phí từ đâu đổ về, do ai làm, ai chi, ai nhập hệ thống; tại đây được lập phiếu thu/chi các khoản chi phí.

### 3.4 Tổng hợp thu/trả phơi

Bảng con của bảng tổng hợp: tổng hợp các bên đã thu/trả trong thời gian tham chiếu; có thể hiển thị dạng bảng mini phía dưới. Chỉ thể hiện khách hàng / nhà xe còn công nợ trong thời điểm tham chiếu (từ ngày … đến ngày …); số còn phải thu = 0 mặc định được ẩn đi (ảnh 5). Phần báo cáo hiện có mặc định theo thời gian tìm kiếm.

### Mockup: rId31.png (ảnh 5 — tổng hợp thu/trả phơi)

Đầu block: dropdown **"Báo cáo tháng"** + **"Phạm vi: Mặc định (của tôi với kế toán) ▾"**. Hai bảng: **PHẢI THU (theo khách hàng)** — STT · Khách hàng · Tiền nâng · Tiền hạ · PS khác · nhóm **TỔNG HỢP** (Tổng · Đã thu · Còn phải thu) · Ghi chú; và **PHẢI TRẢ (theo nhà xe)** — cấu trúc đối xứng với Đã trả / Còn phải trả. Dòng "Chưa xác định" gộp khoản không rõ đối tượng. Chân có ghi chú phân công ≈ *"Phân công xe cho kế toán…"* → *behavior: bảng mini gắn với người kế toán phụ trách xe*. Số 0 còn phải thu → *ẩn dòng theo mặc định*.

### 3.5 Theo dõi hóa đơn kết hợp (đã làm – chưa test)

Bảng 1.1.2 — Theo dõi hóa đơn kết hợp (ảnh 6).

### Mockup: rId35.png (ảnh 6 — bảng 1.1.2 hóa đơn kết hợp)

Filter: **Từ ngày / Đến ngày** + 4 ô **Tổng** (tổng cont, tổng tiền, tổng thu, tổng chi). Bảng grouped: STT · Ngày · **Thông tin lô hàng** (Khách hàng (Nhà máy)) · **Thông số container** (Số cont · Loại cont · Xuất/Nhập) · MST · Nhà cung cấp · **Thông tin hóa đơn** (Số tiền · Số hóa đơn · Số tiền trả bên cung cấp HD · Số tiền trừ cho khách hàng (nếu có)) · Chênh lệch · Ghi chú · **Tiến độ** — dropdown **"Chọn dữ liệu"** với các lựa chọn trạng thái gửi hóa đơn (đã gửi / chưa gửi / Gửi HD) và chú thích tay *"chọn nâng/hạ"*. *Behavior: mỗi lô theo dõi hóa đơn kết hợp theo chiều nâng hoặc hạ; tiến độ HD điều khiển bằng dropdown trạng thái.*

### 3.6 Theo dõi hoàn cược (đã làm – chưa test)

Bảng 1.1.3 — Theo dõi hoàn cược (ảnh 7). Quy tắc: khi CUS nhập liệu tích có cược và điền số tiền cược dự kiến, bảng tự động ghi nhận lô cần cược đủ: tên khách hàng / hãng tàu / Bill / số tiền cược; CUS không điền thì kế toán được tự điền tay. Ngày nộp CV (ngày nộp công văn hoàn cược): kế toán điền, chọn qua lịch hoặc điền tay theo mẫu dd/mm/yy. Ngày dự kiến hoàn cược = ngày nộp CV + 14 ngày; vẫn cho chọn lịch hoặc điền tay (một số hãng tàu có thời gian hoàn cược lâu hơn 14 ngày). Trạng thái: mặc định "chưa hoàn cược"; khi tích "đã hoàn cược", hệ thống ghi nhận đã thu và đổ tiền về quỹ tài khoản ACB. Từ ngày – đến ngày để chọn thời gian kiểm tra; ngoài lọc, mặc định đẩy những cont chưa hoàn cược lên đầu, theo thứ tự ngày xa nhất → gần nhất. Tổng: tổng số tiền cược trong thời gian chọn hoặc theo trạng thái; có bộ lọc trạng thái đã/chưa hoàn cược. Cảnh báo chạy song song tại bảng này: (1) Ngày cược + 7 ngày chưa ghi nhận ngày nộp công văn → cảnh báo "kiểm tra check cược số lượng: … lô hàng" (đếm theo lọc: có ngày nộp CV và trạng thái chưa hoàn cược; ví dụ gốc: 21/09/26 cược lô Khách A — Bill YML123 — hãng YML — 4.000.000₫; đến 28/09/26 chưa chọn ngày nộp CV → cảnh báo "01 lô hàng"). (2) Chưa hoàn cược: cảnh báo liên tục tổng số tiền theo trạng thái "chưa hoàn cược".

### Mockup: rId39.png (ảnh 7 — bảng 1.1.3 hoàn cược)

Filter **Từ ngày … đến ngày …** + ô **Tổng** + dropdown **Trạng thái**. Cột: STT · Ngày cược · Khách hàng · Hãng tàu · Bill · Số tiền cược · Ngày nộp CV · Ngày dự kiến hoàn cược · **Trạng thái hoàn cược** · Ghi chú. Trạng thái dạng chip/nhãn 3 mức: **"đã hoàn cược" / "KT ghi chú" / "chưa hoàn cược"**. *Behavior: ngày dự kiến auto = ngày nộp CV + 14 (sửa tay được); tick đã hoàn cược ghi thu + đổ quỹ ACB; sort mặc định chưa hoàn cược trước, ngày xa nhất lên đầu.*

### 3.7 Theo dõi tạm ứng

Bảng 1.1.4 — Quản lý tạm ứng (ảnh 8) — tạm ứng của Ops, lái xe, …: bảng để kiểm tra duyệt chi phí của Ops đã nhập lên hệ thống; cột Ngày duyệt tích all hoặc tích từng dòng để xác nhận duyệt. Sau khi duyệt, trên Sổ Quỹ tại TÀI KHOẢN OPS sẽ hiện số tiền còn lại cuối cùng khớp với số "Còn phải hoàn ứng" ở bảng "báo cáo tổng hợp hoàn ứng", để kế toán tiện thanh toán hoặc yêu cầu nhân viên hoàn lại tiền tạm ứng làm hàng trong ngày.

Bảng 1.1.4 — Báo cáo hoàn ứng (ảnh 9), để lập phiếu hoàn ứng: Số tiền ĐNTT theo ngày / theo đợt làm đề nghị; Số tiền đã ứng = số tiền tạm ứng đầu ngày của Ops; Số tiền còn lại = Số tiền ĐNTT − Số tiền đã ứng. Số tiền dương: công ty thanh toán hoàn ứng; số tiền âm: công ty yêu cầu hoàn trả tạm ứng.

### Mockup: rId43.png (ảnh 8 — bảng 1.1.4 quản lý tạm ứng)

Filter: **Từ ngày ĐNTT / Đến ngày** · **"Nhân viên thanh toán … (lọc theo tên toàn bộ nhân viên VP)"** · **"Loại theo dõi: Theo lô hàng / Theo nhân viên"** · **"Tiến độ TT"** · nút **"Lập phiếu hoàn ứng"**. Bảng grouped: Ngày lập · Ngày duyệt DNTT · Nhân viên · Khách hàng & Nhà máy · Tổng quan hàng hóa · **Phí chi hộ không hóa đơn** (Tên phí · Phí giao nhận · Phí phát sinh) · **Phí chi hộ có hóa đơn** (Tên phí · Số hóa đơn) · Ghi chi. Dòng mẫu: Long Minh · IEGLV48607619986 · 1×20DC · "Carnet" · (chi tiết tên phí) · GASKEY… · 08615325934. *Behavior: "Ngày duyệt" là cột tick — tích all hoặc từng dòng; sau duyệt Sổ Quỹ TK OPS khớp "Còn phải hoàn ứng".*

### Mockup: rId46.png (ảnh 9 — báo cáo tổng hợp hoàn ứng tháng)

Filter **Từ ngày / Đến ngày**. Cột: STT · Nhân viên · DNTT · Số tiền ĐNTT · Số tiền đã ứng · **Còn phải hoàn ứng** · Ghi chú. *Behavior: còn phải hoàn ứng = DNTT − đã ứng; dương công ty trả, âm công ty thu lại (hiện cảnh báo, không hiện số âm trần trụi).*

## 4. Danh mục Công nợ vận tải

### 4.1 Kế hoạch điều động tổng hợp

Bảng 1.2.1 — Kế hoạch tổng hợp (ảnh 10): Từ ngày – đến ngày lọc thời gian muốn kiểm tra. Bộ lọc "mini" trên cột Thông tin lô hàng và Phân xe: cho phép tìm tên khách hàng, tên nhà xe; khi tới kỳ chốt công nợ, lọc của bên nào bấm chọn bên đó.

### Mockup: rId51.png (ảnh 10 — bảng 1.2.1 kế hoạch điều động tổng hợp)

Filter **Từ ngày / Đến ngày** + 2 nút hành động: **"Gửi yêu cầu điều chỉnh cước"** và **"Debit"**. Bảng grouped 2 tầng: Ngày · **Thông tin lô hàng** (Khách hàng (Nhà máy)) · **Thông số container** (Số cont · Loại cont · Xuất/Nhập) · **Phân xe** (Tên nhà xe · BKS) · nhóm **PHẢI THU** (Cước thu (auto) · Lạch Huyện (auto) · Phụ phí (auto) · Phát sinh (CUS) · Tổng thu) · nhóm **PHẢI TRẢ** (Cước trả ĐV · Lạch Huyện (điều vận) · Phát sinh (điều vận) · Tổng 1) · **Phí RU**. *Behavior: mini-filter trên 2 cột Thông tin lô hàng + Phân xe để chốt theo khách/nhà xe; nút điều chỉnh cước và Debit tác động trên tập đang lọc.*

### 4.2 Gửi yêu cầu điều chỉnh cước

Khi kiểm tra thấy chuyến hàng lệch cước: tích vào dòng chuyến hàng, chọn gửi yêu cầu điều chỉnh cước → hệ thống đẩy yêu cầu tới người có quyền "phê duyệt". Tại thời gian đó không thể chọn xuất Debit lô hàng.

### 4.3 Xuất Debit

Ví dụ gốc của chủ sản phẩm — lọc kiểm tra cước phải trả "Nhà xe A": chọn lọc "Nhà xe A" tại cột Phân xe; nếu cước đã chính xác, tích chọn ALL hoặc một dòng trên tổng số sản lượng kỳ lọc → chọn Debit. Hệ thống hiện bảng nhỏ (ảnh 11): Từ ngày – đến ngày (theo ngày trên bộ lọc đã lọc); Lần: 1, 2, 3… (tự chọn); Tháng: 1–12 (tự chọn); Phải thu / phải trả: tích chọn — với ví dụ "Nhà xe A" tích phải trả → hiện tên "Nhà xe A" với số tiền phải trả; VAT: tích chọn 0 / 5 / 8 / 10% — hệ thống tự nhân với số tiền phải trả để hiện số tiền VAT; cột tổng tiền = phải trả + VAT = tổng tiền.

### Mockup: rId56.png (ảnh 11 — popup Debit)

Popup nhỏ dạng bảng: **Tên khách | Cước thu | Cước trả | Tổng | Ghi chú** + nút **"Xác nhận"**. *Behavior: hộp chốt Debit theo kỳ đã lọc — chọn lần/tháng/chiều thu-trả/VAT, tiền VAT và tổng tự tính, xác nhận để chốt đợt.* (Ô nhập lần/tháng/VAT trong ảnh gốc quá nhỏ để OCR đủ — cấu trúc fields lấy từ text §4.3.)

### 4.4 Chi tiết phải thu/trả và tổng hợp công nợ tháng

Chi tiết phải thu/trả (tìm theo thời gian từ ngày … đến ngày …): bảng tổng hợp sản lượng vận tải của các bên trong tháng, dùng để đối soát nhanh cuối tháng — chốt lại tổng số lượng ncc/vendor phải xử lý trong tháng, tránh xót khách hàng (ảnh 12). Tổng hợp công nợ phải thu/trả theo tháng: tổng số tiền + VAT.

### Mockup: rId60.png (ảnh 12 — chi tiết phải thu/trả tháng)

Bảng danh sách đối tác: STT · Tên (khách/nhà xe) · Cước thu · Cước trả · **Tổng** · nút **"Lại"** *(behavior: nút tải thêm / làm mới từng dòng — retry load)*. Danh sách mẫu theo ABC: BIEN XANH 21.500.000₫, BÌNH MINH 2.450.000₫, ĐƯỜNG THỦY 12.900.000₫, ĐẶNG KHOA / ĐẶNG KHOA BN, ĐẲNG QUÂN, BEN, BX LOC, DLA VÀM, BÔ TRUC XS, BÒ XASCO, BÓNG TÁP… *Behavior: mỗi bên một dòng tổng tiền để chốt nhanh cuối tháng; dùng cùng khoảng ngày lọc.*

## 5. Danh mục Quỹ

Quỹ tiền mặt. Quỹ công ty. Dashboard (§2.3) và ghi nhận hoàn cược (§3.6) đọc số tiền từ các quỹ này.

## 6. Danh mục Khác

Bảng chấm công: chia văn phòng / lái xe. Bảng lương: chia văn phòng / lái xe. Danh sách nhân sự. Hiện trạng: màn hình lương/nhân sự hiện hành đã quản lý theo "Đơn vị phụ trách" (bộ phận) của từng nhân sự; yêu cầu mới của chủ sản phẩm là hiển thị tách văn phòng / lái xe.

## 7. Tiêu chí chấp nhận

| Mã | Tiêu chí |
|---|---|
| AC-KT-01 | Dashboard tổng quát về tiền hiện phải thu/phải trả trong tháng theo số lượng + số tiền; nhấp số lượng mở chi tiết theo từng khách |
| AC-KT-02 | Biểu đồ cược container so sánh theo tuần: số lượng, số tiền cược, đã hoàn cược |
| AC-KT-03 | Thông báo Quỹ = quỹ tiền mặt + quỹ công ty tại ngày hôm đó |
| AC-KT-04 | Cảnh báo nợ đủ 4 nhóm: trước 5 ngày, quá hạn 1–10, 30, 60 ngày |
| AC-KT-05 | Cảnh báo Quỹ âm chỉ hiện khi cả hai quỹ < 0 |
| AC-KT-06 | Xe ngoài: kế toán điền/sửa chi phí trực tiếp; xe nhà: lái xe nhập, kế toán tích xác nhận/từ chối/sửa |
| AC-KT-07 | Bộ lọc mini trên cột khách hàng và thông tin xe; sắp xếp nhóm số xe/số container trùng nhau liên tiếp |
| AC-KT-08 | CUS tích có cược + điền số tiền → dòng hoàn cược tự tạo đủ khách/hãng tàu/Bill/số tiền; thiếu thì kế toán điền tay được |
| AC-KT-09 | Ngày dự kiến hoàn cược = ngày nộp CV + 14 ngày, sửa tay được |
| AC-KT-10 | Tích đã hoàn cược → ghi nhận đã thu và đổ tiền về quỹ ACB |
| AC-KT-11 | Cảnh báo ngày cược +7 chưa có ngày nộp CV; cảnh báo liên tục tổng tiền chưa hoàn cược |
| AC-KT-12 | Duyệt tạm ứng xong → Sổ Quỹ tài khoản OPS khớp "Còn phải hoàn ứng" |
| AC-KT-13 | Gửi yêu cầu điều chỉnh cước → trong thời gian chờ không xuất được Debit của dòng đó |
| AC-KT-14 | Hộp Debit: lần, tháng, phải thu/phải trả, VAT 0/5/8/10% tự nhân, tổng = tiền + VAT |
| AC-KT-15 | Tổng hợp thu/trả phơi ẩn mặc định khách có số dư 0; phần báo cáo mặc định theo thời gian tìm kiếm |

## 8. Điểm cần làm rõ

File nguồn ghi "chia phân hệ kế toán làm thành 3 mục chính" nhưng liệt kê 4 danh mục (Phơi phiếu / Công nợ vận tải / Quỹ / Khác) — tài liệu này giữ nguyên 4 danh mục. Yêu cầu "đẩy yêu cầu tới người có quyền phê duyệt" (§4.2) và bước "duyệt chi phí" tạm ứng/chi phí lái xe (§3.3, §3.7) chạm nguyên tắc không phê duyệt nội bộ ở [README.md](README.md) §2.1 — đây là yêu cầu gốc của chủ sản phẩm nên được ghi nhận; cần chủ sản phẩm xác định vai trò "phê duyệt" và cách đối chiếu với nguyên tắc chung. Quỹ đích khi tích hoàn cược (§3.6): tài khoản ACB cố định hay cấu hình được? Các phân hệ còn lại của "5.10 - CHI TIẾT CÁC BỘ PHẬN" (Điều độ, Lái xe, CUS, …) chưa nhận file nguồn. Hai mục "đã làm – chưa test" (§3.5, §3.6) cần rung kiểm thử UI (rung 3) trước khi tuyên bố hoàn thành. Trạng thái "nhận phơi" tích trên desktop (§3.1) — cần ánh xạ với trạng thái hiện có của hệ thống. Tổng hợp thu/trả phơi ẩn khách dư 0 (§3.4): có cần nút bật hiện lại không?

---

# Spec gốc khách hàng (các đợt fix chi phí)

Các mục dưới đây lưu **nguyên văn spec gốc** cho 2 đợt chỉnh sửa chi phí kèm trạng thái triển khai; quy tắc đang áp dụng nằm ở [QuyTrinhO2C.md](QuyTrinhO2C.md) và [CHANGELOG.md](CHANGELOG.md).

> Giới hạn phương pháp: mockup mô tả bằng chữ từ caption docx + OCR (session không có vision).
> Chú thích trong ảnh là **gợi ý hành vi**, không phải UI text.

## Spec gốc — "19.10 - FIX CHI PHÍ.docx" (Fix lần 2 – khai báo chi phí tổng quan, 19/10/2026)

### Text gốc (trích nguyên văn)

**Kế hoạch làm hàng -> Khai chi phí : cần điều chỉnh**

1.1 (ảnh 1 — hiện trạng hệ thống). Muốn điều chỉnh hiển thị: *"Tại ô Chụp / Chọn ảnh: Có thể chụp hoặc không, không ghi nhận thiếu chứng từ. Lý do: Ops khi khai báo chi phí, phải in hóa đơn chứng từ để trên bàn kế toán, đối soát nên có thể không chụp."*

2. Kế toán:

> TOÀN BỘ TRƯỜNG PHẢI ĐIỀN SỐ TIỀN, MẶC ĐỊNH CHO EM ĐỊNH DẠNG: 1,000,000 (CÓ DẤU CHẤM HOẶC PHẨY NGĂN CÁCH – TẤT CẢ DỮ LIỆU CỦA CÁC PHÂN HỆ)

**A/ Kiểm soát phơi phiếu — Xem chi tiết -> Thêm Dòng:**

2.1 (ảnh "Thêm khoản chi - Kiểm soát phơi phiếu hệ thống"). Mong muốn điều chỉnh hiển thị: click vào mục **Tiền đường**, bảng hiển thị (ảnh 4–5); click vào mục **Chi phí lô hàng**, bảng hiển thị tương tự -> **Đóng / Lưu**. *"Phía bên dưới bảng kiểm soát phơi phiếu thể hiện bảng này."* Bảng 1×3 gốc: `Tiền đường | Chi phí lô hàng` — *(2 loại phí để cạnh nhau, tích chọn sẽ ra chi phí của mục đó)*.

2.2 (ảnh báo cáo). *"Mục đích em muốn có bảng này để tiện đối soát trong trường hợp còn phải thu / trả các nhà xe -> Không hiển thị báo cáo tháng đổi tên : **BÁO CÁO THU / TRẢ PHƠI — Ngày .... - ......** Báo cáo phải thu (theo khách hàng) / Lập phiếu thu: / Báo cáo phải trả (theo nhà xe) / Lập phiếu chi. Ở 2 báo cáo này, khi click vào tên nhà xe thể hiện ra 1 bảng chi phí còn thiếu chưa thanh toán của các lô hàng. Khi ấn lập phiếu thu / phiếu chi, tại ô STT hiện ra ô vuông có thể tích chọn / chọn all để lập phiếu chi hàng loạt thanh toán chi phí. Tại bảng thanh toán chi phí (hàng loạt hay từng nhà xe), đều phải thể hiện rõ các loại chi phí thanh toán. VD: với nhà xe hàng loạt."*

**b/ Kế toán chốt Debit** (2.3): *"Nếu chọn tất cả các cột, hệ thống vẫn bị lỗi: Giao diện chưa đẹp mắt -> Yêu cầu fix lại, hàng cột cân chỉnh khớp. Khi ấn dòng bất kì, hiện số dòng mà không biết đã click tới dòng nào rồi -> Khi ấn chọn debit -> Ở ô Ngày: hiện ra những ô vuông nhỏ để tích chọn / chọn all -> Chọn debit. Xuất debit e đang không xuất được, kiểm tra lại phần XUẤT DEBIT."*

**c/ Tạm ứng & Hoàn ứng:** *"Tại yêu cầu tạm ứng: Chưa có mục phê duyệt, chỉ có ghi nhận. Vậy ghi nhận nhưng không phê duyệt sẽ chi tiền thế nào. Phần hoàn ứng: Khi Ops lập phiếu hoàn ứng, cũng không có mục duyệt phiếu hoàn ứng. Em check thấy khi Ops lên chi phí, vào mục hoàn tạm ứng nhưng qua bên tài khoản kế toán không hiện. Check lại giúp em."*

### Mockup: image1.png (đầu spec 19.10 — chi tiết tiền đường, khoản "Sửa chữa dọc đường")

Panel "Chi tiết tiền đường <Bill> ×" (nút đóng ×): thông báo rỗng "Không tìm thấy chi phí thuộc lô" + nút "Tải lại khoản chi"; bảng "LÁI XE NHẬP (8 NGƯỜI)": STT · Khoản lái xe nhập · Ngày · Lái xe · Ban đầu (₫) · Thực chi hiện tại (₫) · thao tác **Tích duyệt / Từ chối** · Kế toán duyệt; footer "Tổng phát sinh 500.000₫ · Đã duyệt 0₫" kèm chú thích tay: *tổng phát sinh là tất cả dòng; chỉ dòng đã duyệt mới được lập phiếu chi thanh toán cho lái xe — 500.000₫ chưa duyệt không vào phiếu; con số "Đã duyệt" chính là con số hiện ở cột Tiền đường của bảng kiểm soát phơi phiếu*; nút "+ Thêm dòng · Hủy · Lưu".

### Mockup: image2.png (biến thể — khoản "Phí nâng" 1.500.000₫)

Cùng cấu trúc image1: khoản "Phí nâng" ngày 2026-10-14, lái xe Bùi Văn Kiệm, Ban đầu 1.500.000₫, Thực chi hiện tại 1.500.000₫, chưa duyệt; footer Tổng phát sinh 1.500.000₫ · Đã duyệt 0₫ + cùng chú thích behavior.

### Mockup: image3.png (báo cáo tổng hợp hoàn ứng)

Filter Từ/Đến + Nhân viên (Tất cả) + Đợt đối soát (Tất cả) + nút Lọc; 3 thẻ tổng: Tổng số tiền DNTT 0₫ · Tổng số tiền đã ứng 27.575.000₫ · Tổng còn phải hoàn ứng 0₫; bảng STT · Nhân viên · DNTT · Số tiền DNTT · Số tiền đã ứng · Còn phải hoàn ứng · Ghi chú — 4 dòng mẫu (Lưu Danh Hùng 1.500.000₫, Nguyễn Huy Hoàng 75.000₫, Nguyễn Văn Giao 16.000.000₫, Vũ Đình Cường 10.000.000₫) đều "Không còn chênh lệch". *Behavior: báo cáo đọc theo đợt đối soát; còn phải hoàn ứng = DNTT − đã ứng.*

### Mockup: image4.png (sub-form "Tiền đường")

Sub-form mở khi click mục Tiền đường (bên cạnh mục Chi phí lô hàng): dòng "Ngày" *(chú thích tay: mặc định là ngày hiện tại / được chọn ngày — behavior: date-picker default today, đổi được)*; các trường: Tên khoản chi · Số tiền (placeholder 1,000,000) · Số hóa đơn · Thu khách hàng · Người chi; chú thích tay tại ô: *"Tích chọn ô (nếu tích chọn tức là phí có hóa đơn, ghi số hóa đơn)"* → *behavior: checkbox = flag có hóa đơn, khi bật mới yêu cầu số hóa đơn*; nút "+ Thêm chi phí" *(behavior: thêm liên tục nhiều dòng, không phải lưu từng dòng)*.

### Mockup: image5.png (sub-form "Chi phí lô hàng")

Cấu trúc giống hệt image4, chỉ đổi nhãn mục sang "Chi phí lô hàng" — *behavior: hai loại phí nằm cạnh nhau, tích chọn loại nào ra form nhập của loại đó*.

### Mockup: image6.png (BÁO CÁO THU/TRẢ PHƠI)

Block đổi tên từ "Báo cáo tháng": tiêu đề "BÁO CÁO THU/TRẢ PHƠI — Ngày … - …"; 2 bảng: **Báo cáo Phải thu (theo khách hàng)** — STT · Khách hàng · Tiền nâng · Tiền hạ · PS khác · nhóm TỔNG HỢP (Tổng · Đã thu · Còn phải thu) · Ghi chú; **Báo cáo Phải trả (theo nhà xe)** — đối xứng (Nhà xe · Đã trả · Còn phải trả); dòng gộp "(Chưa xác định)" (nâng 2.250.000₫, hạ 0₫, PS khác 1.148.000₫, tổng 3.398.000₫) và "XE NHÀ – SILVER SEA" (140.000₫); *behavior: click tên nhà xe → bảng chi phí còn thiếu chưa thanh toán của các lô; nút "Lập phiếu thu"/"Lập phiếu chi" mở phiếu với checkbox chọn/chọn-all tại cột STT*.

### Mockup: image7.png (cận cảnh Phải thu)

Bảng Phải thu của image6 phóng to: 1 dòng "(Chưa xác định)" + dòng TỔNG CỘNG khớp (2.250.000₫ · 0₫ · 1.148.000₫ · 3.398.000₫ · đã thu 0₫ · còn 3.398.000₫).

### Mockup: image8.png (cận cảnh Phải trả)

Bảng Phải trả phóng to: "(Chưa xác định)" (nâng 2.260.000₫, hạ 0₫, PS 1.008.000₫, tổng 3.258.000₫, còn trả 3.268.000₫) + "XE NHÀ – SILVER SEA" (140.000₫).

### Mockup: image9.png (PHIẾU CHI THANH TOÁN PHƠI — 1 nhà xe)

Form phiếu: Ngày chi · TK chi; bảng STT · Nhà xe · Chi phí · Số cont · Số tiền · Tổng tiền · Ghi chú — 1 nhà xe "Vận tải" 2 dòng (Nâng hàng AXEU2141373 1.000.000₫; Hạ vỏ AXEU2141373 2.000.000₫) subtotal 3.000.000₫; dòng "Tổng thanh toán 3.000.000₫"; nút "Xác nhận".

### Mockup: image10.png (PHIẾU CHI THANH TOÁN PHƠI — hàng loạt)

Như image9 nhưng nhiều nhà xe: "Vận tải" (3.000.000₫) + "Duyên Hải" (Gửi vỏ OOCU5614120 500.000₫; Hạ hàng EMCU1012517 1.872.000₫ = 2.372.000₫); Tổng thanh toán 5.372.000₫. *Behavior: cột STT là checkbox — chọn từng dòng/chọn-all để lập phiếu chi hàng loạt; từng nhóm nhà xe có subtotal riêng.*

### Mockup: image11.png (Kế toán chốt debit — hiện trạng đã có nút chọn-all)

Screenshot staging: search "Mã lô, bill/booking, khách hàng, container" + Từ-Đến + Khách hàng ▾ + Nhà xe (phân xe) ▾ + nút Cột; chip thống kê "Lô trong kỳ 190 · Chưa đối soát 52 · Chờ xác nhận đối soát 188"; bộ chọn cột dạng chip: Thông số container (0) · Chọn Debit (0 dòng) · Xuất Debit Note · Phân xe · Cước thu (tự động) · Lạch Huyện (tự động) · Phụ phí (tự động) · Phát sinh (CUS) · Cước trả ĐV · Phát sinh DV · Tổng 1 · Phí RU; nút hành động **"Chọn tất cả 190 lô đủ điều kiện · Đối soát · Hoàn tác"**; hàng thiếu dữ liệu hiện "Thiếu cước thu / Thiếu phụ phí / Thiếu phát sinh DV / Thiếu tổng 1 / Thiếu phí RU…" *(behavior: thiếu dữ liệu là nhãn thiếu, không gán 0)*. Hai dòng mẫu: 05/08/2026 LOGCOM DNKM192801 (Công ty TNHH SX TM Dệt May) và 08/08/2026 DNKM13339 (Công ty CP Thực phẩm Đôn) đều toàn "Thiếu …".

### Trạng thái land (21/10/2026)

| Mục spec | Trạng thái | Bằng chứng |
|---|---|---|
| 1.1 OPS Khai chi phí — ảnh/chứng từ optional | LAND | phiếu 141026230710/191026160000 (PASS doc tổng hợp 21/10); rule OpsVanHanh §3.3 |
| Định dạng số tiền 1,000,000 toàn phân hệ | LAND | convention VND nhà (AGENTS); CHANGELOG 21/10 (CUS-08 tiền tệ hiển thị) |
| 2.1 Thêm dòng: 2 loại phí cạnh nhau + bảng duyệt lái xe (chỉ dòng đã duyệt vào phiếu) | LAND | "Bảng kiểm chi phí Ops (ship 22/09)" OpsVanHanh §9.2; card 2026-10-05 phoi-phieu mini-filter; hint "Đã duyệt = cột Tiền đường" trùng quy tắc §9.2 |
| 2.2 BÁO CÁO THU/TRẢ PHƠI + lập phiếu thu/chi chọn/chọn-all + bảng chi phí từng nhà xe | LAND | QuyTrinhO2C §7.6 (2 báo cáo phải thu/trả), §7.5 (phiếu tổng hợp, AC-CP-KT-08 chọn-all); UI 19/10 (141026230760 → 191026201900) |
| 2.3 Chốt debit: cân chỉnh cột, chọn debit theo ô Ngày, Xuất Debit | LAND | FB-094 `239556ec`/`150acee0` + cột essential/column chooser (KT4, ebd032fb); UI "Chọn tất cả N lô đủ điều kiện" có thật (image11 chụp hiện trạng đã có nút) |
| c/ Tạm ứng & hoàn ứng: phê duyệt, tick chốt, số âm | LAND | 141026230770 + 181026183600; UI DRIVEN qa/2026-10-21-hoanung-am (số âm + duyệt) |

## Spec gốc — "chiphispec-2.docx" (Fix lại các chi phí của từng phân hệ)

### Text gốc (trích nguyên văn)

**Lái xe** — Kết thúc lô hàng hiện ra 2 bảng chi phí: Chi phí lô hàng và tiền đường. *"BỎ HẾT CHỖ NGƯỜI CHI – TÔI CHI / CÔNG TY CHI GIÚP EM."*

- Chi phí lô hàng: *(Bỏ cột người chi – không cần thiết). Bỏ số hóa đơn và ngày hóa đơn. + Thêm 2 ô chọn nhỏ: Hóa đơn / Phiếu thu. Yêu cầu chụp biên lai nếu có phát sinh chi phí lô hàng.*
- Ở tiền đường: *"+ Tiền đường: (hệ thống tự động ghi nhận; kế toán được phép điều chỉnh): lxe không được điền, chỉ được nhìn. + Nâng/Hạ Lạch Huyện: (hệ thống tự động cộng chi phí – lxe không được điền tay). + Loại chi phí…: (như hiện tại hệ thống có) lái xe chọn chi phí và điền số tiền. Được thêm chi phí liên tục mà không cần lưu mới được nhập thêm chi phí (hiện tại hệ thống yêu cầu nhập 1 loại chi phí xong – lưu mới được nhập tiếp chi phí mới -> mất thời gian)."*

**Ops:** *"Ops được phép điền tất cả các chi phí lô hàng (không chia cá nhân nào nhận bao nhiêu xe, tất cả các Ops đều được điền chi phí). Khi 1 Ops đã điền chi phí, chọn toàn bộ số cont, nếu có Ops khác nhập, hệ thống sẽ hiện cảnh báo: ĐÃ ĐƯỢC ID…. NHẬP TRƯỚC ĐÓ, BẠN VẪN TIẾP TỤC NHẬP CHỨ, để các Ops kiểm tra lại tránh nhập trùng. Phân hệ OPS hiện em chưa điền được trực tiếp chi phí nên chưa nhận xét thêm."*

**Kế toán:**

- a/ Phơi phiếu — Theo dõi hoàn cược: *"+ Thêm cược: Bill/Book: điền 4 số cuối sẽ có thể hiện gợi ý bill lô hàng – Khách hàng nào: Chọn là điền được luôn (tích hợp từ bên bảng cus qua bao gồm các thông tin: Bill/book – Hãng Tàu – Tên Khách hàng). Điền thông tin và ấn lưu."*
- Kiểm soát phơi phiếu — Thêm khoản chi: *"+ Nhóm chi phí: Chỉ thể hiện: Tiền đường / Chi phí lô hàng (những chi phí khác: Chi phí Ops đã được các Ops điền dữ liệu hàng ngày, hệ thống ghi nhận và kế toán duyệt). Chi phí lô hàng: Nếu khi chọn chi phí, chọn 'bên thực chi' sẽ hiện ra: 3 mục như phần mềm đang hiện. Nếu chọn 'Nhà cung cấp', hệ thống mặc định ghi nhận là tên nhà xe đang chạy tuyến đường đó. Được phép tiếp tục thêm chi phí, không điền 1 chi phí rồi lưu, mất thời gian. Ở thêm khoản chi này làm gọn lại giúp em: Nhóm chi phí / Tên khoản chi / Bên thực chi / Nhà cung cấp / Số hóa đơn – ngày hóa đơn: (có thể điền hoặc không đều được) / Nhập thu / trả bằng nhau. Hiện ở phần này không biết có lỗi không nhưng em vẫn chưa thực hiện test chi lô hàng được. Bên mình check giúp em có vấn đề gì không ạ."*
- Kế toán chốt debit: *"Giao diện hiện đang không được đẹp mắt, fix lại giúp em trước. Vì chưa có chi phí em chưa tiếp tục được."*
- Tạm ứng / Hoàn ứng: *"+ Ở phần Tạm ứng: Khi Ops điền tạm ứng, em chưa thấy hiện nút 'PHÊ DUYỆT TẠM ỨNG'. + 'Phiếu hoàn ứng': Không hiện chốt xác nhận hoàn ứng hay không (không có mục click -> tích chọn hoàn ứng). + 'Báo cáo hoàn ứng': Số tiền ĐNTT – Số tiền đã ứng -> Số tiền còn phải hoàn ứng. Số tiền phải hoàn ứng có thể âm (do Ops có thể ứng số tiền cao hơn số tiền làm hàng hằng ngày, khi đó hệ thống cảnh báo – đề nghị thu tiền ứng). Hiện tại ở mục này hệ thống không ghi nhận âm."*
- b/ Công nợ vận tải: *"(phần này với em chưa ổn, tuy nhiên còn 1 số vấn đề nên để lại giúp em, trong tuần sau khi chạy được hết chi phí em sẽ kiểm tra tiếp)."*

### Mockup: image1.png (c2 — chi tiết tiền đường, khoản "Sửa chữa dọc đường")

Trùng nội dung image1 của spec 19.10 (bảng LÁI XE NHẬP khoản "Sửa chữa dọc đường" 500.000₫ Lương Văn Long + chú thích duyệt/phiếu) — ảnh được dùng lại trong doc này tại phần Kế toán.

### Mockup: image2.png (c2 — biến thể "Phí nâng")

Trùng image2 của spec 19.10 ("Phí nâng" 1.500.000₫ Bùi Văn Kiệm).

### Mockup: image3.png (c2 — báo cáo tổng hợp hoàn ứng)

Trùng image3 của spec 19.10 (3 thẻ tổng + bảng 4 nhân viên "Không còn chênh lệch").

### Trạng thái land (21/10/2026)

| Mục spec | Trạng thái | Bằng chứng |
|---|---|---|
| Lái xe: 2 bảng chi phí cuối lô, bỏ cột Người chi, 2 ô Hóa đơn/Phiếu thu, chụp biên lai | LAND | phiếu 141026230700 (driver-chi-phi redesign, PASS doc); rule ManHinhLaiXe §8 |
| Tiền đường: hệ thống tự ghi nhận, lái xe chỉ xem; Nâng/Hạ Lạch Huyện tự cộng; thêm chi phí liên tục không lưu từng dòng | LAND | phiếu 141026230700 + 181026182300 (lái xe sửa tiền đường — kế toán điều chỉnh) |
| Ops: mọi Ops điền mọi chi phí + cảnh báo "ĐÃ ĐƯỢC ID… NHẬP TRƯỚC ĐÓ, BẠN VẪN TIẾP TỤC NHẬP CHỨ" | LAND | phiếu 141026230720 (ops-khai-chi-phi-tat-ca-va-canh-bao-trung) |
| Thêm cược gợi ý bill 4 số cuối + autofill | LAND | FB-096 `295dd98a` + `150acee0`; regpack fb096 |
| Thêm khoản chi gọn: Nhóm chỉ Tiền đường/Chi phí lô hàng; Nhà cung cấp default nhà xe tuyến; thêm liên tục; thu/trả bằng nhau | LAND | phiếu 141026230740 (gọn form thêm khoản chi) |
| Chốt debit giao diện | LAND | 191026201900 (ketoan-debit-qua-nhieu-cot) |
| Tạm ứng: nút PHÊ DUYỆT; hoàn ứng: tick chốt; số âm + cảnh báo thu lại | LAND | 181026183600 + qa/2026-10-21-hoanung-am (UI DRIVEN) |
| Công nợ vận tải | OPEN — khách tự hoãn ("tuần sau kiểm tra tiếp") | — |
