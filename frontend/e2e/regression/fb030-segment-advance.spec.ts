/**
 * FB-030/075 — auto-advance segment khi gõ liên tục.
 *
 * Card 171026215500 (c2, sibling sweep miss): host ledger /shipments-detail
 * (`ShipmentContainerScheduleEditor`) chưa wire `onComplete` — gõ "1430" xong
 * focus KHÔNG nhảy sang phân đoạn Ngày → số "14" tiếp theo rơi vào ô giờ.
 * Sau fix: giờ complete → focus `[data-seg="dd"]`; gõ "14" ở dd → advance
 * sang month. Host dialog (/shipments quick-edit) giữ nguyên hành vi.
 */
import { test, expect } from '@playwright/test';
import {
  appReady,
  authedPage,
  createFclLot,
  ensureSite,
  isoContainerNumber,
  loadCatalogs,
  login,
  runSerial,
  runWindow,
  shot,
} from './helpers';

const admin = await login('admin');
const cat = await loadCatalogs(admin.token);
const serial = runSerial();
const win = runWindow(serial);

test('c2 — /shipments-detail ledger: "1430" xong focus sang Ngày (dd); "14" ở dd advance sang tháng', async ({ browser }) => {
  const siteId = await ensureSite(admin.token, serial, cat.routeId);
  const bill = `REGPK-${serial}`;
  await createFclLot(admin.token, {
    bill,
    containers: [{
      containerTypeId: cat.containerTypeId20,
      containerNumber: isoContainerNumber(serial + '4'),
      operationalSiteId: siteId,
      routeId: cat.routeId,
      pickupPortId: cat.pickupPortId,
      dropoffPortId: cat.dropoffPortId,
      cargoWeightKg: 16000,
      customerAppointmentAt: win.appointment,
    }],
  });

  const cus = await authedPage(browser, 'cus');
  try {
    await appReady(cus.page, `/shipments-detail?searchSuffix=${encodeURIComponent(bill)}&transportDateFrom=2027-01-01&transportDateTo=2027-12-31`);
    // Mở inline editor lịch trình của dòng container (trigger id
    // shipment-detail-edit-schedule-<containerId>).
    const trigger = cus.page.locator('[id^="shipment-detail-edit-schedule-"]').first();
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();

    await expect(cus.page.getByText('Chỉnh sửa lịch trình').first()).toBeVisible({ timeout: 10_000 });
    await shot(cus.page, 'fb030-schedule-editor-open');

    // Gõ "1430" vào Giờ → focus phải nhảy sang dd của Ngày (FB-030 hand-off).
    const timeInput = cus.page.locator('.time-input input').first();
    await timeInput.click();
    await cus.page.keyboard.type('1430', { delay: 70 });
    await cus.page.waitForTimeout(350);
    const activeSegAfterTime = await cus.page.evaluate(() => document.activeElement?.getAttribute('data-seg'));
    expect(activeSegAfterTime, 'sau "1430": focus phải ở data-seg="dd" (Ngày)').toBe('dd');
    await shot(cus.page, 'fb030-after-1430-focus-dd');

    // Gõ tiếp "14" ở dd → advance sang month (mm2) — engine auto-advance.
    await cus.page.keyboard.type('14', { delay: 80 });
    await cus.page.waitForTimeout(350);
    const activeSegAfterDay = await cus.page.evaluate(() => document.activeElement?.getAttribute('data-seg'));
    expect(activeSegAfterDay, 'sau "14" ở dd: focus phải advance sang mm2 (tháng)').toBe('mm2');
    await shot(cus.page, 'fb030-after-14-advance-month');
  } finally {
    await cus.close();
  }
});
