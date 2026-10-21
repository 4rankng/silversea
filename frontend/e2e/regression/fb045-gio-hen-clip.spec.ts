/**
 * FB-045 — dialog "Chi tiết container": cột GIỜ HẸN đọc trọn @1024/1440.
 *
 * Card 201026140000 (lan 2): giá trị giờ hẹn bị select cảng/hàng xóm sơn đè
 * (/dispatch drawer) hoặc input ngày bị cặp nút Thêm/Hủy đè (/shipments
 * drawer). Luật sau fix: header + giá trị "HH:mm DD/MM/YYYY" 1 dòng, không
 * control hàng xóm tràn đè lên ô giờ hẹn ở mọi viewport.
 */
import { test, expect, type Page } from '@playwright/test';
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
const bill = `REGPK-${serial}`;
let lotId = 0;

/**
 * Đo đè che cho một cột (theo header regex) trong scope: mọi ô dữ liệu phải
 * chứa điểm trung tâm + mép trái của chính nó (elementFromPoint rơi vào
 * cell/con của cell) — kênh lỗi lan-2 là control hàng xóm tràn sơn đè.
 */
async function probeColumn(page: Page, scope: string, headerRegex: RegExp) {
  return page.locator(scope).first().evaluate((root, reSrc) => {
    const re = new RegExp(reSrc, 'i');
    const table = root.querySelector('table');
    if (!table) return { ok: false, reason: 'no table' };
    const ths = [...table.querySelectorAll('th')];
    const col = ths.findIndex((th) => re.test(th.textContent ?? ''));
    if (col < 0) return { ok: false, reason: `no column ${reSrc}`, headers: ths.map((t) => t.textContent?.trim()) };
    const rows = [...table.querySelectorAll('tbody tr')];
    const bad: string[] = [];
    let sample: Record<string, unknown> | null = null;
    let dataRows = 0;
    for (const tr of rows) {
      const td = tr.children[col] as HTMLElement;
      if (!td) continue;
      // Band scroll-x law (FB-045): dialog hẹp hơn tổng bề rộng cột → cuộn
      // ngang. Đưa ô vào giữa viewport NGANG trước khi đo đè che.
      td.scrollIntoView({ inline: 'center', block: 'nearest' });
      const r = td.getBoundingClientRect();
      if (r.width === 0) continue;
      dataRows += 1;
      const x0 = Math.max(r.left + 3, 0);
      const x1 = Math.min(r.right - 3, window.innerWidth - 2);
      if (x1 <= x0) {
        bad.push(`${td.textContent?.trim().slice(0, 30)} — cell không vào được viewport sau scroll`);
        continue;
      }
      const points: Array<[number, number]> = [
        [(x0 + x1) / 2, r.top + Math.min(r.height / 2, 16)],
        [x0, r.top + Math.min(r.height / 2, 16)],
      ];
      for (const [x, y] of points) {
        if (x < 0 || x > window.innerWidth - 1 || y < 0 || y > window.innerHeight - 1) continue; // ngoài viewport dọc — không phải bị che
        const top = document.elementFromPoint(x, y);
        if (!top || !td.contains(top)) {
          bad.push(`${td.textContent?.trim().slice(0, 30)} @${Math.round(x)},${Math.round(y)} → ${top?.tagName}`);
        }
      }
      if (!sample) sample = { text: td.textContent?.trim(), w: Math.round(r.width) };
    }
    return { ok: bad.length === 0 && dataRows > 0, bad, sample, rows: dataRows };
  }, headerRegex.source);
}

test.describe.configure({ mode: 'serial' });

