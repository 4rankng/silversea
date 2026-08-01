# BẢNG CÂU HỎI LÀM RÕ QUY TRÌNH O2C — GỬI KHÁCH HÀNG

**Dự án:** Phần mềm Quản lý Vận tải TTransport — Silver Sea
**Mục đích:** Làm rõ các điểm thiếu sót / mâu thuẫn giữa tài liệu *Đặc tả Quy trình O2C* và các chứng từ thực tế của khách hàng (Hợp đồng HĐVC, DATA PM, DEMO KẾ TOÁN, CUS-ĐIỀU XE).
**Hướng dẫn trả lời:** Mỗi câu đều có mục **"Vì sao hỏi"** dẫn nguồn chứng từ cụ thể. Vui lòng trả lời trực tiếp vào mục **"Trả lời"** bên dưới mỗi câu.

**Độ ưu tiên:**
- 🔴 **Quan trọng nhất** — mâu thuẫn/thiếu sót ảnh hưởng trực tiếp đến tính khả thi của quy trình (hỏi trước)
- 🟠 **Quan trọng** — cần làm rõ để xây dựng đúng nghiệp vụ
- 🟡 **Phụ** — có thể hỏi ở vòng sau

---

## TÓM TẮT ƯU TIÊN (hỏi trước các câu 🔴)

| # | Câu hỏi ngắn | Mục |
|---|---|---|
| 1 | Quy trình O2C có bao gồm cả công nợ phải trả (AP/NCC) không? | A1 |
| 2 | Vòng đời thanh toán NCC theo chu kỳ nào? | A2 |
| 3 | Phụ phí xăng dầu tính lại khi nào, lấy giá từ đâu? | B1 |
| 4 | VAT (0/5/8/10%) chọn theo tiêu chí nào? | B2 |
| 5 | Bảng phí nâng hạ cảng/bãi duy trì và áp dụng ra sao? | B3 |
| 6 | Lưu ca xe (1tr/cont/ngày) có thực thu không? | C1 |
| 7 | Luật chia kỳ đối soát (mốc ngày 25) cho mọi khách? | D1 |
| 8 | Báo cáo Lãi Lỗ tháng có phải sản phẩm đầu ra bắt buộc không? | D4 |
| 9 | Hạn TT "chi hộ" và "cước" là hai hạn riêng biệt? | G1 |

---

## A. PHẠM VI & KHUNG QUY TRÌNH

### A1. 🔴 Phạm vi "Order-to-Cash" có bao gồm cả công nợ phải trả (AP/NCC) không?

**Vì sao hỏi:** Hợp đồng HĐVC (Điều 3.6 & 5.3) quy định Bên A ủy quyền Silver Sea "chi hộ" các phí phát sinh. File DEMO KẾ TOÁN có song song cả bảng **PHẢI THU** và **PHẢI TRẢ**. Mỗi lô hàng vừa sinh AR (cước thu khách) vừa sinh AP (trả cảng, trả chủ xe ngoài). Tài liệu O2C hiện tại chỉ mô tả rõ nửa AR; nửa AP gần như bỏ ngỏ.

**Câu hỏi:** Phần thanh toán cho NCC (cảng/bãi, chủ xe ngoài, phí nâng hạ) là **cùng một quy trình** hay là **quy trình riêng**? Ai chịu trách nhiệm chốt AP?

**Trả lời:**

> _*(điền vào đây)*_

---

### A2. 🔴 Vòng đời thanh toán NCC (vendor payment cycle) diễn ra như thế nào?

**Vì sao hỏi:** Chưa rõ chu kỳ chốt và thanh toán cho nhà cung cấp (cảng, chủ xe ngoài) có giống luật chia kỳ của cước thu khách (HĐVC 5.4) hay không.

**Câu hỏi:** Cước trả chủ xe ngoài và phí cảng/bãi được đối soát và thanh toán theo chu kỳ nào? Có cùng luật "1–25 tháng này / 26–cuối tháng sang tháng sau" như cước thu khách, hay khác?

**Trả lời:**

> _*(điền vào đây)*_

---

## B. BẢNG GIÁ & PHỤ PHÍ

### B1. 🔴 Phụ phí xăng dầu được tính lại khi nào và lấy giá dầu ở đâu?

