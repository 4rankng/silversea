# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: o2c-lifecycle.spec.ts >> O2C Lifecycle >> OPS-002: Create LCL shipment and transition to ready by date
- Location: e2e/o2c-lifecycle.spec.ts:31:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.selectOption: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('select[name="customerId"]')

```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - link "Bỏ qua đến nội dung chính" [ref=f1e4] [cursor=pointer]:
    - /url: "#main-content"
  - generic [ref=f1e5]: Đã chuyển đến Tạo lô hàng
  - complementary [ref=f1e6]:
    - generic [ref=f1e10]:
      - strong [ref=f1e11]: TransTing
      - generic [ref=f1e12]: Quản lý vận tải và logistics
    - navigation [ref=f1e13]:
      - generic [ref=f1e14]:
        - button "Chứng từ" [expanded] [ref=f1e15] [cursor=pointer]
        - button "Lô hàng được giao" [ref=f1e19] [cursor=pointer]
        - button "Tạo lô hàng" [active] [ref=f1e24] [cursor=pointer]
      - generic [ref=f1e30]:
        - button "Đối soát" [expanded] [ref=f1e31] [cursor=pointer]
        - button "Chi phí cần kiểm tra" [ref=f1e35] [cursor=pointer]
    - button "Menu người dùng" [ref=f1e40] [cursor=pointer]:
      - generic [ref=f1e45]:
        - generic [ref=f1e46]: Đỗ Thị Cẩm Tú
        - generic [ref=f1e47]: Nhân viên chứng từ
  - generic [ref=f1e50]:
    - banner [ref=f1e51]:
      - button "Đóng menu điều hướng" [expanded] [ref=f1e52] [cursor=pointer]
      - generic "Trang hiện tại" [ref=f1e54]:
        - generic [ref=f1e55]: Đang xem
        - strong [ref=f1e56]: Tạo lô hàng
      - generic [ref=f1e57]:
        - textbox "Tìm trang, cấu hình hoặc thao tác" [ref=f1e58]:
          - /placeholder: Tìm trang, cấu hình, thao tác…
        - generic [ref=f1e59]: ⌘ K
      - button "Chọn tháng" [ref=f1e62] [cursor=pointer]:
        - generic [ref=f1e65]:
          - generic [ref=f1e66]: Tháng 8/2026
          - generic [ref=f1e67]: 01/08 – 31/08
    - main [ref=f1e70]:
      - generic [ref=f1e71]:
        - button "Quay lại" [ref=f1e72] [cursor=pointer]
        - heading "Tạo lô hàng mới" [level=1] [ref=f1e75]
        - paragraph [ref=f1e76]: Lưu nháp để bổ sung sau, hoặc nhập đủ thông tin và gửi sang bảng điều phối.
        - generic [ref=f1e77]:
          - generic [ref=f1e78]:
            - heading "Thông tin chung" [level=2] [ref=f1e79]
            - generic [ref=f1e80]:
              - generic [ref=f1e82]:
                - generic [ref=f1e83]: Khách hàng *
                - button "Khách hàng *" [ref=f1e85] [cursor=pointer]:
                  - generic [ref=f1e86]: Chọn khách hàng
              - generic [ref=f1e89]:
                - generic [ref=f1e90]: Tuyến đường
                - button "Tuyến đường" [ref=f1e92] [cursor=pointer]:
                  - generic [ref=f1e93]: Chọn tuyến đường
              - generic [ref=f1e96]:
                - generic [ref=f1e97]: Loại hàng
                - button "Loại hàng" [ref=f1e99] [cursor=pointer]:
                  - generic [ref=f1e100]: Chọn loại hàng
              - generic [ref=f1e103]:
                - generic [ref=f1e104]: Số booking
                - textbox "Số booking" [ref=f1e105]
              - generic [ref=f1e106]:
                - generic [ref=f1e107]: Số vận đơn (B/L)
                - textbox "Số vận đơn (B/L)" [ref=f1e108]
              - generic [ref=f1e109]:
                - generic [ref=f1e110]: Số tờ khai
                - textbox "Số tờ khai" [ref=f1e111]
              - generic [ref=f1e112]:
                - generic [ref=f1e113]: Chiều hàng
                - button "— Chọn chiều hàng —" [ref=f1e114] [cursor=pointer]
            - generic [ref=f1e118]:
              - generic [ref=f1e119]:
                - generic [ref=f1e120]: Nhà máy
                - button "Nhà máy Vui lòng chọn khách hàng để tải danh sách nhà máy." [disabled] [ref=f1e122]:
                  - generic [ref=f1e123]: Chọn khách hàng trước
                - generic [ref=f1e126]: Vui lòng chọn khách hàng để tải danh sách nhà máy.
              - button "Thêm nhà máy" [ref=f1e128] [cursor=pointer]
          - generic [ref=f1e130]:
            - heading "Hình thức hàng" [level=2] [ref=f1e131]
            - generic [ref=f1e132]:
              - generic [ref=f1e133]: Loại lô hàng
              - button "Hàng nguyên container (FCL)" [ref=f1e134] [cursor=pointer]
            - generic [ref=f1e138]:
              - generic [ref=f1e139]:
                - generic [ref=f1e140]:
                  - strong [ref=f1e141]: Gán nhà xe
                  - generic [ref=f1e142]:
                    - paragraph [ref=f1e143]: Chọn nhà xe cho từng cỡ container 20' và 40'.
                    - paragraph [ref=f1e144]: "20': 0/0 · 40': 0/0"
                - button "Gán nhà xe" [disabled] [ref=f1e145] [cursor=pointer]
              - generic [ref=f1e146]:
                - strong [ref=f1e148]: Container 1
                - generic [ref=f1e149]:
                  - generic [ref=f1e150]:
                    - generic [ref=f1e151]: Số container
                    - textbox "Số container" [ref=f1e152]
                  - generic [ref=f1e153]:
                    - generic [ref=f1e154]: Loại container *
                    - button "— Chọn loại —" [ref=f1e155] [cursor=pointer]
                  - generic [ref=f1e159]:
                    - generic [ref=f1e160]: Hãng tàu
                    - textbox "Hãng tàu" [ref=f1e161]
                  - generic [ref=f1e162]:
                    - generic [ref=f1e163]: Cảng nâng
                    - button "Cảng nâng" [ref=f1e165] [cursor=pointer]:
                      - generic [ref=f1e166]: Chọn cảng nâng
                  - generic [ref=f1e169]:
                    - generic [ref=f1e170]: Cảng hạ
                    - button "Cảng hạ" [ref=f1e172] [cursor=pointer]:
                      - generic [ref=f1e173]: Chọn cảng hạ
                  - generic [ref=f1e176]:
                    - generic [ref=f1e177]: Trọng lượng (kg)
                    - spinbutton "Trọng lượng (kg)" [ref=f1e178]
              - button "Thêm container" [ref=f1e179] [cursor=pointer]
          - generic [ref=f1e181]:
            - heading "Mốc thời gian và lưu ý" [level=2] [ref=f1e182]
            - generic [ref=f1e183]:
              - generic [ref=f1e184]:
                - generic [ref=f1e185]: Cut-off tờ khai
                - textbox "Cut-off tờ khai" [ref=f1e186]
              - generic [ref=f1e187]:
                - generic [ref=f1e188]: Giờ đóng hàng
                - textbox "Giờ đóng hàng" [ref=f1e189]
              - generic [ref=f1e190]:
                - generic [ref=f1e191]: Thời gian trả
                - textbox "Thời gian trả" [ref=f1e192]
              - generic [ref=f1e193]:
                - generic [ref=f1e194]: Ngày giao dự kiến
                - textbox "Ngày giao dự kiến" [ref=f1e195]
            - generic [ref=f1e196]:
              - text: Ghi chú điều xe
              - textbox "Ghi chú điều xe" [ref=f1e197]
          - generic [ref=f1e198]:
            - heading "Cước dự kiến theo cấu hình" [level=2] [ref=f1e199]
            - paragraph [ref=f1e201]: Chọn khách hàng, tuyến đường và thông tin hàng hóa để xem cước dự kiến.
          - generic [ref=f1e202]:
            - button "Lưu bản nháp" [ref=f1e203] [cursor=pointer]
            - button "Gửi sang điều phối" [ref=f1e206] [cursor=pointer]
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * O2C Lifecycle E2E Tests
  5   |  * Tests Order-to-Cash workflow from shipment creation to completion
  6   |  *
  7   |  * Corresponds to QA test cases:
  8   |  * - OPS-002: Tạo lô LCL và chuyển sẵn sàng theo ngày
  9   |  * - OPS-004: Hoàn thiện hồ sơ và kích hoạt ngày điều vận
  10  |  * - OPS-006: Gán nhà xe theo số lượng và rã FCL theo container
  11  |  * - OPS-007: Chọn xe đúng nhà xe đã gán
  12  |  * - OPS-008: Chặn xung đột xe, tài xế và lịch
  13  |  * - OPS-009: Kẹp hai lệnh tương thích
  14  |  * - OPS-010: Phát lệnh và chuyển trạng thái Đã điều xe
  15  |  * - OPS-011: Tài xế bắt đầu vận chuyển và cập nhật mốc đúng thứ tự
  16  |  * - OPS-012: Nộp e-POD đầy đủ từng fulfillment
  17  |  * - OPS-013: Ghi chi phí hiện trường theo tariff
  18  |  * - OPS-014: Hoàn tất vận hành và chuyển Chờ duyệt chi phí
  19  |  * - OPS-015: Duyệt chi phí và hoàn thành lô nguyên tử
  20  |  */
  21  | 
  22  | const USERS = JSON.parse(process.env.STAGING_USERS || '{}');
  23  | const PASSWORD = process.env.STAGING_PASSWORD || 'Abc123';
  24  | 
  25  | test.describe('O2C Lifecycle', () => {
  26  |   test.beforeEach(async ({ page }) => {
  27  |     // Navigate to login page
  28  |     await page.goto('/');
  29  |   });
  30  | 
  31  |   test('OPS-002: Create LCL shipment and transition to ready by date', async ({ page }) => {
  32  |     // Login as CUS/CLERK
  33  |     await page.fill('input[name="username"]', USERS.clerk);
  34  |     await page.fill('input[name="password"]', PASSWORD);
  35  |     await page.click('button[type="submit"]');
  36  | 
  37  |     // Wait for navigation to dashboard
  38  |     await page.waitForURL('/shipments');
  39  | 
  40  |     // Click "Tạo lô hàng" (Create new shipment)
  41  |     await page.click('text=Tạo lô hàng');
  42  |     await page.waitForURL('/clerk/shipments/new');
  43  | 
  44  |     // Fill LCL shipment form
> 45  |     await page.selectOption('select[name="customerId"]', '1');
      |                ^ Error: page.selectOption: Test timeout of 30000ms exceeded.
  46  |     await page.fill('input[name="bookingRef"]', `QA-LCL-${Date.now()}`);
  47  |     await page.selectOption('select[name="shipmentType"]', 'LCL');
  48  | 
  49  |     // Enter LCL details
  50  |     await page.fill('input[name="packageCount"]', '12');
  51  |     await page.fill('input[name="cargoWeightKg"]', '8500');
  52  |     await page.fill('input[name="cargoVolumeCbm"]', '18.5');
  53  | 
  54  |     // Leave delivery dates empty to test PENDING_DATE state
  55  |     await page.click('button[type="submit"]');
  56  | 
  57  |     // Verify success message
  58  |     await expect(page.locator('text=Đã tạo lô thành công')).toBeVisible();
  59  | 
  60  |     // Verify shipment is in PENDING_DATE state
  61  |     await page.click('text=Chi tiết');
  62  |     await expect(page.locator('text=Chờ ngày điều vận')).toBeVisible();
  63  |   });
  64  | 
  65  |   test('OPS-004: Complete documents and activate dispatch date', async ({ page }) => {
  66  |     // Login as CUS
  67  |     await page.fill('input[name="username"]', USERS.clerk);
  68  |     await page.fill('input[name="password"]', PASSWORD);
  69  |     await page.click('button[type="submit"]');
  70  | 
  71  |     // Navigate to an existing PENDING_DATE shipment
  72  |     await page.goto('/shipments');
  73  |     await page.click('text=Chờ ngày điều vận').first();
  74  | 
  75  |     // Fill in B/L and container details
  76  |     await page.fill('input[name="blNumber"]', `BL${Date.now()}`);
  77  |     await page.fill('input[name="containerNumbers"]', 'MSKU1234565');
  78  |     await page.fill('input[name="sealNumbers"]', 'SEAL123456');
  79  | 
  80  |     // Set delivery date to trigger READY_FOR_DISPATCH
  81  |     await page.fill('input[name="expectedDeliveryDate"]', '2026-08-15');
  82  |     await page.click('button[type="submit"]');
  83  | 
  84  |     // Verify transition to READY_FOR_DISPATCH
  85  |     await expect(page.locator('text=Sẵn sàng điều xe')).toBeVisible();
  86  |     await expect(page.locator('button:has-text("Gán nhà xe")')).toBeVisible();
  87  |   });
  88  | 
  89  |   test('OPS-006: Assign carriers by quantity and split FCL by container', async ({ page }) => {
  90  |     // Login as CUS
  91  |     await page.fill('input[name="username"]', USERS.clerk);
  92  |     await page.fill('input[name="password"]', PASSWORD);
  93  |     await page.click('button[type="submit"]');
  94  | 
  95  |     // Navigate to a READY_FOR_DISPATCH shipment with multiple containers
  96  |     await page.goto('/shipments?status=READY_FOR_DISPATCH');
  97  |     await page.click('text=Chi tiết').first();
  98  | 
  99  |     // Click "Gán nhà xe" (Assign carriers)
  100 |     await page.click('button:has-text("Gán nhà xe")');
  101 | 
  102 |     // Verify carrier assignment dialog
  103 |     await expect(page.locator('text=Gán nhà xe theo container')).toBeVisible();
  104 | 
  105 |     // Assign 4x40' to carrier SS and 1x40' to carrier DH
  106 |     await page.selectOption('select[name="carrierId_0"]', 'SS');
  107 |     await page.selectOption('select[name="containerSize_0"]', '40');
  108 |     await page.fill('input[name="containerCount_0"]', '4');
  109 | 
  110 |     await page.click('button:has-text("Thêm dòng")');
  111 |     await page.selectOption('select[name="carrierId_1"]', 'DH');
  112 |     await page.selectOption('select[name="containerSize_1"]', '40');
  113 |     await page.fill('input[name="containerCount_1"]', '1');
  114 | 
  115 |     await page.click('button[type="submit"]');
  116 | 
  117 |     // Verify assignment summary
  118 |     await expect(page.locator('text=SS 4×40')).toBeVisible();
  119 |     await expect(page.locator('text=DH 1×40')).toBeVisible();
  120 |   });
  121 | 
  122 |   test('OPS-007: Select vehicle from assigned carrier', async ({ page }) => {
  123 |     // Login as DISPATCHER
  124 |     await page.fill('input[name="username"]', USERS.dispatcher);
  125 |     await page.fill('input[name="password"]', PASSWORD);
  126 |     await page.click('button[type="submit"]');
  127 | 
  128 |     // Navigate to dispatch plan
  129 |     await page.goto('/dispatch');
  130 | 
  131 |     // Find a shipment with assigned carrier
  132 |     const shipmentRow = page.locator('text=Sẵn sàng điều xe').first();
  133 |     await shipmentRow.click();
  134 | 
  135 |     // Open vehicle selection for first container
  136 |     await page.click('button:has-text("Chọn xe")');
  137 | 
  138 |     // Verify only vehicles from assigned carrier are shown
  139 |     await expect(page.locator('text=Xe thuộc nhà xe đã gán')).toBeVisible();
  140 | 
  141 |     // Select a vehicle and driver
  142 |     await page.selectOption('select[name="vehicleId"]', /^[0-9]+$/);
  143 |     await page.selectOption('select[name="driverId"]', /^[0-9]+$/);
  144 |     await page.fill('input[name="departureTime"]', '2026-08-15T08:00');
  145 | 
```