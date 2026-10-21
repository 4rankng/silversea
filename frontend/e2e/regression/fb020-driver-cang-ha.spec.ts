/**
 * FB-020 — Cảng hạ / Địa chỉ giao hàng map đúng trên driver trip detail.
 *
 * Card gốc (171026205400, R21 verify-fail): IMPORT FCL, container KHÔNG có
 * cảng hạ (không port, không free-text) nhưng CÓ operational site → lệnh tài
 * xế hiển thị "Chưa có cảng hạ" trong khi Địa chỉ giao hàng là nhà máy → tài
 * xế hiểu nhầm địa điểm. Sau fix: cảng hạ = tên điểm trả (site), hai hàng
 * cùng tên chỗ khi cùng một nơi; control trip CÓ cảng hạ hiển thị riêng đúng.
 */
import { test, expect } from '@playwright/test';
import {
  api,
  appReady,
  authedPage,
  claimTrucks,
  createFclLot,
  ensureSite,
  findPlanRow,
  issueDispatch,
  isoContainerNumber,
  loadCatalogs,
  login,
  planRowSave,
  psql,
  runSerial,
  runWindow,
  shot,
  usernameOfUser,
} from './helpers';

const adminToken = (await login('admin')).token;
const cat = await loadCatalogs(adminToken);
const serial = runSerial();
const win = runWindow(serial);
// Xe riêng cho spec này — FB-081 dùng 2 xe ACTIVE đầu tiên; spec này lấy 2 xe
// KẾ TIẾP để hai spec không bao giờ chia nhau tài nguyên guard trùng lịch.
const allTrucks = await claimTrucks(adminToken, 4, []);
const trucks = allTrucks.slice(2, 4);
const truckA = trucks[0];
const truckB = trucks[1];

test.describe.configure({ mode: 'serial' });

test('TC-FB020-001: portless IMPORT — Cảng hạ = tên điểm trả, Địa chỉ giao hàng = nhà máy đầy đủ', async ({ browser }) => {
  const siteId = await ensureSite(adminToken, serial, cat.routeId);
  const bill = `REGPK-${serial}`;
  const ship = await createFclLot(adminToken, {
    bill,
    containers: [{
      containerTypeId: cat.containerTypeId20,
      containerNumber: isoContainerNumber(serial + '1'),
      operationalSiteId: siteId,
      routeId: cat.routeId,
      pickupPortId: cat.pickupPortId,
      // dropoffPortId cố ý KHÔNG set — hình fixture portless của card gốc
      cargoWeightKg: 20000,
      customerAppointmentAt: win.appointment,
    }],
  });
  let row = await findPlanRow(adminToken, bill);
  expect(row, 'plan row sau create').not.toBeNull();
  row = row!;

  const planned = await planRowSave(adminToken, row.fulfillmentId, {
    expectedFulfillmentVersion: row.version,
    expectedShipmentVersion: row.shipmentVersion,
    carrierType: 'OWN',
    truckId: truckA.truckId,
    classification: 'SINGLE',
    plannedRevenue: 2500000,
    plannedCarrierCost: 1800000,
  });
  expect(planned.status, JSON.stringify(planned.body)).toBe(200);

  row = (await findPlanRow(adminToken, bill))!;
  const issued = await issueDispatch(adminToken, ship.id, {
    fulfillmentId: row.fulfillmentId,
    expectedVersion: row.version,
    plannedStartAt: win.start,
    plannedEndAt: win.end,
    carrierType: 'OWN',
    truckId: truckA.truckId,
    driverId: truckA.driverId,
  });
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  const tripId = issued.body.trip!.id;

  // DB proof: trip live gắn đúng driver, container không có dropoff port.
  const db = await psql(
    `SELECT t.id, t.driver_id, sc.dropoff_port_id, sc.raw_dropoff_port_name FROM trips t JOIN shipment_fulfillments f ON f.id = t.fulfillment_id JOIN shipment_containers sc ON sc.id = f.shipment_container_id WHERE t.id = ${tripId}`,
  );
  expect(db, `fixture portless: trip=${tripId} không có dropoff port — ${db}`).toMatch(new RegExp(`^${tripId}[|]${truckA.driverId}[|]{2}$`));

  // Driver mở lệnh (viewport mobile 390 như tài xế thật).
  const drv = await authedPage(browser, await usernameOf(truckA.driverId), { viewport: { width: 390, height: 844 } });
  try {
    await appReady(drv.page, `/my-trips/${tripId}`);
    const facts = drv.page.locator('.driver-task-fact');
    await expect(facts.first()).toBeVisible({ timeout: 20_000 });
    const rows = await facts.evaluateAll((els) => els.map((el) => ({
      label: el.querySelector('.driver-task-fact__label')?.textContent?.trim() ?? null,
      value: el.querySelector('.driver-task-fact__value')?.textContent?.trim() ?? null,
    })));
    const cangHa = rows.find((r) => r.label === 'Cảng hạ')?.value ?? null;
    const diaChi = rows.find((r) => r.label === 'Địa chỉ giao hàng')?.value ?? null;
    const siteName = `NM REGPK ${serial}`;
    expect(cangHa, `Cảng hạ phải là tên điểm trả (${siteName}), không phải "Chưa có cảng hạ"`).toBe(siteName);
    expect(diaChi, 'Địa chỉ giao hàng = tên đầy đủ + địa chỉ nhà máy').toContain(siteName);
    expect(diaChi).toContain('Khu 2, Phường Võ Cường');
    await shot(drv.page, 'fb020-01-portless-cang-ha');
  } finally {
    await drv.close();
  }
});

