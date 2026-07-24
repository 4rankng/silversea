# Tài liệu bối cảnh & mục tiêu

**Dự án:** Hệ thống quản lý vận tải NePO (NePO TMS)
**Phạm vi tài liệu:** Bối cảnh nghiệp vụ và mục tiêu cho 3 tính năng — (1) Chi phí dịch vụ đi kèm, (2) Điều động xe ngoài, (3) Đối trừ công nợ
**Mục đích:** Cung cấp kiến thức nền và bối cảnh để đội ngũ (hoặc agent) triển khai hiểu rõ *vì sao* và *cần đạt được điều gì* trước khi đi vào chi tiết kỹ thuật.
**Ngày:** 02/06/2026

> Tài liệu này tập trung vào **bối cảnh và mục tiêu nghiệp vụ**. Chi tiết kỹ thuật triển khai (cấu trúc dữ liệu, API, giao diện) nằm ở tài liệu kế hoạch riêng (`PLAN_service_costs_external_carrier_netting_REVISED.md`). Khi hai tài liệu mâu thuẫn về *nghiệp vụ*, lấy tài liệu này và phần "Quy tắc nghiệp vụ đã xác nhận" làm chuẩn.

---

## 1. Bối cảnh doanh nghiệp

NePO (Công ty TNHH NePO) là một doanh nghiệp giao nhận và logistics tại Việt Nam, hoạt động chính tại khu vực Hải Phòng. Công ty cung cấp dịch vụ vận tải container đường bộ nội địa, cước vận tải đường biển, và đóng vai trò đại lý thủ tục hải quan. Một đơn hàng vận chuyển điển hình bắt đầu từ một cảng hoặc bãi tại Hải Phòng và đi đến một hoặc nhiều điểm giao hàng.

Công ty đang xây dựng một hệ thống quản lý vận tải (TMS) để số hóa toàn bộ quy trình vận hành: từ lập kế hoạch vận chuyển, ghi nhận chi phí, theo dõi công nợ, đến lên báo cáo doanh thu/chi phí cho **từng đầu xe** và **từng chuyến hàng**. Mục tiêu cốt lõi của hệ thống là giúp công ty biết chính xác mỗi chuyến đi và mỗi đầu xe lãi hay lỗ, đồng thời quản lý chặt chẽ công nợ và dòng tiền.

Luồng nghiệp vụ cốt lõi hiện tại đi theo trình tự: **Kế hoạch vận chuyển (Kế hoạch O/C)** sinh ra **doanh thu** (giá cước bán cho khách → công nợ phải thu) và **chi phí vận hành xe** (nhiên liệu, lương lái xe, cầu đường, sửa chữa…), rồi tổng hợp thành **báo cáo doanh thu/chi phí theo từng xe**. Song song là các nghiệp vụ quản lý hằng ngày: cấp công lệnh cho lái xe, tạm ứng/hoàn ứng tiền mặt, nhắc lịch bảo dưỡng, và quản lý công nợ phải trả cho nhà cung cấp/đối tác.

### Các vai trò trong hệ thống

Hệ thống vận hành quanh bốn vai trò người dùng, mỗi vai trò chịu trách nhiệm một phần dữ liệu khác nhau:

- **Quản lý:** Tạo kế hoạch vận chuyển (ngày giờ, khách hàng, số/loại container, giá cước bán ra, điểm đi/đến, thông tin hàng, phân việc cho xe nội bộ hay thuê ngoài). Quản lý cũng là người kiểm tra và phê duyệt số liệu do kế toán và giao nhận nhập.
- **Giao nhận:** Nhập số liệu chi phí dịch vụ đi kèm (phí nâng hạ, hải quan, hạ tầng, cân hàng…), kèm số hóa đơn/ngày hóa đơn/số tờ khai. Giao nhận thường ứng tiền mặt để chi hộ các khoản này, sau đó lập "phiếu thanh toán" để hoàn ứng.
- **Kế toán:** Nhập số liệu vận hành chi tiết (số km, số lít nhiên liệu, vé cầu đường thực chi, tiền đi đường, lương lái xe…), nhập các chi phí định kỳ (sửa chữa, bảo hiểm, đăng kiểm, phí đường bộ), và hằng tháng lên các bảng kê công nợ, giấy báo nợ, bảng lương lái xe.
- **Lái xe:** Truy cập để theo dõi kế hoạch được giao và tự kiểm tra định mức quãng đường, nhiên liệu được cấp, tiền đi đường, lương kết hợp, tiền lưu ca… cho từng chuyến.

