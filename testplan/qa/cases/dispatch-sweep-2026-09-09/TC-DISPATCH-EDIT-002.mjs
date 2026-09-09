// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-DISPATCH-EDIT-002.mjs
// TC-DISPATCH-EDIT-002 — Bấm "Lưu thay đổi" đóng dialog Chỉnh sửa điều phối
// Source: User reported bug 2026-09-09 — "click luu thay doi should close the dialog also"

export const caseId = 'TC-DISPATCH-EDIT-002';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  await ctx.goto('/dispatch-detail');
  await page.waitForSelector('.dispatch-assignment-cell__trigger, .detailed-plan-grid', { timeout: 15000 });

  await ctx.screenshot('01_dispatch_detail_overview');

  const cellTriggers = await page.$$('.dispatch-assignment-cell__trigger');
  if (cellTriggers.length === 0) {
    return { verdict: 'BLOCKED', errors: ['Không tìm thấy ô gán xe (.dispatch-assignment-cell__trigger) trên /dispatch-detail'] };
  }

  // Click to open the dispatch edit dialog
  await cellTriggers[0].evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    el.click();
  });
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
