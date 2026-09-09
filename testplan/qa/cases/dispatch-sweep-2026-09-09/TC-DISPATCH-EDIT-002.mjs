// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-DISPATCH-EDIT-002.mjs
// TC-DISPATCH-EDIT-002 — Bấm "Lưu thay đổi" đóng dialog Chỉnh sửa điều phối
// Source: User reported bug 2026-09-09 — "click luu thay doi should close the dialog also"

export const caseId = 'TC-DISPATCH-EDIT-002';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  await ctx.goto('/dispatch-detail');
  // First load of /dispatch-detail on staging can exceed 15s (cold cache);
  // 30s matches the harness nav timeout.
  await page.waitForSelector('.dispatch-assignment-cell__trigger, .detailed-plan-grid', { timeout: 30000 });

  await ctx.screenshot('01_dispatch_detail_overview');

  // COMPLETED rows freeze their cell trigger (disabled) and DISPATCHED rows
  // with an active trip open the trip-reassign flow instead, so trigger[0] is
  // only editable when its row is neither — click the first editable one.
  const clicked = await page.evaluate(() => {
    const triggers = Array.from(document.querySelectorAll('.dispatch-assignment-cell__trigger'));
    const idx = triggers.findIndex((b) => !b.disabled && !(b.getAttribute('title') || '').includes('Phân xe lại'));
    if (idx === -1) return null;
    triggers[idx].scrollIntoView({ block: 'center' });
    triggers[idx].click();
    return { index: idx, total: triggers.length };
  });
  if (!clicked) {
    return { verdict: 'BLOCKED', errors: ['Không có ô điều phối nào có thể chỉnh sửa (tất cả đã hoàn thành hoặc đang chờ phân xe lại) trên /dispatch-detail'] };
  }

  await page.waitForSelector('.dispatch-assignment-dialog', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 600));

  await ctx.screenshot('02_dispatch_edit_modal_open');

  // Verify dialog is visible
  const isDialogOpenBefore = await page.evaluate(() => {
    const dialog = document.querySelector('.dispatch-assignment-dialog');
    return Boolean(dialog && dialog.closest('.modal, [role="dialog"], .dialog-overlay, .ui-modal'));
  });

  if (!isDialogOpenBefore) {
    return { verdict: 'FAIL', errors: ['Modal chỉnh sửa điều phối không mở sau khi bấm ô điều phối'] };
  }

  // Find and click "Lưu thay đổi" button
  const saveBtnClicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const saveBtn = buttons.find((b) => b.textContent?.includes('Lưu thay đổi'));
    if (!saveBtn) return false;
    saveBtn.click();
    return true;
  });

  if (!saveBtnClicked) {
    return { verdict: 'FAIL', errors: ['Không tìm thấy nút "Lưu thay đổi" trong modal'] };
  }

  // Wait for dialog to close (up to 8s)
  await page.waitForFunction(() => {
    return !document.querySelector('.dispatch-assignment-dialog');
  }, { timeout: 8000 });

  await new Promise((r) => setTimeout(r, 500));
  await ctx.screenshot('03_dispatch_modal_closed_after_save');

  const isDialogClosedAfter = await page.evaluate(() => {
    return document.querySelector('.dispatch-assignment-dialog') == null;
  });

  return {
    verdict: isDialogClosedAfter ? 'PASS' : 'FAIL',
    isDialogOpenBefore,
    isDialogClosedAfter,
  };
}
