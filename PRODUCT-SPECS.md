# PRODUCT SPECIFICATION & USER STORIES: HỆ THỐNG WEB QUẢN LÝ NEPO

## 1. TỔNG QUAN SẢN PHẨM (PRODUCT OVERVIEW)

Sản phẩm là một nền tảng web thống nhất nhằm thay thế quy trình vận hành và quản lý thủ công hiện tại dựa trên 7 file Excel và hơn 300 sheet của Công ty TNHH NEPO.

* **Quy mô quản lý:** 4 xe đầu kéo container, 38+ tuyến đường và 44+ khách hàng.
* **Mục tiêu chính:**
    * Giảm thời gian tổng hợp dữ liệu thủ công (tiết kiệm 2-3h/ngày cho kế toán, 1h/ngày cho quản lý).
    * Tự động hóa tính toán chi phí và doanh thu, giảm sai sót.
    * Cung cấp cảnh báo và báo cáo thời gian thực giúp ra quyết định nhanh chóng.

---

## 2. ĐỊNH NGHĨA NGƯỜI DÙNG & GIAO DIỆN (USER PERSONAS & UI STRATEGY)

| Vai trò | Mô tả nhiệm vụ | Giao diện |
| :--- | :--- | :--- |
| **Quản lý / Đối tác** | Điều hành toàn bộ quy trình, nhận đơn, phân xe, theo dõi tài chính, công nợ, quản lý kỷ luật và xem phân chia lợi nhuận. | Desktop-first (Dashboard, Báo cáo) |
| **Kế toán** | Nhập liệu/kiểm tra thông tin chuyến đi, kiểm soát nhiên liệu, tính toán tiền đi đường và đôn đốc công nợ phải thu. | Desktop-first (Bảng dữ liệu, Cấu hình) |
| **Giao nhận** | Nhập chi phí dịch vụ đi kèm (nâng/hạ, hải quan, cân hàng, hạ tầng...) và số container/seal theo từng chuyến, kèm số hóa đơn/tờ khai. Sử dụng tiền tạm ứng để chi hộ và lập phiếu thanh toán hoàn ứng. **Không xem dữ liệu tài chính.** | Mobile-first (Danh sách chuyến, Form nhập phí) |
| **Lái xe** | Xem lịch trình, kiểm tra số dầu được cấp, xem thu nhập và kỷ luật cá nhân. **Chỉ xem, không nhập liệu.** | Mobile-first (Nút bấm lớn, Tối giản) |

---

## 3. PHẠM VI NGHIỆP VỤ (BUSINESS SCOPE)

Sản phẩm bao gồm các module nghiệp vụ: Ghi nhận chuyến đi; Quản lý nhiên liệu & tiền đi đường; Dashboard doanh thu – chi phí; Công nợ phải thu; Phân chia lợi nhuận; Kỷ luật; Chi phí vận hành & công nợ phải trả; Lương & chấm công lái xe; Quản lý lốp xe; Quản lý đội xe & điều vận; Cấu hình hệ thống. Lộ trình triển khai và phân kỳ ưu tiên được quản lý tại `docs/plans/feedback-fix-plan.md`.

**Ngoài phạm vi:** GPS tracking, variable pricing.

---

## 4. QUY TẮC NGHIỆP VỤ CỐT LÕI (BUSINESS RULES)

### 4.1 Chuyến đi (Trips)

* **Trip (Chuyến xe)** là đơn vị vận hành cốt lõi — mỗi chuyến là một lần xe chạy độc lập. Khách hàng và tuyến đường được chọn trực tiếp trên Trip.
* **Customer Reference (Tham chiếu KH):** Trường tùy chọn trên Trip để nhóm các chuyến phục vụ cùng một yêu cầu của khách hàng. Khái niệm Order/Đơn hàng chính thức hiện chưa có mặt trong sản phẩm (xem `docs/plans/feedback-fix-plan.md`).
* **Trạng thái chuyến đi (5 trạng thái):**
    1. **Mới tạo**: Quản lý tạo thông tin cơ bản (chọn Xe nhà hoặc Xe ngoài, điền thuế VAT). Kế toán nhập các số liệu dự kiến (km, dầu, vé).
    2. **Đang chạy**: Lái xe đã xuất phát. Kế toán có thể cập nhật số liệu bất kỳ lúc nào.
    3. **Hoàn thành**: Xe đã về. Kế toán nhập/đối chiếu số liệu thực tế cuối cùng (đăng ảnh chuyến chè nếu có). Vẫn có thể sửa nếu gõ sai.
    4. **Đã chốt**: Khóa sổ, hệ thống tạo bản ghi Sổ cái (Ledger). Cấm sửa đổi.
    5. **Đã hủy**: Chuyến xe bị hủy bỏ giữa chừng, lưu lại lịch sử.
* **Quy trình nhập liệu:** Quản lý tạo chuyến -> Kế toán điền số dự kiến -> Xe chạy -> Xe về, kế toán chốt số thực tế -> Quản lý/Kế toán khóa chuyến (Đã chốt).
* **Quy tắc chuyển trạng thái (quan trọng):** Trạng thái chuyến đi chỉ thay đổi khi người dùng (Quản lý/Kế toán) **chủ động bấm nút** tương ứng. Hệ thống **không tự động** chuyển sang `Hoàn thành` khi upload ảnh container/seal — ảnh chỉ để lưu hồ sơ. Việc hoàn thành chuyến do người dùng quyết định sau khi chuyến kết thúc. *(Phản hồi người dùng 2026-06, mục A3.1.)*

### 4.1.1 Thuế VAT, Hoa hồng & Doanh thu vận tải
* Giá cước bán cho khách hàng luôn được nhập **bao gồm VAT** (INCL VAT). 
* Hệ thống ghi nhận **Tỷ lệ VAT** (VD: 8% hoặc 10%) cho từng chuyến đi (mặc định cấu hình theo khách hàng).
* **Hoa hồng chi khách hàng** (`customerCommission`): khoản chiết khấu/hoa hồng thương mại trả trực tiếp cho đối tác/khách hàng theo từng chuyến. Kế toán nhập tay, không theo công thức. **Ghi nhận ngay khi nhập dữ liệu** (không phải đợi khóa chuyến).
* **Công thức doanh thu thực tế:** `Doanh thu ghi nhận = Giá cước (chưa VAT) − Hoa hồng chi KH`. Hay: `recordedRevenue = freightExVat − customerCommission`.
* Doanh thu ghi nhận trên giấy báo nợ (phải thu) là giá gồm VAT. 
* Doanh thu ghi nhận vào Báo cáo Lãi lỗ nội bộ (P&L, DT xe) là **doanh thu thực tế** (= Giá bán / (1 + VAT) − Hoa hồng). *(Pete xác nhận 11/6)*

### 4.1.2 Điều động Xe ngoài (External Carrier)
* Một chuyến đi có thể được thực hiện bởi **Xe nhà** (OWN) hoặc **Xe ngoài** (EXTERNAL).
* **Xe nhà**: Sử dụng đầu kéo, lái xe, nhiên liệu, và tiền đi đường của công ty.
* **Xe ngoài**: Công ty thuê đối tác vận chuyển. Khi chọn xe ngoài:
    * Không nhập xe đầu kéo, lái xe công ty.
    * Nhập **Đối tác vận chuyển** (Nhà cung cấp).
    * Nhập **Giá cước thuê ngoài (gồm VAT)**, **Biển số xe ngoài**, **Tên lái xe ngoài**, **SĐT lái xe ngoài**.
    * Chi phí chuyến đi = Giá cước thuê ngoài (không có dầu, vé, lương).
    * **Lãi điều xe ngoài (Management Margin)** = Doanh thu chưa VAT − Giá cước thuê ngoài **gồm VAT** (nguyên tắc §4.7: chi phí ghi nhận incl-VAT). Lãi này cộng vào P&L của công ty.

### 4.2 Doanh thu & Bảng giá

* **Doanh thu** được xác định bằng bảng tra cố định theo **Khách hàng × Tuyến đường** (cùng tuyến đường có thể có giá khác nhau cho từng khách hàng).
* Bảng giá hiện tại cố định; variable pricing có thể xem xét sau.
* **Phân biệt Tuyến đường vs. Chặng chi tiết:** Tuyến đường (Route) là khái niệm tổng quát (VD: "Hải Phòng - Hà Nội") dùng làm khóa tra **bảng giá** và **tiền đi đường chuẩn**. Các chặng chi tiết (Trip Legs: cảng → nhà máy A → kho B...) là dữ liệu bổ sung nhập trong quá trình thực hiện chuyến để tính **định mức nhiên liệu** chính xác theo từng đoạn. *(Pete xác nhận 19/5: "Chính xác")*

### 4.3 Chi phí nhiên liệu

* Kế toán nhập **số lít dầu**; hệ thống tự nhân với **đơn giá** để tính chi phí dầu. Mặc định dùng **đơn giá cấu hình** (được snapshot khi tạo chuyến). Kế toán có thể nhập **đơn giá thực tế** (giá thực mua tại trạm) nếu khác với giá cấu hình — khi đó chi phí = L dầu × đơn giá thực tế (xem §4.3.1).
* **Tiêu thụ bình quân (TTBQ)** = Số lít dầu / km × 100. Tự động đối chiếu với định mức để cảnh báo.
* **Định mức nhiên liệu:**
    * Hàng (đầy): 43L/100km
    * Vỏ (chạy không): 25L/100km
    * Bổ sung cố định: +3L/chuyến (áp dụng cho tuyến thường)
    * Tuyến đèo đốc: định mức cố định **tổng cả chuyến** theo tuyến (lưu trong bảng Tuyến đường, hệ thống tự tra). Thay thế hoàn toàn công thức tính theo km và +3L bổ sung. VD: Mộc Châu 240L, Sơn La 320L, Lai Châu 365L.