test('TC-FB045-01: /dispatch quick-view drawer — GIỜ HẸN không bị che @1024 & @1440', async ({ browser }) => {
  const siteId = await ensureSite(admin.token, serial, cat.routeId);
  const lot = await createFclLot(admin.token, {
    bill,
    containers: [{
      containerTypeId: cat.containerTypeId20,
      containerNumber: isoContainerNumber(serial + '9'),
      operationalSiteId: siteId,
      routeId: cat.routeId,
      pickupPortId: cat.pickupPortId,
      dropoffPortId: cat.dropoffPortId,
      cargoWeightKg: 17500,
      customerAppointmentAt: win.appointment,
    }],
  });
  lotId = lot.id;

  const dv = await authedPage(browser, 'dieuvan');
  try {
    for (const width of [1024, 1440] as const) {
      await dv.page.setViewportSize({ width, height: 900 });
      await appReady(dv.page, `/dispatch?q=${encodeURIComponent(bill)}`);
      const trigger = dv.page.locator(`.master-plan-grid__container-detail-trigger[aria-label*="${bill}"]`).first();
      await expect(trigger).toBeVisible({ timeout: 20_000 });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();

      const drawer = dv.page.locator('.dispatch-container-detail');
      await expect(drawer).toBeVisible({ timeout: 10_000 });
      // Drawer tải detail async — đợi bảng thật sự mount rồi mới đo.
      await expect(drawer.locator('table').first()).toBeVisible({ timeout: 15_000 });
      await dv.page.waitForTimeout(700); // drawer slide-in animation — đo khi đứng yên
      const probe = await probeColumn(dv.page, '.dispatch-container-detail', /giờ hẹn/i);
      expect(probe.ok, `w${width}: ${JSON.stringify(probe)}`).toBeTruthy();
      expect(String(probe.sample?.text), `w${width}: giá trị giờ hẹn đủ "HH:mm DD/MM/YYYY"`).toMatch(/\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}/);
      await shot(dv.page, `fb045-dispatch-drawer-w${width}`);
      await dv.page.keyboard.press('Escape');
      await dv.page.waitForTimeout(300);
    }
  } finally {
    await dv.close();
  }
});

test('TC-FB045-02: /shipments drawer — Giờ hẹn đóng/trả đọc trọn + input add-row không bị đè @1024 & @1440', async ({ browser }) => {
  test.skip(lotId === 0, 'chờ TC-01 tạo fixture');
  const cus = await authedPage(browser, 'cus', { storage: { 'cus-containers-hidden-cols': '["legacy","removed"]' } });
  try {
    for (const width of [1024, 1440] as const) {
      await cus.page.setViewportSize({ width, height: 900 });
      await appReady(cus.page, `/shipments?searchSuffix=${encodeURIComponent(bill)}&transportDateFrom=2027-01-01&transportDateTo=2027-12-31`);
      const rowBtn = cus.page.locator(`#cus-dashboard-detail-${lotId}`);
      await expect(rowBtn).toBeVisible({ timeout: 20_000 });
      await rowBtn.scrollIntoViewIfNeeded();
      await rowBtn.click();

      const ledger = cus.page.locator('.cus-container-ledger');
      await expect(ledger).toBeVisible({ timeout: 10_000 });

      // Cột giờ hẹn của các dòng dữ liệu: không bị che.
      const probe = await probeColumn(cus.page, '.cus-container-ledger', /giờ hẹn/i);
      expect(probe.ok, `w${width}: ${JSON.stringify(probe)}`).toBeTruthy();

      // Add-row (lan-2 kênh 2): mở "Thêm container", input giờ hẹn đủ bề rộng,
      // các nút Thêm/Hủy không đè lên input ngày.
      const addBtn = ledger.getByRole('button', { name: /^Thêm container$/ });
      if (await addBtn.count()) {
        await addBtn.first().scrollIntoViewIfNeeded();
        await addBtn.first().click();
        await cus.page.waitForTimeout(400);
        const addRow = ledger.locator('tbody tr').last();
        const gioHenCell = addRow.locator('td[data-label="Giờ hẹn đóng/trả"]');
        if (await gioHenCell.count()) {
          const box = await gioHenCell.first().boundingBox();
          expect(box?.width ?? 0, `w${width}: ô giờ hẹn add-row đủ bề rộng (không bị ép dẹt)`).toBeGreaterThanOrEqual(100);
          const covered = await gioHenCell.first().evaluate((td) => {
            const r = td.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 14));
            return td.contains(top);
          });
          expect(covered, `w${width}: điểm giữa input giờ hẹn không bị nút Thêm/Hủy đè`).toBeTruthy();
        }
        await shot(cus.page, `fb045-shipments-drawer-w${width}`);
        await ledger.getByRole('button', { name: /^Hủy$/ }).first().click();
      }
      await cus.page.keyboard.press('Escape');
      await cus.page.waitForTimeout(300);
    }
  } finally {
    await cus.close();
  }
});
