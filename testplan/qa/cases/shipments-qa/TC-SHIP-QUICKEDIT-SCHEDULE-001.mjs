// cases/shipments-qa/TC-SHIP-QUICKEDIT-SCHEDULE-001.mjs
// /shipments workboard quick-edit, schedule + notes cell groups (current contract):
//   • schedule + notes triggers are enabled for CUS, ADMIN and DISPATCHER
//     actors on unlocked lots (transportDateEditable = role in {CUS, ADMIN,
//     DISPATCHER} && lot not locked); this rung runs as CUS and taps ONE
//     unlocked LCL fixture row — the full role matrix is exercised on
//     staging during the release rung.
//   • schedule: open the quick-edit modal, interact with the time field
//     (click, type) and assert the modal stays open throughout — the dialog
//     must not self-close during time/date interaction.
//   • notes: positive control — open, assert title, Hủy.
// Mutation surface: READ-ONLY rungs — the typed time value is DISCARDED via
// Hủy (cancel drops the draft; no API call). Finders are aria-label-only and
// scoped to .cus-dashboard-table.
//
// Verdict: PASS when the schedule modal survives the time-field interaction
// and the notes positive control passes. BLOCKED when page 1 has no
// unlocked LCL row as CUS.

export const caseId = 'TC-SHIP-QUICKEDIT-SCHEDULE-001';
export const role = 'CUS';

const TABLE = '.cus-dashboard-table';

export default async function (ctx) {
  const { page } = ctx;
  const errors = [];

  await ctx.goto('/shipments');
  await page.waitForSelector(`${TABLE} tbody tr`, { timeout: 15000 });
  await ctx.screenshot('01_page_loaded');

  // Pick ONE unlocked LCL row: schedule trigger present and enabled, notes
  // trigger present and enabled — same row, single-fixture taps throughout.
  const shipmentId = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.cus-dashboard-table tbody tr'));
    for (const tr of rows) {
      const scheduleBtn = tr.querySelector("td[data-label='Lịch trình & điều xe'] button[id^='cus-inline-schedule-']");
      const notesBtn = tr.querySelector("button[id^='cus-inline-notes-']");
      if (scheduleBtn && !scheduleBtn.disabled && notesBtn && !notesBtn.disabled) {
        const m = tr.querySelector("button[id^='cus-inline-identity-']")?.id.match(/-(\d+)$/);
        return m ? Number(m[1]) : null;
      }
    }
    return null;
  });

  if (shipmentId == null) {
    return {
      verdict: 'BLOCKED',
      errors: ['No unlocked LCL row on /shipments page 1 as CUS — schedule/notes rungs not exercised'],
    };
  }

  // --- Schedule rung: modal must survive time-field interaction ---
  const schedClicked = await page.evaluate((id) => {
    const btn = document.getElementById(`cus-inline-schedule-${id}`);
    if (!btn || btn.disabled) return false;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return true;
  }, shipmentId);
  if (!schedClicked) {
    return { verdict: 'FAIL', errors: ['Schedule trigger missing/disabled on the picked row'] };
  }

  await new Promise((r) => setTimeout(r, 1000));
  const schedModal = await page.evaluate(() => {
    const m = document.querySelector('.modal__content');
    if (!m) return null;
    return { title: m.querySelector('h2, h3, .modal__title')?.innerText?.trim() ?? null };
  });
  await ctx.screenshot('02_schedule_modal_open');
  if (!schedModal) errors.push('Schedule modal did not open');
  else if (!schedModal.title?.toLowerCase().includes('lịch trình')) {
    errors.push(`Schedule modal title mismatch: got "${schedModal.title}"`);
  }

  const isModalOpen = () => page.evaluate(() => Boolean(document.querySelector('.modal__content')));

  if (schedModal) {
    // Click the Giờ (time) input inside the modal.
    const timeClicked = await page.evaluate(() => {
      const m = document.querySelector('.modal__content');
      const labels = m ? Array.from(m.querySelectorAll('label')) : [];
      const timeLabel = labels.find((l) => l.innerText.trim() === 'Giờ');
      const input = timeLabel?.querySelector('input') ?? null;
      if (!input) return false;
      input.scrollIntoView({ block: 'center' });
      input.focus();
      input.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 500));
    if (!timeClicked) {
      errors.push('Giờ (time) input not found inside schedule modal');
    } else {
      await ctx.screenshot('03_after_time_click');
      if (!(await isModalOpen())) errors.push('BUG: modal closed after clicking time field');
      else {
        // Type a time value (draft only — discarded via Hủy below).
        await page.keyboard.type('14:30', { delay: 50 });
        await new Promise((r) => setTimeout(r, 500));
        await ctx.screenshot('04_after_time_type');
        if (!(await isModalOpen())) errors.push('BUG: modal closed after typing time');
      }
    }

    // Positive control: Hủy closes the modal; draft discarded, no API call.
    const closed = await page.evaluate(() => {
      const m = document.querySelector('.modal__content');
      const cancel = m ? Array.from(m.querySelectorAll('button')).find((b) => b.innerText.trim() === 'Hủy') : null;
      if (cancel) { cancel.click(); return true; }
      return false;
    });
    await new Promise((r) => setTimeout(r, 500));
    const stillOpen = await isModalOpen();
    if (!closed || stillOpen) {
      errors.push('Schedule modal did not close after Hủy (draft must be discarded)');
    }
  }

  // --- Notes rung: positive control on the same row ---
  const notesClicked = await page.evaluate((id) => {
    const btn = document.getElementById(`cus-inline-notes-${id}`);
    if (!btn || btn.disabled) return false;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return true;
  }, shipmentId);
  if (!notesClicked) {
    errors.push('Notes trigger missing/disabled on the picked row (as CUS)');
  } else {
    await new Promise((r) => setTimeout(r, 800));
    const notesModal = await page.evaluate(() => {
      const m = document.querySelector('.modal__content');
      if (!m) return null;
      return { title: m.querySelector('h2, h3, .modal__title')?.innerText?.trim() ?? null };
    });
    await ctx.screenshot('05_notes_modal_open');
    if (!notesModal) {
      errors.push('Notes modal did not open (as CUS)');
    } else {
      if (!notesModal.title?.toLowerCase().includes('ghi chú')) {
        errors.push(`Notes modal title mismatch: got "${notesModal.title}"`);
      }
      const closed = await page.evaluate(() => {
        const m = document.querySelector('.modal__content');
        const cancel = m ? Array.from(m.querySelectorAll('button')).find((b) => b.innerText.trim() === 'Hủy') : null;
        if (cancel) { cancel.click(); return true; }
        return false;
      });
      await new Promise((r) => setTimeout(r, 500));
      const stillOpen = await isModalOpen();
      if (!closed || stillOpen) {
        errors.push('Notes modal did not close after Hủy');
      }
    }
  }

  return {
    verdict: errors.length > 0 ? 'FAIL' : 'PASS',
    rowUnderTest: shipmentId,
    errors,
  };
}
