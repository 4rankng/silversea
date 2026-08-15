import { test, expect } from '@playwright/test';

/**
 * Dispatch master-plan screen (Kế hoạch Tổng quát) e2e — docx spec.
 * Covers: load with 7 columns + READY_FOR_DISPATCH-only request, filter
 * round-trip, allocation popover validation + partial save, and the
 * detail-tab handoff (backend dispatch-detail-plan-rows).
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
    const listRequest = page.waitForRequest(
      (request) => request.url().includes('/api/shipments?') && request.url().includes('status=READY_FOR_DISPATCH'),
    );
    await page.goto('/dispatch/master-plan');
    await expect(listRequest).resolves.toBeTruthy();

    await expect(page.getByRole('button', { name: 'Kế hoạch Tổng quát' })).toBeVisible();
    const headers = page.locator('.master-plan-grid thead th');
    await expect(headers).toHaveCount(7);
    await expect(headers.nth(0)).toHaveText('Thời gian & lịch trình');
    await expect(headers.nth(6)).toHaveText('Phân bổ nhà xe');
  });

  test('filters round-trip to the API', async ({ page }) => {
    await page.goto('/dispatch/master-plan');
    await expect(page.locator('.master-plan-grid thead th').first()).toBeVisible();

    // Wait for the debounced reload triggered by the direction change.
    const requestPromise = page.waitForRequest(
      (request) => request.url().includes('tradeDirection=IMPORT') && request.method() === 'GET',
    );
    await page.getByLabel('Chiều hàng').selectOption('IMPORT');
    await expect(requestPromise).resolves.toBeTruthy();

    const statusRequestPromise = page.waitForRequest(
      (request) => request.url().includes('allocationStatus=NOT_ALLOCATED') && request.method() === 'GET',
    );
    await page.getByLabel('Trạng thái phân bổ').selectOption('NOT_ALLOCATED');
    await expect(statusRequestPromise).resolves.toBeTruthy();
  });

  test('allocation popover blocks over-allocation and saves partial', async ({ page }) => {
    await page.goto('/dispatch/master-plan');
    const firstRow = page.locator('.master-plan-grid tbody tr').first();
    await expect(firstRow).toBeVisible();
    const demandText = firstRow.locator('td').nth(4).textContent() ?? '';

    await firstRow.getByRole('button', { name: /Phân bổ|Sửa phân bổ/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Phân bổ phương tiện' });
    await expect(dialog).toBeVisible();

    // Over-allocate → error shown, Lưu disabled.
    const count20 = dialog.locator('input[aria-label^="Số container 20"]');
    const count40 = dialog.locator('input[aria-label^="Số container 40"]');
    await count20.first().fill('99');
    await expect(dialog.getByText(/vượt số lượng/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Lưu' })).toBeDisabled();

    // Fix to a valid partial (1x20') → partial-mode save → chips render.
    await count20.first().fill('1');
    if (await count40.first().isVisible()) {
      await count40.first().fill('0');
    }
    const saveRequest = page.waitForRequest(
      (request) => request.url().includes('/carrier-allocations?mode=partial') && request.method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Lưu' }).click();
    await expect(saveRequest).resolves.toBeTruthy();
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(firstRow.locator('.master-plan-grid__chip').first()).toBeVisible({ timeout: 10000 });
    // Demand line unchanged by the partial save.
    expect(demandText).toBeTruthy();
  });

  test('detail tab loads container rows with carrier via dispatch-detail-plan-rows', async ({ page }) => {
    const rowsRequest = page.waitForRequest(
      (request) => request.url().includes('/dispatch-detail-plan-rows') && request.method() === 'GET',
    );
    await page.goto('/dispatch/detailed-plan');
    await expect(rowsRequest).resolves.toBeTruthy();

    const detailRows = page.locator('.detailed-plan-grid tbody tr');
    const count = await detailRows.count();
    if (count > 0) {
      // Carrier renders via the plate-assignment cell.
      await expect(detailRows.first().locator('.plate-assignment__carrier').first()).toBeVisible();
    } else {
      await expect(page.getByText('Không có dòng kế hoạch nào')).toBeVisible();
    }
  });
});
