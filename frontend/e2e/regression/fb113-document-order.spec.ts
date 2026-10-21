/**
 * FB-113 — /shipments/:id header: nhóm chứng từ đúng thứ tự.
 *
 * Card 171026122140 (standing, R24/R25): header card của trang chi tiết lô
 * thiếu "Số tờ khai" hoàn toàn và Booking đứng trước Bill. Sau fix, nhóm
 * chứng từ trình bày liền kề đúng thứ tự:
 *   Số Bill / Số Booking → Số tờ khai → Xuất / Nhập → Hãng tàu
 */
import { test, expect } from '@playwright/test';
import {
  api,
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

const admin = (await login('admin')).token;
const cat = await loadCatalogs(admin);
const serial = runSerial();
const win = runWindow(serial);
const DECL = `TK${serial.slice(-8)}`;

test('FB-113-02: header nhóm chứng từ đúng thứ tự + Số tờ khai hiển thị số của lô', async ({ browser }) => {
  const siteId = await ensureSite(admin, serial, cat.routeId);
  const bill = `REGPK-${serial}`;
  const ship = await createFclLot(admin, {
    bill,
    containers: [{
      containerTypeId: cat.containerTypeId20,
      containerNumber: isoContainerNumber(serial + '5'),
      operationalSiteId: siteId,
      routeId: cat.routeId,
      pickupPortId: cat.pickupPortId,
      dropoffPortId: cat.dropoffPortId,
      cargoWeightKg: 21000,
      customerAppointmentAt: win.appointment,
    }],
  });

  // Tờ khai hải quan của lô (cùng store section "Tờ khai hải quan" đọc).
  const decl = await api<{ id: number }>(admin, 'POST', `/shipments/${ship.id}/declarations`, {
    declarationNumber: DECL,
    scope: 'SINGLE',
  });
  expect(decl.status, JSON.stringify(decl.body)).toBeLessThan(300);

  const cus = await authedPage(browser, 'cus');
  try {
    await appReady(cus.page, `/shipments/${ship.id}`);
    const fields = cus.page.locator('.shipment-detail__header .shipment-detail__fields');
    await expect(fields.first()).toBeVisible({ timeout: 20_000 });

    const labels = await fields.locator('dt').evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
    const order = ['Số Bill / Số Booking', 'Số tờ khai', 'Xuất / Nhập', 'Hãng tàu'];
    const idx = order.map((label) => labels.indexOf(label));
    // Cả 4 label hiện diện và đứng LIỀN KỀ đúng thứ tự (bắt đầu sau Khách hàng).
    for (const i of idx) expect(i, `label set ${JSON.stringify(labels)}`).toBeGreaterThan(0);
    for (let k = 1; k < idx.length; k += 1) {
      expect(idx[k], `thứ tự ${order[k - 1]} → ${order[k]}: ${JSON.stringify(labels)}`).toBe(idx[k - 1] + 1);
    }

    // Giá trị: Bill đúng, tờ khai đúng số lô, chiều IMPORT → Nhập.
    const ddValue = (label: string) => fields
      .locator(`div:has(dt:text-is("${label}")) dd`).first().innerText();
    expect((await ddValue('Số Bill / Số Booking')).trim()).toBe(bill);
    expect((await ddValue('Số tờ khai')).trim()).toBe(DECL);
    expect((await ddValue('Xuất / Nhập')).trim()).toBe('Nhập');

    await shot(cus.page, 'fb113-detail-header-order');
  } finally {
    await cus.close();
  }
});