**Vì sao hỏi:** Sheet **MẪU BÁO GIÁ** cho thấy công thức:
`phụ phí = (giá dầu hiện tại − giá dầu gốc 26/2) × định mức lít/km × số km`, rồi nhân **tỷ lệ chia sẻ % riêng từng khách** (Long Minh 2%, ASKEY 4%, SUNRISE 2.5%). Đây là biến giá động nhất nhưng tài liệu O2C hiện tại không nhắc tới.

**Câu hỏi:**
1. "Giá dầu hiện tại" được **nhập tay** (người dùng cập nhật) hay **lấy tự động** từ nguồn nào? Ngày lấy giá là ngày nào (ngày chạy chuyến / ngày chốt kỳ)?
2. Tỷ lệ chia sẻ % có hợp đồng đính kèm hay thỏa thuận riêng? Khách có thể tự đổi % giữa chừng không?
3. Khi nào phụ phí = 0 (khách chịu 0%) hay luôn > 0?

**Trả lời:**

> _*(điền vào đây)*_

---

### B2. 🔴 Mức thuế VAT (0/5/8/10%) áp dụng theo tiêu chí nào?

**Vì sao hỏi:** Sheet **TH VẬN TẢI** có chú thích *"XỔ CHỌN: 0, 5, 8, 10% — GIẢ SỬ 8%"*, nhưng tài liệu O2C chỉ viết "áp dụng mức VAT chuẩn".

**Câu hỏi:** Mỗi mức VAT dùng cho trường hợp nào? Do **cấp khách hàng** mặc định, hay chọn **từng dòng phí** (cước vận tải 10% / nâng hạ 8% / xuất khẩu 0%)? Ai có quyền chọn?

**Trả lời:**

> _*(điền vào đây)*_

---

### B3. 🔴 Bảng phí nâng hạ tại cảng/bãi được duy trì và áp dụng ra sao?

**Vì sao hỏi:** Sheet **THÔNG TIN CẢNG BÃI** có ma trận `Nâng/Hạ × 20'/40' × rỗng/hàng` cho từng cảng. Đây là khoản chi hộ lớn nhất nhưng không có trong 6 danh mục chuẩn của tài liệu O2C。

**Câu hỏi:**
1. Phí này Ops **nhập tay theo biên lai**, hay hệ thống **tự kéo từ bảng giá cảng** đã duy trì?
2. Ai cập nhật khi cảng đổi giá? Có lưu lịch sử thay đổi để truy ngược không?
3. "MST nâng hạ" (mã số thuế đơn vị cung cấp) có bắt buộc để lên hóa đơn chi hộ không?

**Trả lời:**

> _*(điền vào đây)*_

---

### B4. 🟠 Cột "Com" trong bảng kê là gì?

**Vì sao hỏi:** Mọi dòng **TH VẬN TẢI** đều có cột Com (thường âm, ví dụ −100.000đ). Tài liệu O2C không nhắc tới khoản này ở bước nào.

**Câu hỏi:** Đây là **chiết khấu cho khách**, **hoa hồng cho đại lý/người môi giới**, hay **phí trả nội bộ**? Ai duyệt mức Com? Có phải cứ mỗi chuyến đều có?

**Trả lời:**

> _*(điền vào đây)*_

---

## C. PHÍ PHÁT SINH & LƯU CA

### C1. 🔴 Lưu ca xe (1.000.000đ/cont/ngày sau 8h) có thực sự được tính tiền không?

**Vì sao hỏi:** HĐVC (Điều 3.5) quy định rõ, nhưng tài liệu O2C không nhắc tới khoản doanh thu này ở bất kỳ bước nào.

**Câu hỏi:**
1. Có **thực thu** lưu ca không, hay thường được **miễn**?
2. Mốc "8 giờ" tính từ lúc nào (lái xe bấm "đến nơi" / giờ cutoff / giờ thực tế giao)?
3. Hệ thống **tự tính** từ log của lái xe, hay kế toán **nhập tay**?
4. Lưu ca thuộc cước (chịu VAT) hay chi phí khác?

**Trả lời:**

> _*(điền vào đây)*_

---