* **Mô hình chặng (Trip Legs) áp dụng cho cả tuyến đèo đốc:** Kế toán vẫn nhập chi tiết từng chặng (điểm đi, điểm đến, km, loại tải) để lưu lịch sử vận hành. Tuy nhiên, hệ thống sử dụng **định mức cố định theo tuyến** (không tính theo km chặng) để ra số L dầu. *(Pete xác nhận 19/5: "Vẫn áp dụng em ạ, và vẫn có lựa chọn bổ sung")*
* **3 chế độ nhập dầu (áp dụng cả tuyến đèo đốc):**
    1. **AUTO:** Hệ thống tự tính L dầu từ km từng chặng × định mức (hàng/vỏ), hoặc dùng định mức cố định nếu là tuyến đèo đốc.
    2. **KHOÁN (FLAT_RATE):** Kế toán nhập thủ công tổng L dầu, ghi đè toàn bộ tính toán tự động.
    3. **Bổ sung (Supplement):** L dầu cộng thêm do xe hỏng, đi sửa,... — cộng vào kết quả của cả 2 chế độ trên.

### 4.3.1 Điều chỉnh giá nhiên liệu theo thực tế

* **Vấn đề:** Giá nhiên liệu biến động theo thời gian. Giá cấu hình tại thời điểm kế toán nhập (VD: 28.760 VNĐ/lít) có thể khác với giá thực tế khi lái xe đổ dầu (VD: 27.650 VNĐ/lít). Chênh lệch làm sai chi phí chuyến, công nợ NCC nhiên liệu và báo cáo P&L.
* **Giải pháp 2 tầng:**
    1. **Lịch sử giá nhiên liệu** (`fuel_price_history`): Hệ thống tự ghi lại mọi thay đổi đơn giá kèm ngày hiệu lực. Cung cấp audit trail và đề xuất giá hiệu lực theo ngày xuất phát chuyến.
    2. **Giá thực tế theo chuyến** (`fuelActualUnitPrice`): Kế toán nhập giá thực mua cho từng chuyến. Khi có giá thực tế → hệ thống tính `chi phí dầu = L dầu × giá thực tế` (thay vì giá cấu hình). Chênh lệch (`fuelPriceVariance = chi phí thực tế − chi phí theo giá cấu hình`) được theo dõi cho báo cáo.
* **Luồng nghiệp vụ:**
    1. Khi mở form nhập liệu chuyến, hệ thống **đề xuất** giá hiệu lực từ bảng lịch sử giá theo ngày xuất phát.
    2. Kế toán chấp nhận đề xuất hoặc nhập giá khác. Nếu để trống → dùng giá cấu hình (hành vi hiện tại).
    3. Hệ thống tính lại `totalFuelCost`, `totalCost`, `grossProfit` khi giá thực tế thay đổi.
    4. Chênh lệch hiển thị trên thẻ chuyến và tổng hợp trong báo cáo P&L.
* **Ràng buộc:** Chỉ được nhập/sửa giá thực tế khi chuyến chưa khóa (trạng thái Mới tạo, Đang chạy, Hoàn thành). Chuyến đã chốt — giá bất biến. Chuyến cũ (trước khi có tính năng này) để trống giá thực tế → dùng giá cấu hình snapshotted như hiện tại.
* **Cập nhật giá cấu hình:** Mỗi lần kế toán thay đổi đơn giá trong Cấu hình hệ thống, hệ thống tự ghi một dòng mới vào bảng `fuel_price_history` (append-only, không sửa/xóa). Giá cấu hình hiện tại luôn đồng bộ với dòng mới nhất trong lịch sử.
* **Snapshot giá tại chuyến:** Mỗi chuyến đi **phải** lưu `fuel_price_applied` tại thời điểm tạo hoặc lần đầu nhập số liệu tài chính. Thay đổi đơn giá cấu hình **không** làm thay đổi chi phí nhiên liệu của các chuyến đã tạo (kể cả khi chưa khóa, nếu đã có `fuel_price_applied` ≥ 0). Chuyến đã chốt (`LOCKED`) tuyệt đối không bị recompute — sai sót được sửa bằng bút toán `ADJUSTMENT` (xem §4.9).

### 4.3.2 Lựa chọn Nhà cung cấp nhiên liệu & Ghi nhận công nợ

* **Lựa chọn Nhà cung cấp:** Đối với các chuyến xe nhà (`OWN` carrier), kế toán có thể lựa chọn nhà cung cấp nhiên liệu tương ứng. Danh sách nhà cung cấp này được chọn lọc từ danh sách nhà cung cấp (`suppliers`) dựa trên việc đánh dấu cờ "Là nhà cung cấp nhiên liệu (xăng, dầu)" (`isFuelSupplier`). Điều này giúp phân biệt rõ ràng nhà cung cấp xăng dầu với các nhà cung cấp dịch vụ khác (ví dụ: sửa xe, đăng kiểm).
* **Xuất phiếu cấp nhiên liệu (Phiếu cấp dầu):** Kế toán có thể xuất phiếu cấp nhiên liệu (HTML/PDF hoặc Excel) theo từng chuyến sau khi phê duyệt trên phần mềm. Phiếu bao gồm: Biển số xe, Khối lượng/Số lít dầu được cấp, Tên + Địa chỉ nhà cung cấp nhiên liệu, Mã chuyến, Tuyến đường, Ngày, Tên lái xe, Khối chữ ký (Kế toán / Giám đốc / Người nhận). Thông tin NCC tối giản — chỉ cần tên + địa chỉ, **không cần** MST, số tài khoản ngân hàng hay người liên hệ. Phiếu được in ra để ký tay hoặc trích xuất dưới dạng file ảnh/file điện tử gửi cho đối tác. *(Pete xác nhận 11/6)*
* **Ghi nhận công nợ tự động:**
    - Khi chuyến đi được Chốt khóa (`LOCKED`), hệ thống tự động ghi nhận một bút toán Có (`credit`) bằng `totalFuelCost` (Tổng chi phí nhiên liệu thực tế của chuyến) vào sổ cái của nhà cung cấp nhiên liệu tương ứng (`entity_type='VENDOR'`, loại giao dịch `FUEL_EXPENSE`).
    - Khi chuyến đi được Mở khóa (`COMPLETED`), hệ thống ghi nhận một bút toán đối ứng Nợ (`debit` loại `UNLOCK_REVERSAL`) để hoàn tác công nợ.
* **Tra cứu đối với lái xe:** Lái xe thông qua Driver Portal có thể tra cứu chi tiết từng chuyến để biết số dầu mình được cấp và nhà cung cấp nhiên liệu chỉ định.



### 4.4 Tiền đi đường (Road Allowance)

* Là khoản chi phí hoàn trả cho lái xe (chi phí đường bộ), **không tính là thu nhập của lái xe**.
* **Tiền chuẩn:** Bảng tra cố định theo Tuyến đường × Loại rơ-mooc (~38 tuyến × 2 loại).
* Điều chỉnh do kế toán/quản lý nhập thủ công từng chuyến: Tiền vé (công ty) đã thanh toán, Tổng tiền đi đường, Số trạm.
* **Công thức:**
  - Nếu nhập "Tổng tiền đi đường" (> 0), giá trị đó được sử dụng trực tiếp; ngược lại, hệ thống tự động tính: `Tổng tiền đi đường (tự tính) = Tiền chuẩn - (Số trạm × 55.000) + [300.000 nếu về có hàng]`.
  - Số tiền thanh toán thực tế cho lái xe: `Lái xe thực lĩnh = Tổng tiền đi đường + Tiền kết hợp + Tiền lưu ca xe + Tiền đóng trả hàng 2 điểm - Tiền vé (công ty) đã thanh toán`.

### 4.5 Lương lái xe & Chấm Công

> Xem chi tiết tại [`docs/flows/14-LUONG_VA_CHAM_CONG.md`](docs/flows/14-LUONG_VA_CHAM_CONG.md)

#### 4.5.1 Mô hình Chấm Công

Hệ thống quản lý ngày công qua hai luồng song song:
1. **Tự động từ chuyến đi:** Mỗi ngày lái xe có chuyến đang chạy → hệ thống tự ghi `TRIP_DAY`.
2. **Kế toán chấm công thủ công:** Các ngày còn lại kế toán gán `STANDBY` (chờ việc/sửa xe) hoặc `PERSONAL_LEAVE` (nghỉ không lương). Hệ thống tự điền `WEEKLY_OFF` cho Chủ nhật không có chuyến.

**Trạng thái ngày công (`WorkDayStatus`):**

| Mã | Tên | Mô tả | Hưởng lương |
| :--- | :--- | :--- | :--- |
| `TRIP_DAY` | Ngày đi chuyến | Tự động từ dữ liệu vận hành | Có |
| `STANDBY` | Chờ việc / Sửa xe | Trực bãi, không có hàng, xe hỏng do lỗi công ty | Có (đầy đủ) |
| `PERSONAL_LEAVE` | Nghỉ việc riêng | Tự xin nghỉ không lương | Không |
| `WEEKLY_OFF` | Nghỉ tuần | Chủ nhật không có chuyến | Không |

**Lưu ý Chủ nhật xuyên chuyến:** Nếu chuyến kéo dài qua ngày Chủ nhật, ngày đó được tính là `TRIP_DAY` (ngày làm việc bình thường).

#### 4.5.2 Số ngày công chuẩn (`standard_work_days`)

* Tính theo **thực tế từng tháng**: tổng số ngày trong tháng − số ngày Chủ nhật.
* **Không cố định 26 ngày.** Tháng có 27 ngày làm → tính thêm; tháng có 24 ngày làm → giảm tương ứng.

#### 4.5.3 Công thức tính lương thực nhận

```
Ngày công hưởng lương = trip_days + standby_days

daily_rate = base_salary / standard_work_days   *(Pete 2026-06: social_insurance KHÔNG nằm trong daily_rate — chỉ base_salary. BHXH hạch toán chi phí riêng.)*

Điều chỉnh công (Adjustment):
  Nếu ngày công hưởng lương < standard_work_days → adjustment = -(số ngày thiếu × daily_rate)
  Nếu ngày công hưởng lương > standard_work_days → adjustment = +(số ngày thừa × daily_rate)
  Nếu bằng nhau → adjustment = 0

net_salary = base_salary + adjustment − penalties

*Lưu ý: Lương chuyến (total_trip_salary) và Lương chờ việc (standby_cost) chỉ là các khoản phân bổ để hạch toán chi phí vào báo cáo Lãi/Lỗ, KHÔNG cộng thêm vào lương thực nhận của lái xe.*
```

