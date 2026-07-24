hiện tại phần lương của lái xe là do hệ thống tự tính hay nên quy đổi thành ngày rồi tính vào chi phí của chuyến vận tải luôn nhìn cho trực quan? Anh chưa rõ cách tính lương hoặc phân bổ theo chuyến phần mềm sẽ thực hiện như thế nào? Bởi nếu tính theo từng chuyến thì trong tháng có những ngày nghỉ sửa xe hoặc không có việc thì công ty cũng vẫn tính lương cho lái xe, như vậy việc ghi nhận lương quy đổi theo chuyến rồi cộng tổng các chuyến vào sẽ nhỏ hơn tiền lương thực tế phải trả của tháng
trên góc độ của nhà quản lý nhân lực tư vấn giúp cách giải quyết để cho phần mềm tính lương đúng cho lái xe:
•⁠  ⁠Lương tháng NePO trả cho lái xe là 10tr (chưa gồm BHXH, BHYT , configurable for each lai xe) tương đương với 26 ngày làm việc, nghỉ 4 chủ nhật. Nếu lái xe làm nhiều hơn thì tính thêm, nếu làm ít hơn do nguyên nhân từ lái xe xin nghỉ việc riêng thì trừ đi. Còn nếu số ngày làm việc ít hơn 26 ngày do nguyên nhân từ công ty: xe hỏng, không có việc thì công ty vẫn trả đủ lương
•⁠  ⁠⁠Lương chuyến có thể quy đổi = (10tr+ BHXK)/ 26 * số ngày làm của chuyến (thường là 1 hoặc 2 ngày hoặc hơn tuỳ trường hợp cung đường xa hoặc lưu ca xe), trong trường hợp này kế toán có thể tính rồi điền luôn vào chi phí lương theo chuyến. Tuy nhiên những ngày xe không chạy do lý do từ công ty (nhưng lái xe vẫn có lương) thì nếu phần mềm chỉ cộng các mục lương chuyến vào sẽ không tính được lương những ngày này
hiện tại chưa có phần nhập tiền lương quy đổi theo chuyến để hệ thống ghi nhận vào chi phí
[4/6/26, 6:55:49 PM] Hai Anh Bui: Bài toán tính lương của anh có fixed và ko thay đổi theo thời gian ko, hay chính sách sẽ điều chỉnh cho phù hợp từng thời điểm
[4/6/26, 6:58:11 PM] ~ Pete: về cơ bản sẽ là cố định như trên
[4/6/26, 7:01:41 PM] ~ Pete: @⁨Frank Nguyen⁩ nên anh đề xuất tiền lương sẽ nhập vào theo chuyến luôn, còn cuối tháng để tính ra báo cáo lỗ lãi của từng xe thì sẽ có lựa chọn để kế toán bổ sung thêm những ngày lương chưa thể hiện trên lương quy đổi theo chuyến và khi đó phần mềm sẽ cộng vào để tính ra tổng tiền lương phải trả lái xe

sau khi kế toán tính dầu thì có luôn lựa chọn nhà cung cấp nhiên liệu (bên anh có 2 đơn vị cung cấp) sau đó kế toán xuất ra bảng/ phiếu cấp nhiên liệu tương ứng với từng biển số xe và gửi cho nhà cung cấp. Phần mềm cũng căn cứ vào lựa chọn này để ghi nhận công nợ phải trả cho nhà cung cấp nhiên liệu. Lái xe qua phần mềm cũng biết được sau số dầu mình được cấp cho từng chuyến và ở nhà cung cấp nào

sau khi kế toán tính dầu thì có luôn lựa chọn nhà cung cấp nhiên liệu (bên anh có 2 đơn vị cung cấp) sau đó kế toán xuất ra bảng/ phiếu cấp nhiên liệu tương ứng với từng biển số xe và gửi cho nhà cung cấp. Phần mềm cũng căn cứ vào lựa chọn này để ghi nhận công nợ phải trả cho nhà cung cấp nhiên liệu. Lái xe qua phần mềm cũng biết được sau số dầu mình được cấp cho từng chuyến và ở nhà cung cấp nào

hiện tại chưa có phần nhập tiền lương quy đổi theo chuyến để hệ thống ghi nhận vào chi phí

