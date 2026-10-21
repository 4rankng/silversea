# PhanHeKeToan — Spec gốc khách hàng (phân hệ Kế toán)

File này lưu **nguyên văn spec gốc của khách hàng** cho các đợt chỉnh sửa phân hệ Kế toán,
kèm trạng thái triển khai (commit/branch) và mô tả mockup bằng chữ. Quy tắc nghiệp vụ
đang áp dụng vẫn nằm trong [PhanHeKeToan.docx](PhanHeKeToan.docx), [QuyTrinhO2C.docx](QuyTrinhO2C.docx)
và [CHANGELOG.md](CHANGELOG.md); file này chỉ là nguồn truy vấn spec gốc.

> Giới hạn phương pháp: ảnh mockup trong 2 spec dưới đây được mô tả bằng chữ dựa trên
> caption trong docx + OCR (session không có khả năng vision). Chú thích khoanh đỏ/mũi tên
> trong mockup là **gợi ý hành vi**, không phải UI text.

## Spec gốc — "19.10 - FIX CHI PHÍ.docx" (Fix lần 2 – khai báo chi phí tổng quan, 19/10/2026)

### Text gốc (trích nguyên văn)

**Kế hoạch làm hàng -> Khai chi phí : cần điều chỉnh**

1.1 (ảnh 1 — hiện trạng hệ thống). Muốn điều chỉnh hiển thị: *"Tại ô Chụp / Chọn ảnh: Có thể
chụp hoặc không, không ghi nhận thiếu chứng từ. Lý do: Ops khi khai báo chi phí, phải in hóa
đơn chứng từ để trên bàn kế toán, đối soát nên có thể không chụp."*

2. Kế toán:

> TOÀN BỘ TRƯỜNG PHẢI ĐIỀN SỐ TIỀN, MẶC ĐỊNH CHO EM ĐỊNH DẠNG: 1,000,000 (CÓ DẤU CHẤM HOẶC
> PHẨY NGĂN CÁCH – TẤT CẢ DỮ LIỆU CỦA CÁC PHÂN HỆ)

**A/ Kiểm soát phơi phiếu — Xem chi tiết -> Thêm Dòng:**

2.1 (ảnh "Thêm khoản chi - Kiểm soát phơi phiếu hệ thống"). Mong muốn điều chỉnh hiển thị:
click vào mục **Tiền đường**, bảng hiển thị (ảnh 4–5); click vào mục **Chi phí lô hàng**, bảng
hiển thị tương tự -> **Đóng / Lưu**. *"Phía bên dưới bảng kiểm soát phơi phiếu thể hiện bảng
này."* Bảng 1×3 gốc: `Tiền đường | Chi phí lô hàng` — *(2 loại phí để cạnh nhau, tích chọn sẽ
ra chi phí của mục đó)*.

2.2 (ảnh báo cáo). *"Mục đích em muốn có bảng này để tiện đối soát trong trường hợp còn phải
thu / trả các nhà xe -> Không hiển thị báo cáo tháng đổi tên : **BÁO CÁO THU / TRẢ PHƠI —
Ngày .... - ......** Báo cáo phải thu (theo khách hàng) / Lập phiếu thu: / Báo cáo phải trả
(theo nhà xe) / Lập phiếu chi. Ở 2 báo cáo này, khi click vào tên nhà xe thể hiện ra 1 bảng
chi phí còn thiếu chưa thanh toán của các lô hàng. Khi ấn lập phiếu thu / phiếu chi, tại ô
STT hiện ra ô vuông có thể tích chọn / chọn all để lập phiếu chi hàng loạt thanh toán chi
phí. Tại bảng thanh toán chi phí (hàng loạt hay từng nhà xe), đều phải thể hiện rõ các loại
chi phí thanh toán. VD: với nhà xe hàng loạt."*

**b/ Kế toán chốt Debit** (2.3): *"Nếu chọn tất cả các cột, hệ thống vẫn bị lỗi: Giao diện
chưa đẹp mắt -> Yêu cầu fix lại, hàng cột cân chỉnh khớp. Khi ấn dòng bất kì, hiện số dòng mà
không biết đã click tới dòng nào rồi -> Khi ấn chọn debit -> Ở ô Ngày: hiện ra những ô vuông
nhỏ để tích chọn / chọn all -> Chọn debit. Xuất debit e đang không xuất được, kiểm tra lại
phần XUẤT DEBIT."*

