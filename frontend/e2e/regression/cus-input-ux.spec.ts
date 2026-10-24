/**
 * CUS input UX — SIL-65/66/68 (CUS-01/02/04), board plan.tingting.vip/SIL.
 *
 * CUS-01 (SIL-65): /shipments/new — gõ '08' vào ô Giờ của "Ngày giờ đóng trả"
 *   → focus TỰ nhảy sang ô phút; phút tiếp theo không rơi phím số.
 * CUS-04 (SIL-68) create: TAB từ Số container sang Loại container → gõ '2'
 *   → dropdown gợi ý tự mở, lọc prefix (20DC).
 * CUS-04 (SIL-68) drawer: CUS drawer "Thêm container" — TAB từ Số container
 *   sang Loại cont → gõ '2' → gợi ý tự mở (surface đổi native select →
 *   combobox openOnType).
 * CUS-02 (SIL-66): lô LCL CHƯA CÓ lịch — mở "Chỉnh sửa Lịch trình", gõ giờ
 *   '08:30', Enter → 1 PATCH + modal THOÁT về danh sách (API readback).
 *
 * Evidence: qa/2026-10-24-cus-input-ux/ (AGENTS §7/§9).
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  api,
  appReady,
  authedPage,
  createFclLot,
  createLclLot,
  isoContainerNumber,
  loadCatalogs,
  login,
  runSerial,
  runWindow,
} from './helpers';

const SHOTS = path.resolve(process.cwd(), '..', 'qa', '2026-10-24-cus-input-ux');
mkdirSync(SHOTS, { recursive: true });
// Viewport shots: every assertion target (segment focus, combobox listbox,
// modal) sits in view; fullPage captures on the long create form time out.
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), timeout: 30_000 });

const admin = await login('admin');
const cat = await loadCatalogs(admin.token);
const serial = runSerial();
const win = runWindow(serial);

const activeSeg = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-seg'));

test('CUS-01/SIL-65: create lô — gõ "08" ô Giờ → focus tự sang ô phút, không rơi phím số', async ({ browser }) => {
  const cus = await authedPage(browser, 'admin');
  try {
    await appReady(cus.page, '/shipments/new');
    const hh = cus.page.locator('tr.csc-container-row [data-seg="hh"]').first();
    await expect(hh).toBeVisible({ timeout: 20_000 });

    // Click the Giờ segment (caret click — typing starts there), type '08'.
    await hh.click();
    await cus.page.keyboard.type('08', { delay: 140 });
    await cus.page.waitForTimeout(300);
    expect(await activeSeg(cus.page), 'sau "08": focus phải tự sang ô phút').toBe('mm');
    await shot(cus.page, 'cus01-hour-08-focus-minute');

    // Tiếp '30' ở phút — giờ giữ nguyên '08' (không rơi phím số).
    await cus.page.keyboard.type('30', { delay: 140 });
    await cus.page.waitForTimeout(250);
    expect(await activeSeg(cus.page), 'phút complete → focus sang ô Ngày (dd)').toBe('dd');
    const groupOf = (key: string) => cus.page.evaluate(
      (k) => {
        const el = document.activeElement?.closest('[data-split-datetime]');
        return (el?.querySelector(`[data-seg="${k}"]`) as HTMLInputElement | null)?.value ?? null;
      },
      key,
    );
    expect(await groupOf('hh')).toBe('08');
    expect(await groupOf('mm')).toBe('30');
    await shot(cus.page, 'cus01-minute-30-advance-date');
  } finally {
    await cus.close();
  }
});

test('CUS-04/SIL-68 (create): TAB sang Loại container → gõ "2" → gợi ý tự mở (20DC)', async ({ browser }) => {
  const cus = await authedPage(browser, 'admin');
  try {
    await appReady(cus.page, '/shipments/new');
    const number = cus.page.getByRole('textbox', { name: 'Số container' }).first();
    await expect(number).toBeVisible({ timeout: 20_000 });

    // Ticket flow: cursor ở ô Số cont → TAB sang ô Loại cont → gõ.
    await number.click();
    await cus.page.keyboard.press('Tab');
    await cus.page.waitForTimeout(250);
    const activeRole = await cus.page.evaluate(() => document.activeElement?.getAttribute('role'));
    expect(activeRole, 'TAB phải land vào combobox Loại container').toBe('combobox');

    await cus.page.keyboard.type('2', { delay: 90 });
    await expect(cus.page.getByRole('option', { name: '20DC' })).toBeVisible({ timeout: 5_000 });
    await shot(cus.page, 'cus04-create-tab-type-suggest');
  } finally {
    await cus.close();
  }
});

test('CUS-04/SIL-68 (drawer add-row): TAB sang Loại cont → gõ "2" → gợi ý tự mở, Enter chốt 20DC', async ({ browser }) => {
  const bill = `REGPK-${serial}t4`;
  const ship = await createFclLot(admin.token, {
    bill,
    containers: [{
      containerTypeId: cat.containerTypeId20,
      containerNumber: isoContainerNumber(serial + '1'),
      routeId: cat.routeId,
      pickupPortId: cat.pickupPortId,
      dropoffPortId: cat.dropoffPortId,
      customerAppointmentAt: win.appointment,
    }],
  });

  const cus = await authedPage(browser, 'cus');
  try {
    await appReady(cus.page, `/shipments?searchSuffix=${encodeURIComponent(bill)}&transportDateFrom=2027-01-01&transportDateTo=2027-12-31`);
    await cus.page.locator(`#cus-dashboard-detail-${ship.id}`).click();
    const ledger = cus.page.locator('.cus-container-ledger');
    await expect(ledger).toBeVisible({ timeout: 10_000 });

    await ledger.getByRole('button', { name: /^Thêm container$/ }).first().click();
    const addRow = ledger.locator('tfoot tr').last();
    const number = addRow.locator('input[aria-label="Số container"]');
    await expect(number).toBeVisible({ timeout: 10_000 });

    // Ticket flow: cursor ô Số cont → TAB → ô Loại cont → gõ '2'.
    await number.click();
    await cus.page.keyboard.press('Tab');
    await cus.page.waitForTimeout(250);
    const onCombo = await cus.page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute('role') === 'combobox' && el?.getAttribute('aria-label') === 'Loại cont';
    });
    expect(onCombo, 'TAB phải land vào combobox Loại cont của add row').toBe(true);

    await cus.page.keyboard.type('2', { delay: 90 });
    await expect(cus.page.getByRole('option', { name: '20DC' })).toBeVisible({ timeout: 5_000 });
    expect(await cus.page.getByRole('option', { name: '40HC' }).count(), 'filter prefix "2" ẩn 40HC').toBe(0);
    await shot(cus.page, 'cus04-drawer-addrow-tab-type-suggest');

    // ArrowDown + Enter chốt 20DC — không submit add row (menu đang mở).
    await cus.page.keyboard.press('ArrowDown');
    await cus.page.keyboard.press('Enter');
    await cus.page.waitForTimeout(400);
    const comboValue = await cus.page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value ?? '');
    expect(comboValue, 'Enter chốt gợi ý → combobox hiển thị 20DC').toContain('20DC');
    await shot(cus.page, 'cus04-drawer-addrow-picked-20dc');
  } finally {
    await cus.close();
  }
});

test('CUS-02/SIL-66: lô chưa có lịch — gõ giờ, Enter → PATCH lưu + THOÁT về danh sách', async ({ browser }) => {
  // LCL lot WITHOUT closingAt/plannedReturnAt — "lô hàng chưa có lịch".
  const bill = `REGPK-${serial}t2`;
  const lot = await createLclLot(admin.token, {
    bill,
    routeId: cat.routeId,
    expectedDeliveryDate: '2027-05-06',
  });

  const cus = await authedPage(browser, 'cus');
  try {
    await appReady(cus.page, `/shipments?searchSuffix=${encodeURIComponent(bill)}&transportDateFrom=2027-01-01&transportDateTo=2027-12-31`);
    const trigger = cus.page.locator(`#cus-inline-schedule-${lot.id}`);
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();

    await expect(cus.page.locator('.modal__title').first()).toHaveText('Chỉnh sửa Lịch trình');
    await shot(cus.page, 'cus02-schedule-modal-open');

    // Gõ '08:30' vào ô Giờ (single-box TimeInput; '0830' được normalize).
    const timeInput = cus.page.locator('.cus-quick-edit-modal input[aria-label="Giờ"]');
    await timeInput.click();
    await cus.page.keyboard.type('0830', { delay: 110 });
    await cus.page.waitForTimeout(350);
    // Time complete → focus tự sang ô Ngày (dd) — đã seed ngày giao 06/05/2027.
    expect(await activeSeg(cus.page), 'giờ complete → focus sang ô Ngày').toBe('dd');
    await shot(cus.page, 'cus02-time-complete-focus-date');

    // Enter trên ô ngày: requestSubmit → save → modal THOÁT (không đứng lại popup).
    await cus.page.keyboard.press('Enter');
    await expect(cus.page.locator('.modal__title').first()).toBeHidden({ timeout: 10_000 });
    await shot(cus.page, 'cus02-after-enter-exit-to-list');

    // API readback: lịch đã lưu (IMPORT → plannedReturnAt 08:30 VN ngày
    // 06/05/2027; the wire stores UTC, so compare by instant).
    const res = await api<{ summary?: { plannedReturnAt: string | null; closingAt: string | null } }>(
      admin.token, 'GET', `/shipments/cus-workspace/${lot.id}`,
    );
    const saved = res.body.summary?.plannedReturnAt ?? res.body.summary?.closingAt;
    expect(saved, 'PATCH phải ghi lịch đóng/trả 08:30').toBeTruthy();
    expect(Date.parse(saved!), 'plannedReturnAt = 2027-05-06 08:30 (+07)').toBe(Date.parse('2027-05-06T08:30:00+07:00'));
  } finally {
    await cus.close();
  }
});