Một nguyên tắc xuyên suốt: **mọi số liệu tài chính do kế toán hoặc giao nhận nhập đều cần được quản lý/giám đốc kiểm tra và phê duyệt** trước khi chính thức ghi nhận hoặc phát hành.

---

## 2. Vấn đề hiện tại

Hệ thống hiện chỉ ghi nhận được phần cốt lõi: cước vận chuyển cơ bản và chi phí của **xe nhà** (xe do công ty sở hữu và vận hành). Thực tế vận hành của một công ty logistics đòi hỏi nhiều hơn thế, và đang có **ba khoảng trống** khiến số liệu chưa phản ánh đúng bản chất kinh doanh:

**Thứ nhất, hệ thống chưa quản lý được chi phí dịch vụ đi kèm.** Mỗi chuyến hàng không chỉ phát sinh cước vận chuyển mà còn nhiều loại phí: nâng/hạ container, làm thủ tục hải quan, phí kết cấu hạ tầng, cân hàng, kiểm hóa… Các phí này có hai mặt: **mua vào** (công ty/giao nhận trả cho cảng/nhà cung cấp) và **bán ra** (công ty báo lại cho khách hàng kèm cước). Hệ thống hiện không tách được hai chiều này, nên không tính được phần lãi từ dịch vụ và không đưa được các dịch vụ này lên giấy báo nợ cho khách.

**Thứ hai, hệ thống chưa điều động và hạch toán được xe thuê ngoài.** Khi không đủ xe nhà, NePO thuê xe của đối tác bên ngoài để chạy chuyến. Khi đó khách hàng vẫn trả cước bình thường cho NePO, còn NePO trả cho đối tác một mức "giá cước mua vào", phần chênh lệch là lãi quản lý của NePO. Hệ thống hiện chỉ hỗ trợ xe nhà, nên không ghi nhận được loại chi phí này cũng như công nợ phải trả cho đối tác vận tải.

**Thứ ba, hệ thống chưa đối trừ được công nợ.** Đặc thù ngành vận tải là nhiều đối tác vừa là khách hàng (NePO chở cho họ → phải thu) vừa là nhà cung cấp (họ chở cho NePO → phải trả), vì hai bên vận tải qua lại cho nhau. Khi lên bảng công nợ, cần có cơ chế **đối trừ** giữa khoản phải thu và phải trả của cùng một đối tác, nếu không thì công nợ hiển thị bị "phình" hai chiều và không phản ánh đúng số tiền thực tế còn phải thanh toán.

**Hệ quả chung:** lãi/lỗ từng chuyến và từng đầu xe bị tính sai (thiếu lãi dịch vụ, thiếu lãi điều xe ngoài, thiếu chi phí thuê ngoài); bảng công nợ phải thu/phải trả không phản ánh đúng số ròng (net); và giấy báo nợ gửi khách hàng chưa đầy đủ các dịch vụ đi kèm.

---

## 3. Mục tiêu cần đạt

**Mục tiêu tổng quát:** Bổ sung ba năng lực còn thiếu để hệ thống phản ánh đúng và đầy đủ bản chất kinh doanh của NePO — tính đúng lãi/lỗ theo từng chuyến và từng xe, ghi nhận đúng công nợ ròng, và xuất được chứng từ (giấy báo nợ) đầy đủ cho khách hàng.

Cụ thể, sau khi hoàn thành, hệ thống cần đạt được:

- **Về chi phí dịch vụ đi kèm:** ghi nhận được từng loại phí với hai chiều mua vào/bán ra, kèm đầy đủ thông tin chứng từ (số hóa đơn, ngày hóa đơn, số tờ khai, số container); tính được lãi dịch vụ (bán ra − mua vào); xử lý đúng việc khoản phí được giao nhận chi hộ từ tạm ứng hay công ty trả trực tiếp; và đưa được các dịch vụ này lên giấy báo nợ cho khách.
- **Về điều động xe ngoài:** cho phép một chuyến được giao cho xe nhà hoặc xe ngoài; với xe ngoài, ghi nhận đối tác vận chuyển, giá cước mua vào, biển số xe và thông tin lái xe; tính được lãi điều xe ngoài (quy về giá chưa VAT); và tự động hình thành công nợ phải trả cho đối tác.
- **Về đối trừ công nợ:** nhận diện được các đối tác hai chiều (vừa là khách vừa là nhà cung cấp); thực hiện đối trừ hằng tháng giữa khoản phải thu và phải trả; và lên được bảng đối chiếu công nợ phản ánh số ròng.
- **Về báo cáo:** lãi dịch vụ và lãi điều xe ngoài được tổng hợp vào báo cáo doanh thu/chi phí theo từng xe và từng khoảng thời gian.