test('TC-FB020-002 (control): IMPORT CÓ cảng hạ — hai hàng khác nhau, không đổ lẫn', async ({ browser }) => {
  const bill2 = `REGPK-${serial}C`;
  const ship2 = await createFclLot(adminToken, {
    bill: bill2,
    containers: [{
      containerTypeId: cat.containerTypeId20,
      containerNumber: isoContainerNumber(serial + '2'),
      routeId: cat.routeId,
      pickupPortId: cat.pickupPortId,
      dropoffPortId: cat.dropoffPortId,
      cargoWeightKg: 18000,
      customerAppointmentAt: win.appointment,
    }],
  });
  const truck2 = truckB.truckId;
  const driver2 = truckB;
  let row = await findPlanRow(adminToken, bill2);
  expect(row).not.toBeNull();
  row = row!;
  await planRowSave(adminToken, row.fulfillmentId, {
    expectedFulfillmentVersion: row.version,
    expectedShipmentVersion: row.shipmentVersion,
    carrierType: 'OWN', truckId: truck2, classification: 'SINGLE',
    plannedRevenue: 2200000, plannedCarrierCost: 1500000,
  });
  row = (await findPlanRow(adminToken, bill2))!;
  const issued = await issueDispatch(adminToken, ship2.id, {
    fulfillmentId: row.fulfillmentId,
    expectedVersion: row.version,
    plannedStartAt: win.start,
    plannedEndAt: win.end,
    carrierType: 'OWN', truckId: truck2, driverId: driver2.driverId,
  });
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  const tripId = issued.body.trip!.id;

  const drv = await authedPage(browser, await usernameOf(driver2.driverId), { viewport: { width: 390, height: 844 } });
  try {
    await appReady(drv.page, `/my-trips/${tripId}`);
    await expect(drv.page.locator('.driver-task-fact').first()).toBeVisible({ timeout: 20_000 });
    const rows = await drv.page.locator('.driver-task-fact').evaluateAll((els) => els.map((el) => ({
      label: el.querySelector('.driver-task-fact__label')?.textContent?.trim() ?? null,
      value: el.querySelector('.driver-task-fact__value')?.textContent?.trim() ?? null,
    })));
    const cangHa = rows.find((r) => r.label === 'Cảng hạ')?.value ?? '';
    const diaChi = rows.find((r) => r.label === 'Địa chỉ giao hàng')?.value ?? '';
    expect(cangHa, 'Cảng hạ = cảng ghi nhận (không rỗng, không "Chưa có")').toBeTruthy();
    expect(cangHa).not.toContain('Chưa có');
    if (diaChi) expect(cangHa === diaChi ? 'same' : 'distinct').toBe('distinct');
    await shot(drv.page, 'fb020-02-control-co-cang-ha');
  } finally {
    await drv.close();
  }
});

/** Username của lái xe gắn truckB (đăng nhập đúng người xem lệnh). */
async function usernameOf(driverId: number): Promise<string> {
  const res = await api<{ items: Array<{ id: number; userId: number }> }>(adminToken, 'GET', '/drivers?page=1&limit=200');
  const drv = (res.body.items ?? []).find((d) => d.id === driverId);
  if (!drv) throw new Error(`no driver ${driverId}`);
  return usernameOfUser(adminToken, drv.userId);
}
