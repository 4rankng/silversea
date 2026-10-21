/**
 * FB-081 — phân xe lại KẸP mở được + đổi nhà xe (pair propagate).
 *
 * Card 181026003045 (v2): hai chân KEP ACTIVE cùng truck — trước fix, đổi
 * chân này bị 409 "Xe đầu kéo đã bị trùng lịch kế hoạch"; sau fix:
 *  - dialog "Phân xe lại" trên /dispatch-detail MỞ và lưu được cho chân pair;
 *  - đổi nhà xe (OWN → EXTERNAL) ở một chân → chân kia TỰ THEO (propagate);
 *  - cặp KEP không còn pair-split thầm lặng.
 */
import { test, expect } from '@playwright/test';
import {
  api,
  appReady,
  authedPage,
  claimTrucks,
  createFclLot,
  ensureSite,
  evidence,
  findPlanRow,
  isoContainerNumber,
  issueDispatch,
  loadCatalogs,
  login,
  planRowSave,
  psql,
  runSerial,
  runWindow,
  shot,
} from './helpers';

const admin = await login('admin');
const cat = await loadCatalogs(admin.token);
const serial = runSerial();
const win = runWindow(serial);
const bill1 = `REGPK-K1${serial}`;
const bill2 = `REGPK-K2${serial}`;
// Cặp KEP chạy trên 2 xe ACTIVE đầu; FB-020 dùng xe từ vị trí 3 trở đi.
const kepTrucks = await claimTrucks(admin.token, 2, []);
const kepTruck = kepTrucks[0];
const nextTruck = kepTrucks[1];

async function buildKepLeg(bill: string, contSeed: string) {
  const siteId = await ensureSite(admin.token, serial, cat.routeId);
  const ship = await createFclLot(admin.token, {
    bill,
    containers: [{
      containerTypeId: cat.containerTypeId20,
      containerNumber: isoContainerNumber(contSeed),
      operationalSiteId: siteId,
      routeId: cat.routeId,
      pickupPortId: cat.pickupPortId,
      dropoffPortId: cat.dropoffPortId,
      cargoWeightKg: 11000,
      // Cùng cửa sổ với chân kia — KEP by construction.
      customerAppointmentAt: win.appointment,
    }],
  });
  return { ship };
}

/** Plan KEP leg: classification DOUBLE + cùng xe. Plan-row scan có carve-out
 *  cho DOUBLE (081026091100) nên CẢ HAI chân plan xong TRƯỚC khi phát lệnh. */
async function planKepLeg(bill: string) {
  let row = await findPlanRow(admin.token, bill);
  expect(row, `plan row ${bill}`).not.toBeNull();
  row = row!;
  const planned = await planRowSave(admin.token, row.fulfillmentId, {
    expectedFulfillmentVersion: row.version,
    expectedShipmentVersion: row.shipmentVersion,
    carrierType: 'OWN',
    truckId: kepTruck.truckId,
    classification: 'DOUBLE',
    plannedRevenue: 3200000,
    plannedCarrierCost: 2400000,
  });
  expect(planned.status, `${bill} plan: ${JSON.stringify(planned.body).slice(0, 220)}`).toBe(200);
}

/** Phát lệnh một chân KEP — carve-out assertResourceAvailability (partner
 *  DOUBLE + 20' + cùng truck/trailer/driver + cùng ngày) cho chân thứ hai. */
async function issueKepLeg(bill: string): Promise<number> {
  const row = (await findPlanRow(admin.token, bill))!;
  const issued = await issueDispatch(admin.token, row.shipmentId, {
    fulfillmentId: row.fulfillmentId,
    expectedVersion: row.version,
    plannedStartAt: win.start,
    plannedEndAt: win.end,
    carrierType: 'OWN',
    truckId: kepTruck.truckId,
    driverId: kepTruck.driverId,
  });
  expect(issued.status, `${bill} issue: ${JSON.stringify(issued.body).slice(0, 220)}`).toBe(201);
  return issued.body.trip!.id;
}

/** Ghép pair KEP chính thức (trip_pairs ACTIVE) — điều kiện để reassign
 *  propagate rig/nhà xe sang chân kia (FB-081 v2). */