**c/ Tạm ứng & Hoàn ứng:** *"Tại yêu cầu tạm ứng: Chưa có mục phê duyệt, chỉ có ghi nhận.
Vậy ghi nhận nhưng không phê duyệt sẽ chi tiền thế nào. Phần hoàn ứng: Khi Ops lập phiếu
hoàn ứng, cũng không có mục duyệt phiếu hoàn ứng. Em check thấy khi Ops lên chi phí, vào
mục hoàn tạm ứng nhưng qua bên tài khoản kế toán không hiện. Check lại giúp em."*

### Mockup mô tả bằng chữ (11 ảnh; chú thích = behavior hint)

| Ảnh | Vị trí trong doc | Layout mô tả |
|---|---|---|
| 1 | §1.1 OPS Khai chi phí | Panel "Chi tiết tiền đường <Bill> ×": thông báo rỗng "Không tìm thấy chi phí thuộc lô" + nút "Tải lại khoản chi"; bảng "LÁI XE NHẬP (N NGƯỜI)": STT · Khoản lái xe nhập · Ngày · Lái xe · Ban đầu (₫) · Thực chi hiện tại (₫) · thao tác Tích duyệt/Từ chối · Kế toán duyệt; footer "Tổng phát sinh 500.000₫ · Đã duyệt 0₫" kèm hint: *tổng phát sinh là tất cả dòng; chỉ dòng đã duyệt mới được lập phiếu chi thanh toán cho lái xe; con số "Đã duyệt" chính là con số ở cột Tiền đường của bảng kiểm soát phơi phiếu*; nút "+ Thêm dòng · Hủy · Lưu" |
| 2 | §2.1 | Biến thể ảnh 1: khoản "Phí nâng" 1.500.000₫ (Bùi Văn Kiệm), cùng cấu trúc |
| 3 | §2.1 | "Báo cáo tổng hợp hoàn ứng": bộ lọc Từ/Đến + Nhân viên + Đợt đối soát + Lọc; 3 thẻ tổng (Tổng số tiền DNTT · Tổng số tiền đã ứng · Tổng còn phải hoàn ứng); bảng STT · Nhân viên · DNTT · Số tiền DNTT · Số tiền đã ứng · Còn phải hoàn ứng · Ghi chú ("Không còn chênh lệch") |
| 4–5 | §2.1 | Sub-form toggle hai loại phí cạnh nhau: "Tiền đường" / "Chi phí lô hàng" — Ngày (mặc định hôm nay/chọn được), các trường Tên khoản chi · Số tiền (định dạng 1,000,000) · Số hóa đơn · Thu khách hàng (tích chọn = phí có hóa đơn, khi đó ghi số hóa đơn) · Người chi; nút "+ Thêm chi phí" |
| 6 | §2.2 | "BÁO CÁO THU/TRẢ PHƠI — Ngày … - …": 2 khối — Phải thu theo khách hàng (STT · Khách hàng · Tiền nâng · Tiền hạ · PS khác · Tổng hợp [Tổng · Đã thu · Còn phải thu] · Ghi chú) và Phải trả theo nhà xe (đối xứng, Đã trả/Còn phải trả); có dòng gộp "(Chưa xác định)" và "XE NHÀ – SILVER SEA"; nút "Lập phiếu thu" / "Lập phiếu chi" |
| 7–8 | §2.2 | Cận cảnh 2 bảng Phải thu / Phải trả ở ảnh 6 |
| 9 | §2.2 | "PHIẾU CHI THANH TOÁN PHƠI": Ngày chi · TK chi; bảng STT · Nhà xe · Chi phí · Số cont · Số tiền · Tổng tiền · Ghi chú — 1 nhà xe (Nâng hàng + Hạ vỏ = 3.000.000₫), "Tổng thanh toán", nút Xác nhận |
| 10 | §2.2 | Như ảnh 9 nhưng hàng loạt 2 nhà xe (5.372.000₫) — minh họa tích chọn/chọn-all tại ô STT |
| 11 | §b | "Kế toán chốt debit": search Mã lô/bill/booking/khách/container + Từ-Đến + Khách hàng + Nhà xe (phân xe); bộ chọn cột (Thông số container · Chọn Debit · Xuất Debit Note · Phân xe · Cước thu (tự động) · Lạch Huyện (tự động) · Phụ phí (tự động) · Phát sinh CUS · Cước trả ĐV · Phát sinh DV · Tổng 1 · Phí RU); nút "Chọn tất cả N lô đủ điều kiện · Đối soát · Hoàn tác"; chip "Lô trong kỳ 190 · Chưa đối soát 52 · Chờ xác nhận đối soát 188"; ô thiếu dữ liệu hiện "Thiếu cước thu/Thiếu phụ phí/…" (không gán 0) |