* **BHXH/BHYT:** Phần doanh nghiệp đóng (`social_insurance`) được cấu hình cho từng lái xe (trường `social_insurance` trên bảng `drivers`) và **hạch toán chi phí riêng** — **KHÔNG** cộng vào `daily_rate`. Cả `daily_rate` và lương thực trả lái xe đều dùng `base_salary` gốc. *(Pete xác nhận 4/6, 11/6, 12/6 — cập nhật: social KHÔNG vào daily_rate)*
* **Lương chuyến quy đổi (Trip Salary Auto-fill):** Khi kế toán nhập liệu chuyến đi (chọn lái xe, nhập ngày đi/ngày về), hệ thống **tự động điền** trường `driver_salary` theo công thức: `base_salary / 26 × trip_wage_days` (BHXH hạch toán riêng, KHÔNG vào công thức). Đây là khoản PHÂN BỔ chi phí vào chuyến, không cộng thêm vào thu nhập lái xe. Kế toán có thể sửa/ghi đè. Mẫu số biến động `standard_work_days` chỉ dùng cho chấm công/lương tháng.
* **Dashboard thu nhập lái xe (5 thẻ):** Cổng lái xe hiển thị 5 thẻ tổng hợp thu nhập cộng dồn từ đầu tháng đến hiện tại:
    1. **Lương cơ bản tháng** (`base_salary_mtd`) — lương cứng tháng hiện tại.
    2. **Lương sản xuất (chuyến) cộng dồn** (`trip_salary_mtd`) — tổng `driver_salary` từ các chuyến đã chốt trong tháng.
    3. **Tiền đi đường đã lĩnh** (`road_allowance_mtd`) — tổng tiền đi đường thực lĩnh từ các chuyến LOCKED trong tháng.
    4. **Đã tạm ứng + đã thanh toán** (`total_paid_mtd`) — cộng gộp từ sổ cái (`entity_type='DRIVER'`, áp dụng quy ước dấu `credit − debit`).
    5. **Còn lại** (`remaining_mtd`) = `(Lương CB + Lương SX + Tiền đi đường) − (Tạm ứng + Kỷ luật + Đã thanh toán)`.

    **Không tách STANDBY riêng** trong dashboard — lương STANDBY đã nằm trong Lương CB tháng qua `daily_rate × (trip_days + standby_days)` (xem công thức trên). Tách riêng sẽ gây hiểu nhầm là khoản cộng thêm → double-count.

    **Lưu ý hiển thị:** Thẻ "Lương SX" trên giao diện lái xe ghi rõ "Lương phân bổ chuyến — không cộng vào thu nhập thực nhận" để lái xe hiểu đúng bản chất phân bổ chi phí (không phải thu nhập cộng thêm).
* **Trường `trip_wage_days`:** Hệ thống tự tính từ khoảng ngày đi → ngày về (`daysBetween(departure, arrival) + 1`). Kế toán có thể ghi đè khi chuyến kéo dài xuyên ngày nghỉ.
* **Chi phí chờ việc (Standby Cost):** Tính bằng `standby_days × daily_rate`. Đây là khoản PHÂN BỔ chi phí gián tiếp vào P&L chung, không cộng thêm vào thu nhập lái xe.
* **Khấu trừ / Thưởng ngày công (Adjustment):** Hệ thống so sánh tổng ngày làm việc (`trip_days + standby_days`) với `standard_work_days`. Nếu lái xe nghỉ không lương (`PERSONAL_LEAVE`), ngày làm việc sẽ giảm và bị trừ lương. Nếu lái xe làm thêm ngày Chủ nhật mà không nghỉ bù, ngày làm việc sẽ tăng và được cộng thêm lương (theo `daily_rate`).
* **Phạt kỷ luật (Penalty):** Trừ vào `net_salary` (không phải chi phí công ty — xem §4.11).

#### 4.5.4 Phân bổ chi phí lương vào P&L

| Loại | Hạch toán | Ghi chú |
| :--- | :--- | :--- |
| **Nhân công trực tiếp** | Vào từng chuyến qua trường `driver_salary` | Kế toán nhập thủ công |
| **Nhân công gián tiếp (chờ việc)** | Vào chi phí chung tháng (`standby_cost = standby_days × daily_rate`) | Không gán vào chuyến bất kỳ — tránh méo hiệu quả chuyến |

* Sau khi kế toán xác nhận kỳ lương (`CONFIRMED`), hệ thống tự tạo bản ghi `expenses` loại `STANDBY_LABOR` (truck_id = null) với số tiền = `standby_cost`, hạch toán vào chi phí chung trong báo cáo lãi lỗ.

#### 4.5.5 Phân quyền chấm công

* **Kế toán:** Chấm công, sửa ngày công, xác nhận kỳ lương. Xem thu nhập tất cả lái xe.
* **Quản lý:** Xem và xác nhận kỳ lương. Xem thu nhập tất cả lái xe.
* **Lái xe:** Chỉ xem lịch chấm công và thu nhập của chính mình qua `/my-earnings`. Không được sửa.

### 4.6 Tổng chi phí (Total Cost)

* **Công thức đối với Xe nhà:**
  ```
  Tổng chi phí = Chi phí dầu (incl. VAT)
               + Tiền đi đường (net — lái xe thực nhận)
               + Tiền vé BOT (trạm thu phí: số trạm × phí/trạm)
               + Tiền vé (công ty đã thanh toán hộ lái xe — tollsDiscount)
               + Lương chuyến quy đổi (driver_salary)
               + Thưởng giao 2 điểm (nếu có)
               + Lưu ca xe (nếu có)
  ```
  Chi phí dịch vụ đi kèm **không** cộng trực tiếp vào tổng chi phí — biên lợi nhuận dịch vụ (service margin = bán ex-VAT − mua incl-VAT) được cộng riêng vào lợi nhuận gộp (xem §4.7). Lương chuyến quy đổi được hệ thống tự điền theo công thức `baseSalary / 26 × tripWageDays` (BHXH hạch toán riêng, không vào công thức), kế toán có thể ghi đè.

  **Lưu ý hiển thị:** Tiền đi đường trên thẻ phân tích tài chính hiển thị theo 2 dòng riêng biệt: (1) "Tiền đi đường" = số tiền lái xe thực nhận (đã trừ vé công ty), và (2) "Tiền vé (công ty thanh toán)" = khoản công ty trả hộ vé cho lái xe. Cả hai đều là chi phí công ty và được tính vào tổng chi phí.
* **Công thức đối với Xe ngoài:** `Tổng chi phí = Giá cước thuê ngoài`.
* **Thuế VAT trong chi phí:** Toàn bộ khoản chi phí được ghi nhận **gồm VAT** (incl. VAT). Không trừ VAT đầu vào trên chi phí. Điều này phản ánh thực tế doanh nghiệp: chi phí thực trả cho NCC đã bao gồm thuế GTGT.
* Phạt kỷ luật **không** tính vào tổng chi phí — đây là khoản trừ lương lái xe, không phải chi phí công ty.
* **Hai tầng:** thẻ **từng chuyến** giữ nguyên công thức trên (`computeTripTotals` không đổi). Ở **báo cáo lãi lỗ theo tháng**, Tổng chi phí bao gồm **TẤT CẢ chi phí** = Σ chi phí các chuyến (gồm VAT) + Σ chi phí vận hành/bảo dưỡng theo xe (sửa chữa, phụ tùng, vật tư, bảo hiểm, đăng kiểm, phí đường bộ — xem §4.14). Chi phí bảo dưỡng là theo xe/tháng, không tính vào từng chuyến.

### 4.6.1 Chi phí dịch vụ đi kèm (Ancillary Fees)
* Các chi phí phát sinh tại cảng/bãi (Nâng container, Hạ container, Cân hàng, Kiểm hóa, Hải quan, Hạ tầng, Phục vụ kiểm hóa, Phí chi hộ khác).
* Mỗi chi phí có **Giá mua vào** (Công ty/Giao nhận trả cảng/NCC) và **Giá bán ra** (Thu của khách hàng, luôn gồm VAT).
* **Thuế GTGT dịch vụ đi kèm:** Tất cả phí đi kèm chịu VAT **8%** (mức hiện hành; có thể điều chỉnh lên 10%). Mức thuế lưu dạng **cấu hình được**, không gán cứng.
* Giá bán ra do kế toán/giao nhận nhập/sửa tự do — hệ thống gợi ý theo loại phí (xem bảng dưới). Lãi dịch vụ (Service Margin) = Bán ra − Mua vào.
* **Phí nội bộ:** Giá bán ra có thể bằng 0 (khoản chi nội bộ không báo khách, hoặc báo dưới hạng mục khác). Mỗi loại phí có thể cấu hình nhãn hiển thị riêng trên Giấy báo nợ (`billing_label`) khác với tên nội bộ.

**Danh mục phí và quy tắc mặc định:**

| Mã | Tên tiếng Việt | Trường bổ sung | Hình thức chi mặc định | Giá bán ra mặc định |
| :--- | :--- | :--- | :--- | :--- |
| `LIFTING` | Phí nâng container | Số HĐ, Ngày HĐ | FORWARDER_ADVANCE | Bằng giá mua (at cost) |
| `LOWERING` | Phí hạ container | Số HĐ, Ngày HĐ | FORWARDER_ADVANCE | Bằng giá mua |
| `WEIGHING` | Phí cân hàng | Số HĐ, Ngày HĐ | FORWARDER_ADVANCE | Bằng giá mua |
| `CUSTOMS` | Phí làm tờ khai hải quan | Số tờ khai, Số container | FORWARDER_ADVANCE | Cộng thêm phí quản lý (markup) |
| `INFRASTRUCTURE` | Phí kết cấu hạ tầng (nộp hộ) | Số container | FORWARDER_ADVANCE | Bằng giá mua |
| `INSPECTION` | Phí kiểm hóa tại cảng | Số HĐ, Ngày HĐ | FORWARDER_ADVANCE | Bằng giá mua |
| `INSPECTION_SVC` | Phí phục vụ kiểm hóa | Diễn giải chi tiết | FORWARDER_ADVANCE | Cộng thêm phí quản lý |
| `OTHER` | Phí chi hộ khác | Diễn giải chi tiết, Số container | FORWARDER_ADVANCE | Theo từng trường hợp (có thể = 0) |

