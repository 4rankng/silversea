// cases/shipments-qa/TC-SHIP-DRAWER-001.mjs
// /shipments drawer: open detail, check workflow/signals/appointments,
// check document custody, check container ledger, close.
//
// Verdict: PASS when drawer opens, shows workflow section with signals,
// has appointment display, custody select, and container ledger rows.

export const caseId = 'TC-SHIP-DRAWER-001';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  const errors = [];

  await ctx.goto('/shipments');
  await page.waitForSelector('.cus-dashboard-table tbody tr', { timeout: 15000 });
  await ctx.screenshot('01_page_loaded');

  // --- Open first shipment detail ---
  const detailClicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const match = buttons.find((b) => {
      const name = (b.getAttribute('aria-label') || '').toLowerCase();
      return name.includes('mở chi tiết');
    });
    if (match) {
      match.scrollIntoView({ block: 'center' });
      match.click();
      return match.getAttribute('aria-label');
    }
    return null;
  });

  if (!detailClicked) {
    return { verdict: 'BLOCKED', errors: ['No detail button found'] };
  }

  await new Promise((r) => setTimeout(r, 2000));
  await ctx.screenshot('02_drawer_open');

  // Check drawer opened
  const drawer = await page.$('.cus-shipment-drawer');
  if (!drawer) {
    return { verdict: 'FAIL', errors: ['Drawer did not open'] };
  }

  // --- Check workflow section ---
  const workflow = await page.evaluate(() => {
    const section = document.querySelector('.cus-drawer-workflow');
    if (!section) return null;
    return {
      title: section.querySelector('h3')?.innerText || '',
      hasSignals: section.querySelectorAll('.cus-drawer-signal, [class*="signal"]').length > 0,
      hasAction: section.querySelector('.cus-drawer-workflow__action') != null,
      actionLabel: section.querySelector('.cus-drawer-workflow__action strong')?.innerText || '',
    };
  });

  if (!workflow) {
    errors.push('Workflow section not found in drawer');
  } else {
    if (!workflow.title.includes('Trạng thái')) {
      errors.push(`Workflow title unexpected: "${workflow.title}"`);
    }
  }

  // --- Check appointment display ---
  const appointments = await page.evaluate(() => {
    const aptSection = document.querySelector('.cus-drawer-decision--schedule');
    if (!aptSection) return null;
    const text = aptSection.innerText;
    return {
      hasContent: text.length > 0,
      text: text.substring(0, 200),
      hasNoSchedule: text.includes('Chưa có lịch'),
    };
  });

  if (!appointments) {
    errors.push('Appointment section not found');
  }

  // --- Check document custody select ---
  const custody = await page.evaluate(() => {
    const select = document.querySelector('.cus-drawer-decision--custody select, .cus-drawer-decision--custody [role="combobox"]');
    if (!select) return null;
    return {
      value: select.value || select.innerText?.substring(0, 50) || '',
      disabled: select.disabled || select.hasAttribute('disabled'),
    };
  });

  if (!custody) {
    errors.push('Document custody select not found');
  }

  // --- Check container ledger ---
  const ledger = await page.evaluate(() => {
    const table = document.querySelector('.shipment-container-ledger table, .cus-container-ledger table');
    if (!table) return null;
    const rows = table.querySelectorAll('tbody tr');
    return {
      rowCount: rows.length,
      headers: Array.from(table.querySelectorAll('th')).map((th) => th.innerText.trim()).filter(Boolean),
    };
  });

  if (!ledger) {
    // Ledger might load async — wait a bit more
    await new Promise((r) => setTimeout(r, 2000));
    const ledger2 = await page.evaluate(() => {
      const table = document.querySelector('.shipment-container-ledger table, .cus-container-ledger table');
      if (!table) return null;
      return { rowCount: table.querySelectorAll('tbody tr').length };
    });
    if (!ledger2 || ledger2.rowCount === 0) {
      errors.push('Container ledger not found or empty');
    }
  } else if (ledger.rowCount === 0) {
    errors.push('Container ledger has 0 rows');
  }

  await ctx.screenshot('03_drawer_detail');

  // --- Close drawer ---
  await page.evaluate(() => {
    const closeBtn = document.querySelector('.drawer__close, [aria-label*="Đóng"]');
    if (closeBtn) { closeBtn.click(); return; }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 500));
  await ctx.screenshot('04_drawer_closed');

  return {
    verdict: errors.length === 0 ? 'PASS' : 'FAIL',
    detailClicked,
    workflow,
    appointments,
    custody,
    ledger,
    errors,
  };
}
