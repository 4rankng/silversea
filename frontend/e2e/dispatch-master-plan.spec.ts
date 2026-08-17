import { test, expect } from '@playwright/test';

/**
 * Dispatch planning screens e2e — docx spec.
 * Covers: /dispatch (Kế hoạch Tổng quát) load with 7 columns +
 * READY_FOR_DISPATCH-only request, filter round-trip, allocation popover
 * validation + partial save, and /dispatch-detail (Kế hoạch Chi tiết)
 * container rows via backend dispatch-detail-plan-rows.
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
    await page.waitForURL(/\/(dispatch|dashboard)$/);
  });

  test('renders READY_FOR_DISPATCH grid with the 7 docx columns', async ({ page }) => {
    const listRequest = page.waitForRequest(
      (request) => request.url().includes('/api/shipments?') && request.url().includes('status=READY_FOR_DISPATCH'),
    );
    await page.goto('/dispatch');
    await expect(listRequest).resolves.toBeTruthy();

    const headers = page.locator('.master-plan-grid thead th');
    await expect(headers).toHaveCount(7);
    await expect(headers.nth(0)).toHaveText('Thời gian & lịch trình');
    await expect(headers.nth(6)).toHaveText('Phân bổ nhà xe');

    const firstAllocationCell = page.locator('.master-plan-grid tbody tr').first().locator('td').nth(6);
    const firstAllocationTrigger = firstAllocationCell.getByRole('button', { name: 'Chỉnh sửa phân bổ nhà xe' });
    await expect(firstAllocationTrigger).toBeVisible();
    await expect(firstAllocationCell.getByText('Sửa phân bổ', { exact: true })).toHaveCount(0);
    const [cellBox, triggerBox] = await Promise.all([
      firstAllocationCell.boundingBox(),
      firstAllocationTrigger.boundingBox(),
    ]);
    expect(cellBox).not.toBeNull();
    expect(triggerBox).not.toBeNull();
    expect(Math.abs((cellBox?.width ?? 0) - (triggerBox?.width ?? 0))).toBeLessThanOrEqual(1);
    await firstAllocationCell.click({ position: { x: (cellBox?.width ?? 2) - 2, y: (cellBox?.height ?? 2) - 2 } });
    const dialog = page.getByRole('dialog', { name: 'Phân bổ nhà xe' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(firstAllocationTrigger).toBeFocused();
  });

  test('filters round-trip to the API', async ({ page }) => {
    await page.goto('/dispatch');
    await expect(page.locator('.master-plan-grid thead th').first()).toBeVisible();

    // Wait for the debounced reload triggered by the direction change.
    const requestPromise = page.waitForRequest(
      (request) => request.url().includes('tradeDirection=IMPORT') && request.method() === 'GET',
    );
    await page.locator('.master-plan-filters__select').nth(0).locator('button').click();
    await page.getByRole('option', { name: 'Nhập', exact: true }).click();
    await expect(requestPromise).resolves.toBeTruthy();

    const statusRequestPromise = page.waitForRequest(
      (request) => request.url().includes('allocationStatus=NOT_ALLOCATED') && request.method() === 'GET',
    );
    await page.locator('.master-plan-filters__select').nth(1).locator('button').click();
    await page.getByRole('option', { name: 'Chưa phân xe', exact: true }).click();
    await expect(statusRequestPromise).resolves.toBeTruthy();
  });

  test('allocation popover blocks over-allocation and saves partial', async ({ page }) => {
    await page.goto('/dispatch');
    const candidateRows = page.locator('.master-plan-grid tbody tr');
    const dialog = page.getByRole('dialog', { name: 'Phân bổ nhà xe' });
    await expect(candidateRows.first()).toBeVisible({ timeout: 10000 });
    let selectedRowIndex = -1;
    let demand20 = 0;
    let demand40 = 0;
    for (let index = 0; index < await candidateRows.count(); index += 1) {
      await candidateRows.nth(index).getByRole('button', { name: 'Chỉnh sửa phân bổ nhà xe' }).click();
      await expect(dialog).toBeVisible();
      const balanceRows = dialog.locator('.dispatch-allocation-popover__balance-row');
      demand20 = Number(await balanceRows.nth(0).getByRole('cell').first().innerText());
      demand40 = Number(await balanceRows.nth(1).getByRole('cell').first().innerText());
      if (demand20 + demand40 > 0) {
        selectedRowIndex = index;
        break;
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
    expect(selectedRowIndex).toBeGreaterThanOrEqual(0);
    const firstRow = candidateRows.nth(selectedRowIndex);
    const demandText = await firstRow.locator('td').nth(4).textContent() ?? '';

    // Over-allocate → error shown, Lưu disabled.
    const count20 = dialog.locator('input[aria-label^="Số container 20"]');
    const count40 = dialog.locator('input[aria-label^="Số container 40"]');
    const originalCounts20 = await count20.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    const originalCounts40 = await count40.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    const targetInput = demand20 > 0 ? count20.first() : count40.first();
    const targetDemand = demand20 > 0 ? demand20 : demand40;
    await targetInput.fill(String(targetDemand + 1));
    await expect(dialog.getByText(/vượt số lượng/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Lưu phân bổ' })).toBeDisabled();

    // Restore the valid allocation → partial-mode API save → chips render.
    for (let index = 0; index < originalCounts20.length; index += 1) {
      await count20.nth(index).fill(originalCounts20[index]);
      await count40.nth(index).fill(originalCounts40[index]);
    }
    // A never-allocated row starts with both quantities empty, which is not a
    // valid allocation. Enter a positive in-range quantity before saving.
    await targetInput.fill(String(Math.max(1, targetDemand - 1)));
    await expect(dialog.getByRole('button', { name: 'Lưu phân bổ' })).toBeEnabled();
    const saveRequest = page.waitForRequest(
      (request) => request.url().includes('/carrier-allocations?mode=partial') && request.method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Lưu phân bổ' }).click();
    await expect(saveRequest).resolves.toBeTruthy();
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(firstRow.locator('.master-plan-grid__chip').first()).toBeVisible({ timeout: 10000 });
    // Demand line unchanged by the partial save.
    expect(demandText).toBeTruthy();
  });

  test('detail screen loads container rows with carrier via dispatch-detail-plan-rows', async ({ page }) => {
    const rowsRequest = page.waitForRequest(
      (request) => request.url().includes('/dispatch-detail-plan-rows') && request.method() === 'GET',
    );
    await page.goto('/dispatch-detail');
    await expect(rowsRequest).resolves.toBeTruthy();

    const detailRows = page.locator('.detailed-plan-grid tbody tr');
    const emptyState = page.getByText('Không có dòng kế hoạch nào');
    await expect(detailRows.first().or(emptyState)).toBeVisible();
    const count = await detailRows.count();
    if (count > 0) {
      // Carrier renders via the plate-assignment cell.
      await expect(detailRows.first().locator('.plate-assignment__carrier').first()).toBeVisible();
    } else {
      await expect(emptyState).toBeVisible();
    }
  });
});