---

## 4. Mô tả ba tính năng (theo góc độ nghiệp vụ)

### 4.1. Chi phí dịch vụ đi kèm

Đây là mục chứa các loại phí phát sinh kèm theo cước vận chuyển: phí nâng container, phí hạ container, phí cân hàng, phí làm thủ tục hải quan, phí kết cấu hạ tầng, phí kiểm hóa, và các khoản chi hộ khác. Mỗi loại phí được tách làm hai phần:

- **Mua vào:** số tiền công ty (hoặc giao nhận chi hộ) phải trả cho nhà cung cấp/cảng bãi. Đây là chi phí của công ty và hình thành công nợ phải trả (hoặc giảm trừ tạm ứng nếu giao nhận đã chi hộ).
- **Bán ra:** số tiền công ty báo lại cho khách hàng, thể hiện trên giấy báo nợ kèm cước vận chuyển. Đây là doanh thu, làm tăng công nợ phải thu của khách.

Phần chênh lệch (bán ra − mua vào) là **lãi dịch vụ**, được tính vào lãi/lỗ của chuyến.

### 4.2. Điều động xe ngoài

Ngoài việc điều động xe nhà, hệ thống cần cho phép điều động xe thuê ngoài từ đối tác/nhà cung cấp. Cơ chế kinh doanh:

- Khách hàng trả cho NePO mức cước bình thường (như khi dùng xe nhà).
- NePO trả cho đối tác bên ngoài một mức **giá cước mua vào**. Khoản này hình thành chi phí vận tải và công nợ phải trả cho đối tác.
- Phần chênh lệch giữa giá bán cho khách và giá mua vào là **lãi quản lý** (lãi điều xe ngoài) của NePO.

Vì vậy, trong khâu lập kế hoạch chuyến, ngoài lựa chọn xe nhà cần có lựa chọn đối tác vận chuyển bên ngoài (từ danh sách nhà cung cấp), kèm ô nhập giá cước mua vào và thông tin xe/lái xe của đối tác.

### 4.3. Đối trừ công nợ

Với những đối tác vừa là khách hàng vừa là nhà cung cấp, khi lên bảng kê công nợ phải thu/phải trả cần có mục **đối trừ**: ghi nhận việc cấn trừ song phương, làm giảm đồng thời cả khoản phải thu và khoản phải trả của cùng đối tác mà không phát sinh dòng tiền thực tế. Số ròng sau đối trừ = công nợ phải thu − công nợ phải trả. Kết quả được thể hiện trên **bảng đối chiếu công nợ**.

---

## 5. Quy tắc nghiệp vụ đã được khách hàng xác nhận

> Đây là phần quan trọng nhất đối với người triển khai. Các quy tắc dưới đây do khách hàng (Pete/NePO) xác nhận trực tiếp và là **ground truth** — khi nghi ngờ, lấy phần này làm chuẩn.

### Tính năng 1 — Chi phí dịch vụ đi kèm

**Hình thức thanh toán mua vào (chi hộ vs trả trực tiếp):**
Đa phần các khoản phí do **giao nhận chi hộ bằng tiền tạm ứng**, sau đó hoàn ứng. Trường hợp **công ty trả trực tiếp bằng chuyển khoản** chỉ áp dụng khi: phí nộp hộ tại hãng tàu có lấy hóa đơn về cho NePO, *hoặc* khoản phí **trên 5.000.000 VNĐ**. Do đó hệ thống cần hỗ trợ cả hai hình thức; mặc định là chi hộ từ tạm ứng, và cho phép người dùng chuyển sang trả trực tiếp tùy trường hợp (đây là gợi ý mặc định, không phải ràng buộc cứng).

**Cách xác định giá bán ra cho khách:**
Giá bán dựa trên **báo giá của NePO** — có khoản báo đúng bằng chi phí, có khoản cộng thêm. Vì vậy hệ thống phải cho phép **người dùng tự điền hoặc sửa lại** giá bán (gợi ý sẵn từ giá mua vào nhưng được phép chỉnh).

**Quy tắc cộng lãi theo từng loại phí (dùng làm giá trị gợi ý mặc định, vẫn cho phép sửa):**

