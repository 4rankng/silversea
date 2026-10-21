/**
 * FB-093 — nút "Tách nhóm" hiện trên máy CÓ saved prefs ẩn cột (lan 3).
 *
 * Card 211026024348 + 0c263b00 (lan 3): workstation có localStorage
 * `accounting-debit-hidden-cols` từ build TRƯỚC (chưa có law essential) vẫn
 * tên cột "Thông số container" — cột bị ẩn chôn nút "Tách nhóm" của nhóm ghép
 * cước thu khách. Sau fix: sanitize loại key essential/essentialWhenHasData
 * khỏi mọi stored choice → cột host action tự hiện khi có data LCL, còn cột
 * tiền không-essential giữ nguyên theo choice/default.
 */
import { test, expect } from '@playwright/test';
import {
  api,
  appReady,
  authedPage,
  createLclLot,
  evidence,
  loadCatalogs,
  login,
  psql,
  runSerial,
  shot,
} from './helpers';

const admin = await login('admin');
const cat = await loadCatalogs(admin.token);
const serial = runSerial();
const bill1 = `REGPK-R1${serial}`;
const bill2 = `REGPK-R2${serial}`;

test('FB-093 lan-3: saved prefs ẩn "container" không chôn nút Tách nhóm; click tách → nhóm giải tán', async ({ browser }) => {
  // 1. Hai lô LCL cùng khách → ghép cước thu khách (REV) qua API.
  // Board mặc định scope từ đầu tháng hiện tại đến hôm nay — đặt ngày giao
  // hàng của fixture vào đúng cửa sổ đó.
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(Math.max(1, now.getDate() - 1)).padStart(2, '0');
  const inWindowDate = `${now.getFullYear()}-${month}-${day}`;
  const lot1 = await createLclLot(admin.token, { bill: bill1, routeId: cat.routeId, expectedDeliveryDate: inWindowDate });
  const lot2 = await createLclLot(admin.token, { bill: bill2, routeId: cat.routeId, expectedDeliveryDate: inWindowDate });
  const classes = await api<{ items?: Array<{ id: number }>; id?: number }>(admin.token, 'GET', '/vehicle-size-classes');
  const classRows = (classes.body.items ?? (Array.isArray(classes.body) ? classes.body : [])) as Array<{ id: number }>;
  const classId = classRows[0]?.id;
  expect(classId, 'vehicle size class catalog có loại xe').toBeTruthy();

  const merge = await api<{ groupId?: number }>(admin.token, 'POST', '/shipments/lcl/rev-group', {
    shipmentIds: [lot1.id, lot2.id],
    vehicleSizeClassId: classId,
  });
  expect(merge.status, `merge: ${JSON.stringify(merge.body).slice(0, 220)}`).toBeLessThan(300);
  const before = await psql(`SELECT id, bl_number, rev_group_id FROM shipments WHERE id IN (${lot1.id}, ${lot2.id}) ORDER BY id`);
  evidence('fb093-db-merged.txt', `${before}\n`);
  const mergedRows = before.split('\n').filter((l) => l.trim());
  expect(mergedRows.length, '2 lô trong nhóm').toBe(2);
  const groupIds = mergedRows.map((l) => l.split('|')[2]?.trim());
  expect(groupIds[0], 'nhóm ghép có id').toBeTruthy();
  expect(groupIds[0], 'cả 2 lô cùng rev_group_id').toBe(groupIds[1]);

  // 2. Máy trạm CÓ saved prefs cũ: ẩn "container" (cột host nút) + "cuocThu".
  const kt = await authedPage(browser, 'ketoan', {
    storage: { 'accounting-debit-hidden-cols': JSON.stringify(['container', 'cuocThu']) },
    viewport: { width: 1440, height: 900 },
  });
  try {
    await appReady(kt.page, '/accounting/chot-debit');
    const search = kt.page.getByLabel('Tìm lô hàng');
    await expect(search).toBeVisible({ timeout: 20_000 });
    await search.fill(bill1);
    await kt.page.waitForTimeout(1200);

    // Cột "Thông số container" PHẢI hiện (sanitize đã bỏ key container khỏi choice).
    const header = kt.page.locator('table thead th, [role="columnheader"]').filter({ hasText: 'Thông số container' }).first();
    await expect(header, 'cột Thông số container hiện dù prefs cũ ẩn nó').toBeVisible({ timeout: 15_000 });
    await shot(kt.page, 'fb093-container-column-visible-with-stale-prefs');

    // Nút Tách nhóm hiện trên dòng thuộc nhóm ghép, aria-label nêu Bill.
    const unmerge = kt.page.locator(`button[aria-label^="Tách nhóm ghép cước thu khách"]`).first();
    await expect(unmerge).toBeVisible({ timeout: 15_000 });
    await shot(kt.page, 'fb093-tach-nhom-button-visible');

    // Cột tiền không-essential vẫn theo stored choice (ẩn) — luật KT4 không bị lật ngược.
    const cuocThu = kt.page.locator('table thead th, [role="columnheader"]').filter({ hasText: 'Cước thu (tự động)' }).first();
    await expect(cuocThu).toBeHidden();

    // 3. Click Tách nhóm → confirm dialog chung → nhóm giải tán (DB proof).
    await unmerge.scrollIntoViewIfNeeded();
    await unmerge.click();
    const confirm = kt.page.getByRole('button', { name: /^Tách nhóm$/ }).last();
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await shot(kt.page, 'fb093-tach-nhom-confirm-dialog');
    await confirm.click();
    await kt.page.waitForTimeout(2000);
    await shot(kt.page, 'fb093-tach-nhom-after');

    const after = await psql(`SELECT id, bl_number, rev_group_id FROM shipments WHERE id IN (${lot1.id}, ${lot2.id}) ORDER BY id`);
    evidence('fb093-db-unmerged.txt', `${after}\n`);
    const lines = after.split('\n').filter((l) => l.trim());
    expect(lines.length, '2 lô vẫn còn (chỉ tách nhóm, không xóa)').toBe(2);
    for (const line of lines) {
      expect(line.replace(/\s+$/, '').endsWith('|'), `rev_group_id phải NULL sau tách: "${line}"`).toBeTruthy();
    }
  } finally {
    await kt.close();
  }
});
