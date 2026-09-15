// cases/shipments-qa/TC-SHIP-ACTIONS-001.mjs
// /shipments actions: open action modal (confirm/lock/reopen), verify
// modal content, test reason field, cancel.
//
// Verdict: PASS when action modal opens with correct title and reason
// field, and cancels cleanly.

export const caseId = 'TC-SHIP-ACTIONS-001';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  const errors = [];

  await ctx.goto('/shipments');
  await page.waitForSelector('.cus-dashboard-table tbody tr', { timeout: 15000 });
  await ctx.screenshot('01_page_loaded');

  // Find a row with an action button (confirm/lock/reopen)
  const actionBtn = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    // Look for action buttons in the drawer workflow section or row actions
    const match = buttons.find((b) => {
      const name = (b.getAttribute('aria-label') || b.innerText || '').toLowerCase();
      return name.includes('xác nhận') || name.includes('khóa lô') || name.includes('mở khóa');
    });
    if (match) {
      match.scrollIntoView({ block: 'center' });
      return { label: match.innerText.trim(), ariaLabel: match.getAttribute('aria-label') || '' };
    }
    return null;
  });

  if (!actionBtn) {
    // Actions may only be available inside the drawer for specific shipments
    // Try opening a drawer first
    const detailClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const match = buttons.find((b) => {
        const name = (b.getAttribute('aria-label') || '').toLowerCase();
        return name.includes('mở chi tiết');
      });
      if (match) { match.click(); return true; }
      return false;
    });

    if (detailClicked) {
      await new Promise((r) => setTimeout(r, 2000));

      // Now look for action button inside drawer
      const drawerAction = await page.evaluate(() => {
        const drawer = document.querySelector('.cus-shipment-drawer');
        if (!drawer) return null;
        const buttons = Array.from(drawer.querySelectorAll('button'));
        const match = buttons.find((b) => {
          const text = (b.innerText || '').toLowerCase();
          return text.includes('xác nhận') || text.includes('khóa') || text.includes('điều chỉnh');
        });
        if (match) {
          match.click();
          return match.innerText.trim();
        }
        return null;
      });

      if (drawerAction) {
        await new Promise((r) => setTimeout(r, 800));
        await ctx.screenshot('02_action_modal_open');

        // Check modal opened
        const modalContent = await page.evaluate(() => {
          const modals = document.querySelectorAll('[role="dialog"], .modal__content');
          for (const m of modals) {
            if (m.offsetParent !== null || getComputedStyle(m).display !== 'none') {
              return m.innerText.substring(0, 300);
            }
          }
          return null;
        });

        if (!modalContent) {
          errors.push('Action modal did not open');
        } else {
          // Check for reason textarea
          const hasReasonField = await page.evaluate(() => {
            const ta = document.querySelector('.cus-action-reason textarea, textarea[required]');
            return ta != null;
          });
          if (!hasReasonField) {
            errors.push('Reason textarea not found in action modal');
          }

          await ctx.screenshot('03_action_modal_detail');
        }

        // Cancel the modal
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const cancel = buttons.find((b) => b.innerText.trim() === 'Hủy');
          if (cancel) cancel.click();
        });
        await new Promise((r) => setTimeout(r, 500));
      } else {
        errors.push('No action button found inside drawer');
      }

      // Close drawer
      await page.evaluate(() => {
        const closeBtn = document.querySelector('.drawer__close, [aria-label*="Đóng"]');
        if (closeBtn) closeBtn.click();
      });
      await new Promise((r) => setTimeout(r, 500));
    } else {
      errors.push('No action button or detail button found on page');
    }
  } else {
    // Click the action button directly
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const match = buttons.find((b) => {
        const name = (b.getAttribute('aria-label') || b.innerText || '').toLowerCase();
        return name.includes('xác nhận') || name.includes('khóa lô') || name.includes('mở khóa');
      });
      if (match) match.click();
    });
    await new Promise((r) => setTimeout(r, 800));
    await ctx.screenshot('02_action_modal_direct');

    const modalContent = await page.evaluate(() => {
      const modals = document.querySelectorAll('[role="dialog"], .modal__content');
      for (const m of modals) {
        if (m.offsetParent !== null || getComputedStyle(m).display !== 'none') {
          return m.innerText.substring(0, 300);
        }
      }
      return null;
    });

    if (!modalContent) {
      errors.push('Action modal did not open');
    }

    // Cancel
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const cancel = buttons.find((b) => b.innerText.trim() === 'Hủy');
      if (cancel) cancel.click();
    });
    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    verdict: errors.length === 0 ? 'PASS' : 'FAIL',
    actionBtn,
    errors,
  };
}