### C2. 🟠 Chênh lệch "nhiên liệu định mức" vs "nhiên liệu thực chi" được ghi nhận thế nào?

**Vì sao hỏi:** Bước 1 tính phụ phí theo **định mức**; Bước 3 thu **thực chi** từ ảnh bơm xăng. P&L phải so sánh hai con số này — đây chính là cơ sở kiểm soát gian lận nhiên liệu — nhưng tài liệu mô tả riêng lẽ, không nêu bước đối chiếu。

**Câu hỏi:** Khi thực chi > định mức, khoản chênh lệch được **ghi nhận là lỗ của chuyến** (giảm lợi nhuận) hay **trừ vào lương lái xe**?

**Trả lời:**

> _*(điền vào đây)*_

---

## D. ĐỐI SOÁT, HÓA ĐƠN & CHỐT KỲ

### D1. 🔴 Luật chia kỳ đối soát: ngày 25 có áp dụng cho mọi khách không?

**Vì sao hỏi:** HĐVC (5.4): dịch vụ 1–25 → chốt tháng này; 26–cuối tháng → sang tháng sau; 31/12 chốt năm. Tài liệu O2C chỉ nói chung "T1/T2/T3".

**Câu hỏi:** Mốc **25** là **cố định cho mọi khách** hay **mỗi khách có ngày cắt riêng**? Có khách nào chốt theo tuần/kỳ khác không?

**Trả lời:**

> _*(điền vào đây)*_

---

### D2. 🟠 Khách xác nhận số liệu trong 2 ngày — quy trình khi khách tranh chấp?

**Vì sao hỏi:** HĐVC (5.4) yêu cầu khách xác nhận lại trong 02 ngày làm việc trước khi xuất hóa đơn GTGT.

**Câu hỏi:** Khách xác nhận qua đâu (email / Zalo / cổng thông tin)? Khi khách **tranh chấp** một dòng phí, phiếu được giữ ở trạng thái nào, ai xử lý, có cần tái đối soát không?

**Trả lời:**

> _*(điền vào đây)*_

---

### D4. 🔴 Báo cáo Lãi Lỗ tháng là sản phẩm đầu ra bắt buộc không?

**Vì sao hỏi:** Sheet **LN THÁNG** là báo cáo quản trị chính (Doanh thu − chi phí NCC − cố định − biến đổi − tài chính = lợi nhuận trước thuế). Tài liệu O2C chỉ nói "đẩy sang công nợ", không mô tả khâu tính P&L。

**Câu hỏi:** Khi "chốt kỳ", hệ thống có **tự sinh P&L tháng** không, hay xuất số liệu để kế toán **tính ngoài**? P&L đó là cấp **công ty** hay tách **theo xe nhà / xe ngoài**?

**Trả lời:**

> _*(điền vào đây)*_

---

## E. PHÂN QUYỀN & VAI TRÒ

> **Lưu ý quan trọng về vai trò ADMIN:** Trong phần mềm TTransport, `ADMIN` là vai trò **dành riêng cho bên phát triển hỗ trợ khách hàng (developer support)**, KHÔNG phải vai trò nghiệp vụ của khách hàng. Do đó mọi quy tắc hiển thị dữ liệu nhạy cảm trong tài liệu O2C được áp dụng theo vai trò nghiệp vụ thực tế. Theo O2C (Bước 0): **Ban Giám đốc và Kế toán** được xem dữ liệu nhạy cảm (Lợi nhuận, Giá vốn, Lương tài xế, Định mức); Điều vận/Ops không được tiếp cận → đây là quy tắc chính thức, không cần xác nhận lại.

### E1. 🟠 Danh sách vai trò nghiệp vụ thực tế và quyền tương ứng?

**Vì sao hỏi:** Danh sách nhân sự (DS NHÂN SỰ) có các vai trò **PGĐ** (Phó giám đốc), **Kế hoạch** (Planner) — chưa được nêu rõ trong ma trận trách nhiệm của tài liệu. Tài liệu gộp chung "Điều vận" cho cả lập kế hoạch và điều xe。

**Câu hỏi:** Liệt kê chính xác các vai trò nghiệp vụ + quyền (xem/sửa/xóa/khóa) trên từng nghiệp vụ。 Đặc biệt: "Kế hoạch" khác "Điều vận" chỗ nào? "PGĐ" có quyền ngang Giám đốc không?

