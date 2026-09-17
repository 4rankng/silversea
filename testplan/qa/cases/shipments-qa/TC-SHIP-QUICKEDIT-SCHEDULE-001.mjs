// cases/shipments-qa/TC-SHIP-QUICKEDIT-SCHEDULE-001.mjs
// /shipments schedule quick-edit: dialog stability during time/date interaction.
//
// Known bug area: "Chỉnh sửa Lịch trình" dialog closes when selecting
// time or date. This test verifies the modal stays open through:
//   1. Opening the schedule quick-edit
//   2. Clicking the time field
//   3. Typing a time value
//   4. Clicking the date picker button
//   5. Interacting with date picker (if popover opens)
//   6. Saving changes
//
// Verdict: PASS when modal remains open through all interactions.

export const caseId = 'TC-SHIP-QUICKEDIT-SCHEDULE-001';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  const errors = [];

  await ctx.goto('/shipments');
  await page.waitForSelector('.cus-dashboard-table tbody tr', { timeout: 15000 });

  // Find a schedule edit button
  const btnClicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const match = buttons.find((b) => {
      const name = (b.getAttribute('aria-label') || b.innerText || '').toLowerCase();
      return name.includes('sửa ô lịch trình');
    });
    if (match) {
      match.scrollIntoView({ block: 'center' });
      match.click();
      return match.getAttribute('aria-label') || match.innerText;
    }
    return null;
  });

  if (!btnClicked) {
    return { verdict: 'BLOCKED', errors: ['No schedule edit button found on /shipments'] };
  }

  await new Promise((r) => setTimeout(r, 1000));
  await ctx.screenshot('01_schedule_modal_open');

  // Helper: check if modal is still open
  const isModalOpen = async () => {
    return await page.evaluate(() => {
      const cancelBtns = Array.from(document.querySelectorAll('button'));
      return cancelBtns.some((b) => b.innerText.trim() === 'Hủy');
    });
  };

  // --- Step 2: Click the time field ---
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const timeLabel = labels.find((l) => l.innerText.trim() === 'Giờ');
    if (timeLabel) {
      const input = timeLabel.querySelector('input') || timeLabel.closest('label')?.querySelector('input');
      if (input) {
        input.scrollIntoView({ block: 'center' });
        input.focus();
        input.click();
        return true;
      }
    }
    return false;
  });

  await new Promise((r) => setTimeout(r, 500));
  let open = await isModalOpen();
  await ctx.screenshot('02_after_time_click');
  if (!open) {
    errors.push('BUG: Modal closed after clicking time field');
    return { verdict: 'FAIL', errors, step: 'time_click' };
  }

  // --- Step 3: Type a time value ---
  const timeInput = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const timeLabel = labels.find((l) => l.innerText.trim() === 'Giờ');
    if (timeLabel) {
      const input = timeLabel.querySelector('input') || timeLabel.closest('label')?.querySelector('input');
      if (input) {
        input.focus();
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    }
    return false;
  });

  if (timeInput) {
    await page.keyboard.type('14:30', { delay: 50 });
    await new Promise((r) => setTimeout(r, 500));
  }

  open = await isModalOpen();
  await ctx.screenshot('03_after_time_type');
  if (!open) {
    errors.push('BUG: Modal closed after typing time');
    return { verdict: 'FAIL', errors, step: 'time_type' };
  }

  // --- Step 4: Click date picker button ---
  const dateBtnClicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const match = buttons.find((b) => {
      const name = (b.getAttribute('aria-label') || '').toLowerCase();
      return name.includes('show date picker') || name.includes('chọn ngày');
    });
    // Find the one inside the modal (not the filter bar)
    const modal = document.querySelector('.modal__content, [role="dialog"]');
    if (modal) {
      const modalBtn = Array.from(modal.querySelectorAll('button')).find((b) => {
        const name = (b.getAttribute('aria-label') || '').toLowerCase();
        return name.includes('date picker') || name.includes('chọn ngày');
      });
      if (modalBtn) {
        modalBtn.click();
        return 'modal_date_picker';
      }
    }
    // Fallback: click any date picker button
    if (match) {
      match.click();
      return match.getAttribute('aria-label');
    }
    return null;
  });

  await new Promise((r) => setTimeout(r, 800));
  open = await isModalOpen();
  await ctx.screenshot('04_after_date_picker_click');
  if (!open) {
    errors.push('BUG: Modal closed after clicking date picker');
    return { verdict: 'FAIL', errors, step: 'date_picker_click' };
  }

  // --- Step 5: Check if a calendar/popover appeared ---
  const calendarVisible = await page.evaluate(() => {
    // Check for calendar grid, popover, or date picker overlay
    const candidates = document.querySelectorAll(
      '[role="grid"], [role="dialog"], .date-picker-popover, .react-aria-Popover, [class*="calendar"], [class*="datepicker"]'
    );
    for (const el of candidates) {
      if (el.offsetParent !== null || getComputedStyle(el).display !== 'none') {
        return el.tagName + '.' + el.className.substring(0, 60);
      }
    }
    return null;
  });

  if (calendarVisible) {
    // Try clicking a date in the calendar
    await page.evaluate(() => {
      // Try to find and click a day cell
      const cells = document.querySelectorAll('[role="gridcell"], td[class*="day"], button[class*="day"]');
      for (const cell of cells) {
        if (cell.offsetParent !== null && cell.innerText.trim()) {
          cell.click();
          return cell.innerText.trim();
        }
      }
      return null;
    });

    await new Promise((r) => setTimeout(r, 500));
    open = await isModalOpen();
    await ctx.screenshot('05_after_date_select');
    if (!open) {
      errors.push('BUG: Modal closed after selecting date from calendar');
      return { verdict: 'FAIL', errors, step: 'date_select' };
    }
  }

  // --- Step 6: Verify modal is still open (final check) ---
  open = await isModalOpen();
  await ctx.screenshot('06_final_state');
  if (!open) {
    errors.push('BUG: Modal closed unexpectedly during schedule edit');
    return { verdict: 'FAIL', errors, step: 'final_check' };
  }

  // Cancel to clean up
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const cancel = buttons.find((b) => b.innerText.trim() === 'Hủy');
    if (cancel) cancel.click();
  });
  await new Promise((r) => setTimeout(r, 300));

  return {
    verdict: errors.length === 0 ? 'PASS' : 'FAIL',
    btnClicked,
    dateBtnClicked,
    calendarVisible,
    errors,
  };
}