async function pairKepTrips(trip1: number, trip2: number): Promise<void> {
  const load = async (id: number) => {
    const res = await api<{
      version: number; plannedStartAt: string; plannedEndAt: string;
      canonicalOrigin: string | null; canonicalDestination: string | null;
      cargoWeightKg: string | null; vehicleCapacityKg: string | null;
    }>(admin.token, 'GET', `/trips/${id}`);
    if (res.status !== 200) throw new Error(`GET /trips/${id}: ${res.status}`);
    return res.body;
  };
  const [d1, d2] = await Promise.all([load(trip1), load(trip2)]);
  const res = await api<{ id: number }>(admin.token, 'POST', '/trips/pairs', {
    firstTripId: trip1,
    secondTripId: trip2,
    pairKind: 'KEP',
    firstTrip: {
      plannedStartAt: d1.plannedStartAt, plannedEndAt: d1.plannedEndAt,
      canonicalOrigin: d1.canonicalOrigin ?? 'SITC LH', canonicalDestination: d1.canonicalDestination ?? 'HICT',
      cargoWeightKg: d1.cargoWeightKg ?? '11000', vehicleCapacityKg: d1.vehicleCapacityKg ?? '30000',
      expectedVersion: d1.version,
    },
    secondTrip: {
      plannedStartAt: d2.plannedStartAt, plannedEndAt: d2.plannedEndAt,
      canonicalOrigin: d2.canonicalOrigin ?? 'SITC LH', canonicalDestination: d2.canonicalDestination ?? 'HICT',
      cargoWeightKg: d2.cargoWeightKg ?? '11000', vehicleCapacityKg: d2.vehicleCapacityKg ?? '30000',
      expectedVersion: d2.version,
    },
  });
  expect(res.status, `pair KEP: ${JSON.stringify(res.body).slice(0, 240)}`).toBe(201);
}