| Loại phí | Quy tắc bán ra |
|----------|----------------|
| Phí kết cấu hạ tầng | Giữ nguyên giá gốc (không cộng lãi) |
| Phí nâng/hạ container | Giữ nguyên giá gốc |
| Phí kiểm hóa tại cảng | Giữ nguyên giá gốc |
| Phí cân hàng | Giữ nguyên giá gốc |
| Phí thủ tục hải quan | Cộng thêm phí quản lý / tiền thuế khi xuất hóa đơn cho khách |
| Phí phục vụ kiểm hóa | Cộng thêm phí quản lý |

**Phí nội bộ:**
Có những khoản phí công ty thực chi cho giao nhận **nhưng không báo cho khách hàng**, hoặc báo dưới một hạng mục khác. Hệ thống cần cho phép giá bán bằng 0 (chỉ là chi phí nội bộ) và cho phép gắn nhãn/hạng mục hiển thị khác trên giấy báo nợ.

**Thuế GTGT (VAT) cho dịch vụ đi kèm:**
**Tất cả các phí đều chịu thuế GTGT 8%** theo mức hiện hành; sau này có thể điều chỉnh lên 10% theo quy định nhà nước. Do đó mức thuế phải để **cấu hình được**, không gán cứng.

### Tính năng 2 — Điều động xe ngoài

**Thông tin cần ghi nhận với xe ngoài:**
Ngoài tên đối tác/nhà cung cấp vận chuyển, cần ghi nhận **biển số xe** (để phục vụ xuất hóa đơn cước vận chuyển), **họ tên lái xe** và **số điện thoại lái xe** (để cung cấp cho khách hàng).

**Cách tính lãi điều xe ngoài:**
Lãi là **phần chênh lệch tự nhiên** giữa giá bán ra (báo khách) và giá mua vào (trả đối tác). Mức này **biến động tùy từng chuyến hàng cụ thể**, không có công thức hay tỷ lệ % cố định, và thay đổi theo từng khách hàng/đối tác. → Không xây dựng cơ chế tỷ lệ % cấu hình; chỉ cần tính chênh lệch.

**Quy ước VAT khi tính lãi:**
Lãi điều xe ngoài phải được **quy về mức chưa gồm thuế VAT** để phản ánh đúng bản chất. Tức là so sánh giá bán và giá mua đều ở mức chưa VAT, không so sánh trên giá đã gồm VAT.

### Tính năng 3 — Đối trừ công nợ

**Tần suất và người thực hiện:**
Việc đối trừ công nợ (và trích xuất bảng công nợ phải thu/phải trả) được thực hiện **hằng tháng**, do **kế toán NePO** làm.

**Phê duyệt:**
Kế toán thực hiện, **quản lý kiểm tra và phê duyệt trước khi phát hành**.

**Đối trừ toàn bộ, không đối trừ một phần:**
Khoản đối trừ được thực hiện **toàn bộ và một lần trong tháng** — cấn trừ hết phần nhỏ hơn trong hai khoản (phải thu và phải trả). **Không có đối trừ một phần và không nhập số tiền tự do**; số tiền đối trừ = giá trị nhỏ hơn giữa số phải thu và số phải trả. Việc hai bên thanh toán phần còn lại như thế nào nằm ngoài phạm vi.

### Thuế VAT (áp dụng chung)

Mức VAT hiện hành là **8%**, sau này cơ quan thuế có thể điều chỉnh thành **10%**. Hệ thống lưu mức thuế dưới dạng **cấu hình được** (mặc định toàn hệ thống, có thể thay đổi theo thời gian), áp dụng cho từng chuyến.

### Giấy báo nợ

**Phạm vi lập (theo tháng vs theo lô) — tùy từng khách hàng:**
- Khách chỉ vận chuyển **đường bộ + dịch vụ đi kèm** → lập giấy báo nợ **theo tháng**.
- Khách có **đường bộ + đường biển + dịch vụ đi kèm** → lập giấy báo nợ **theo từng lô hàng**.

Hệ thống cần hỗ trợ cả hai chế độ, chọn theo từng khách hàng.

**Mức độ chi tiết:**
Trên giấy báo nợ, thể hiện **chi tiết từng dòng riêng** tương ứng với từng dịch vụ (cước vận chuyển và mỗi loại dịch vụ đi kèm là một dòng riêng), **không gộp chung** thành một khoản.

---

## 6. Khái niệm & thuật ngữ

