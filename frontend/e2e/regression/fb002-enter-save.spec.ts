/**
 * FB-002 — Enter ô GIỜ (đủ ngày+giờ) lưu lịch — input-order matrix 3 case.
 *
 * Card 181026000027 (cases 1–3) trên dialog "Chỉnh sửa Lịch trình" (/shipments,
 * lot LCL đã có ngày+giờ):
 *   CASE 1: gõ "14:30" CÓ dấu hai chấm + Enter → LƯU ngay (1 PUT, toast).
 *   CASE 2: gõ "1430" KHÔNG hai chấm + Enter → Enter ĐẦU TIÊN lưu (draft
 *           "1430" được normalize "14:30" tại thời điểm Enter).
 *   CASE 3: ArrowDown mở picker → gõ tay + Enter → LƯU (keystroke phải tới
 *           input, không chết trong panel — typedSinceOpen).
 * Mỗi case một lot riêng; evidence: PUT fired + plannedReturnAt mới + toast.
 */
import { test, expect } from '@playwright/test';
import {
  api,
  appReady,
  authedPage,
  createLclLot,
  login,
  runSerial,
  shot,
} from './helpers';

const admin = await login('admin');
const serial = runSerial();

interface LotCtx {
  id: number;
  plannedReturnAt: string | null;
}

async function snapshotLot(id: number): Promise<LotCtx> {
  const res = await api<{ summary?: { plannedReturnAt: string | null } }>(admin.token, 'GET', `/shipments/cus-workspace/${id}`);
  return { id, plannedReturnAt: res.body.summary?.plannedReturnAt ?? null };
}

/** Tạo lot LCL "đủ ngày+giờ" và mở dialog Lịch trình trên dòng của nó. */
async function openScheduleDialog(page: import('@playwright/test').Page, tag: string): Promise<number> {
  const bill = `REGPK-${tag}${serial}`;
  const lot = await createLclLot(admin.token, {
    bill,
    expectedDeliveryDate: '2027-05-06',
    closingAt: '2027-05-06T09:00:00+07:00',
  });
  await appReady(page, `/shipments?searchSuffix=${encodeURIComponent(bill)}&transportDateFrom=2027-01-01&transportDateTo=2027-12-31`);
  const trigger = page.locator(`#cus-inline-schedule-${lot.id}`);
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(page.locator('.modal__title').first()).toHaveText('Chỉnh sửa Lịch trình');
  return lot.id;
}

async function typeAndEnter(page: import('@playwright/test').Page, keys: string[], shotName: string): Promise<void> {
  const timeInput = page.locator('[role="dialog"] .time-input input').first();
  await timeInput.click();
  for (const k of keys) await page.keyboard.type(k, { delay: 70 });
  await page.waitForTimeout(300);
  await shot(page, `${shotName}-before-enter`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1600);
}

async function assertSaved(page: import('@playwright/test').Page, lotId: number, shotName: string): Promise<void> {
  // Dialog đóng + toast xác nhận.
  await expect(page.locator('.modal__title')).toHaveCount(0, { timeout: 10_000 });
  const status = page.locator('[role="status"], .app-notices').filter({ hasText: /Đã cập nhật lịch/ }).first();
  await expect(status).toBeVisible({ timeout: 10_000 });
  await shot(page, `${shotName}-saved-toast`);
  // API readback: giờ mới đã lưu (14:30 → plannedReturnAt 07:30Z = 14:30+07).
  const after = await snapshotLot(lotId);
  expect(after.plannedReturnAt, 'plannedReturnAt cập nhật thành 14:30 (+07:00)').toMatch(/07:30:00/);
}

test.describe.configure({ mode: 'serial' });

test('CASE 1 — gõ "14:30" (có hai chấm) + Enter: lưu ngay', async ({ browser }) => {
  const cus = await authedPage(browser, 'cus');
  try {
    const lotId = await openScheduleDialog(cus.page, 'C1');
    await typeAndEnter(cus.page, ['14:30'], 'fb002-case1');
    await assertSaved(cus.page, lotId, 'fb002-case1');
  } finally {
    await cus.close();
  }
});

test('CASE 2 — gõ "1430" (không hai chấm) + Enter: Enter ĐẦU TIÊN lưu (normalize tại Enter)', async ({ browser }) => {
  const cus = await authedPage(browser, 'cus');
  try {
    const lotId = await openScheduleDialog(cus.page, 'C2');
    await typeAndEnter(cus.page, ['1430'], 'fb002-case2');
    await assertSaved(cus.page, lotId, 'fb002-case2');
  } finally {
    await cus.close();
  }
});

test('CASE 3 — ArrowDown mở picker → gõ tay + Enter: vẫn lưu (keystroke tới input)', async ({ browser }) => {
  const cus = await authedPage(browser, 'cus');
  try {
    const lotId = await openScheduleDialog(cus.page, 'C3');
    const timeInput = cus.page.locator('[role="dialog"] .time-input input').first();
    await timeInput.click();
    await cus.page.keyboard.press('ArrowDown');
    await cus.page.waitForTimeout(400);
    await shot(cus.page, 'fb002-case3-picker-open');
    // Gõ khi picker đang mở — focus phải về lại input để digit land đúng chỗ.
    await cus.page.keyboard.type('1430', { delay: 70 });
    await cus.page.waitForTimeout(300);
    await shot(cus.page, 'fb002-case3-before-enter');
    await cus.page.keyboard.press('Enter');
    await cus.page.waitForTimeout(1600);
    await assertSaved(cus.page, lotId, 'fb002-case3');
  } finally {
    await cus.close();
  }
});