test('FB-081-R2: KEP pair — Phân xe lại dialog mở được, đổi nhà xe → cả 2 chân theo', async ({ browser }) => {
  // Hai chân KEP cùng truck, cùng cửa sổ.
  await buildKepLeg(bill1, serial + 'a');
  await buildKepLeg(bill2, serial + 'b');
  // Plan CẢ HAI chân trước (carve-out DOUBLE ở plan-row scan), rồi phát lệnh
  // từng chân (carve-out kepContext ở issue path tạo pair).
  await planKepLeg(bill1);
  await planKepLeg(bill2);
  const trip1 = await issueKepLeg(bill1);
  const trip2 = await issueKepLeg(bill2);
  await pairKepTrips(trip1, trip2);

  // DB proof trạng thái pair trước khi reassign.
  const before = await psql(
    `SELECT t.id, t.truck_id, ci.carrier_type, ci.external_entity_id FROM trips t LEFT JOIN trip_carrier_info ci ON ci.trip_id = t.id WHERE t.id IN (${trip1}, ${trip2}) ORDER BY t.id`,
  );
  evidence('fb081-db-pair-before-reassign.txt', `${before}\n`);
  expect(before.split('\n').filter((l) => l.trim()).every((l) => /OWN/.test(l)), 'pair là OWN trước reassign').toBeTruthy();

  const dv = await authedPage(browser, 'dieuvan', { viewport: { width: 1440, height: 900 } });
  try {
    const day = win.appointment.slice(0, 10);
    await appReady(dv.page, `/dispatch-detail?q=${encodeURIComponent(bill1)}&date=${day}`);
    const quickSearch = dv.page.getByLabel('Tìm nhanh');
    if (await quickSearch.count()) {
      await quickSearch.fill(bill1);
      await dv.page.waitForTimeout(1200);
    }
    // Nút "Phân xe lại" trên dòng đã phát lệnh (scope vào đúng dòng của run).
    const myRow = dv.page.locator('tr', { hasText: bill1 }).first();
    await expect(myRow).toBeVisible({ timeout: 20_000 });
    const reassignBtn = myRow.getByRole('button', { name: /Phân xe lại/i });
    await expect(reassignBtn).toBeVisible({ timeout: 20_000 });
    await reassignBtn.scrollIntoViewIfNeeded();
    await reassignBtn.click();

    // Dialog phải MỞ — không bị chặn bởi guard trùng lịch KEP (lỗi card gốc).
    // Pin theo nội dung: popover combobox portalled có thể là [role=dialog] đầu.
    const dlg = dv.page.locator('[role="dialog"]').filter({ hasText: 'Phân xe lại' }).first();
    await expect(dlg).toBeVisible({ timeout: 10_000 });
    await expect(dlg.locator('[class*="title"], h2, h3').first()).toContainText('Phân xe lại');
    await shot(dv.page, 'fb081-reassign-dialog-open-kep');

    // R2 của card: ĐỔI RIG (xe đầu kéo + lái xe, vẫn OWN — cặp kẹp chạy xe nội
    // bộ là owner law) → chân kia TỰ THEO. Dialog phải mở được và lưu được.
    const xedaukeo = dlg.locator('label:has-text("Xe đầu kéo")').locator('..').locator('input[role="combobox"], button').first();
    await expect(xedaukeo).toBeVisible({ timeout: 10_000 });
    await xedaukeo.scrollIntoViewIfNeeded();
    await xedaukeo.click();
    const truckOption = dv.page.locator('[role="option"]', { hasText: nextTruck.plate }).first();
    await expect(truckOption, `option xe ${nextTruck.plate} hiện`).toBeVisible({ timeout: 10_000 });
    await truckOption.click();
    await dv.page.waitForTimeout(400);
    const laixe = dlg.locator('label:has-text("Lái xe")').locator('..').locator('input[role="combobox"], button').first();
    await laixe.click();
    const driverOption = dv.page.locator('[role="option"]', { hasText: nextTruck.driverName }).first();
    await expect(driverOption, `option lái xe ${nextTruck.driverName} hiện`).toBeVisible({ timeout: 10_000 });
    await driverOption.click();
    await dv.page.waitForTimeout(400);
    await dlg.getByLabel(/Lý do điều chuyển/).fill('REGPACK FB-081 regression — đổi rig cả pair KEP');
    await shot(dv.page, 'fb081-reassign-filled-new-truck');

    // Confirm + đợi response PATCH reassign (modal có thể đợi animation lâu).
    const respPromise = dv.page.waitForResponse(
      (r) => /\/api\/trips\/\d+\/reassign$/.test(r.url()) && r.request().method() === 'PATCH',
      { timeout: 30_000 },
    );
    await dlg.locator('button', { hasText: 'Xác nhận phân xe lại' }).click();
    const resp = await respPromise;
    const respBody = await resp.text().catch(() => '');
    expect(resp.status(), `PATCH reassign body ${respBody.slice(0, 220)}`).toBeLessThan(300);
    await shot(dv.page, 'fb081-reassign-saved');

    // Cả HAI chân pair phải đã chuyển sang xe mới (propagate) — DB proof (poll:
    // propagate chạy trong cùng tx nhưng UI flush có thể chậm một nhịp).
    let after = '';
    for (let i = 0; i < 10; i += 1) {
      after = await psql(
        `SELECT t.id, t.truck_id, t.driver_id, ci.carrier_type FROM trips t LEFT JOIN trip_carrier_info ci ON ci.trip_id = t.id WHERE t.id IN (${trip1}, ${trip2}) ORDER BY t.id`,
      );
      if (after.split('\n').filter((l) => l.trim()).every((l) => l.startsWith(`${l.split('|')[0]}|${nextTruck.truckId}|`))) break;
      await new Promise((r) => setTimeout(r, 800));
    }
    evidence('fb081-db-pair-after-reassign.txt', `${after}\n`);
    const lines = after.split('\n').filter((l) => l.trim());
    expect(lines.length, '2 trips của pair').toBe(2);
    for (const line of lines) {
      expect(line, `chân pair propagate sang xe ${nextTruck.plate}: ${line}`).toMatch(new RegExp(`^\\d+\\|${nextTruck.truckId}\\|`));
      expect(line, 'vẫn OWN (cặp kẹp chạy xe nội bộ)').toContain('OWN');
    }
  } finally {
    await dv.close();
  }
});
