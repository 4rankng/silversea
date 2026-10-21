/**
 * FB-066 — nút "+ Thêm nhanh" BKS trong dialog "Phân bổ nhà xe".
 *
 * Card 121026141040 → 201026101600 (R27): nút thêm nhanh biển số biến mất
 * khỏi các dialog phân bổ. Luật: dialog "Phân bổ nhà xe" (master plan) luôn
 * mang ô BKS thực với nút "+ Thêm nhanh" cạnh selector — kể cả trên máy trạm
 * có localStorage cũ (pref/quét cột từ build trước). FCL counterpart: editor
 * "Phân bổ nhà xe" trên /dispatch-detail cũng mang nút "+ Thêm nhanh" cạnh
 * "Xe / biển số" khi nhà xe đã chọn.
 */
import { test, expect } from '@playwright/test';
import {
  appReady,
  authedPage,
  createFclLot,
  createLclLot,
  ensureSite,
  findPlanRow,
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

/** Máy trạm có localStorage cũ: key lạ + payload pref từ build trước. */
const STALE_STORAGE: Record<string, string> = {
  'dispatch-master-plan-columns': '["stale","removed-col"]',
  'cus-lots-hidden-cols': '["legacy-column-x"]',
  'dispatch-detail-plan-hidden-cols': '["stale"]',
  'master-plan-quick-filters': '{"mode":"HANG_LE"}',
};

test.describe.configure({ mode: 'serial' });

test('FB-066-LCL: dialog Phân bổ nhà xe (hàng lẻ) có nút Thêm nhanh cạnh BKS thực', async ({ browser }) => {
  const bill = `REGPK-A${serial}`;
  const lot = await createLclLot(admin.token, { bill, routeId: cat.routeId });
  expect(lot.id, 'LCL lot tạo được').toBeTruthy();

  const dv = await authedPage(browser, 'dieuvan', { storage: STALE_STORAGE, viewport: { width: 1440, height: 900 } });
  try {
    await appReady(dv.page, `/dispatch?q=${encodeURIComponent(bill)}`);
    // Tìm nhanh theo bill, rồi scope trigger vào đúng dòng lô của run này.
    const quickSearch = dv.page.getByLabel('Tìm nhanh');
    if (await quickSearch.count()) {
      await quickSearch.fill(bill);
      await dv.page.waitForTimeout(1200);
    }
    const myRow = dv.page.locator('tr', { hasText: bill }).first();
    await expect(myRow).toBeVisible({ timeout: 20_000 });
    const trigger = myRow.locator('.master-plan-grid__allocation-trigger');
    await expect(trigger).toBeVisible();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();

    const dlg = dv.page.locator('[role="dialog"]').first();
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('h2, h3, [class*="title"]').first()).toContainText('Phân bổ nhà xe');

    // BKS thực field head + nút "+ Thêm nhanh" hiện diện (không phụ thuộc localStorage cũ).
    const bksLabel = dlg.locator('span', { hasText: /BKS thực/ }).first();
    await expect(bksLabel).toBeVisible();
    const quickAdd = dlg.getByRole('button', { name: /thêm nhanh/i });
    await expect(quickAdd, 'nút Thêm nhanh phải có trong dialog Phân bổ nhà xe (LCL)').toBeVisible();
    await shot(dv.page, 'fb066-lcl-alloc-dialog-quickadd');

    // Click mở nested "Thêm nhanh biển số xe" — nút wired thật.
    await quickAdd.click();
    const nested = dv.page.locator('[role="dialog"]').nth(1);
    await expect(nested, 'nested dialog "Thêm nhanh biển số xe" mở sau click').toBeVisible({ timeout: 10_000 });
    await shot(dv.page, 'fb066-lcl-quickadd-dialog-open');
  } finally {
    await dv.close();
  }
});

test('FB-066-FCL: editor /dispatch-detail có nút Thêm nhanh cạnh "Xe / biển số"', async ({ browser }) => {
  const siteId = await ensureSite(admin.token, serial + 'F', cat.routeId);
  const bill = `REGPK-F${serial}`;
  await createFclLot(admin.token, {
    bill,
    containers: [{
      containerTypeId: cat.containerTypeId20,
      containerNumber: isoContainerNumber(serial + '6'),
      operationalSiteId: siteId,
      routeId: cat.routeId,
      pickupPortId: cat.pickupPortId,
      dropoffPortId: cat.dropoffPortId,
      cargoWeightKg: 19000,
      customerAppointmentAt: win.appointment,
    }],
  });
  const row = await findPlanRow(admin.token, bill);
  expect(row).not.toBeNull();

  const dv = await authedPage(browser, 'dieuvan', { storage: STALE_STORAGE, viewport: { width: 1440, height: 900 } });
  try {
    // Deep-link ?date=<ngày fixture> để board hiện đúng ngày của lô (board
    // mặc định scope theo tháng topbar).
    const day = win.appointment.slice(0, 10);
    await appReady(dv.page, `/dispatch-detail?q=${encodeURIComponent(bill)}&date=${day}`);
    const quickSearch = dv.page.getByLabel('Tìm nhanh');
    if (await quickSearch.count()) {
      await quickSearch.fill(bill);
      await dv.page.waitForTimeout(1200);
    }
    // Mở editor điều phối của dòng (dialog "Chỉnh sửa điều phối" mang trường
    // nhà xe + "Xe / biển số" với quick-add — surface FB-066 của /dispatch-detail).
    const myRow = dv.page.locator('tr', { hasText: bill }).first();
    await expect(myRow).toBeVisible({ timeout: 20_000 });
    const rowEditorTrigger = myRow.locator('.dispatch-assignment-cell__trigger');
    await expect(rowEditorTrigger).toBeVisible({ timeout: 20_000 });
    await rowEditorTrigger.scrollIntoViewIfNeeded();
    await rowEditorTrigger.click();

    const dlg = dv.page.locator('[role="dialog"]').first();
    await expect(dlg).toBeVisible({ timeout: 10_000 });
    await expect(dlg.locator('[class*="title"], h2, h3').first()).toContainText('Chỉnh sửa điều phối');
    // Chọn nhà xe (OWN fleet) — nút chỉ hiện khi nhà xe đã chọn (thiết kế FB-066).
    if (await dlg.getByRole('button', { name: /thêm nhanh/i }).count() === 0) {
      const carrierTrigger = dlg.locator('.dispatch-assignment-dialog__carrier button').first();
      await expect(carrierTrigger).toBeVisible({ timeout: 10_000 });
      await carrierTrigger.scrollIntoViewIfNeeded();
      await carrierTrigger.click();
      const ownOption = dv.page.locator('[role="option"]', { hasText: 'xe nội bộ' }).first();
      await expect(ownOption, 'option OWN fleet ("… xe nội bộ") hiện').toBeVisible({ timeout: 10_000 });
      await ownOption.click();
      await dv.page.waitForTimeout(700);
    }
    const vehicleHead = dlg.locator('.dispatch-assignment-dialog__vehicle-head, label:has-text("Xe / biển số")').first();
    await expect(vehicleHead).toBeVisible();
    const quickAdd = dlg.getByRole('button', { name: /thêm nhanh/i }).first();
    await expect(quickAdd, 'nút Thêm nhanh cạnh "Xe / biển số" (FCL, nhà xe OWN đã chọn)').toBeVisible();
    await shot(dv.page, 'fb066-fcl-editor-quickadd');
  } finally {
    await dv.close();
  }
});
