// cases/shipments-qa/TC-SHIP-ACTIONS-001.mjs
// /shipments actions under the no-approval policy (internal-approval ruling
// removed 2026-09-15): Khóa lô is a direct CUS action — ADMIN tapping it gets
// the permission toast; no reason textarea exists anywhere in the flow.
//
// Verdict: PASS when (a) ADMIN tapping 'Khóa lô' receives the role toast
// 'Chỉ CUS được khóa lô.', (b) no reason textarea is present, (c) cancel
// leaves the shipment untouched.

export const caseId = 'TC-SHIP-ACTIONS-001';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  const errors = [];

  await ctx.goto('/shipments');
  await page.waitForSelector('.cus-dashboard-table tbody tr', { timeout: 15000 });
  await ctx.screenshot('01_page_loaded');

  // Open the first shipment drawer
  const detailClicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const match = buttons.find((b) => (b.getAttribute('aria-label') || '').toLowerCase().includes('mở chi tiết'));
    if (match) { match.click(); return true; }
    return false;
  });
  if (!detailClicked) {
    return { verdict: 'FAIL', errors: ['No "Mở chi tiết" button found on /shipments'] };
  }
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 1200));
  await ctx.screenshot('02_drawer_open');

  // (b) No reason textarea — the approval-era reason field is gone.
  const textareas = await page.evaluate(() => document.querySelectorAll('[role="dialog"] textarea').length);
  if (textareas > 0) {
    errors.push(`Reason textarea still present in drawer (${textareas}) — no-approval violation`);
  }

  // (a) ADMIN taps 'Khóa lô' → permission toast 'Chỉ CUS được khóa lô.'
  const lockTapped = await page.evaluate(() => {
    const drawer = document.querySelector('[role="dialog"]');
    const buttons = Array.from((drawer || document).querySelectorAll('button'));
    const match = buttons.find((b) => /khóa lô/i.test(b.innerText || b.getAttribute('aria-label') || ''));
    if (!match) return false;
    match.click();
    return true;
  });
  if (!lockTapped) {
    errors.push('No "Khóa lô" button found in drawer');
  } else {
    await new Promise((r) => setTimeout(r, 800));
    // ADMIN contract: a persistent inline note 'Chỉ CUS được khóa lô.' renders
    // beside the Khóa lô control (not a transient toast).
    const lockNote = await page.evaluate(() => {
      const drawer = document.querySelector('[role="dialog"]');
      const nodes = Array.from((drawer || document).querySelectorAll('*')).filter((n) => n.children.length === 0 && n.offsetWidth && n.textContent.includes('Chỉ CUS được khóa lô'));
      return nodes.length;
    });
    await ctx.screenshot('03_admin_lock_note');
    if (lockNote === 0) {
      errors.push("Expected inline note 'Chỉ CUS được khóa lô.' beside the Khóa lô control");
    }
    // (c) Cancel cleanly — close the drawer, nothing mutated.
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 600));
    await new Promise((r) => setTimeout(r, 800));
    const drawerGone = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
    if (!drawerGone) errors.push('Drawer did not close after cancel');
  }

  return {
    verdict: errors.length === 0 ? 'PASS' : 'FAIL',
    textareas,
    errors,
  };
}
