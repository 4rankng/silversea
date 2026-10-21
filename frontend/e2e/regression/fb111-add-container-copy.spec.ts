/**
 * A.1 / FB-111 — "Thêm container" ở Tổng quan copy Tuyến/Nâng/Hạ (từ dòng cont
 * hiện có, fallback về shipment-level).
 *
 * Card 181026185900 → 201026124500 (verify-fail lan 2): dòng thêm container
 * chỉ seed Loại cont/Trọng lượng/Giờ hẹn — Tuyến/Nhà xe/Nâng/Hạ trống dù cont
 * nguồn có đủ. Sau fix: add row seed ĐẦY ĐỦ A.1 set (trừ Số container + Loại
 * cont), và dòng LƯU sau khi nhập số container carry các trường đó.
 */
import { test, expect } from '@playwright/test';
import {
  api,
  appReady,
  authedPage,
  createFclLot,
  ensureSite,
  findPlanRow,
  isoContainerNumber,
  loadCatalogs,
  login,
  planRowSave,
  runSerial,
  runWindow,
  shot,
} from './helpers';

const admin = await login('admin');
const cat = await loadCatalogs(admin.token);
const serial = runSerial();
const win = runWindow(serial);
const bill = `REGPK-${serial}`;
const newContNumber = isoContainerNumber(serial + 'z');

test('A.1/FB-111: add row copy Tuyến/Nhà xe/Nâng/Hạ + persisted row carry đủ', async ({ browser }) => {
  const siteId = await ensureSite(admin.token, serial, cat.routeId);
  const ship = await createFclLot(admin.token, {
    bill,
    containers: [{
      containerTypeId: cat.containerTypeId20,
      containerNumber: isoContainerNumber(serial + '1'),
      operationalSiteId: siteId,
      routeId: cat.routeId,
      pickupPortId: cat.pickupPortId,
      dropoffPortId: cat.dropoffPortId,
      cargoWeightKg: 14000,
      customerAppointmentAt: win.appointment,
    }],
  });
  // Nhà xe có kế hoạch (OWN) để add row seed được cột Nhà xe.
  const row = await findPlanRow(admin.token, bill);
  expect(row).not.toBeNull();
  const planned = await planRowSave(admin.token, row!.fulfillmentId, {
    expectedFulfillmentVersion: row!.version,
    expectedShipmentVersion: row!.shipmentVersion,
    carrierType: 'OWN',
    truckId: cat.truckId,
    classification: 'SINGLE',
    plannedRevenue: 2000000,
    plannedCarrierCost: 1500000,
  });
  expect(planned.status, JSON.stringify(planned.body).slice(0, 200)).toBe(200);

  // Catalog names để so sánh seed.
  const routes = await api<{ items: Array<{ id: number; name: string }> }>(admin.token, 'GET', '/routes');
  const ports = await api<{ items: Array<{ id: number; name: string }> }>(admin.token, 'GET', '/ports');
  const routeName = routes.body.items.find((r) => r.id === cat.routeId)?.name ?? '';
  const liftName = ports.body.items.find((p) => p.id === cat.pickupPortId)?.name ?? '';
  const dropName = ports.body.items.find((p) => p.id === cat.dropoffPortId)?.name ?? '';

  const cus = await authedPage(browser, 'cus', { viewport: { width: 1440, height: 900 } });
  try {
    await appReady(cus.page, `/shipments?searchSuffix=${encodeURIComponent(bill)}&transportDateFrom=2027-01-01&transportDateTo=2027-12-31`);
    const detailBtn = cus.page.locator(`#cus-dashboard-detail-${ship.id}`);
    await expect(detailBtn).toBeVisible({ timeout: 20_000 });
    await detailBtn.scrollIntoViewIfNeeded();
    await detailBtn.click();

    const ledger = cus.page.locator('.cus-container-ledger');
    await expect(ledger).toBeVisible({ timeout: 10_000 });

    // "Thêm container" mở add row — các cột copy-down HIỆN seed (không trống).
    const addBtn = ledger.getByRole('button', { name: /^Thêm container$/ });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.first().scrollIntoViewIfNeeded();
    await addBtn.first().click();
    await cus.page.waitForTimeout(400);

    const addRow = ledger.locator('tfoot tr').last();
    const cellText = async (label: string) => addRow.locator(`[data-label="${label}"]`).first().innerText();
    await expect(addRow.locator('input[aria-label="Số container"]')).toBeVisible();
    expect((await cellText('Tuyến')).trim(), 'add row seed Tuyến từ dòng cont').toContain(routeName.slice(0, 6));
    expect((await cellText('Nâng')).trim(), 'add row seed Nâng').toContain(liftName.slice(0, 6));
    expect((await cellText('Hạ')).trim(), 'add row seed Hạ').toContain(dropName.slice(0, 6));
    const nhaXe = (await cellText('Nhà xe')).trim();
    expect(nhaXe, 'add row seed Nhà xe (kế hoạch OWN)').toContain('SilverSea');
    await shot(cus.page, 'fb111-add-row-seeded');

    // Nhập CHỈ số container (Loại cont là entry của operator — ngoài A.1 set).
    await addRow.locator('input[aria-label="Số container"]').fill(newContNumber);
    await ledger.getByRole('button', { name: /^Thêm$/, exact: true }).first().click();
    await cus.page.waitForTimeout(1800);
    await shot(cus.page, 'fb111-added-row-persisted');

    // API readback: dòng mới carry Tuyến/Nâng/Hạ/Nhà xe từ cont nguồn.
    const detail = await api<{ containers?: Array<{ containerNumber: string; routeName: string | null; liftSite: string | null; dropoffSite: string | null; carrierName: string | null }> }>(
      admin.token, 'GET', `/shipments/cus-workspace/${ship.id}`,
    );
    const added = (detail.body.containers ?? []).find((c) => c.containerNumber === newContNumber);
    expect(added, `dòng ${newContNumber} đã lưu`).toBeTruthy();
    expect(added!.routeName ?? '', 'persisted row copy Tuyến').toContain(routeName.slice(0, 6));
    expect(added!.liftSite ?? '', 'persisted row copy Nâng').toContain(liftName.slice(0, 6));
    expect(added!.dropoffSite ?? '', 'persisted row copy Hạ').toContain(dropName.slice(0, 6));
    expect(added!.carrierName ?? '', 'persisted row carry Nhà xe').toContain('SilverSea');
  } finally {
    await cus.close();
  }
});
