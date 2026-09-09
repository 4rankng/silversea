// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-DISPATCH-REASSIGN-001.mjs
// TC-DISPATCH-REASSIGN-001 — Điều vận phân xe lại (TripReassignDialog) đổi nhà xe thành công
// Source: User reported 2026-09-09 — "test again this flow, dieuvan should able to make change"

export const caseId = 'TC-DISPATCH-REASSIGN-001';
export const role = 'DISPATCHER';

export default async function (ctx) {
  const { page } = ctx;
  await ctx.goto('/dispatch-detail');
  await page.waitForSelector('.dispatch-assignment-cell__trigger', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));

  await ctx.screenshot('01_dispatch_detail_view');

  // Find a row where the trip is CREATED (eligible for reassignment before departure)
  // Target YMJAE492321975 (SilverSea OWN in CREATED status) or any CREATED trip
  const trigger = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr, .detailed-plan-grid__row'));
    // Look for row with YMJAE492321975 or 2337300010 or any row with a Phân xe lại trigger
    let targetRow = rows.find((r) => r.textContent.includes('YMJAE492321975'));
    if (!targetRow) {
      targetRow = rows.find((r) => {
        const btn = r.querySelector('.dispatch-assignment-cell__trigger');
        return btn && (btn.getAttribute('title') || '').includes('Phân xe lại') && !btn.disabled;
      });
    }

    const btn = targetRow ? targetRow.querySelector('.dispatch-assignment-cell__trigger') : null;
    if (!btn) return null;

    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return {
      ariaLabel: btn.getAttribute('aria-label'),
      text: btn.textContent.trim(),
    };
  });

  if (!trigger) {
    return {
      verdict: 'BLOCKED',
      errors: ['Không tìm thấy ô điều phối nào có trạng thái Phân xe lại trước khi chuyến xuất phát'],
    };
  }

  // Wait for TripReassignDialog to open
  await page.waitForSelector('.modal', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 800));
  await ctx.screenshot('02_reassign_dialog_open');

  // Verify dialog title
  const isReassignDialog = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    return modal?.querySelector('.modal__title')?.textContent?.trim() === 'Phân xe lại';
  });

  if (!isReassignDialog) {
    return { verdict: 'FAIL', errors: ['Modal mở lên không phải là modal Phân xe lại'] };
  }

  // Select "Xe ngoài" (EXTERNAL)
  await page.evaluate(() => {
    const carrierTypeSelect = document.querySelector('.modal select');
    if (carrierTypeSelect) {
      carrierTypeSelect.value = 'EXTERNAL';
      carrierTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  await new Promise((r) => setTimeout(r, 1000));
  await ctx.screenshot('03_reassign_dialog_switched_to_external');

  // Click on the combobox to open the popover
  const cb = await page.waitForSelector('.modal [role="combobox"]');
  await cb.click();
  await page.keyboard.press('ArrowDown');

  // Wait for option items in listbox
  await page.waitForSelector('[role="option"]', { timeout: 5000 });

  // Click DUYÊN HẢI or first non-empty option
  const picked = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('[role="option"]'));
    const dh = opts.find((o) => o.textContent.includes('DUYÊN HẢI'))
      || opts.find((o) => o.getAttribute('data-key') !== '__EMPTY_SELECT_VALUE__');
    if (dh) {
      dh.click();
      return { text: dh.textContent.trim(), key: dh.getAttribute('data-key') };
    }
    return null;
  });
  console.log('Picked option:', picked);

  await new Promise((r) => setTimeout(r, 600));

  // Enter plate number 15C-123456
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('.modal input'));
    const plateInput = inputs.find((i) => i.placeholder?.includes('15C-12345'));
    if (plateInput) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(plateInput, '15C-123456');
      else plateInput.value = '15C-123456';
      plateInput.dispatchEvent(new Event('input', { bubbles: true }));
      plateInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const driverInput = inputs.find((i) => i.placeholder?.includes('Tên lái xe'));
    if (driverInput) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(driverInput, 'Tài xế ngoài A');
      else driverInput.value = 'Tài xế ngoài A';
      driverInput.dispatchEvent(new Event('input', { bubbles: true }));
      driverInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const phoneInput = inputs.find((i) => i.placeholder?.includes('SĐT'));
    if (phoneInput) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(phoneInput, '0901234567');
      else phoneInput.value = '0901234567';
      phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
      phoneInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  await new Promise((r) => setTimeout(r, 600));
  await ctx.screenshot('04_reassign_dialog_filled');

  // Click "Xác nhận phân xe lại"
  const submitClicked = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    const btns = Array.from(modal?.querySelectorAll('button') || []);
    const confirmBtn = btns.find((b) => b.textContent?.includes('Xác nhận phân xe lại'));
    if (!confirmBtn || confirmBtn.disabled) return false;
    confirmBtn.click();
    return true;
  });

  if (!submitClicked) {
    return { verdict: 'FAIL', errors: ['Nút "Xác nhận phân xe lại" bị disabled hoặc không tìm thấy'] };
  }

  // Wait for submission response
  await new Promise((r) => setTimeout(r, 4000));
  await ctx.screenshot('05_after_reassign_submit');

  // Check if error appeared
  const result = await page.evaluate(() => {
    const errorEl = document.querySelector('.dispatch-assignment-dialog__error, .modal [role="alert"]');
    const modal = document.querySelector('.modal');
    const errorText = errorEl ? errorEl.textContent.trim() : null;
    return {
      hasError: Boolean(errorEl),
      errorText,
      isModalClosed: modal == null,
    };
  });

  if (result.hasError && result.errorText?.includes('Không thể đổi nhà xe đã được CUS gán tại bước điều xe')) {
    return {
      verdict: 'FAIL',
      errors: [`Vẫn bị lỗi CUS gán chặn: "${result.errorText}"`],
      result,
    };
  }

  if (result.hasError) {
    return {
      verdict: 'FAIL',
      errors: [`Có lỗi xuất hiện khi phân xe lại: "${result.errorText}"`],
      result,
    };
  }

  return {
    verdict: result.isModalClosed ? 'PASS' : 'INCONCLUSIVE',
    trigger,
    picked,
    result,
  };
}