**Trả lời:**

> _*(điền vào đây)*_

---

## F. NGHIỆP VỤ NGOẠI LỆ

### F1. 🟠 Khi thiếu POD (chứng từ gốc) tới hạn chốt kỳ?

**Vì sao hỏi:** Tài liệu cấm chốt kỳ nếu chưa thu hồi POD ("Ranh giới POD"). Nhưng thực tế POD có thể mất / trễ。

**Câu hỏi:** Nếu đến ngày chốt mà chưa thu đủ POD cho một lô, lô đó được **giữ lại không chốt** (doanh thu trễ kỳ), hay **chốt trước có điều kiện** rồi bổ sung? Ai có quyền cho phép?

**Trả lời:**

> _*(điền vào đây)*_

---

### F2. 🟠 Chi phí không hóa đơn (lẻ tiền mặt) xử lý ra sao?

**Vì sao hỏi:** Bước 4 yêu cầu phân tách "có HĐ / không HĐ"。

**Câu hỏi:** Khoản không hóa đơn có được **thu hồi từ khách** (ghi chi hộ) hay **Silver Sea tự chịu**? Có hạn mức tối đa mỗi chuyến không?

**Trả lời:**

> _*(điền vào đây)*_

---

## G. CÔNG NỢ & HẠN TÍN DỤNG

### G1. 🔴 Hạn thanh toán "chi hộ" và "cước" là hai hạn riêng biệt?

**Vì sao hỏi:** Sheet **THÔNG TIN NCC**: Long Minh có **HẠN TT CHI HỘ = 25 ngày** *và* **HẠN TT CƯỚC = 15 ngày** — hai hạn khác nhau。

**Câu hỏi:** Xác nhận mỗi khách có **hai hạn thanh toán độc lập**? Báo cáo tuổi nợ (aging) tính theo hạn nào?

**Trả lời:**

> _*(điền vào đây)*_

---

## H. DỮ LIỆU TỔNG QUÁT

### H1. 🟠 Tiền tệ & làm tròn?

Toàn bộ bằng VND. Phụ phí xăng dầu có tới 5 chữ số thập phân — quy tắc làm tròn cuối cùng (theo dòng / theo tổng / theo hóa đơn)?

**Trả lời:**

> _*(điền vào đây)*_

---

### H2. 🟡 Kẹp hàng (ghép 2 chiều): quy tắc tính phí cầu đường chính xác?

**Vì sao hỏi:** Tài liệu nói "vòng khép kín → tính 1 lần phí cầu đường". Nhưng ghi chú xe có *"QUAY ĐẦU 1 VÉ"*, *"ĐI QUA VÉ"* — cho thấy phụ thuộc **tuyến cụ thể** chứ không chỉ hình dạng vòng。

**Câu hỏi:** Quy tắc chính xác: trùng tuyến (cùng trạm) mới gom, hay mọi ghép 2 chiều đều gom 1 vé?

**Trả lời:**

> _*(điền vào đây)*_

---

## I. ĐỊNH DẪNG NGUỒN CHỨNG TỪ (tham khảo)

| Viết tắt | Tên đầy đủ | Vai trò |
|---|---|---|
| HĐVC | Hợp đồng Cung cấp Dịch vụ Giao nhận Vận tải | Khung pháp lý giữa Silver Sea (Bên B) và khách hàng/NCC (Bên A) |
| DATA PM | File dữ liệu Phần mềm (master data) | 8 sheet danh mục: NCC, KH, nhà máy, tuyến đường, loại hình xe, bảng giá, cảng/bãi, nhân sự |
| DEMO KT | File demo Kế toán | Báo cáo Lãi Lỗ, tuổi nợ PT/PR, tổng hợp vận tải, báo cáo hàng ngày |
| CUS-ĐIỀU XE | File demo Cus/Điều vận | Bảng kế hoạch xe, hiển thị chi tiết, form nhập lô hàng |

---

*Lưu ý: Ưu tiên hỏi trước các câu 🔴 (A1, A2, B1, B2, B3, C1, D1, D4, G1). Các câu 🟠/🟡 có thể hỏi ở vòng sau.*