### Trạng thái land (21/10/2026)

| Mục spec | Trạng thái | Bằng chứng |
|---|---|---|
| 1.1 OPS Khai chi phí — ảnh/chứng từ optional | LAND | phiếu 141026230710/191026160000 (PASS doc tổng hợp 21/10); rule OpsVanHanh §3.3 |
| Định dạng số tiền 1,000,000 toàn phân hệ | LAND | convention VND nhà (AGENTS); CHANGELOG 21/10 (CUS-08 tiền tệ hiển thị) |
| 2.1 Thêm dòng: 2 loại phí cạnh nhau + bảng duyệt lái xe (chỉ dòng đã duyệt vào phiếu) | LAND | "Bảng kiểm chi phí Ops (ship 22/09)" OpsVanHanh §9.2; card 2026-10-05 phoi-phieu mini-filter; hint "Đã duyệt = cột Tiền đường" trùng quy tắc §9.2 |
| 2.2 BÁO CÁO THU/TRẢ PHƠI + lập phiếu thu/chi chọn/chọn-all + bảng chi phí từng nhà xe | LAND | QuyTrinhO2C §7.6 (2 báo cáo phải thu/trả), §7.5 (phiếu tổng hợp, AC-CP-KT-08 chọn-all); UI 19/10 (141026230760 → 191026201900) |
| 2.3 Chốt debit: cân chỉnh cột, chọn debit theo ô Ngày, Xuất Debit | LAND | FB-094 `239556ec`/`150acee0` + cột essential/column chooser (KT4, ebd032fb); UI "Chọn tất cả N lô đủ điều kiện" có thật (ảnh 11 chụp hiện trạng đã có nút này) |
| c/ Tạm ứng & hoàn ứng: phê duyệt, tick chốt, số âm | LAND | 141026230770 + 181026183600; UI DRIVEN qa/2026-10-21-hoanung-am (số âm + duyệt) |

## Spec gốc — "chiphispec-2.docx" (Fix lại các chi phí của từng phân hệ)

### Text gốc (trích nguyên văn)

**Lái xe** — Kết thúc lô hàng hiện ra 2 bảng chi phí: Chi phí lô hàng và tiền đường.
*"BỎ HẾT CHỖ NGƯỜI CHI – TÔI CHI / CÔNG TY CHI GIÚP EM."*

- Chi phí lô hàng: *(Bỏ cột người chi – không cần thiết). Bỏ số hóa đơn và ngày hóa đơn.
  + Thêm 2 ô chọn nhỏ: Hóa đơn / Phiếu thu. Yêu cầu chụp biên lai nếu có phát sinh chi phí lô hàng.*
- Ở tiền đường: *"+ Tiền đường: (hệ thống tự động ghi nhận; kế toán được phép điều chỉnh): lxe
  không được điền, chỉ được nhìn. + Nâng/Hạ Lạch Huyện: (hệ thống tự động cộng chi phí – lxe
  không được điền tay). + Loại chi phí…: (như hiện tại hệ thống có) lái xe chọn chi phí và
  điền số tiền. Được thêm chi phí liên tục mà không cần lưu mới được nhập thêm chi phí (hiện
  tại hệ thống yêu cầu nhập 1 loại chi phí xong – lưu mới được nhập tiếp chi phí mới -> mất
  thời gian)."*

