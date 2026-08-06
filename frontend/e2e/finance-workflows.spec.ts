import { test, expect } from '@playwright/test';

/**
 * Finance Workflow E2E Tests
 * Tests financial processes from expense approval to AR/AP settlement
 *
 * Corresponds to QA test cases:
 * - FIN-003: Track AR and aging
 * - FIN-004: Record and allocate payments received
 * - FIN-005: Confirm or dispute Debit Note
 * - FIN-006: Track AP and vendor payment deadlines
 * - FIN-007: Pay AP in full and partial
 * - FIN-008: Request, approve, and settle advances
 * - FIN-009: Non-invoiced expenses by threshold
 * - FIN-010: Approval queue by separated roles
 * - FIN-011: Exceed credit limit
 * - FIN-012: Treasury ledger with source tracking
 * - FIN-013: Offset AR/AP same legal entity
 * - FIN-014: P&L and source reconciliation
 * - FIN-015: Lock shipment and unlock by same person who locked
 */

const USERS = JSON.parse(process.env.STAGING_USERS || '{}');
const PASSWORD = process.env.STAGING_PASSWORD || 'Abc123';

test.describe('Finance Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('FIN-003: Track AR and aging', async ({ page }) => {
    // Login as ACCOUNTANT
    await page.fill('input[name="identifier"]', USERS.accountant);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Navigate to AR aging report
    await page.goto('/accounting/receivables-aging');

    // Verify aging buckets displayed
    await expect(page.locator('text=Tuổi nợ')).toBeVisible();
    await expect(page.locator('text=0-30 ngày')).toBeVisible();
    await expect(page.locator('text=31-60 ngày')).toBeVisible();
    await expect(page.locator('text=61-90 ngày')).toBeVisible();
    await expect(page.locator('text=Trên 90 ngày')).toBeVisible();
  });

  test('FIN-005: Confirm or dispute Debit Note', async ({ page }) => {
    // Login as CUSTOMER
    await page.fill('input[name="identifier"]', USERS.customer);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Navigate to debit notes
    await page.goto('/portal/debit-notes');

    // Click on a pending debit note
    await page.click('text=Chờ xác nhận').first();

    // Verify confirm/dispute buttons
    await expect(page.locator('button:has-text("Xác nhận")')).toBeVisible();
    await expect(page.locator('button:has-text("Tranh chấp")')).toBeVisible();

    // Test confirm action
    await page.click('button:has-text("Xác nhận")');
    await page.click('button:has-text("Xác nhận lại")');

    // Verify status updated
    await expect(page.locator('text=Đã xác nhận')).toBeVisible();
  });

  test('FIN-006: Track AP and vendor payment deadlines', async ({ page }) => {
    // Login as ACCOUNTANT
    await page.fill('input[name="identifier"]', USERS.accountant);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Navigate to AP ledger
    await page.goto('/accounting/payable');

    // Verify payment deadline tracking
    await expect(page.locator('text=Hạn trả')).toBeVisible();
    await expect(page.locator('text=Số ngày còn lại')).toBeVisible();
  });

  test('FIN-008: Request, approve, and settle advance', async ({ page }) => {
    // Login as FORWARDER
    await page.fill('input[name="identifier"]', USERS.forwarder);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Navigate to advance requests
    await page.goto('/forwarder/me/advance-requests');

    // Click "Yêu cầu tạm ứng" (Request advance)
    await page.click('button:has-text("Yêu cầu tạm ứng")');

    // Fill advance request form
    await page.fill('input[name="amount"]', '1000000');
    await page.fill('textarea[name="reason"]', 'Chi phí xăng dầu');
    await page.click('button[type="submit"]');

    // Verify request submitted
    await expect(page.locator('text=Đã gửi yêu cầu')).toBeVisible();

    // Login as MANAGER to approve
    await page.goto('/');
    await page.fill('input[name="identifier"]', USERS.manager);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Navigate to approval queue
    await page.goto('/governance-actions?entity_type=advance_requests');

    // Click on pending request
    await page.click('text=Chờ duyệt').first();

    // Approve the request
    await page.click('button:has-text("Duyệt")');
    await page.click('button:has-text("Xác nhận")');

    // Verify approved
    await expect(page.locator('text=Đã duyệt')).toBeVisible();
  });

  test('FIN-015: Lock shipment and unlock by same person', async ({ page }) => {
    // Login as ACCOUNTANT
    await page.fill('input[name="identifier"]', USERS.accountant);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Navigate to shipments
    await page.goto('/accounting/shipments');

    // Find a completed shipment
    await page.click('text=Hoàn thành').first();

    // Lock the shipment
    await page.click('button:has-text("Khóa lô")');

    // Verify lock banner with username and timestamp
    await expect(page.locator('text=Đã khóa bởi')).toBeVisible();
    await expect(page.locator('text=USERS.accountant')).toBeVisible();

    // Try to unlock (should work for same person)
    await page.click('button:has-text("Mở khóa")');
    await page.click('button:has-text("Xác nhận")');

    // Verify unlocked
    await expect(page.locator('text=Đã mở khóa')).toBeVisible();
  });

  test('FIN-010: Approval queue by separated roles', async ({ page }) => {
    // Login as MANAGER
    await page.fill('input[name="identifier"]', USERS.manager);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Navigate to governance approval queue
    await page.goto('/governance-actions');

    // Verify queue shows different entity types
    await expect(page.locator('text=Debit Note')).toBeVisible();
    await expect(page.locator('text=Yêu cầu tạm ứng')).toBeVisible();
    await expect(page.locator('text=Chi phí vận hành')).toBeVisible();

    // Verify role-based filtering
    await page.click('select[name="entityType"]');

    // Check that manager can approve advance requests
    await expect(page.locator('option[value="advance_requests"]')).toBeVisible();
  });
});