> Mặc định FORWARDER_ADVANCE cho tất cả. Chuyển sang COMPANY_DIRECT khi: phí nộp hộ tại hãng tàu có HĐ xuất tên NePO, **hoặc** khoản **> 5.000.000 VNĐ** (NePO chuyển khoản trực tiếp). Đây là gợi ý — người dùng luôn có thể ghi đè.

* **Đường dẫn thanh toán (Settlement Method):**
    * **COMPANY_DIRECT**: Công ty trả trực tiếp cho NCC/Cảng → Tạo công nợ phải trả NCC.
    * **FORWARDER_ADVANCE**: Giao nhận trả hộ bằng tiền tạm ứng → Trừ vào số dư tạm ứng của giao nhận; không tạo công nợ NCC. (Mặc định).
* Các khoản phí cần lưu trữ: Số hóa đơn, Ngày hóa đơn, Số tờ khai (hải quan), và Số container.
* **Ghi chú defensive (form giao nhận):** Khi giao nhận mở form nhập chi phí từ một dòng container đã chọn, trường `containerNumber` hiển thị ở chế độ **readonly + auto-fill** từ container đã chọn — giao nhận xác nhận lại bằng mắt trước khi nhập số tiền, tránh click nhầm dòng. Hệ thống vẫn ghi nhận FK `tripContainerId` để phiếu thanh toán group theo container chính xác, không phụ thuộc chuỗi text.

### 4.7 Lợi nhuận

* **Nguyên tắc VAT (bất đối xứng):** Doanh thu ghi nhận **chưa VAT** (ex-VAT), chi phí ghi nhận **gồm VAT** (incl. VAT). Đây là phương pháp tính của công ty: cước bán ra cho KH gồm VAT, nhưng nội bộ chỉ tính phần doanh thu thực (không VAT) trừ đi toàn bộ chi phí thực chi (đã có VAT). Khoản VAT đầu ra không phải thu nhập công ty; VAT đầu vào trên chi phí là chi phí thực tế không được khấu trừ trong bức tranh nội bộ.
* **Lợi nhuận gộp (Gross Profit):** = Doanh thu vận tải **chưa VAT** − Tổng chi phí **gồm VAT**, tính theo từng **xe đầu kéo** (hoặc gộp riêng thành mục Xe ngoài), theo tháng. **Tổng chi phí xe** = Σ chi phí các chuyến của xe (gồm VAT) + Σ chi phí bảo dưỡng gắn chính xe đầu kéo đó **hoặc rơ-mooc ghép cặp với xe đó** trong tháng (sửa chữa đầu kéo/rơ-mooc, bảo hiểm/đăng kiểm/phí đường bộ của cả cặp). Mỗi đầu kéo và rơ-mooc **ghép thành cặp cố định** — chi phí rơ-mooc tính chung vào chi phí của đầu kéo ghép cặp. Mỗi phiếu chi phí gắn xe đánh dấu thuộc **đầu kéo** hay **rơ-mooc** (`vehicle_component: 'TRUCK' | 'TRAILER'`), cho phép báo cáo phân tách chi phí sửa chữa/đăng kiểm/thay lốp theo thành phần xe *(Pete xác nhận 1/6)*.
* **Lợi nhuận ròng (Net Profit):** = Tổng LN gộp tất cả xe − Phí quản lý − **Chi phí không gắn xe (chi phí chung, gồm VAT)** + Thu nhập khác.
* **Phí quản lý:** Khoản cố định hàng tháng cho toàn công ty. Kế toán nhập thủ công. *(Mức cụ thể do Giám đốc ấn định — tạm thời placeholder 24.000.000 VNĐ/tháng; sẽ xác nhận chính thức sau.)*
* **Thu nhập khác (Other Income):** Ghi nhận doanh thu phạt kỷ luật. Lương lái xe ghi nhận đầy đủ, không trừ phạt.
* **Đối chiếu P&L:** Trước khi đưa vào vận hành chính thức, kế toán cần đối chiếu lại số liệu P&L bằng tay cho mỗi bộ chuyến mẫu (reconcile từng dòng doanh thu / chi phí / lãi gộp với `pnl.service.ts` và `computeTripTotals`). Sai lệch > 0.01 VNĐ phải được truy vết và sửa trước khi ký chốt báo cáo.

### 4.8 Phân chia lợi nhuận

* **Mô hình Kết hợp (Hybrid Approach)**:
  * **Đầu vào (CapTableHistory)**: Theo dõi lịch sử thay đổi tỷ lệ cổ phần (VD hiện tại: Ông Thương 29.55%, Ông Phụng 70.45%).
  * **Đầu ra (Distribution Snapshot)**: Khi phân chia (theo quý/năm), hệ thống tính toán dựa trên tỷ lệ lịch sử hiện hành và khóa chết kết quả thành các bản ghi phân bổ (distributions) bất biến. Báo cáo năm chỉ cần `SUM` các bản ghi này.

### 4.8.1 Phân chia lợi nhuận cho nhà đầu tư theo xe (Truck-level Investor Equity)

Ngoài phân chia cổ tức tổng công ty theo `capTableHistory` (§4.8 trên), hệ thống còn hỗ trợ phân chia lợi nhuận ròng cho **nhà đầu tư góp vốn vào từng xe cụ thể**. Bản chất: "góp vốn theo xe" = đầu tư trên tài sản cụ thể, nhà đầu tư sở hữu một phần lợi nhuận ròng sinh ra từ chính xe đó.

**Schema mới:** `truck_profit_distribution`
- `id`, `truck_id` (FK→trucks), `partner_id` (FK→forwarders/partners, nullable cho trường hợp 1 nhà đầu tư góp nhiều xe), `period` (tháng/quý), `gross_profit`, `net_profit`, `share_pct` (decimal 5,2), `amount`, `created_at`, `status` (DRAFT/CONFIRMED).

**Tách bạch 3 dòng tiền** (không gộp):
1. **Chi phí vận hành theo xe** → trừ vào LN gộp của xe (sửa chữa, bảo dưỡng, lốp, bảo hiểm, đăng kiểm, phí đường bộ).
2. **Cổ tức nhà đầu tư theo xe** → chia từ LN ròng công ty cho từng xe theo `share_pct` của xe đó (dòng tiền này).
3. **Cổ tức cổ đông tổng công ty** → `capTableHistory` (§4.8), chia theo tỷ lệ sở hữu toàn công ty.

Một cá nhân có thể vừa là cổ đông công ty (capTable), vừa là nhà đầu tư riêng cho 1 xe (truck_profit_distribution) — hai dòng tiền độc lập.

### 4.9 Khóa chuyến đi & Điều chỉnh (Trip Locking & Corrections)

* Chuyến đi được quản lý/kế toán kiểm tra và **khóa (Đã chốt) theo từng chuyến** (trip-by-trip) khi dữ liệu đã chính xác. Không có cơ chế "chốt tháng" — từng chuyến là commit point duy nhất.
* Khi một chuyến chuyển sang "Đã chốt", hệ thống sinh ra bản ghi bất biến trong Sổ cái (Ledger).
* Dashboard hiển thị lợi nhuận cộng dồn của các chuyến `Đang chạy`, `Hoàn thành` và `Đã chốt`.
* **Nghiệp vụ sửa lỗi:** Số liệu đã chốt không thể sửa đổi quá khứ. Tuân thủ chuẩn kế toán Việt Nam, nếu sai sót phải xuất **Hóa đơn điều chỉnh** (Adjustment E-Invoice) ở kỳ hiện tại kèm biên bản thỏa thuận. Số âm cho điều chỉnh giảm (Credit Note), số dương cho điều chỉnh tăng (Debit Note).

### 4.10 Công nợ phải thu & Kiến trúc Sổ cái (Ledger)

* **Sổ cái trung tâm (Transaction Ledger):** Toàn bộ giao dịch tài chính (Công nợ KH, Lương/Phạt lái xe, Chi phí) đều được ghi nhận vào một bảng Sổ cái bất biến. (Gồm các trường: ID, date, txn_type, txn_id, receipt_id, entity_type, entity_id, credit, debit, balance, note).
* Mỗi chuyến `Đã chốt` tạo 1 dòng ghi nợ trên Sổ cái khách hàng với `txn_id` là ID của chuyến đi.
* **Ghi nhận thanh toán:** Thanh toán được khớp (match) với từng chuyến đi cụ thể. Một khoản chuyển khoản ngân hàng (có `receipt_id` chung) sẽ tạo ra nhiều dòng ghi có (mỗi dòng tương ứng với số tiền trả cho một `txn_id` cụ thể). Hệ thống cho phép thanh toán một phần (partial payment).
* **Tính nợ động:** Số dư nợ hiện tại là cột `balance` ở dòng cuối cùng của thực thể đó. Tình trạng nợ của từng chuyến đi được tính bằng tổng debit trừ tổng credit của chuyến đó.
* Kế toán xuất sao kê cho khách hàng ghi tổng công nợ. Cảnh báo: Quá hạn 30/60/90 ngày.
* **Làm mới tức thời:** Số liệu công nợ phải thu (số dư, tuổi nợ, KPI tổng hợp) phải được làm mới **tức thời** mỗi khi có ghi nhận ledger mới — không cần người dùng tải lại trang. Cơ chế: server push invalidation + client `queryClient.invalidateQueries` cho các query liên quan đến công nợ.
* **Giấy báo nợ (Debit Note):** Bản xuất ra PDF/Excel gửi cho khách hàng, bao gồm Cước vận tải + Chi phí dịch vụ đi kèm. Tùy chọn xuất theo tháng (MONTHLY) hoặc theo từng lô (PER_BATCH) cấu hình theo khách hàng.
* **Đối trừ công nợ (Debt Netting):** Đối với khách hàng đồng thời là đối tác/nhà cung cấp. Kế toán lập Bảng đối chiếu công nợ hàng tháng, lấy min(Công nợ phải thu, Công nợ phải trả) để cấn trừ (Full offset). Giám đốc duyệt mới ghi nhận vào Sổ cái.

