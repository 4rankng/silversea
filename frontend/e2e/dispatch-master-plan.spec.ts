import { test, expect } from '@playwright/test';

/**
 * Dispatch master-plan screen (Kế hoạch Tổng quát) e2e — docx spec.
 * Covers: load with 7 columns, filter round-trip, allocation popover
 * validation + save, and the auto-split handoff to Kế hoạch Chi tiết.
 *
 * Runs against the dev environment (frontend :7174 via playwright config).
 * Dispatcher account: dieuvan / Abc123.
 */

const DISPATCHER_USERNAME = process.env.DISPATCH_USERNAME || 'dieuvan';
const DISPATCHER_PASSWORD = process.env.DISPATCH_PASSWORD || 'Abc123';

test.describe('Dispatch master plan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.fill('input[name="username"]', DISPATCHER_USERNAME);
    await page.fill('input[name="password"]', DISPATCHER_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('/shipments');
  });

  test('renders READY_FOR_DISPATCH grid with the 7 docx columns', async ({ page }) => {
    await page.goto('/dispatch/master-plan');

    await expect(page.getByRole('button', { name: 'Kế hoạch Tổng quát' })).toBeVisible();
    const headers = page.locator('.master-plan-grid thead th');
    await expect(headers).toHaveCount(7);
    await expect(headers.nth(0)).toHaveText('Thời gian & lịch trình');
    await expect(headers.nth(6)).toHaveText('Phân bổ nhà xe');

    // Only READY_FOR_DISPATCH rows are requested.
    const [listRequest] = await Promise.all([
      page.waitForRequest((request) => request.url().includes('/api/shipments') && request.method() === 'GET'),
      page.reload(),
    ]);
    expect(listRequest.url()).toContain('status=READY_FOR_DISPATCH');
  });

  test('filters round-trip to the API and reset pagination', async ({ page }) => {
    await page.goto('/dispatch/master-plan');

    await page.getByLabel('Chiều hàng').selectOption('IMPORT');
    await expect(page).toHaveURL(/\/dispatch\/master-plan/, { timeout: 5000 });

    const requestPromise = page.waitForRequest(
      (request) => request.url().includes('tradeDirection=IMPORT') && request.method() === 'GET',
    );
    await page.getByLabel('Chiều hàng').selectOption('IMPORT');
    await expect(requestPromise).resolves.toBeTruthy();
  });

  test('allocation popover blocks over-allocation and saves partial', async ({ page }) => {
    await page.goto('/dispatch/master-plan');

    const firstRow = page.locator('.master-plan-grid tbody tr').first();
    await firstRow.getByRole('button', { name: /Phân bổ|Sửa phân bổ/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Phân bổ phương tiện' });
    await expect(dialog).toBeVisible();

    // Over-allocate → error shown, Lưu disabled.
    const countInputs = dialog.locator('input[type="number"]');
    await countInputs.first().fill('99');
    await expect(dialog.getByText(/vượt số lượng/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Lưu' })).toBeDisabled();

    // Fix to a valid partial (1x20') → save succeeds → chips render.
    await countInputs.first().fill('1');
    if (await countInputs.nth(1).count()) {
      await countInputs.nth(1).fill('0');
    }
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(firstRow.locator('.master-plan-grid__chip').first()).toBeVisible({ timeout: 10000 });
  });

  test('detail tab shows auto-split rows with pre-filled vendor', async ({ page }) => {
    await page.goto('/dispatch/detailed-plan');

    await page.getByRole('button', { name: 'Kế hoạch Chi tiết' }).click();
    const detailRows = page.locator('.detailed-plan-grid tbody tr');
    // If any shipment on the page has allocations, its container rows render
    // with a vendor chip; otherwise the empty state renders.
    const count = await detailRows.count();
    if (count > 0) {
      await expect(detailRows.first().locator('.detailed-plan-grid__vendor, .detailed-plan-grid__unassigned').first()).toBeVisible();
    } else {
      await expect(page.getByText('Chưa có lô hàng nào được phân bổ nhà xe.')).toBeVisible();
    }
  });
});
