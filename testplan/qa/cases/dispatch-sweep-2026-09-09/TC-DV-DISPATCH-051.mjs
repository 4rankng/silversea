// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-DV-DISPATCH-051.mjs
// TC-DV-DISPATCH-051 — Phát lệnh flow: quick-issue affordance + assignment-editor contract.
//
// MUTATION SURFACE: none — this case is READ-ONLY.
// 2026-09-20 ruling (card 20260920_45 incident note): mutation-class row actions are
// NEVER swept. Every tap on a row action must be a single fixture-row tap preceded by
// an affirmative read of the button's contract — no iterate-and-click loops, ever.
// This case taps NO row action at all. The quick-issue icon ("Phát lệnh · <container>",
// QuickIssueOrderButton) ISSUES THE REAL ORDER on click — "A row action issues directly
// without mounting the assignment dialog" — so it is asserted as AFFORDANCE-EXISTS only
// (aria-label + title contract text). The old "quick-issue calendar modal" no longer
// exists: planning times are CUS-owned ("dispatchers never pick times", useIssueOrder),
// so the calendar assertions are re-homed to the ASSIGNMENT EDITOR dialog (opened via
// the dispatch-cell trigger, closed via Hủy = non-mutating): carrier/vehicle fields
// present, and the obsolete input[type="datetime-local"] absent.
//
// mutates: nothing.

export const caseId = 'TC-DV-DISPATCH-051';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  await ctx.goto('/dispatch-detail');
  await page.waitForSelector('.dispatch-assignment-cell__trigger, .detailed-plan-grid', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));

  // 1. Quick-issue affordance exists (contract read only — never clicked).
  //    Each button carries the immediate-issue contract in its title.
  const quickIssue = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button[aria-label^="Phát lệnh ·"]'));
    return {
      count: buttons.length,
      samples: buttons.slice(0, 5).map((b) => ({
        ariaLabel: b.getAttribute('aria-label'),
        title: b.getAttribute('title'),
        titleIsIssueContract: (b.getAttribute('title') || '').includes('Phát lệnh ngay'),
      })),
    };
  });
  if (quickIssue.count === 0) {
    await ctx.screenshot('01_dispatch_detail_no_quick_issue');
    return {
      verdict: 'BLOCKED',
      errors: ['Không có dòng plated-not-issued nào trên trang 1 — cần fixture (mã prefix QA0920-) ở trạng thái có biển nhưng chưa phát lệnh.'],
      quickIssue,
    };
  }

  await ctx.screenshot('01_dispatch_detail_overview');

  // 2. Assignment-editor dialog: opened via the dispatch-cell trigger (a cell,
  //    not a row action). Read-only until save; closed via Hủy. Triggers on
  //    DISPATCHED rows with a CREATED/IN_TRANSIT trip open the REASSIGN
  //    dialog instead — pick an edit-mode trigger (aria-haspopup="dialog").
  const editable = await page.evaluate(() => {
    const triggers = Array.from(document.querySelectorAll('.dispatch-assignment-cell__trigger'));
    const target = triggers.find((t) => t.getAttribute('aria-haspopup') === 'dialog' && !t.disabled);
    if (target) {
      // Scroll + click atomically: the app resets main scrollTop on re-render,
      // so a puppeteer scroll-then-click across ticks lands on stale coordinates.
      target.scrollIntoView({ block: 'center' });
      target.click();
      return { found: true, label: target.getAttribute('aria-label') };
    }
    return { found: false, label: null, total: triggers.length };
  });
  if (!editable.found) {
    await ctx.screenshot('02_no_editable_trigger');
    return {
      verdict: 'BLOCKED',
      errors: ['Không có trigger điều phối ở chế độ sửa (mọi dòng đều đã phát lệnh/đã hoàn thành) — cần fixture plated-not-issued.'],
      quickIssue,
      editable,
    };
  }
  await page.waitForSelector('form.dispatch-assignment-dialog', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 800));
  await ctx.screenshot('02_assignment_editor_dialog');

  const editor = await page.evaluate(() => {
    const dialog = document.querySelector('form.dispatch-assignment-dialog');
    const labels = Array.from(dialog.querySelectorAll('label > span')).map((s) => s.textContent.trim());
    return {
      dialogPresent: Boolean(dialog),
      carrierField: labels.includes('Nhà xe'),
      vehicleField: labels.includes('Xe / biển số'),
      hasOldDatetimeLocal: Boolean(dialog.querySelector('input[type="datetime-local"]')),
      datetimeLocalAnywhere: Boolean(document.querySelector('input[type="datetime-local"]')),
      legendTexts: Array.from(dialog.querySelectorAll('legend')).map((l) => l.textContent.trim()),
    };
  });

  // 3. Close via Hủy (footer button) and verify the dialog unmounts.
  await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    const buttons = Array.from((modal || document).querySelectorAll('button'));
    const cancelBtn = buttons.find((b) => b.textContent?.trim() === 'Hủy');
    if (cancelBtn) cancelBtn.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await ctx.screenshot('03_editor_closed');

  const closed = await page.evaluate(() => document.querySelector('form.dispatch-assignment-dialog') == null);

  const ok = quickIssue.count > 0
    && quickIssue.samples.every((s) => s.titleIsIssueContract)
    && editor.dialogPresent
    && editor.carrierField
    && editor.vehicleField
    && !editor.hasOldDatetimeLocal
    && !editor.datetimeLocalAnywhere
    && closed;

  return {
    verdict: ok ? 'PASS' : 'FAIL',
    quickIssue: { count: quickIssue.count, samples: quickIssue.samples },
    editor,
    closed,
  };
}
