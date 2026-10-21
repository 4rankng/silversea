/**
 * FB-096 — "Thêm cược": Tra cứu Bill gợi ý theo 4 số cuối.
 *
 * Card 201026112200 (ketoan residual R24 B5): luồng Thêm cược trên
 * /accounting/deposit-tracker — gõ 4 số cuối số Bill → suggestion hiện đúng
 * lô → click tự điền Số Bill + Khách hàng + Hãng tàu → Lưu dòng → dòng hiện
 * bảng và được persist (GET deposits có row mới).
 */
import { test, expect } from '@playwright/test';
import {
  api,
  appReady,
  authedPage,
  createFclLot,
  ensureSite,
  evidence,
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
// Bill kết thúc bằng đúng 4 số (luật suffix của dabe434f).
const digits4 = String(Date.now()).slice(-4);
const bill = `REGPK${serial}B${digits4}`;
const LINE = 'REGPK LINE';

test('FB-096: tra cứu 4 số cuối → suggestion → autofill → Lưu dòng → persist', async ({ browser }) => {
  const siteId = await ensureSite(admin.token, serial, cat.routeId);
  await createFclLot(admin.token, {
    bill,
    shippingLineName: LINE,
    containers: [{
      containerTypeId: cat.containerTypeId20,
      containerNumber: isoContainerNumber(serial + '2'),
      operationalSiteId: siteId,
      routeId: cat.routeId,
      pickupPortId: cat.pickupPortId,
      dropoffPortId: cat.dropoffPortId,
      cargoWeightKg: 20500,
      customerAppointmentAt: win.appointment,
    }],
  });

  const kt = await authedPage(browser, 'ketoan');
  try {
    await appReady(kt.page, '/accounting/deposit-tracker');
    await kt.page.getByRole('button', { name: /^Thêm cược$/ }).click();
    const modal = kt.page.locator('[role="dialog"]').first();
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Thêm cược')).toBeVisible();

    // Gõ 4 số cuối → suggestion chứa đúng lô.
    const lookup = modal.getByPlaceholder('4 số cuối');
    await lookup.fill(digits4);
    const suggestion = modal.locator('#bill-suggestions .bill-suggestions__item', { hasText: bill }).first();
    await expect(suggestion, `suggestion hiện lô ${bill}`).toBeVisible({ timeout: 15_000 });
    await shot(kt.page, 'fb096-suggestion-4-so-cuoi');

    // Click → tự điền Số Bill + Khách hàng + Hãng tàu.
    await suggestion.click();
    const valueOf = async (label: string) => modal.locator(`.form-group:has(label:text-is("${label}")) input, div:has(> label:text-is("${label}")) > input`).first().inputValue();
    await expect.poll(async () => valueOf('Số Bill')).toBe(bill);
    await expect.poll(async () => valueOf('Khách hàng')).toContain('LONG MINH');
    if (await modal.locator('div:has(> label:text-is("Hãng tàu")) > input').count()) {
      await expect.poll(async () => valueOf('Hãng tàu')).toBe(LINE);
    }
    await shot(kt.page, 'fb096-autofill-after-click');

    // Số tiền cược + Lưu dòng.
    await modal.getByLabel(/Số tiền cược/).fill('2500000');
    await modal.getByRole('button', { name: /^Lưu dòng$/ }).click();
    await expect(modal).toBeHidden({ timeout: 15_000 });
    // Bảng hiện dòng mới với Bill của lô.
    await expect(kt.page.locator('table').first()).toContainText(bill, { timeout: 15_000 });
    await shot(kt.page, 'fb096-row-persisted-table');

    // Persist proof qua API (DB side effect).
    const deps = await api<{ items?: Array<{ billNumber: string; amount: number }> } | Array<{ billNumber: string; amount: number }>>(
      admin.token, 'GET', '/accounting/deposits',
    );
    const rows = Array.isArray(deps.body) ? deps.body : deps.body.items ?? [];
    const hit = rows.find((r) => r.billNumber === bill);
    expect(hit, `GET /accounting/deposits có row Bill ${bill}`).toBeTruthy();
    evidence('fb096-deposit-api-readback.json', JSON.stringify({ bill, row: hit }, null, 2));
  } finally {
    await kt.close();
  }
});
