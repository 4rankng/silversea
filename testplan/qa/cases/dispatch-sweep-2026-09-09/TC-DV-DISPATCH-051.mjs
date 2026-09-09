// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-DV-DISPATCH-051.mjs
// TC-DV-DISPATCH-051 — New Calendar Design in Phát lệnh (QuickIssueOrderDialog & DispatchPlanEditorCell)
// Source: User reported: replace the old calendar design (datetime-local) with the new one

export const caseId = 'TC-DV-DISPATCH-051';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  await ctx.goto('/dispatch-detail');
  await page.waitForSelector('.dispatch-assignment-cell__trigger, .detailed-plan-grid', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000));

  await ctx.screenshot('01_dispatch_detail_overview');

  // Find a row that has the quick-issue button (.dispatch-assignment-cell__quick-issue)
  const quickIssueFound = await page.evaluate(() => {
    const quickButtons = Array.from(document.querySelectorAll('.dispatch-assignment-cell__quick-issue'));
    if (quickButtons.length === 0) return null;

    let targetBtn = quickButtons.find((btn) => {
      const row = btn.closest('tr, .detailed-plan-grid__row');
      return row && row.textContent.includes('MSKU1234565');
    });

    if (!targetBtn) {
      targetBtn = quickButtons[0];
    }

    targetBtn.scrollIntoView({ block: 'center' });
    targetBtn.click();
    return {
      totalQuickButtons: quickButtons.length,
      buttonAriaLabel: targetBtn.getAttribute('aria-label'),
    };
  });

  if (!quickIssueFound) {
    return {
      verdict: 'FAIL',
      errors: ['Không tìm thấy nút Phát lệnh nhanh (.dispatch-assignment-cell__quick-issue) trên /dispatch-detail'],
    };
  }

  // Wait for QuickIssueOrderDialog to open
  await page.waitForSelector('.dispatch-assignment-dialog__schedule-pills, .dispatch-assignment-dialog__issue-grid', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 600));

  await ctx.screenshot('02_quick_issue_modal_open_new_calendar');

  // 1. Check DOM elements for new calendar design
  const calendarInspection = await page.evaluate(() => {
    const quickDayButtons = Array.from(document.querySelectorAll('.dispatch-assignment-dialog__schedule-pill'))
      .map((b) => b.textContent.trim());

    const timePresets = Array.from(document.querySelectorAll('.dispatch-assignment-dialog__schedule-time-pill'))
      .map((b) => b.textContent.trim());

    const startTimeInput = document.querySelector('.modal input[type="time"][id*="start"]');
    const endTimeInput = document.querySelector('.modal input[type="time"][id*="end"]');
    const dateInput = document.querySelector('.modal input[type="date"][id*="date"], .modal input[lang="en-GB"][id*="date"]');

    // Confirm that old datetime-local input is NOT present
    const oldDatetimeInput = document.querySelector('.modal input[type="datetime-local"]');

    return {
      foundSchedule: quickDayButtons.length > 0 && timePresets.length > 0,
      quickDayButtons,
      timePresets,
      hasStartTimeInput: Boolean(startTimeInput),
      hasEndTimeInput: Boolean(endTimeInput),
      hasDateInput: Boolean(dateInput),
      dateInputLang: dateInput ? dateInput.getAttribute('lang') : null,
      hasOldDatetimeLocal: Boolean(oldDatetimeInput),
      initialDateValue: dateInput ? dateInput.value : null,
      initialStartTime: startTimeInput ? startTimeInput.value : null,
      initialEndTime: endTimeInput ? endTimeInput.value : null,
    };
  });

  if (!calendarInspection.foundSchedule) {
    return { verdict: 'FAIL', errors: ['Không tìm thấy phần lịch trình mới trong modal Phát lệnh'] };
  }

  if (calendarInspection.hasOldDatetimeLocal) {
    return { verdict: 'FAIL', errors: ['Vẫn còn tồn tại input[type="datetime-local"] cũ thay vì thiết kế mới'] };
  }

  // 2. Click "Ngày mai" quick day preset
  const clickedTomorrow = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.dispatch-assignment-dialog__schedule-pill'));
    const tomorrowBtn = buttons.find((b) => b.textContent.includes('Ngày mai'));
    if (!tomorrowBtn) return false;
    tomorrowBtn.click();
    return true;
  });

  // 3. Click "10:00" time preset
  const clickedTimePreset = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.dispatch-assignment-dialog__schedule-time-pill'));
    const tenBtn = buttons.find((b) => b.textContent.includes('10:00'));
    if (!tenBtn) return false;
    tenBtn.click();
    return true;
  });

  await new Promise((r) => setTimeout(r, 400));
  await ctx.screenshot('03_quick_issue_presets_selected');

  // Verify inputs updated
  const updatedValues = await page.evaluate(() => {
    const startTimeInput = document.querySelector('.modal input[type="time"][id*="start"]');
    const endTimeInput = document.querySelector('.modal input[type="time"][id*="end"]');
    const dateInput = document.querySelector('.modal input[type="date"][id*="date"], .modal input[lang="en-GB"][id*="date"]');
    return {
      dateValue: dateInput ? dateInput.value : null,
      startTime: startTimeInput ? startTimeInput.value : null,
      endTime: endTimeInput ? endTimeInput.value : null,
    };
  });

  // Calculate expected tomorrow date YYYY-MM-DD
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  const expectedTomorrow = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const tomorrowMatches = updatedValues.dateValue === expectedTomorrow;
  const timePresetMatches = updatedValues.startTime === '10:00' && updatedValues.endTime === '12:00';

  // 4. Test validation error when end time <= start time
  await page.evaluate(() => {
    const endTimeInput = document.querySelector('.modal input[type="time"][id*="end"]');
    if (endTimeInput) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) {
        setter.call(endTimeInput, '08:00');
      } else {
        endTimeInput.value = '08:00';
      }
      endTimeInput.dispatchEvent(new Event('input', { bubbles: true }));
      endTimeInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // Click Phát lệnh button inside modal footer
  await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    const buttons = Array.from(modal.querySelectorAll('button'));
    const issueBtn = buttons.find((b) => b.textContent?.includes('Phát lệnh'));
    if (issueBtn) issueBtn.click();
  });

  await new Promise((r) => setTimeout(r, 500));
  await ctx.screenshot('04_quick_issue_validation_error');

  const errorInspection = await page.evaluate(() => {
    const errorEl = document.querySelector('.dispatch-assignment-dialog__error');
    return {
      hasError: Boolean(errorEl),
      errorText: errorEl ? errorEl.textContent.trim() : null,
    };
  });

  // 5. Close the dialog cleanly via Hủy button
  await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    const buttons = Array.from(modal.querySelectorAll('button'));
    const cancelBtn = buttons.find((b) => b.textContent?.trim() === 'Hủy');
    if (cancelBtn) cancelBtn.click();
  });

  await new Promise((r) => setTimeout(r, 500));
  await ctx.screenshot('05_quick_issue_closed');

  const isClosed = await page.evaluate(() => {
    return document.querySelector('.dispatch-assignment-dialog__schedule-pills') == null;
  });

  const ok = calendarInspection.foundSchedule
    && !calendarInspection.hasOldDatetimeLocal
    && calendarInspection.hasStartTimeInput
    && calendarInspection.hasEndTimeInput
    && calendarInspection.hasDateInput
    && calendarInspection.dateInputLang === 'en-GB'
    && clickedTomorrow && tomorrowMatches
    && clickedTimePreset && timePresetMatches
    && errorInspection.hasError && errorInspection.errorText?.includes('Giờ kết thúc phải sau giờ chạy')
    && isClosed;

  return {
    verdict: ok ? 'PASS' : 'FAIL',
    calendarInspection,
    clickedTomorrow,
    tomorrowMatches,
    clickedTimePreset,
    timePresetMatches,
    updatedValues,
    expectedTomorrow,
    errorInspection,
    isClosed,
  };
}