**Ops:** *"Ops được phép điền tất cả các chi phí lô hàng (không chia cá nhân nào nhận bao
nhiêu xe, tất cả các Ops đều được điền chi phí). Khi 1 Ops đã điền chi phí, chọn toàn bộ số
cont, nếu có Ops khác nhập, hệ thống sẽ hiện cảnh báo: ĐÃ ĐƯỢC ID…. NHẬP TRƯỚC ĐÓ, BẠN VẪN
TIẾP TỤC NHẬP CHỨ, để các Ops kiểm tra lại tránh nhập trùng. Phân hệ OPS hiện em chưa điền
được trực tiếp chi phí nên chưa nhận xét thêm."*

**Kế toán:**

- a/ Phơi phiếu — Theo dõi hoàn cược: *"+ Thêm cược: Bill/Book: điền 4 số cuối sẽ có thể
  hiện gợi ý bill lô hàng – Khách hàng nào: Chọn là điền được luôn (tích hợp từ bên bảng cus
  qua bao gồm các thông tin: Bill/book – Hãng Tàu – Tên Khách hàng). Điền thông tin và ấn lưu."*
- Kiểm soát phơi phiếu — Thêm khoản chi: *"+ Nhóm chi phí: Chỉ thể hiện: Tiền đường / Chi phí
  lô hàng (những chi phí khác: Chi phí Ops đã được các Ops điền dữ liệu hàng ngày, hệ thống
  ghi nhận và kế toán duyệt). Chi phí lô hàng: Nếu khi chọn chi phí, chọn 'bên thực chi' sẽ
  hiện ra: 3 mục như phần mềm đang hiện. Nếu chọn 'Nhà cung cấp', hệ thống mặc định ghi nhận
  là tên nhà xe đang chạy tuyến đường đó. Được phép tiếp tục thêm chi phí, không điền 1 chi
  phí rồi lưu, mất thời gian. Ở thêm khoản chi này làm gọn lại giúp em: Nhóm chi phí / Tên
  khoản chi / Bên thực chi / Nhà cung cấp / Số hóa đơn – ngày hóa đơn: (có thể điền hoặc
  không đều được) / Nhập thu / trả bằng nhau. Hiện ở phần này không biết có lỗi không nhưng
  em vẫn chưa thực hiện test chi lô hàng được. Bên mình check giúp em có vấn đề gì không ạ."*
- Kế toán chốt debit: *"Giao diện hiện đang không được đẹp mắt, fix lại giúp em trước. Vì
  chưa có chi phí em chưa tiếp tục được."*
- Tạm ứng / Hoàn ứng: *"+ Ở phần Tạm ứng: Khi Ops điền tạm ứng, em chưa thấy hiện nút 'PHÊ
  DUYỆT TẠM ỨNG'. + 'Phiếu hoàn ứng': Không hiện chốt xác nhận hoàn ứng hay không (không có
  mục click -> tích chọn hoàn ứng). + 'Báo cáo hoàn ứng': Số tiền ĐNTT – Số tiền đã ứng ->
  Số tiền còn phải hoàn ứng. Số tiền phải hoàn ứng có thể âm (do Ops có thể ứng số tiền cao
  hơn số tiền làm hàng hằng ngày, khi đó hệ thống cảnh báo – đề nghị thu tiền ứng). Hiện tại
  ở mục này hệ thống không ghi nhận âm."*
- b/ Công nợ vận tải: *"(phần này với em chưa ổn, tuy nhiên còn 1 số vấn đề nên để lại giúp
  em, trong tuần sau khi chạy được hết chi phí em sẽ kiểm tra tiếp)."*

### Mockup mô tả bằng chữ (3 ảnh — trùng bộ ảnh 1–3 của spec 19.10)

| Ảnh | Layout mô tả |
|---|---|
| 1 | "Chi tiết tiền đường" khoản "Sửa chữa dọc đường" 500.000₫ — bảng duyệt lái xe + hint chỉ dòng đã duyệt vào phiếu (như ảnh 1 spec 19.10) |
| 2 | Biến thể "Phí nâng" 1.500.000₫ (như ảnh 2 spec 19.10) |
| 3 | "Báo cáo tổng hợp hoàn ứng" 3 thẻ tổng + bảng theo nhân viên (như ảnh 3 spec 19.10) |

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