| Thuật ngữ | Giải thích |
|-----------|------------|
| **Kế hoạch O/C** | Kế hoạch điều hành/đơn hàng vận chuyển — điểm khởi đầu của một chuyến hàng |
| **Mua vào** | Số tiền NePO/giao nhận trả cho cảng/nhà cung cấp/đối tác (chi phí) |
| **Bán ra** | Số tiền NePO báo lại cho khách hàng (doanh thu) |
| **Xe nhà** | Xe do NePO sở hữu và vận hành |
| **Xe ngoài** | Xe thuê của đối tác/nhà cung cấp bên ngoài |
| **Lãi điều xe ngoài / lãi quản lý** | Chênh lệch giữa cước bán cho khách và cước trả đối tác (quy về chưa VAT) |
| **Lãi dịch vụ** | Chênh lệch bán ra − mua vào của dịch vụ đi kèm |
| **Tạm ứng / Hoàn ứng** | Giao nhận ứng tiền mặt để chi hộ, sau đó lập phiếu thanh toán để hoàn lại |
| **Phiếu thanh toán** | Chứng từ giao nhận lập để hoàn ứng các khoản đã chi hộ; cần kế toán kiểm tra, giám đốc duyệt |
| **Công nợ phải thu** | Số tiền khách hàng còn nợ NePO |
| **Công nợ phải trả** | Số tiền NePO còn nợ nhà cung cấp/đối tác |
| **Đối trừ công nợ** | Cấn trừ song phương giữa phải thu và phải trả của cùng một đối tác |
| **Bảng đối chiếu công nợ** | Bảng thể hiện phải thu, phải trả, phần đối trừ và số ròng |
| **Giấy báo nợ** | Chứng từ NePO gửi khách hàng, liệt kê cước và dịch vụ đi kèm theo form công ty |
| **VAT / GTGT** | Thuế giá trị gia tăng (hiện 8%, có thể lên 10%) |
| **Đối tác hai chiều** | Đối tác vừa là khách hàng (phải thu) vừa là nhà cung cấp (phải trả) |

---

## 7. Ràng buộc & điểm cần lưu ý khi triển khai

- **Số container là trung tâm truy xuất.** Mọi dữ liệu cần lưu trữ và tra cứu được theo số container; cần đảm bảo tìm kiếm và lọc theo số container hoạt động xuyên suốt.
- **VAT phải tách bạch giữa giá có thuế và chưa thuế.** Giá cước bán cho khách nhập là giá **đã gồm VAT**; doanh thu hạch toán nội bộ (cho báo cáo lãi/lỗ theo xe) là giá **chưa VAT** = giá bán ÷ (1 + thuế). Báo cáo doanh thu/chi phí xe phải dùng giá chưa VAT, còn công nợ phải thu dùng giá đã gồm VAT.
- **Mọi bút toán tài chính cần được duyệt** trước khi chính thức ghi nhận hoặc phát hành (đối trừ công nợ, phiếu thanh toán, sửa các mục do giao nhận nhập…). Đây là nguyên tắc xuyên suốt, không riêng tính năng nào.
- **Phụ thuộc vào hệ thống tạm ứng/hoàn ứng.** Vì đa phần phí dịch vụ đi kèm do giao nhận chi hộ từ tạm ứng, phần "mua vào" của Tính năng 1 phải kết nối với cơ chế theo dõi tạm ứng/hoàn ứng (giao nhận cần theo dõi được: số đã tạm ứng, số đã chi, số đã làm thanh toán, số dư tạm ứng còn lại). Cần xác nhận hệ thống tạm ứng đã tồn tại hay cần xây dựng tối thiểu một tài khoản theo dõi tạm ứng để hạch toán phần mua vào.
- **Báo cáo theo từng xe và từng khoảng thời gian** là đầu ra cuối cùng mà cả ba tính năng phải phục vụ: lãi dịch vụ và lãi điều xe ngoài đều phải tổng hợp được vào báo cáo doanh thu/chi phí của từng đầu xe.
- **Lưu trữ đầy đủ chứng từ.** Dịch vụ đi kèm cần lưu số hóa đơn, ngày hóa đơn (với phí có hóa đơn), số tờ khai (với phí hải quan), số container và nội dung chi tiết (với khoản chi hộ khác).

---

## 8. Tóm tắt một dòng cho người triển khai

Bổ sung ba năng lực — chi phí dịch vụ đi kèm (mua vào/bán ra, có lãi dịch vụ, có chứng từ, đưa lên giấy báo nợ), điều động xe ngoài (đối tác + giá mua vào + thông tin xe/lái xe, lãi quy về chưa VAT, sinh công nợ phải trả), và đối trừ công nợ (đối tác hai chiều, đối trừ toàn bộ hằng tháng, có duyệt) — để hệ thống NePO tính đúng lãi/lỗ theo từng xe/từng chuyến và phản ánh đúng công nợ ròng, với VAT cấu hình được và mọi bút toán đều qua phê duyệt.
