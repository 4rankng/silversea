import { test, expect } from '@playwright/test';

/**
 * O2C Lifecycle E2E Tests
 * Tests Order-to-Cash workflow from shipment creation to completion
 *
 * Corresponds to QA test cases:
 * - OPS-002: Tạo lô LCL và chuyển sẵn sàng theo ngày
 * - OPS-004: Hoàn thiện hồ sơ và kích hoạt ngày điều vận
 * - OPS-006: Gán nhà xe theo số lượng và rã FCL theo container
 * - OPS-007: Chọn xe đúng nhà xe đã gán
 * - OPS-008: Chặn xung đột xe, tài xế và lịch
 * - OPS-009: Kẹp hai lệnh tương thích
 * - OPS-010: Phát lệnh và chuyển trạng thái Đã phân xe
 * - OPS-011: Tài xế bắt đầu vận chuyển và cập nhật mốc đúng thứ tự
 * - OPS-012: Nộp e-POD đầy đủ từng fulfillment
 * - OPS-013: Ghi chi phí hiện trường theo tariff
 * - OPS-014: Hoàn tất vận hành và chuyển Chờ duyệt chi phí
 * - OPS-015: Duyệt chi phí và hoàn thành lô nguyên tử
 */

const USERS = JSON.parse(process.env.STAGING_USERS || '{}');
const PASSWORD = process.env.STAGING_PASSWORD || 'Abc123';
const CUS_USERNAME = USERS.cus || USERS.clerk || 'cus';

