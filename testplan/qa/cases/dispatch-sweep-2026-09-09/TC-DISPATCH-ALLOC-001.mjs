// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-DISPATCH-ALLOC-001.mjs
// TC-DISPATCH-ALLOC-001 — Phân bổ nhà xe theo từng ngày (flat table per day)
// Source: Báo cáo khách hàng 2026-09-08 / Image 2 Top

export const caseId = 'TC-DISPATCH-ALLOC-001';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  await ctx.goto('/dispatch');
  await page.waitForSelector('.master-plan-grid__allocation-trigger', { timeout: 15000 });

  await ctx.screenshot('01_master_plan_overview');

  const triggers = await page.$$('.master-plan-grid__allocation-trigger');
  if (triggers.length === 0) {
    return { verdict: 'BLOCKED', errors: ['Không tìm thấy nút Phân bổ trên /dispatch'] };
  }

  await triggers[0].evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    el.click();
  });
  await page.waitForSelector('.dispatch-allocation-popover', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 1000));

  await ctx.screenshot('02_allocation_dialog_grouped_by_day');

  const structure = await page.evaluate(() => {
    const dialog = document.querySelector('.dispatch-allocation-popover');
    if (!dialog) return null;
    const dayGroups = Array.from(dialog.querySelectorAll('.dispatch-allocation-popover__day-group'));
    const dayTitles = Array.from(dialog.querySelectorAll('.dispatch-allocation-popover__day-title')).map((el) => el.innerText.trim());
    const balance = dialog.querySelector('.dispatch-allocation-popover__balance')?.innerText.replace(/\s+/g, ' ').trim();
    return {
      dayGroupCount: dayGroups.length,
      dayTitles,
      balance,
    };
  });

  // Close dialog
  const closeBtn = await page.$('.dispatch-allocation-popover__close, button.btn--secondary');
  if (closeBtn) await closeBtn.click();

  const ok = structure && structure.dayGroupCount > 0 && structure.dayTitles.length > 0;
  return {
    verdict: ok ? 'PASS' : 'FAIL',
    structure,
  };
}
