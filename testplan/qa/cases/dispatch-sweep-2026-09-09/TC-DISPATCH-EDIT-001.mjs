// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-DISPATCH-EDIT-001.mjs
// TC-DISPATCH-EDIT-001 — Dropdown "Phân loại" (Đơn/Kẹp/Kết hợp) & Tên tài xế ngoài không bắt buộc
// Source: Báo cáo khách hàng 2026-09-08 / Image 1

export const caseId = 'TC-DISPATCH-EDIT-001';
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
  await new Promise((r) => setTimeout(r, 1000));

  await ctx.screenshot('02_dispatch_edit_modal_internal');

  // Inspect classification dropdown
  const classData = await page.evaluate(() => {
    const sel = document.querySelector('.dispatch-assignment-dialog__classification select');
    if (!sel) return null;
    const options = Array.from(sel.querySelectorAll('option')).map((o) => o.innerText.trim());
    return { hasSelect: true, options, value: sel.value };
  });

  // Switch to external carrier to verify optional driver name
  const carrierOptions = await page.evaluate(() => {
    const sel = document.querySelector('.dispatch-assignment-dialog__carrier select');
    if (!sel) return [];
    return Array.from(sel.querySelectorAll('option')).map((o) => ({ value: o.value, text: o.innerText.trim() }));
  });

  const externalOption = carrierOptions.find((o) => !o.text.includes('SilverSea') && o.value);
  let externalInspection = null;
  if (externalOption) {
    await page.select('.dispatch-assignment-dialog__carrier select', externalOption.value);
    await new Promise((r) => setTimeout(r, 600));

    await ctx.screenshot('03_dispatch_edit_modal_external');

    externalInspection = await page.evaluate(() => {
      const driverNameInput = document.querySelector('#dispatch-external-driver-name');
      return {
        hasDriverNameInput: Boolean(driverNameInput),
        isDriverRequired: driverNameInput ? driverNameInput.hasAttribute('required') : false,
      };
    });
  }

  // Close dialog
  const closeBtn = await page.$('.dialog__close, button.btn--secondary');
  if (closeBtn) await closeBtn.click();

  const hasClassification = classData && classData.hasSelect
    && classData.options.includes('Đơn')
    && classData.options.includes('Kẹp')
    && classData.options.includes('Kết hợp');

  const isDriverOptional = externalInspection
    ? !externalInspection.isDriverRequired
    : true;

  const ok = hasClassification && isDriverOptional;
  return {
    verdict: ok ? 'PASS' : 'FAIL',
    classData,
    externalOption: externalOption?.text,
    externalInspection,
  };
}