test.describe('O2C Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to login page
    await page.goto('/');
  });

  test('OPS-002: Create LCL shipment and transition to ready by date', async ({ page }) => {
    // Login as CUS/CLERK
    await page.fill('input[name="username"]', CUS_USERNAME);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for navigation to dashboard
    await page.waitForURL('/shipments');

    // Open the canonical standalone create page from the shipment workspace.
    await page.getByRole('button', { name: 'Tạo lô mới' }).click();
    await page.waitForURL('/shipments/new');

    // Fill LCL shipment form
    await page.getByRole('combobox', { name: /Khách hàng/ }).click();
    await page.getByRole('option').first().click();
    await page.getByRole('textbox', { name: 'Số Bill/Booking' }).fill(`QA-LCL-${Date.now()}`);
    await page.getByRole('combobox', { name: 'Hình thức xuất nhập khẩu' }).selectOption('IMPORT');
    await page.getByRole('radio', { name: 'Hàng lẻ (LCL)' }).check();

    // Enter LCL details
    await page.getByRole('spinbutton', { name: 'Số lượng' }).fill('12');
    await page.getByRole('spinbutton', { name: 'Trọng lượng (kg)' }).fill('8500');
    await page.getByRole('spinbutton', { name: 'Thể tích (CBM)' }).fill('18.5');

    // Saving a draft remains customer-only and continues to the dossier page.
    await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
    await page.waitForURL(/\/clerk\/shipments\/\d+\/docs/);
    await expect(page).toHaveURL(/\/clerk\/shipments\/\d+\/docs/);
  });

  test('OPS-004: Complete documents and activate dispatch date', async ({ page }) => {
    // Login as CUS
    await page.fill('input[name="username"]', CUS_USERNAME);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Navigate to an existing PENDING_DATE shipment
    await page.goto('/shipments');
    await page.click('text=Chờ ngày điều vận').first();

    // Fill in B/L and container details
    await page.fill('input[name="blNumber"]', `BL${Date.now()}`);
    await page.fill('input[name="containerNumbers"]', 'MSKU1234565');
    await page.fill('input[name="sealNumbers"]', 'SEAL123456');

    // Set delivery date to trigger READY_FOR_DISPATCH
    await page.fill('input[name="expectedDeliveryDate"]', '2026-08-15');
    await page.click('button[type="submit"]');

    // Verify transition to READY_FOR_DISPATCH
    await expect(page.locator('text=Sẵn sàng điều xe')).toBeVisible();
    await expect(page.locator('button:has-text("Gán nhà xe")')).toBeVisible();
  });

  test('OPS-006: Assign carriers by quantity and split FCL by container', async ({ page }) => {
    // Login as CUS
    await page.fill('input[name="username"]', CUS_USERNAME);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Navigate to a READY_FOR_DISPATCH shipment with multiple containers
    await page.goto('/shipments?status=READY_FOR_DISPATCH');
    await page.click('text=Chi tiết').first();

    // Click "Gán nhà xe" (Assign carriers)
    await page.click('button:has-text("Gán nhà xe")');

    // Verify carrier assignment dialog
    await expect(page.locator('text=Gán nhà xe theo container')).toBeVisible();

    // Assign 4x40' to carrier SS and 1x40' to carrier DH
    await page.selectOption('select[name="carrierId_0"]', 'SS');
    await page.selectOption('select[name="containerSize_0"]', '40');
    await page.fill('input[name="containerCount_0"]', '4');

    await page.click('button:has-text("Thêm dòng")');
    await page.selectOption('select[name="carrierId_1"]', 'DH');
    await page.selectOption('select[name="containerSize_1"]', '40');
    await page.fill('input[name="containerCount_1"]', '1');

    await page.click('button[type="submit"]');

    // Verify assignment summary
    await expect(page.locator('text=SS 4×40')).toBeVisible();
    await expect(page.locator('text=DH 1×40')).toBeVisible();
  });

  // OPS-007/008/010 exercised the legacy dispatch console (issue dispatch
  // order) that was removed when /dispatch became Kế hoạch Tổng quát. The
  // replacement flow — carrier allocation on /dispatch + per-container plate
  // assignment on /dispatch-detail — is covered by dispatch-master-plan.spec.ts.
  // TODO: rewrite these lifecycle scenarios against the new planning flow.
  test.skip('OPS-007: Select vehicle from assigned carrier', async ({ page }) => {
    // Login as DISPATCHER
    await page.fill('input[name="username"]', USERS.dispatcher);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Navigate to dispatch plan
    await page.goto('/dispatch');

    // Find a shipment with assigned carrier
    const shipmentRow = page.locator('text=Sẵn sàng điều xe').first();
    await shipmentRow.click();

    // Open vehicle selection for first container
    await page.click('button:has-text("Chọn xe")');

    // Verify only vehicles from assigned carrier are shown
    await expect(page.locator('text=Xe thuộc nhà xe đã gán')).toBeVisible();

    // Select a vehicle and driver
    await page.selectOption('select[name="vehicleId"]', /^[0-9]+$/);
    await page.selectOption('select[name="driverId"]', /^[0-9]+$/);
    await page.fill('input[name="departureTime"]', '2026-08-15T08:00');

    await page.click('button[type="submit"]');

    // Verify assignment persisted
    await expect(page.locator('text=Đã gán xe')).toBeVisible();
  });

  test.skip('OPS-008: Block conflicting vehicle, driver, and schedule', async ({ page }) => {
    // Login as DISPATCHER
    await page.fill('input[name="username"]', USERS.dispatcher);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.goto('/dispatch');

    // Try to assign same vehicle to conflicting trip
    await page.click('text=Chi tiết').first();
    await page.click('button:has-text("Chọn xe")');

    // Select vehicle already assigned (should be blocked)
    await page.selectOption('select[name="vehicleId"]', { label: 'Xe đã điều' });

    // Verify conflict warning
    await expect(page.locator('text=Xung đột lịch điều xe')).toBeVisible();
  });

  test.skip('OPS-010: Issue dispatch order and transition to DISPATCHED', async ({ page }) => {
    // Login as DISPATCHER
    await page.fill('input[name="username"]', USERS.dispatcher);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.goto('/dispatch');

    // Find shipment with assigned vehicles
    const shipmentRow = page.locator('text=Đã gán xe').first();
    await shipmentRow.click();

    // Click "Phát lệnh" (Issue dispatch order)
    await page.click('button:has-text("Phát lệnh")');

    // Confirm in dialog
    await page.click('button:has-text("Xác nhận")');

    // Verify transition to DISPATCHED state
    await expect(page.locator('text=Đã phân xe')).toBeVisible();
  });

  test('OPS-011: Driver starts transport and updates milestones in order', async ({ page }) => {
    // Login as DRIVER
    await page.fill('input[name="username"]', USERS.driver);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Navigate to my trips
    await page.goto('/my-trips');

    // Find IN_TRANSIT trip
    const tripRow = page.locator('text=Đang chạy').first();
    await tripRow.click();

    // Verify milestone sequence
    await expect(page.locator('text=Đã nhận hàng')).toBeVisible();
    await expect(page.locator('text=Đang vận chuyển')).toBeVisible();

    // Update milestone: Arrived at destination
    await page.click('button:has-text("Đã đến nơi")');

    // Verify milestone updated
    await expect(page.locator('text=Đã đến nơi')).toBeVisible();
  });

  test('OPS-012: Submit complete e-POD for each fulfillment', async ({ page }) => {
    // Login as DRIVER
    await page.fill('input[name="username"]', USERS.driver);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.goto('/my-trips');

    // Find trip requiring POD
    const tripRow = page.locator('text=Chờ nộp POD').first();
    await tripRow.click();

    // Upload POD document
    await page.click('button:has-text("Tải lên POD")');
    await page.setInputFiles('input[type="file"]', 'e2e/fixtures/sample-pod.png');

    // Submit for review
    await page.click('button:has-text("Gửi duyệt")');

    // Verify submission successful
    await expect(page.locator('text=Đã nộp POD')).toBeVisible();
  });
});