lưu ý:
•⁠  ⁠Bổ sung phần nhập tiền lương quy đổi theo chuyến (hệ thống tự nhảy và cho lựa chọn nhập/ sửa lại bằng tay
•⁠  ⁠Điều chỉnh doanh thu để tính toán theo tập quán của NePO là chưa gồm thuế GTGT
•⁠  ⁠Chi phí đi đường cần ghi nhận chính là: " tổng tiền đi đường (đã gồm tiền vé)
•⁠  ⁠Các khoản chi phí khác như: Tiền kết hợp, tiền lưu ca xe, tiền trả hàng 2 điểm... hệ thống cũng cần ghi nhận ngay vào chi phí của chuyến đi


Chi phí tiền đi đường như em tính là không gồm tiền vé rồi, và tiền lương chưa có

xử lý cho anh nhé, làm sao tiền lương quy đổi theo chuyến có thể nhảy hoặc điền được luôn theo từng chuyến.
Và bổ sung cho anh mục "hoa hồng" chi cho khách hàng để nhập luôn cùng vào với tiền cước nhé, từ đó hệ thống sẽ tính tiền doanh thu ghi nhận thực tế = giá cước - thuế vat - hoa hồng chi khách hàng

TÀI LIỆU ĐẶC TẢ YÊU CẦU CHỨC NĂNG (SRS)HỆ THỐNG QUẢN LÝ VẬN TẢI (TMS) - NEPO CORP1. MODULE QUẢN LÝ DOANH THU & CHI PHÍ CHUYẾN ĐI (TRIP REVENUE & COST)1.1. Cấu trúc cấu thành Doanh thu thực tếHệ thống cần điều chỉnh cách ghi nhận doanh thu theo tập quán thương mại của NePO (Doanh thu không bao gồm thuế GTGT và phải trừ đi phần chiết khấu/hoa hồng thương mại).Công thức tính toán:$$\text{Doanh thu thực tế ghi nhận} = \text{Giá cước (chưa VAT)} - \text{Hoa hồng chi khách hàng}$$Yêu cầu giao diện & dữ liệu đầu vào (Màn hình tạo/duyệt chuyến):Giá cước: Trường nhập liệu bắt buộc (Giá trị mặc định nhập vào hệ thống quy ước là chưa bao gồm thuế GTGT).Thuế VAT: Trường hiển thị tách biệt (không cộng gộp vào doanh thu thực tế để tính lỗ lãi chuyến).Hoa hồng chi khách hàng: Trường nhập liệu mới (cho phép nhập số tiền hoa hồng chiết khấu trực tiếp cho đối tác/khách hàng theo từng chuyến).1.2. Cấu trúc cấu thành Chi phí chuyến điBổ sung và phân rã các hạng mục chi phí trực tiếp phát sinh theo từng chuyến để hệ thống ghi nhận tức thời vào giá vốn chuyến đi:Tổng tiền đi đường: Trường chi phí bắt buộc, cơ chế ghi nhận phải bao gồm cả tiền vé/phí cầu đường (ePass/VETC) và các chi phí dọc đường khác thành một tổng số duy nhất.Các khoản chi phí phát sinh bổ sung: Hệ thống cần cung cấp các trường nhập liệu độc lập để kế toán ghi nhận ngay khi phát sinh chuyến:Tiền kết hợp (Chi phí ghép hàng, kết hợp chuyến).Tiền lưu ca xe (Chi phí đền bù/hỗ trợ lái xe khi phải chờ đợi lưu đêm/lưu ca tại kho bãi).Tiền trả hàng nhiều điểm (Ví dụ: chi phí phát sinh khi giao nhận từ 2 điểm trở lên).Lương chuyến quy đổi (Chi tiết tại Mục 2).2. MODULE QUẢN LÝ LƯƠNG LÁI XE (DRIVER SALARY MANAGEMENT)2.1. Bài toán nghiệp vụ & Giải pháp phân bổLái xe hưởng cơ chế lương tháng cố định (Gốc 10.000.000 VNĐ + BHXH/BHYT cấu hình theo từng nhân sự cho 26 ngày công chuẩn). Tuy nhiên, để quản trị P&L (Lỗ/Lãi) trực quan theo từng đầu xe, chi phí lương cần được quy đổi và phân bổ động theo từng chuyến, đồng thời xử lý được phần chênh lệch do ngày nghỉ kỹ thuật (xe hỏng, không có việc) mà công ty vẫn chịu chi phí.2.2. Chi tiết luồng chức năng trên phần mềmBước 1: Ghi nhận Lương quy đổi theo chuyến (Màn hình chuyến đi)Hệ thống bổ sung trường Lương chuyến quy đổi trong phần chi phí chuyến.Cơ chế tính toán tự động (Gợi ý từ hệ thống):$$\text{Lương chuyến gợi ý} = \frac{\text{Lương cơ bản tháng} + \text{BHXH}}{26} \times \text{Số ngày thực hiện chuyến}$$Trong đó: Số ngày thực hiện chuyến được hệ thống tính toán dựa trên thời gian bắt đầu đến khi kết thúc chuyến (1 ngày, 2 ngày hoặc nhiều hơn tùy thuộc vào cung đường xa hoặc thời gian lưu ca).Tính năng tương tác: Cho phép Kế toán có quyền lựa chọn giữ nguyên số hệ thống tự nhảy hoặc chỉnh sửa/ghi đè bằng tay trực tiếp số tiền lương quy đổi này trước khi chốt chuyến. Chi phí này sẽ được tính ngay vào chi phí trực tiếp của chuyến đi đó để phục vụ báo cáo lãi lỗ nhanh.Bước 2: Chốt công và tính lương tổng hợp cuối tháng (Màn hình Kế toán lương)Do tổng lương quy đổi theo chuyến luôn nhỏ hơn hoặc bằng tiền lương thực tế phải trả của tháng (vì có những ngày xe không chạy nhưng công ty vẫn trả đủ lương), hệ thống thiết lập cơ chế bù trừ cuối tháng:Công thức tổng hợp lương tháng thực trả:$$\text{Tổng lương thực trả} = \sum(\text{Lương chuyến quy đổi trong tháng}) + \text{Lương bù ngày nghỉ do lỗi công ty} - \text{Khoản trừ nghỉ việc riêng}$$Quy tắc áp dụng công ngày nghỉ:Do lỗi công ty (Xe hỏng, không có việc): Lái xe vẫn hưởng đủ lương. Hệ thống cung cấp giao diện cho phép Kế toán tích chọn các ngày này, phần mềm tự tính giá trị tiền lương của các ngày nghỉ này để làm mục "Lương bổ sung/Lương bù".Do lỗi lái xe (Xin nghỉ việc riêng): Hệ thống tự động trừ lương tương ứng dựa trên số ngày nghỉ thực tế vượt quá 4 ngày Chủ nhật quy định.Phân bổ báo cáo Lỗ/Lãi đầu xe: Khi kết xuất báo cáo lỗ lãi của từng xe vào cuối tháng, kế toán tích chọn lệnh "Bổ sung lương chưa thể hiện trên chuyến", hệ thống sẽ lấy phần "Lương bù ngày nghỉ" cộng dồn vào tổng chi phí lương của đầu xe đó trong tháng, đảm bảo báo cáo tài chính nội bộ chính xác 100% so với quỹ lương thực tế chi trả.3. MODULE QUẢN LÝ NHIÊN LIỆU & CÔNG NỢ NHÀ CUNG CẤP (FUEL & AP MANAGEMENT)3.1. Quy trình xử lý cấp phát nhiên liệu trên phần mềmChức năng này được kích hoạt ngay sau khi Kế toán hoàn thành việc tính toán định mức/khối lượng dầu cần cấp cho chuyến xe.[Kế toán tính dầu chuyến]
       │
       ▼
[Chọn 1 trong 2 Nhà cung cấp]
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
[Hệ thống tự động ghi nhận Công nợ]    [Xuất Phiếu cấp nhiên liệu]
       │                                         │
       ▼                                         ▼
[Module Quản lý Công nợ đối tác]       [Gửi NCC] & [Hiển thị trên Driver App]
3.2. Yêu cầu chi tiết chức năngLựa chọn Nhà cung cấp: Tại màn hình tính dầu của chuyến, hệ thống thiết lập một danh mục lựa chọn (Dropdown) chứa thông tin các đơn vị cung ứng nhiên liệu (Hiện tại cấu hình sẵn 2 đơn vị cung cấp chính của NePO). Kế toán bắt buộc phải chọn 1 đơn vị cho chuyến đi.Xuất Phiếu/Bảng cấp nhiên liệu: * Hệ thống hỗ trợ xuất biểu mẫu (Phiếu cấp dầu) tự động lấy dữ liệu từ chuyến đi bao gồm: Biển số xe, Khối lượng/Số lít dầu được cấp, Tên nhà cung cấp nhiên liệu được chỉ định.Hỗ trợ định dạng xuất file (PDF/Excel) hoặc lệnh in nhanh để gửi sang nhà cung cấp nhiên liệu làm căn cứ đối chiếu.Tự động hạch toán Công nợ: Dựa trên lựa chọn nhà cung cấp và giá trị dầu đã duyệt, hệ thống tự động đồng bộ dữ liệu, ghi nhận tăng công nợ phải trả (Accounts Payable) cho nhà cung cấp nhiên liệu tương ứng trong Module Kế toán công nợ.3.3. Tương tác trên Ứng dụng Lái xe (Driver App)Sau khi kế toán phê duyệt lệnh cấp dầu trên hệ thống quản trị, thông tin phải được cập nhật theo thời gian thực (Real-time) lên giao diện ứng dụng của lái xe:Lái xe truy cập vào chi tiết chuyến đi trên ứng dụng cá nhân để xem được:Số lượng dầu (số lít) mình được cấp cho chuyến đi hiện tại.Tên/Thương hiệu nhà cung cấp nhiên liệu được chỉ định để lái xe chủ động qua đúng trạm đổ dầu theo quy định của công ty.

# Draft: SRS - Revenue/Cost, Driver Salary, Fuel/AP Modules

## Requirements (confirmed - from SRS document)

### Module 1: Trip Revenue & Cost
- Revenue formula: Giá cước (excl. VAT) - Hoa hồng chi KH = Doanh thu thực tế
- New fields needed: Hoa hồng chi khách hàng (commission/discount per trip)
- VAT: Display separately, NOT included in P&L revenue
- Road cost: Single combined field including ePass/VETC + other road costs
- New expense fields: Tiền kết hợp (combined cargo), Tiền lưu ca (wait/detention), Tiền trả hàng nhiều điểm (multi-drop delivery)
- Lương chuyến quy đổi (allocated driver salary) as trip cost

### Module 2: Driver Salary Management
- Base salary: 10,000,000 VNĐ + BHXH/BHYT per driver config, for 26 standard work days
- Per-trip salary allocation: (Base + BHXH) / 26 × trip_days
- System auto-suggests, accountant can override before locking trip
- Monthly reconciliation: Σ(trip salaries) + make-up pay (company-caused off days) - deductions (personal leave > 4 Sundays)
- Company-caused off days: accountant selects dates, system calculates supplementary pay
- Personal leave deductions: auto-deduct beyond 4 allowed Sundays
- P&L allocation: option to add "unallocated salary" to per-truck monthly P&L

### Module 3: Fuel & AP Management
- After fuel calculation, accountant selects vendor from dropdown (currently 2 vendors)
- Generate fuel issuance voucher (Phiếu cấp dầu): truck plate, liters, vendor name
- Export as PDF/Excel or print
- Auto-create AP ledger entry for selected vendor
- Real-time sync to Driver App: driver sees fuel quantity + designated vendor/station

## Technical Decisions
- **Deployment**: All 3 modules simultaneously in ONE plan
- **Driver App**: Already exists as mobile web responsive - only need API/data additions for fuel info
- **VAT**: Configurable rate (not fixed 10%) - stored per trip or per customer
- **Driver Salary**: Base salary + BHXH/BHYT both configurable per driver (not fixed 10M)
- **Test Strategy**: TDD (Red-Green-Refactor) - each task has failing test → impl → refactor
- **Fuel Vendors**: Use existing createCrudRouter() catalog pattern
- **PDF Generation**: pdfkit for fuel voucher (Phiếu cấp dầu)
- **Salary Period UI**: Dedicated page (not embedded in Financial page)

## Research Findings

### Explore Agent 1: Trip Financial Field Inventory
- trips table: 40+ columns for financials. Revenue split into revenue + revenueEmptyReturn + revenueCombine
- vatRate EXISTS (numeric 5,3) but no computed vatAmount column. freightExVat already computed in P&L
- commission field: COMPLETELY MISSING (no column, type, schema, or UI)
- driverSalary: EXISTS as flat per-trip amount, but NOT calculated from base salary formula
- tripWageDays: EXISTS in schema but NOT WIRED to computeSalary()
- Road allowance + tolls are SEPARATE columns (not combined). SRS wants single combined field
- twoPointDeliveryBonus: EXISTS but is a COST, not a separate expense category
- vehicleShiftAllowance: EXISTS (maps to "tiền lưu ca xe" in SRS)
- FuelMode enum: only AUTO + FLAT_RATE (MOUNTAIN handled via route.isMountain + fixedFuelAllowance)
- Ledger: Already posts FUEL_EXPENSE to VENDOR on trip lock

### Explore Agent 2: Salary, Vendor, Frontend Inventory
- salary-period.service.ts: EXISTS - resolves salary period date ranges (cross-month pattern 26th→25th)
- attendance.service.ts: EXISTS - computeSalary() with baseSalary + totalTripSalary + adjustment - penalties
- BUT: No make-up pay concept (adjustment = rounding only)
- suppliers table: EXISTS with isFuelSupplier flag. Already managed via createCrudRouter()
- fuelSupplierId on trips: INFORMATIONAL ONLY - does not create vendor payable
- Frontend TripEdit: Section 3 "Chi phí & Doanh thu" has tolls, salary, bonuses, revenue fields
- TotalsPanel: Live cost breakdown with bar chart
- Driver views: 4 pages (Trips, TripDetail, Earnings, Penalties) - no fuel voucher view
- reporting.service.ts: P&L with per-truck breakdown, profit distribution

### Librarian Agent: Fuel Vendor & AP Best Practices
- PDFKit recommended for PDF generation (pure Node, Vietnamese font support)
- Vietnamese Phiếu xuất kho nhiên liệu format per Thông tư 99/2025/TT-BTC
- FCM + SSE recommended for driver notifications
- Ledger already auto-books FUEL_EXPENSE on trip lock - just need voucher layer on top
- Architecture: trip dispatch → voucher issued → notify driver → trip lock → AP posted → reconcile

## Open Questions
- ✅ Priority/phasing: All 3 modules at once → ONE plan
- ✅ Driver App: Already exists as mobile web responsive
- ✅ Fuel vendors: Use existing catalog CRUD system with createCrudRouter()
- ✅ PDF generation: pdfkit
- ✅ Test strategy: TDD
- ✅ Salary base: Configurable per driver (base + BHXH)
- ✅ VAT: Configurable rate
- ✅ Salary Period UI: Dedicated page
- Outstanding: How does the current fuel calculation work? What fields exist in trip schema already?
- Outstanding: Current salary-period.service.ts capabilities

## Scope Boundaries
- INCLUDE: All 3 modules as described in SRS
- EXCLUDE: (to be confirmed)


Context

 Client (Pete) provided detailed SRS for 3 modules. After exploration, much of the
 infrastructure already exists — the work is primarily adding new fields, formulas, and
 a fuel voucher document. The client confirmed: salary per-trip conversion is the top
 priority.

 Key Clarifications from Client

 - Revenue field (giá cước) IS VAT-inclusive → current revenue / (1+vatRate) formula is
 correct
 - New formula: doanh thu thực tế = giá cước - VAT - hoa hồng = freightExVat -
 commission
 - Salary: (baseSalary + BHXH) / 26 × tripDays, pre-filled, accountant can override
 - P&L reports need option to "supplement" salary for idle days not reflected in trip
 salaries
 - Road cost should be "tổng tiền đi đường" including tolls
 - 4 free personal leave days per month, days 5+ deducted at dailyRate

 ---
 Module 1: Customer Commission (hoa hồng) & Revenue Fix

 Changes

 1.1 Database — Add customerCommission to trips

 File: backend/src/db/schema.ts (trips table)
 customerCommission: numeric('customer_commission', { precision: 15
 }).default('0').notNull()
 Add after vatRate field (~line 257). Default 0.

 1.2 Shared Types

 File: shared/src/types/index.ts
 - Add customerCommission: string to Trip interface (~line 230)
 - Add customerCommission?: number to UpdateTripFiguresRequest interface (~line 591)

 1.3 Zod Validation

 File: shared/src/schemas/index.ts
 - Add customerCommission: nonNegNumeric.optional() to updateTripFiguresSchema
 (~line 146)

 1.4 Calculation — Update computeTripTotals

 File: shared/src/calculations/tripTotals.ts
 - Add customerCommission?: number to ComputeTripTotalsInput interface
 - Add recordedRevenue: number to ComputeTripTotalsOutput interface
 - Update grossProfit formula:
 const commission = input.customerCommission ?? 0;
 const recordedRevenue = freightExVat - commission;
 // ...
 grossProfit = recordedRevenue - totalCost + serviceMargin;
 - Update OWN trip formula (~line 161-177)
 - For EXTERNAL trips: same commission logic applies

 1.5 Backend Service

 File: backend/src/services/trip.service.ts
 - updateTripFigures: pass customerCommission to computeTripTotals
 - Persist customerCommission on trip record

 1.6 Frontend — Trip Form

 File: frontend/src/hooks/useTripForm.ts
 - Add customerCommission state, setter, and include in submit payload

 File: frontend/src/components/trip/FuelTollsRevenueCard.tsx
 - Add "Hoa hồng chi khách hàng" input field next to revenue fields
 - Label: "Hoa hồng chi KH"

 1.7 Frontend — Display

 File: frontend/src/components/trip/TotalsPanel.tsx
 - Show "Hoa hồng chi KH" in cost/revenue breakdown
 - Show "Doanh thu ghi nhận" (= freightExVat - commission)

 File: frontend/src/features/trip-detail/components/FinancialCard.tsx
 - Show commission and adjusted revenue

 1.8 Tests

 File: shared/src/calculations/tripTotals.test.ts
 - Test cases: commission=0 (no change), commission>0 (reduces grossProfit), commission
 > freightExVat (negative profit)

 ---
 Module 2: Driver Salary Per Trip (Lương quy đổi theo chuyến)

 Changes

 2.1 Database — Add socialInsurance to drivers

 File: backend/src/db/schema.ts (drivers table)
 socialInsurance: numeric('social_insurance', { precision: 15 }).default('0').notNull()
 Add after baseSalary (~line 80).

 2.2 Shared Types

 File: shared/src/types/index.ts
 - Add socialInsurance: string to Driver interface
 - Add socialInsurance?: number to driver update schema type

 2.3 Zod Validation

 File: shared/src/schemas/index.ts
 - Add socialInsurance: nonNegNumeric.optional() to driverSchema

 2.4 Salary Auto-Suggest Logic

 File: backend/src/services/trip.service.ts

 When updating trip figures (updateTripFigures):
 - If driverSalary is not provided (undefined/0) AND driverId is set:
   a. Load driver's baseSalary and socialInsurance
   b. Compute tripWageDays from departure-to-arrival date range
   c. Compute suggested salary: (baseSalary + socialInsurance) / 26 * tripWageDays
   d. Return as suggestedDriverSalary in response (NOT auto-set)
 - If accountant provides driverSalary, use that value (override)

 Important: The suggestion is returned to frontend as a hint. Accountant sees it and can
 accept or override. The actual trips.driverSalary is always the explicitly set value.

 2.5 Populate tripWageDays

 File: backend/src/services/trip.service.ts
 - When trip figures are updated with departure/arrival dates:
 tripWageDays = daysBetween(departureDate, arrivalDate) + 1
 - Update the existing (unused) tripWageDays column on trips table.

 2.6 API Response — Add salary suggestion

 File: backend/src/services/trip.service.ts
 - updateTripFigures response should include:
 suggestedDriverSalary?: number  // auto-computed suggestion
 tripWageDays?: number           // days used for calculation

 2.7 Frontend — Salary Suggestion UI

 File: frontend/src/hooks/useTripForm.ts
 - Add state: suggestedDriverSalary, tripWageDays
 - When trip dates change, call API to get suggestion
 - Show suggestion as helper text / placeholder on driverSalary input

 File: frontend/src/components/trip/FuelTollsRevenueCard.tsx or dedicated
 DriverSalarySection
 - Input field: "Lương chuyến quy đổi"
 - Show suggestion as: "Gợi ý: {formatNumber(suggestedDriverSalary)} VNĐ"
 - "Dùng gợi ý" link button to auto-fill
 - Show calculation breakdown: (baseSalary + BHXH) / 26 × {tripWageDays} ngày

 2.8 Personal Leave Deduction

 File: backend/src/services/attendance.service.ts — computeSalary()
 - Current: personalLeaveDays tracked but not deducted
 - New logic:
 const freeLeaveDays = 4;
 const excessLeaveDays = Math.max(0, personalLeaveDays - freeLeaveDays);
 const personalLeaveDeduction = round(excessLeaveDays * dailyRate);
 // netSalary = baseSalary + totalTripSalary + adjustment - totalPenalties -
 personalLeaveDeduction
 - Return personalLeaveDeduction and excessLeaveDays in response

 File: frontend/src/pages/SalaryAttendancePage.tsx
 - Show leave deduction in SalarySummaryCard
 - Label: "Trừ lương nghỉ việc riêng ({excess} ngày × {dailyRate})"

 File: frontend/src/pages/DriverEarningsPage.tsx
 - Show deduction line in earnings breakdown

 2.9 Social Insurance from DB

 File: backend/src/services/attendance.service.ts — computeSalary()
 - Replace hardcoded socialInsurance = 0 (line 273) with:
 const socialInsurance = parseFloat(driver.socialInsurance || '0');

 2.10 P&L Salary Supplement

 File: backend/src/services/attendance.service.ts or new endpoint
 - Add API endpoint that returns salary supplement for a vehicle in a month:
 // supplement = standbyDays × dailyRate + adjustment
 // This is the "lương chưa thể hiện trên chuyến"
 - Frontend P&L report can call this and add to vehicle's total salary cost

 2.11 Driver Config Page

 File: frontend/src/pages/config/DriversConfigPage.tsx
 - Add "BHXH/BHYT" input field next to base salary ("Lương CB")

 ---
 Module 3: Fuel Voucher (Phiếu cấp dầu)

 Changes

 3.1 New Service — Fuel Voucher Rendering

 File: backend/src/services/fuel-voucher.service.ts (NEW)

 Follow existing pattern from settlement-export.service.ts:

 renderFuelVoucherHtml(): HTML for PDF/print
 - Company header: "NEPO CORP — PHIẾU CẤP NHIÊN LIỆU"
 - Table with: STT, Biển số xe, Số lít dầu, Đơn giá, Thành tiền
 - Supplier name and address
 - Trip code, route, date
 - Driver name
 - Signature blocks: Kế toán / Giám đốc / Người nhận

 renderFuelVoucherXlsx(): Excel via ExcelJS
 - Same data, styled with Calibri font, borders, header formatting
 - Follow existing ExcelJS patterns from settlement-export service

 3.2 API Routes

 File: backend/src/routes/trips.ts (or financial.ts)
 GET /api/v1/trips/:id/fuel-voucher/html  → HTML for print/PDF
 GET /api/v1/trips/:id/fuel-voucher/xlsx  → Excel download
 - Only for trips with fuelSupplierId set
 - Requires ACCOUNTANT/MANAGER/ADMIN role

 3.3 Frontend — Export Buttons

 File: frontend/src/features/trip-detail/components/FuelCard.tsx
 - Add "Xuất phiếu cấp dầu" button group (PDF + Excel)
 - Only show when fuelSupplierId is set
 - Follow existing export button patterns from settlement/financial pages

 3.4 Driver App Enhancement (minor)

 File: frontend/src/pages/DriverTripDetailPage.tsx
 - Already shows fuelLiters, fuelSupplierName
 - Ensure fuel info is prominently displayed for driver visibility

 ---
 Database Migration

 All new columns in a single migration:

 -- Module 1: Commission
 ALTER TABLE trips ADD COLUMN customer_commission numeric(15,0) NOT NULL DEFAULT '0';

 -- Module 2: Social Insurance
 ALTER TABLE drivers ADD COLUMN social_insurance numeric(15,0) NOT NULL DEFAULT '0';

 Note: trips.trip_wage_days already exists in schema but unused. No migration needed.

 ---
 Verification Plan

 Module 1 Verification

 1. Create a trip with revenue 10,000,000, vatRate 8%
 2. Set commission to 500,000
 3. Verify: freightExVat = 10,000,000 / 1.08 = 9,259,259
 4. Verify: recordedRevenue = 9,259,259 - 500,000 = 8,759,259
 5. Verify grossProfit uses recordedRevenue (not raw revenue)
 6. Run existing trip totals tests with commission=0 (should pass unchanged)

 Module 2 Verification

 1. Set driver baseSalary=10,000,000, socialInsurance=1,750,000 (typical VN rate)
 2. Create trip with 2-day duration
 3. Verify suggestion: (10,000,000 + 1,750,000) / 26 × 2 = 903,846
 4. Verify accountant can override with different value
 5. Set personalLeaveDays=6 → verify deduction for 2 excess days
 6. Verify netSalary includes leave deduction

 Module 3 Verification

 1. Create trip with fuelSupplierId set
 2. Hit /api/v1/trips/:id/fuel-voucher/html → verify HTML renders correctly
 3. Hit /api/v1/trips/:id/fuel-voucher/xlsx → verify Excel downloads
 4. Verify 404/error when no fuel supplier assigned

 Full Regression

 - make test (Vitest)
 - rtk tsc --noEmit for type checking
 - Manual: create trip → update figures → lock → verify ledger entries correct

 ---
 Implementation Order

 All 3 modules can be implemented in parallel by separate agents:

 Agent A — Module 1 (Commission)

 1. DB schema + migration
 2. Shared types + Zod
 3. computeTripTotals update
 4. Backend service
 5. Frontend form + display
 6. Tests

 Agent B — Module 2 (Salary)

 1. DB schema (socialInsurance on drivers)
 2. Shared types + Zod
 3. Attendance service (socialInsurance from DB, leave deduction)
 4. Trip service (salary auto-suggest, tripWageDays)
 5. Frontend salary suggestion UI
 6. Frontend attendance/earnings updates
 7. Driver config page (BHXH field)

 Agent C — Module 3 (Fuel Voucher)

 1. Fuel voucher service (HTML + XLSX rendering)
 2. API routes
 3. Frontend export buttons

 Sequential Dependencies

 - Module 1 (commission) must be done before final integration testing
 - Module 2's salary auto-suggest depends on tripWageDays population
 - Module 3 is fully independent
 - All 3 share the same migration file

Dưới đây là phương án giải quyết triệt để các điểm xung đột nghiệp vụ và tài liệu Đặc tả Yêu cầu Chức năng (SRS) đã được chuẩn hóa, thống nhất hoàn chỉnh cho cả 3 Module của hệ thống TMS NePO Corp.PHƯƠNG ÁN GIẢI QUYẾT XUNG ĐỘT NGHIỆP VỤ CHÍNHXung đột Lương chuyến quy đổi vs Lương tháng thực trả:Bản chất xung đột: Nếu chỉ cộng dồn lương theo chuyến, tổng lương sẽ bị thiếu hụt so với 10 triệu thực tế phải trả trong tháng do các ngày xe hỏng hoặc không có việc (nhưng lái xe vẫn được tính lương).Giải pháp thống nhất: * Cấp độ chuyến đi: Hệ thống tự động gợi ý lương chuyến theo công thức công chuẩn và cho phép sửa tay để kế toán chốt chi phí trực tiếp, phục vụ xem P&L nhanh của chuyến đó.Cấp độ tổng hợp cuối tháng: Kế toán dùng màn hình chốt công để tích chọn các ngày nghỉ do lỗi công ty (xe hỏng, không có việc). Phần mềm tự tính toán quỹ "Lương bù ngày nghỉ".Cấp độ Báo cáo P&L đầu xe: Khi xuất báo cáo tài chính cuối tháng cho từng xe, kế toán tích chọn "Bổ sung lương chưa thể hiện trên chuyến", hệ thống sẽ phân bổ chi phí lương bù này vào tổng chi phí của xe để báo cáo lỗ lãi chính xác 100%.Thống nhất cách tính Doanh thu và Chi phí đi đường:Doanh thu thực tế: Sẽ bằng Giá cước (quy ước mặc định chưa gồm VAT) trừ đi trường dữ liệu mới là "Hoa hồng chi khách hàng". Thuế VAT hiển thị tách biệt để theo dõi công nợ, không đưa vào doanh thu tính P&L chuyến.Chi phí đi đường: Hợp nhất toàn bộ tiền vé (ePass/VETC) và chi phí dọc đường thành một trường duy nhất là "Tổng tiền đi đường" để tối giản việc nhập liệu cho kế toán.TÀI LIỆU ĐẶC TẢ YÊU CẦU CHỨC NĂNG (SRS) CHUẨN HÓA1. MODULE QUẢN LÝ DOANH THU & CHI PHÍ CHUYẾN ĐI (TRIP REVENUE & COST)1.1. Cấu trúc cấu thành Doanh thu thực tếHệ thống ghi nhận doanh thu thực tế phục vụ tính toán hiệu quả kinh doanh (P&L) theo nguyên tắc loại bỏ thuế và trừ chiết khấu thương mại.Công thức tính toán:$$\text{Doanh thu thực tế ghi nhận} = \text{Giá cước (chưa VAT)} - \text{Hoa hồng chi khách hàng}$$Yêu cầu giao diện & Dữ liệu đầu vào (Màn hình Chuyến đi):Giá cước: Trường nhập liệu bắt buộc (Giá trị nhập vào quy ước chưa bao gồm thuế GTGT).Thuế VAT: Trường hiển thị bóc tách riêng biệt (Tính toán dựa trên % cấu hình theo khách hàng hoặc chuyến), không cộng gộp vào doanh thu thực tế khi tính lỗ lãi chuyến.Hoa hồng chi khách hàng: Trường nhập liệu mới (cho phép nhập số tiền hoa hồng chiết khấu trực tiếp cho đối tác/khách hàng theo từng chuyến).1.2. Cấu trúc cấu thành Chi phí chuyến điBổ sung và phân rã các hạng mục chi phí trực tiếp phát sinh theo từng chuyến để hệ thống ghi nhận tức thời vào giá vốn chuyến đi:Tổng tiền đi đường: Trường chi phí bắt buộc, cơ chế ghi nhận phải bao gồm cả tiền vé/phí cầu đường (ePass/VETC) và các chi phí dọc đường khác thành một tổng số duy nhất.Các khoản chi phí phát sinh bổ sung: Hệ thống cung cấp các trường nhập liệu độc lập để kế toán ghi nhận ngay khi phát sinh chuyến:Tiền kết hợp (Chi phí ghép hàng, kết hợp chuyến).Tiền lưu ca xe (Chi phí đền bù/hỗ trợ lái xe khi phải chờ đợi lưu đêm/lưu ca tại kho bãi).Tiền trả hàng nhiều điểm (Chi phí phát sinh khi giao nhận từ 2 điểm trở lên).Lương chuyến quy đổi (Chi tiết tại Mục 2).2. MODULE QUẢN LÝ LƯƠNG LÁI XE (DRIVER SALARY MANAGEMENT)2.1. Bài toán nghiệp vụ & Giải pháp phân bổLái xe hưởng cơ chế lương tháng cố định (Cấu hình linh hoạt theo từng nhân sự: Lương gốc mặc định 10.000.000 VNĐ + BHXH/BHYT cho 26 ngày công chuẩn). Chi phí lương được quy đổi phân bổ động theo chuyến để quản trị P&L đầu xe và xử lý bù trừ cuối tháng.2.2. Chi tiết luồng chức năng trên phần mềmBước 1: Ghi nhận Lương quy đổi theo chuyến (Màn hình Chuyến đi)Hệ thống bổ sung trường Lương chuyến quy đổi trong phần chi phí chuyến.Cơ chế gợi ý tự động từ hệ thống:$$\text{Lương chuyến gợi ý} = \frac{\text{Lương cơ bản tháng} + \text{BHXH}}{26} \times \text{Số ngày thực hiện chuyến}$$Trong đó: Số ngày thực hiện chuyến được hệ thống tự động tính toán từ thời gian bắt đầu đến khi kết thúc chuyến (ví dụ: 1 ngày, 2 ngày...).Tính năng tương tác: Cho phép Kế toán giữ nguyên số hệ thống tự nhảy hoặc chỉnh sửa/ghi đè bằng tay số tiền lương quy đổi này trước khi khóa chuyến.Bước 2: Chốt công và tính lương tổng hợp cuối tháng (Màn hình Kế toán lương)Để xử lý phần chênh lệch giữa lương chuyến và lương tháng thực tế, hệ thống thiết lập cơ chế tính toán tổng hợp:$$\text{Tổng lương thực trả} = \sum(\text{Lương chuyến quy đổi trong tháng}) + \text{Lương bù ngày nghỉ do lỗi công ty} - \text{Khoản trừ nghỉ việc riêng}$$Quy tắc áp dụng ngày nghỉ:Do lỗi công ty (Xe hỏng, không có việc): Lái xe vẫn hưởng đủ lương. Hệ thống cung cấp giao diện bảng công tháng để Kế toán tích chọn các ngày này, phần mềm tự tính giá trị tiền lương của các ngày nghỉ phát sinh để làm mục "Lương bù ngày nghỉ".Do lỗi lái xe (Xin nghỉ việc riêng): Hệ thống tự động trừ lương dựa trên số ngày nghỉ thực tế vượt quá 4 ngày Chủ nhật quy định (Ngày công thứ 5 trở đi áp dụng mức trừ công nhật: (Lương gốc + BHXH) / 26 mỗi ngày).Bước 3: Phân bổ báo cáo Lỗ/Lãi đầu xe cuối thángKhi kết xuất báo cáo lỗ lãi của từng xe vào cuối tháng, hệ thống cung cấp tùy chọn: "Bổ sung lương chưa thể hiện trên chuyến".Khi kích hoạt, hệ thống sẽ lấy phần "Lương bù ngày nghỉ" cộng dồn vào tổng chi phí lương của đầu xe đó trong tháng, đảm bảo báo cáo tài chính nội bộ chính xác tuyệt đối so với quỹ lương thực tế chi trả.3. MODULE QUẢN LÝ NHIÊN LIỆU & CÔNG NỢ NHÀ CUNG CẤP (FUEL & AP MANAGEMENT)3.1. Quy trình xử lý cấp phát nhiên liệu trên phần mềmChức năng này được thực hiện ngay sau khi Kế toán hoàn thành việc tính toán định mức/khối lượng dầu cần cấp cho chuyến xe.[Kế toán tính dầu chuyến]
       │
       ▼
[Chọn 1 trong 2 Nhà cung cấp]
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
[Hệ thống tự động ghi nhận Công nợ]    [Xuất Phiếu cấp nhiên liệu]
       │                                         │
       ▼                                         ▼
[Module Quản lý Công nợ đối tác]       [Gửi NCC] & [Hiển thị trên Driver App]
3.2. Yêu cầu chi tiết chức năngLựa chọn Nhà cung cấp: Tại màn hình tính dầu của chuyến, hệ thống thiết lập một danh mục lựa chọn thả xuống (Dropdown) chứa thông tin các đơn vị cung ứng nhiên liệu (Cấu hình sẵn 2 đơn vị cung cấp chính). Kế toán bắt buộc phải chọn 1 đơn vị cho chuyến đi.Xuất Phiếu/Bảng cấp nhiên liệu:Hệ thống hỗ trợ xuất biểu mẫu (Phiếu cấp dầu) tự động lấy dữ liệu từ chuyến đi bao gồm: Biển số xe, Khối lượng/Số lít dầu được cấp, Tên nhà cung cấp nhiên liệu được chỉ định.Hỗ trợ định dạng xuất file nhanh (PDF/Excel) để gửi sang nhà cung cấp nhiên liệu làm căn cứ đối chiếu.Tự động hạch toán Công nợ: Dựa trên lựa chọn nhà cung cấp và giá trị dầu đã duyệt, hệ thống tự động đồng bộ dữ liệu, ghi nhận tăng công nợ phải trả (Accounts Payable) cho nhà cung cấp nhiên liệu tương ứng trong Module Kế toán công nợ ngay khi chuyến đi được khóa.3.3. Tương tác trên Ứng dụng Lái xe (Driver App)Sau khi kế toán phê duyệt lệnh cấp dầu trên hệ thống quản trị, thông tin phải được cập nhật theo thời gian thực (Real-time) lên giao diện ứng dụng của lái xe tại chi tiết chuyến đi:Số lượng dầu (số lít) được cấp cho chuyến đi hiện tại.Tên/Thương hiệu nhà cung cấp nhiên liệu được chỉ định để lái xe chủ động qua đúng trạm đổ dầu theo quy định.