### 4.11 Kỷ luật (Penalty)

* Kế toán ghi nhận thủ công các vi phạm.
* Hệ thống cung cấp **danh mục lý do vi phạm** có sẵn (VD: "Thiếu hóa đơn dầu - 100.000đ", "Vi phạm an toàn giao thông - 500.000đ").
* Kế toán có thể nhập lý do mới; hệ thống kiểm tra trùng lặp khi nhập.
* Phạt kỷ luật là khoản **thu nhập khác** của công ty, đồng thời là khoản trừ lương lái xe.

### 4.12 Container, Seal & Ảnh xác nhận chuyến

* **Theo dõi container theo chuyến:** Mỗi chuyến đi có thể chở nhiều container (VD: 2×20FT hoặc 1×40FT). Mỗi container được ghi nhận riêng biệt với 3 thông tin: **Loại container** (từ danh mục cấu hình), **Số container** và **Số seal**.
* **Nhập liệu kép (text + ảnh):** Số container và số seal được nhập **bằng text** (nhập tay) **và/hoặc** upload ảnh. Kế toán, Giám đốc và Giao nhận đều có thể nhập.
* **Loại container (Container Type):** Danh mục cấu hình do người dùng tự khai báo (VD: 20'DC, 20'OT, 20'RF, 40'DC, 40'HC...). Mỗi container trong chuyến chọn loại từ danh mục này. Khác với loại rơ-mooc (20FT/40FT) — một rơ-mooc 40FT có thể chở 1 container 40'HC hoặc 2 container 20'DC.
* **Ảnh xác nhận:** Upload ảnh khi hoàn thành chuyến là **khuyến khích, không bắt buộc** — phần mềm **không** chặn hoàn thành/chốt chuyến nếu thiếu ảnh. Kế toán thực hiện upload khi có. *(Pete 2026-06: permissive, không hard gate — thay cho yêu cầu "tất cả đều yêu cầu chụp ảnh" trước đó)*
* Trường `requires_photos` trên bảng **Loại hàng hóa** vẫn giữ để cấu hình mức độ khuyến nghị theo từng loại hàng trong tương lai.
* **Chuyến chè (Special Cargo: Tea):** Đặc biệt **khuyến nghị** ảnh Container **và** Seal (niêm phong). Không điều chỉnh thêm tiền đi đường. Không bắt buộc.

### 4.13 Đội xe & Nhân sự

* 1 xe có thể có nhiều lái xe được phân công.
* **Rơ-mooc ghép cặp cố định:** Mỗi đầu kéo ghép với một rơ-mooc cố định — biển số và loại rơ-mooc (20FT/40FT) lưu trực tiếp trên bảng xe đầu kéo. Không có bảng rơ-mooc riêng. Khi tạo chuyến, hệ thống tự tra loại rơ-mooc từ xe được chọn để tính tiền đi đường chuẩn. *(Pete xác nhận 31/5)*
* **Đa container:** 1 chuyến xe có thể chở nhiều container (VD: 2 container 20ft hoặc 1 container 40ft). Mỗi container có **loại riêng** (20'DC, 40'HC...), **số container** và **số seal** — không phải chỉ đếm số lượng. *(Pete xác nhận: "có thể 1 chuyến chạy 2 cont 20'")*

### 4.14 Loại Container & Cảng/Bãi (Container Types & Ports/Depots)

* **Loại container:** Danh mục **cấu hình được** do người dùng tự khai báo trong Cấu hình hệ thống. Mỗi loại có: mã (VD: `20DC`, `40HC`), tên hiển thị (VD: 20'DC, 40'HC), kích thước nhóm (20FT/40FT) dùng để validate phù hợp với rơ-mooc, và trạng thái. Dữ liệu mẫu: 20'DC (Dry Container), 20'OT (Open Top), 20'RF (Reefer), 40'DC, 40'HC (High Cube)...
* **Cảng / Bãi:** Danh mục cấu hình các cảng và bãi (chủ yếu tại Hải Phòng). Mỗi cảng/bãi có: tên (VD: Cảng Đình Vũ, Cảng Nam Hải, Bãi ICD NL), địa chỉ, ghi chú, và trạng thái. Danh mục có thể do người dùng tự khai báo hoặc cập nhật.
* **Sử dụng trong chặng (Trip Legs):** Khi kế toán nhập chặng chi tiết (điểm đi, điểm đến), trường origin/destination hỗ trợ **combobox** — dropdown chọn từ danh mục Cảng/Bãi, đồng thời cho phép nhập text tự do nếu điểm chưa có trong danh mục. Mục mới nhập sẽ được gợi ý thêm vào danh mục.

### 4.15 Chi phí vận hành, Nhà cung cấp & Công nợ phải trả

* **Phạm vi:** ghi nhận chi phí vận hành ngoài chuyến đi — sửa chữa, phụ tùng, vật tư, bảo hiểm, đăng kiểm, phí đường bộ — gắn với Nhà cung cấp và (tùy chọn) một xe.
* **Nhà cung cấp (NCC):** danh mục mọi bên nhận tiền (gara, trạm lốp, cửa hàng phụ tùng, công ty bảo hiểm, trung tâm đăng kiểm, đơn vị thu phí đường bộ). **Bắt buộc** trên mọi khoản chi phí. Không có trường "phân loại" (phân loại nằm ở hạng mục từng khoản chi).
* **Hạng mục chi phí:** danh mục **cấu hình được** (người dùng tự thêm). Mỗi hạng mục là **một lần** hoặc **định kỳ** (`is_renewable`); hạng mục định kỳ có `reminder_lead_days` (mặc định 30 ngày).
* **Chi phí phát sinh:** một khoản chi = một hạng mục + một số tiền. Gắn NCC (bắt buộc) + một **xe đầu kéo** (tùy chọn, có thể để trống → chi phí chung). Khi chọn xe, kế toán đánh dấu chi phí thuộc **đầu kéo** hay **rơ-mooc** qua trường `vehicle_component` (`'TRUCK'` | `'TRAILER'`, mặc định `'TRUCK'`). Chi phí rơ-mooc vẫn gộp vào lãi gộp của đầu kéo ghép cặp — phân loại chỉ dùng cho báo cáo phân tách (sửa chữa, đăng kiểm, thay lốp). Đính được ảnh hóa đơn. Hóa đơn nhiều khoản → ghi nhận nhiều lần. *(Pete xác nhận 1/6: "chi phí sửa chữa và đăng kiểm, thay lốp nên tách theo rơ-mooc và đầu kéo")*
* **Trạng thái thanh toán:**
    * **Trả ngay (PAID):** chỉ ghi cho P&L, không phát sinh công nợ (hệ thống không có tài khoản tiền mặt).
    * **Ghi nợ (UNPAID):** tạo bản ghi Sổ cái `entity_type='VENDOR'` (credit = số tiền) → phát sinh **công nợ phải trả**.
* **Hạng mục định kỳ:** phiếu ghi `valid_from`/`valid_to`. Dashboard **nhắc gia hạn** khi `hôm nay >= valid_to − reminder_lead_days` hoặc đã quá hạn (dùng `valid_to` mới nhất theo từng xe × hạng mục). Gia hạn = tạo phiếu mới hạn xa hơn. **Không phân bổ** — ghi toàn bộ vào tháng thanh toán.
* **Công nợ phải trả (Accounts Payable):** mirror công nợ phải thu trên `entity_type='VENDOR'`. Quy ước dấu giống lái xe: `balance = balance trước + Credit − Debit`. **Tuổi nợ ngược chiều phải thu:** chi phí là Credit (tính tuổi), thanh toán là Debit (áp FIFO).
* **Thanh toán công nợ:** kế toán nhập tổng tiền trả cho một NCC → `VENDOR_PAYMENT` (debit) giảm số dư. **Khớp FIFO theo tổng số dư, không khớp từng khoản chi.**
* **Sửa/Xóa phiếu đã ghi nợ:** dùng bút toán **ADJUSTMENT** bù trừ (Sổ cái append-only); dòng phiếu soft-delete.
* **Bảng `expenses`** là bảng vận hành mới (không phải bảng cấu hình), kèm bảng `expense_photos` cho ảnh hóa đơn.
* **Phân loại Nhà cung cấp theo bản chất công nợ:**
    - `FUEL_SUPPLIER` — NCC nhiên liệu (gắn cờ `is_fuel_supplier`). Công nợ phát sinh tự động khi chuyến LOCKED (xem §4.3.2).
    - `EXTERNAL_CARRIER` — Đối tác vận tải thuê ngoài. Công nợ ghi nhận khi chuyến EXTERNAL LOCKED.
    - `COMMISSION_PAYABLE` — Hoa hồng phải trả (môi giới/chiết khấu). Phân loại chi tiết theo `commission_type`:
        - `PARTNER_REFERRAL` — Hoa hồng trả cho cá nhân/tổ chức môi giới giới thiệu khách. Hạch toán là **chi phí bán hàng**, cộng vào P&L.
        - `CUSTOMER_REBATE` — Chiết khấu/hoàn tiền trả cho khách hàng theo doanh số. Hạch toán là **giảm doanh thu** (phát sinh công nợ phải trả cho khách hàng) — khác với `customerCommission` (đã trừ ngay khi nhập chuyến). `CUSTOMER_REBATE` là khoản trả sau.
    - `OTHER_VENDOR` — NCC một lần (sửa chữa, phụ tùng, vật tư, bảo hiểm, đăng kiểm, phí đường bộ) — phát sinh khi phiếu UNPAID.

    Báo cáo công nợ phải trả (`/payables`) cung cấp filter chip theo các loại trên.
* **Back-dating chi phí:** Mỗi phiếu chi phí có 2 mốc thời gian:
    - `expense_date` (Ngày phát sinh) — ngày thực tế phát sinh chi phí tại NCC. Mặc định = ngày nhập.
    - `recorded_at` (Ngày nhập) — ngày hệ thống ghi nhận (auto).

    **Ràng buộc validation:** `expense_date <= today()`. Hệ thống **không cho phép** nhập `expense_date` ở tương lai — tránh gõ nhầm năm và đảm bảo dòng tiền thực tế. Cho phép chỉnh `expense_date` về mọi ngày trong quá khứ + hôm nay (back-dating cho trường hợp NCC báo về sau).
* **Số dư tạm ứng & hoàn ứng:** Đối với tạm ứng giao nhận (forwarder advances), hệ thống hiển thị:
    - **Số dư tạm ứng hiện tại** = Σ tạm ứng đã duyệt − Σ tất toán đã duyệt.
    - **Chi tiết hoàn ứng theo từng container/lô** — cho phép kế toán/giám đốc duyệt các phiếu yêu cầu hoàn ứng, xem phiếu đã duyệt/đã thanh toán, còn dư bao nhiêu.

### 4.16 Quản lý lốp xe (Tire management)

Mỗi đầu kéo có tối đa 22 lốp + 2 lốp dự phòng, mỗi lốp có **số series riêng biệt** để nhận diện. Bảng `tires` (id, truck_id, serial_no [unique], size, position, installed_at, removed_at, supplier_id, warranty_until, status). Theo dõi: lốp chạy được bao nhiêu ngày, mua của NCC nào, còn bảo hành không. Cảnh báo khi lốp sắp tới hạn bảo hành / hết hạn.

### 4.17 Cảnh báo đội xe (Vehicle alerts)

Hệ thống nhắc trước khi tới hạn các mốc vận hành của xe:
- Thay dầu (mặc định nhắc trước **7 ngày**).
- Đăng kiểm (mặc định **30 ngày**).
- Bảo hiểm TNDS (mặc định **30 ngày**).
- Phí đường bộ (mặc định **15 ngày**).

Mỗi loại cảnh báo có `lead_days` cấu hình được (override mặc định). Cảnh báo hiển thị trên Dashboard quản lý, trang Đội xe, và trang cá nhân lái xe (chỉ phương tiện đang vận hành).

Điều kiện kích hoạt: `hôm nay >= hạn_cuối − lead_days` HOẶC đã quá hạn. Dùng `hạn_cuối` mới nhất theo từng (xe × loại cảnh báo).

### 4.18 Hướng dẫn cho lái xe (Trip instructions for drivers)

Quản lý nhập hướng dẫn riêng cho từng chuyến: tên + SĐT người liên hệ, lưu ý đặc biệt (hun trùng, cân hàng, kẹp seal tạm, lấy mẫu kiểm dịch…). Lái xe chỉ đọc, không sửa.

Bảng `trip_instructions` (id, trip_id, contact_name, contact_phone, notes, manager_id, created_at). Quyền: Quản lý tạo/sửa; Lái xe/Kế toán chỉ đọc trên chi tiết chuyến.

---

## 5. DANH SÁCH USER STORIES (THEO MODULE)

### MODULE 1: NHẬN ĐƠN HÀNG & PHÂN XE (ORDER & DISPATCH)
1. **[Quản lý]** Tôi muốn tạo chuyến đi mới với: khách hàng, tuyến đường, xe đầu kéo, lái xe, loại hàng hóa, ngày xuất phát → trạng thái "Mới tạo". Loại rơ-mooc tự động lấy từ xe được chọn.
2. **[Quản lý]** Tôi muốn chuyển trạng thái chuyến đi (Mới tạo → Đang chạy → Hoàn thành → Đã chốt).
4. **[Lái xe]** Tôi muốn xem lịch trình chuyến đi của mình trên điện thoại (chỉ xem).
5. **[Lái xe]** Tôi muốn xem số dầu được cấp cho chuyến đi trên điện thoại (chỉ xem).
6. **[Lái xe]** Tôi muốn danh sách chuyến của mình hiển thị **số container** và **tên khách hàng** để dễ nhận diện.
7. **[Quản lý]** Tôi muốn nhập **hướng dẫn riêng cho từng chuyến** (tên + SĐT người liên hệ, lưu ý đặc biệt) để lái xe xem khi cần.
8. **[Lái xe]** Tôi muốn xem **hướng dẫn** của quản lý cho chuyến của mình (chỉ đọc).

### MODULE 2: GHI NHẬN CHUYẾN ĐI & CHI PHÍ
1. **[Kế toán]** Tôi muốn nhập số liệu thực tế cho chuyến đi: km, số lít dầu, loại tải (hàng/vỏ), điều chỉnh vé đường, số trạm, lương chuyến quy đổi, doanh thu.
2. **[Kế toán]** Tôi muốn hệ thống tự động tính: chi phí nhiên liệu (lít × đơn giá), tiền đi đường, tổng chi phí, lợi nhuận gộp.
3. **[Kế toán/Giám đốc/Giao nhận]** Tôi muốn nhập danh sách container cho chuyến: loại container (từ danh mục), số container (nhập text), số seal (nhập text). Có thể nhập ở cả bước tạo chuyến và bước hoàn thành.
4. **[Kế toán]** Tôi muốn upload ảnh container/seal đối với chuyến chở chè khi đóng chuyến. Bên cạnh ảnh, có thể nhập số container/seal bằng text.
5. **[Kế toán]** Tôi muốn thêm ghi chú/diễn giải cho chuyến đi.
6. **[Kế toán]** Tôi muốn nhập **hoa hồng chi khách hàng** trên form chuyến, để hệ thống tính **doanh thu thực tế = giá cước (chưa VAT) − hoa hồng**. Hoa hồng ghi nhận ngay khi nhập, không đợi khóa chuyến. *(Mới — Pete xác nhận 11/6)*
7. **[Kế toán]** Tôi muốn hệ thống **tự điền lương chuyến quy đổi** khi nhập liệu chuyến đi (chọn lái xe + nhập ngày đi/về), theo công thức `lươngCB / 26 × số ngày chuyến`. BHXH được hạch toán riêng. Tôi có thể sửa lại hoặc điều chỉnh số ngày tính lương. *(Mới — Pete xác nhận 11/6)*

### MODULE 3: KIỂM SOÁT NHIÊN LIỆU & TIỀN ĐI ĐƯỜNG
1. **[Hệ thống]** Tự động tính TTBQ (liters/km × 100) và hiển thị trên chi tiết chuyến đi. Đối chiếu định mức và cảnh báo hoãn sang giai đoạn sau.

### MODULE 4: THEO DÕI DOANH THU & CHI PHÍ
1. **[Quản lý]** Tôi muốn xem Dashboard tổng hợp hiển thị doanh thu, chi phí, và lợi nhuận gộp của tất cả xe theo thời gian thực.
2. **[Quản lý]** Tôi muốn xem biểu đồ xu hướng doanh thu theo tháng, cơ cấu chi phí (pie chart) và top tuyến đường sinh lời.

### MODULE 5: QUẢN LÝ CÔNG NỢ PHẢI THU
1. **[Kế toán/Quản lý]** Tôi muốn xem danh sách khách hàng cùng số dư và tuổi nợ mã hóa màu (Đỏ/Vàng/Xanh).
2. **[Kế toán/Quản lý]** Tôi muốn nhận cảnh báo tự động khi khách hàng quá hạn 30/60/90 ngày.
3. **[Kế toán]** Tôi muốn ghi nhận thanh toán (toàn bộ hoặc một phần) vào tổng số dư của khách hàng. Hệ thống gợi ý FIFO (chuyến cũ nhất trước), nhưng tôi có thể chọn chuyến cụ thể để thanh toán.
4. **[Kế toán]** Tôi muốn xuất sao kê công nợ cho khách hàng.
5. **[Kế toán/Quản lý]** Tôi muốn lọc/xuất **báo cáo công nợ phải thu chi tiết** theo từng khách hàng và **khoảng thời gian** tùy chọn.
6. **[Quản lý/Kế toán]** Tôi muốn trang chi tiết khách hàng hiển thị **công nợ phải thu hiện tại** (số dư + tuổi nợ) ngay tại header, không phải vào trang công nợ riêng.

### MODULE 6: PHÂN CHIA LỢI NHUẬN
1. **[Quản lý]** Tôi muốn hệ thống tự động tính lợi nhuận ròng (= Tổng LN gộp - Phí quản lý + Thu nhập khác) và phân bổ theo tỷ lệ vốn góp.
2. **[Quản lý]** Tôi muốn cấu hình cổ đông: thêm/đổi/rút cổ phần và điều chỉnh tỷ lệ.
3. **[Quản lý]** Tôi muốn cấu hình **tỷ lệ góp vốn theo từng xe** và xem **phân chia lợi nhuận theo xe** (cổ tức nhà đầu tư góp vốn vào từng xe riêng lẻ, tách biệt với cổ tức tổng công ty).

### MODULE 7: KỶ LUẬT
1. **[Kế toán]** Tôi muốn ghi nhận vi phạm dựa trên danh mục có sẵn hoặc nhập lý do mới (hệ thống kiểm tra trùng lặp) và ghi số tiền phạt.
2. **[Kế toán]** Tôi muốn xem tổng hợp phạt kỷ luật theo lái xe, theo tháng.
3. **[Lái xe]** Tôi muốn xem số lần vi phạm và mức phạt tích lũy trên điện thoại (chỉ xem).

### MODULE 8: CẤU HÌNH HỆ THỐNG
1. **[Kế toán/Quản lý]** Tôi muốn quản lý danh mục: Khách hàng, Tuyến đường, Xe đầu kéo, Lái xe.
2. **[Kế toán]** Tôi muốn cấu hình bảng giá theo Khách hàng × Tuyến đường.
3. **[Kế toán]** Tôi muốn cấu hình tiền đi đường chuẩn theo Tuyến đường × Loại rơ-mooc.
4. **[Kế toán]** Tôi muốn cấu hình đơn giá nhiên liệu.
5. **[Kế toán]** Tôi muốn cấu hình định mức nhiên liệu theo tuyến đèo đốc.
6. **[Kế toán]** Tôi muốn nhập phí quản lý hàng tháng.
7. **[Kế toán]** Tôi muốn quản lý danh mục lý do vi phạm kỷ luật.
8. **[Kế toán/Quản lý]** Tôi muốn quản lý danh mục Nhà cung cấp và Hạng mục chi phí (một lần/định kỳ, số ngày nhắc gia hạn).
9. **[Kế toán/Quản lý]** Tôi muốn quản lý danh mục Loại container (thêm/sửa/xóa: 20'DC, 20'OT, 20'RF, 40'DC, 40'HC...). Mỗi loại có mã, tên hiển thị, kích thước nhóm (20FT/40FT) và trạng thái.
10. **[Kế toán/Quản lý]** Tôi muốn quản lý danh mục Cảng/Bãi (thêm/sửa/xóa). Khi nhập chặng (trip legs), có thể chọn từ dropdown hoặc nhập mới — mục mới được gợi ý thêm vào danh mục.
11. **[Kế toán]** Tôi muốn xem lịch sử thay đổi đơn giá nhiên liệu theo thời gian, và khi nhập liệu chuyến hệ thống đề xuất giá hiệu lực theo ngày xuất phát.

### MODULE 9: CHI PHÍ VẬN HÀNH & CÔNG NỢ PHẢI TRẢ
1. **[Kế toán]** Tôi muốn ghi nhận chi phí phát sinh (sửa chữa, phụ tùng, vật tư, bảo hiểm, đăng kiểm, phí đường bộ), gắn Nhà cung cấp và (tùy chọn) một xe, đánh dấu chi phí thuộc đầu kéo hay rơ-mooc (`vehicle_component`), đính ảnh hóa đơn.
2. **[Kế toán]** Tôi muốn chọn trạng thái Trả ngay hoặc Ghi nợ; phiếu Ghi nợ tự phát sinh công nợ phải trả cho NCC.
3. **[Kế toán/Quản lý]** Tôi muốn xem danh sách công nợ phải trả theo NCC kèm tuổi nợ (0–30/31–60/61–90/90+) và xuất sao kê NCC.
4. **[Kế toán]** Tôi muốn ghi nhận thanh toán cho NCC (giảm tổng số dư, FIFO).
5. **[Quản lý]** Tôi muốn lợi nhuận gộp theo xe đã trừ chi phí bảo dưỡng của xe đó (bao gồm chi phí rơ-mooc ghép cặp), và lợi nhuận ròng đã trừ chi phí chung (không gắn xe). Báo cáo phân tách chi phí đầu kéo vs rơ-mooc.
6. **[Quản lý/Kế toán]** Tôi muốn Dashboard nhắc khi bảo hiểm/đăng kiểm/phí đường bộ của xe sắp tới hạn hoặc đã quá hạn.
7. **[Kế toán]** Tôi muốn ghi nhận **hoa hồng phải trả** cho đối tác môi giới (`PARTNER_REFERRAL`, hạch toán chi phí bán hàng) hoặc cho khách hàng (`CUSTOMER_REBATE`, hạch toán giảm doanh thu). Hệ thống phát sinh công nợ phải trả tương ứng.
8. **[Kế toán]** Tôi muốn nhập **ngày phát sinh chi phí** (`expense_date`) khác ngày nhập khi NCC báo về sau. Hệ thống chỉ cho phép ngày trong quá khứ hoặc hôm nay, không cho tương lai.
9. **[Quản lý/Kế toán]** Tôi muốn xem **số dư tạm ứng hiện tại** của từng giao nhận, kèm chi tiết các phiếu yêu cầu hoàn ứng / đã duyệt / đã thanh toán.
10. **[Kế toán]** Tôi muốn duyệt **phiếu hoàn ứng** theo từng container/lô của chuyến, và xem lịch sử duyệt/chi trả chi tiết.
11. **[Quản lý/Kế toán]** Tôi muốn Dashboard / trang Đội xe **cảnh báo** khi thay dầu, đăng kiểm, bảo hiểm TNDS, phí đường bộ của xe sắp tới hạn hoặc đã quá hạn (lead-days cấu hình được).
12. **[Quản lý/Kế toán]** Tôi muốn trang chi tiết nhà cung cấp hiển thị **công nợ phải trả hiện tại** (số dư + tuổi nợ) ngay tại header, không phải vào trang công nợ phải trả riêng.

### MODULE 10: LƯƠNG & CHẤM CÔNG LÁI XE
1. **[Kế toán]** Tôi muốn xem lịch chấm công tháng của từng lái xe — các ngày đi chuyến (`TRIP_DAY`) được hệ thống tự điền; tôi chỉ cần click vào ngày còn lại để gán `STANDBY` (chờ việc/sửa xe) hoặc `PERSONAL_LEAVE` (nghỉ không lương).
2. **[Kế toán]** Tôi muốn hệ thống tự tính lương thực nhận tháng: lương cứng + tổng lương chuyến + lương bổ sung (ngày chờ việc) − khấu trừ nghỉ việc riêng + điều chỉnh công thiếu/thừa − phạt kỷ luật. Số ngày công chuẩn tính theo số ngày làm việc thực tế của tháng (không cố định 26).
3. **[Kế toán]** Tôi muốn xác nhận kỳ lương (CONFIRMED) — sau đó hệ thống tự hạch toán chi phí chờ việc (`standby_cost`) vào chi phí chung trong báo cáo lãi lỗ.
4. **[Kế toán]** Tôi muốn hệ thống **tự điền lương chuyến quy đổi** trên form chuyến (`driver_salary`) theo công thức `lươngCB / 26 × trip_wage_days` (BHXH hạch toán riêng, KHÔNG vào công thức). Tôi có thể sửa lại hoặc điều chỉnh số ngày. Số ngày công chuẩn biến động theo tháng chỉ áp dụng cho chấm công/lương tháng, không áp dụng cho phân bổ lương chuyến.
5. **[Quản lý]** Tôi muốn xem tổng kết lương tất cả lái xe theo tháng.
6. **[Lái xe]** Tôi muốn xem lịch chấm công và thu nhập của mình (lương cứng, lương chuyến, lương bổ sung, khấu trừ nghỉ việc riêng, điều chỉnh, phạt, lương thực nhận) trên điện thoại. Chỉ xem, không sửa.
7. **[Kế toán]** Tôi muốn cấu hình **BHXH/BHYT** cho từng lái xe (trường `social_insurance` trên trang cấu hình Lái xe) để hạch toán riêng chi phí bảo hiểm; khoản này không tham gia `daily_rate` hoặc lương chuyến quy đổi. *(Mới)*
8. **[Kế toán]** Tôi muốn xem **lương bổ sung** (từ ngày STANDBY do lỗi công ty) và **khấu trừ nghỉ việc riêng** (vượt 4 ngày Chủ nhật miễn trừ) trên bảng tổng kết lương tháng. *(Mới)*

### MODULE 11: QUẢN LÝ LỐP XE
1. **[Quản lý/Kế toán]** Tôi muốn quản lý **lốp xe** cho từng đầu kéo: thêm lốp mới (số series, kích cỡ, vị trí, ngày lắp), sửa, xóa (soft delete), xem lịch sử thay lốp.
2. **[Quản lý/Kế toán]** Tôi muốn xem **danh sách lốp** theo xe dạng grid, biết lốp nào đang lắp, lốp nào dự phòng, lốp nào đã tháo.
3. **[Quản lý/Kế toán]** Tôi muốn nhận **cảnh báo bảo hành** khi lốp sắp tới hạn bảo hành hoặc đã hết hạn (lead-days cấu hình được).
4. **[Kế toán]** Tôi muốn mỗi lốp gắn **NCC mua** để biết lốp mua từ đâu và còn bảo hành không.

---

## 6. BẢNG CẤU HÌNH HỆ THỐNG (CONFIGURATION TABLES)

| # | Bảng | Mô tả | Dữ liệu mẫu |
| :--- | :--- | :--- | :--- |
| 1 | **Khách hàng** | Tên, liên hệ, thông tin công nợ, phương thức Giấy báo nợ, Đối tác liên kết | 44+ khách hàng |
| 2 | **Tuyến đường** | Tên tuyến, khoảng cách, định mức đèo đốc (nếu có) | 38+ tuyến |
| 3 | **Bảng giá** | Giá cố định theo Khách hàng × Tuyến đường | ~44×38 = 1.672 dòng |
| 4 | **Xe đầu kéo** | Biển số, biển số rơ-mooc ghép cặp, loại rơ-mooc (20FT/40FT), trạng thái | 4 xe (rơ-mooc không có bảng riêng) |
| 5 | **Lái xe** | Tên, xe được phân công, liên hệ, lương cơ bản | Nhiều lái xe/xe |
| 6 | **Loại hàng hóa** | Tên loại, có yêu cầu upload ảnh không | VD: Chè (yêu cầu ảnh) |
| 7 | **Tiền đi đường chuẩn** | Tiền chuẩn theo Tuyến đường × Loại rơ-mooc (20FT/40FT) | ~38×2 = 76 dòng |
| 8 | **Định mức nhiên liệu** | Định mức hàng/vỏ (cấu hình được), bổ sung/chuyến, đèo đốc theo tuyến | Cấu hình + theo tuyến |
| 9 | **Đơn giá nhiên liệu** | Đơn giá 1 lít dầu (hiện tại 18.730 VNĐ), có lịch sử giá theo ngày hiệu lực | 1 giá hiện tại + bảng lịch sử |
| 10 | **Cổ đông & Tỷ lệ vốn** | Tên, tỷ lệ %, ngày hiệu lực | Ông Thương 29.55%, Ông Phụng 70.45% |
| 11 | **Danh mục kỷ luật** | Lý do vi phạm + số tiền phạt mặc định | VD: "Thiếu hóa đơn dầu - 100.000đ" |
| 12 | **Sổ cái (Ledger)** | Ghi nhận tập trung toàn bộ giao dịch (Công nợ KH, Lương/Phạt, Thanh toán, Công nợ NCC) | Các cột: ID, date, txn_type, credit, debit, balance |
| 13 | **Nhà cung cấp** | Tên, người liên hệ, SĐT, mã số thuế, ghi chú, trạng thái, Khách hàng liên kết | Gara, trạm lốp, phụ tùng, bảo hiểm, đăng kiểm... |
| 14 | **Hạng mục chi phí** | Tên, một lần/định kỳ (is_renewable), số ngày nhắc trước (mặc định 30) | Sửa chữa, Phụ tùng, Vật tư, Bảo hiểm, Đăng kiểm, Phí đường bộ |
| 15 | **Loại container** | Mã loại, tên hiển thị, kích thước nhóm (20FT/40FT), trạng thái | 20'DC, 20'OT, 20'RF, 40'DC, 40'HC... |
| 16 | **Cảng / Bãi** | Tên, địa chỉ, ghi chú, trạng thái | Cảng Đình Vũ, Cảng Nam Hải, Bãi ICD NL... |
| 17 | **Lịch sử giá nhiên liệu** | Đơn giá, ngày hiệu lực, người thay đổi, ghi chú — append-only | Tự ghi khi cập nhật đơn giá cấu hình |
| 18 | **Danh mục Chi phí Giao nhận** | Cấu hình các loại phí tại cảng, cờ mặc định xuất hóa đơn, cờ mặc định tính lãi | Nâng hạ, Cân xe, Kiểm hóa... |
| 19 | **Ngày công lái xe (`driver_work_days`)** | Mỗi dòng = 1 ngày của 1 lái xe. Trạng thái: `TRIP_DAY` (tự động) / `STANDBY` / `PERSONAL_LEAVE` / `WEEKLY_OFF`. Liên kết `trip_id` nếu TRIP_DAY. | Tự động + kế toán chấm |
| 20 | **Kỳ lương (`salary_periods`)** | Tổng kết lương tháng: ngày công chuẩn, daily_rate, trip_days, standby_days, total_trip_salary, adjustment, penalties, BHXH, net_salary, standby_cost. Status: DRAFT → CONFIRMED | 1 bản ghi / lái xe / tháng |
| 21 | **Lốp xe (`tires`)** | id, truck_id, serial_no (unique), size, position, installed_at, removed_at, supplier_id, warranty_until, status | Mỗi đầu kéo 22 lốp + 2 dự phòng |
| 22 | **Cảnh báo đội xe (`vehicle_alerts`)** | alert_type (`OIL_CHANGE` / `INSPECTION` / `INSURANCE` / `ROAD_FEE`), truck_id, valid_to, lead_days, last_checked_at | 4 loại × 4 xe |
| 23 | **Hướng dẫn chuyến (`trip_instructions`)** | id, trip_id, contact_name, contact_phone, notes, manager_id, created_at | 0–n bản ghi/chuyến |
| 24 | **Phân chia lợi nhuận theo xe (`truck_profit_distribution`)** | id, truck_id, partner_id (nullable), period, gross_profit, net_profit, share_pct, amount, created_at, status (`DRAFT` / `CONFIRMED`) | 1–n bản ghi/(xe × kỳ) |

---

## 7. CÁC TRƯỜNG DỮ LIỆU CHUYẾN ĐI (TRIP DATA FIELDS)

### Pha 1 — Quản lý tạo chuyến (trạng thái: Mới tạo)

| Trường | Loại | Bắt buộc | Ghi chú |
| :--- | :--- | :--- | :--- |
| Khách hàng | Select | Có | Từ danh mục |
| Tuyến đường | Select | Có | Từ danh mục |
| VAT Rate | Number | Có | Tỷ lệ thuế VAT (VD: 0.08) cho doanh thu vận tải |
| Chế độ điều xe | Toggle | Có | Xe nhà (OWN) hoặc Xe ngoài (EXTERNAL) |
| Xe đầu kéo | Select | Có (OWN) | Từ danh mục; loại rơ-mooc (20FT/40FT) tự động tra |
| Lái xe | Select | Có (OWN) | Theo xe được phân công |
| Đối tác vận chuyển | Select | Có (EXT) | Nhập NCC (dành cho Xe ngoài) |
| Giá cước thuê ngoài | Number | Có (EXT) | Giá thuê xe ngoài gồm VAT |
| Biển số xe ngoài | Text | Có (EXT) | |
| Tên lái xe ngoài | Text | Có (EXT) | |
| SĐT lái xe ngoài | Text | Có (EXT) | |
| Loại hàng hóa | Select | Có | Từ danh mục (VD: Chè, Container rỗng, Hàng tổng hợp...) |
| Ngày xuất phát | Date | Có | |
| **Các container** | Dynamic rows | Không | Mỗi dòng: Loại container (dropdown từ danh mục — VD: 20'DC, 40'HC), Số container (text nhập tay), Số seal (text nhập tay). Có thể thêm/xóa dòng. VD: 2×20'DC hoặc 1×40'HC. |

### Pha 2 — Kế toán nhập số liệu thực tế (trạng thái: Hoàn thành)

| Trường | Loại | Bắt buộc | Ghi chú |
| :--- | :--- | :--- | :--- |
| **Các chặng (Trip Legs)** | Dynamic rows | Có | Kế toán nhập từng chặng: điểm đi, điểm đến (combobox — dropdown Cảng/Bãi hoặc nhập text tự do), số km, loại tải (hàng/vỏ). Hệ thống tự tính L dầu mỗi chặng theo định mức. |
| Chế độ nhập nhiên liệu | Select (AUTO / KHOÁN) | Có | AUTO: tổng L dầu từ các chặng. KHOÁN: nhập tổng L dầu bằng tay (ghi đè). |
| Dầu bổ sung | Number | Không | L dầu thêm do xe hỏng, đi sửa... (cộng thêm vào cả 2 chế độ) |
| Lý do bổ sung | Text | Không | Bắt buộc nếu có dầu bổ sung |
| **Đơn giá thực tế** | Number | Không | Giá thực mua tại trạm (VNĐ/lít). Để trống → dùng đơn giá cấu hình. Hệ thống đề xuất giá hiệu lực từ lịch sử theo ngày xuất phát. Chỉ nhập trước khi khóa chuyến. |
| Tiền vé (công ty) đã thanh toán | Number | Không | Mặc định 0 |
| Tổng tiền đi đường | Number | Không | Mặc định 0 |
| Số trạm | Number | Không | Mặc định 0, nhân với 55.000 |
| Chuyến về có hàng | Checkbox | Không | Nếu tích → + 300.000 VNĐ tiền đi đường |
| Lương chuyến quy đổi | Number | Có (OWN) | Hệ thống tự điền theo `baseSalary / 26 × tripWageDays` (BHXH riêng). Kế toán có thể sửa/ghi đè. Chỉ Xe nhà. *(Mới — auto-fill)* |
| Số ngày tính lương (trip_wage_days) | Number | Không | Hệ thống tự tính từ ngày đi → ngày về. Kế toán có thể điều chỉnh khi chuyến kéo dài xuyên Chủ nhật. *(Mới — auto-populate)* |
| Hoa hồng chi KH | Number | Không | Khoản chiết khấu/hoa hồng thương mại cho khách hàng theo từng chuyến. Ghi nhận ngay khi nhập (không đợi khóa). **Doanh thu thực tế = freightExVat − commission**. *(Mới)* |
| Doanh thu đóng/ trả hàng | Number | Có | Doanh thu tiêu chuẩn trả hàng/container, INCL VAT |
| Doanh thu kết hợp | Number | Không | Doanh thu bổ sung từ kết hợp trong chuyến (mặc định 0). |
| Ghi chú/diễn giải | Text | Không | |
| **Các container** | Dynamic rows | Không | Cập nhật/bổ sung: Loại container, Số container, Số seal. |
| **Chi phí DV đi kèm**| Dynamic rows | Không | Mỗi dòng: Loại phí, Giá mua, Giá bán, NCC, Hình thức chi (COMPANY_DIRECT/FORWARDER_ADVANCE), Số hóa đơn/ngày, Tờ khai. |
| Ảnh xác nhận hàng hóa | Upload + Text | Không (khuyến khích) | Upload ảnh **khuyến khích** (không bắt buộc, không chặn hoàn thành/chốt). Chuyến chè khuyến nghị ảnh Container **và** Seal. Bên cạnh ảnh, có thể nhập số container/seal bằng text. |

### Tự động tính toán (read-only)

| Trường | Công thức |
| :--- | :--- |
| Tổng L dầu | AUTO: tổng L từ các chặng + bổ sung. KHOÁN: L nhập tay + bổ sung. |
| Chi phí dầu | Tổng L dầu × Đơn giá thực tế (nếu có) hoặc Đơn giá cấu hình |
| Chênh lệch giá dầu | Chi phí dầu (thực tế) − (Tổng L dầu × Đơn giá cấu hình). Chỉ hiển thị khi có đơn giá thực tế |
| Tiền lái xe thực lĩnh | Tiền đi đường (net) + Lương chuyến quy đổi + Tiền lưu ca xe + Thưởng giao 2 điểm. (= `totalRoadAllowance` + `driverSalary` + `vehicleShiftAllowance` + `twoPointDeliveryBonus`) |
| Tổng chi phí (Xe nhà) | Chi phí dầu (incl. VAT) + Tiền đi đường (net) + Tiền vé BOT (số trạm × phí/trạm) + Tiền vé công ty (tollsDiscount) + Lương chuyến quy đổi + Thưởng giao 2 điểm + Lưu ca xe |
| Doanh thu thực tế ghi nhận | (Doanh thu đóng/ trả hàng + Doanh thu kết hợp) / (1 + VAT) − **Hoa hồng chi KH** = `recordedRevenue` |
| Hoa hồng chi KH | Kế toán nhập tay, trừ vào doanh thu thực tế |
| Lợi nhuận dịch vụ | Lãi từ dịch vụ đi kèm (Bán ra - Mua vào) — giá bán ra ex-VAT, giá mua vào incl. VAT |
| Lợi nhuận xe ngoài | Doanh thu ex-VAT − Chi phí xe ngoài (incl. VAT) |
| Lợi nhuận gộp | **Doanh thu thực tế ghi nhận** (`recordedRevenue` = freightExVat − commission) − **Tổng chi phí (incl. VAT)** + LN dịch vụ + LN xe ngoài |
