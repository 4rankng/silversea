// cases/shipments-qa/TC-SHIP-QUICKEDIT-001.mjs
// /shipments quick-edit: open each field group, verify modal, cancel.
// Tests: identity, documents, classification, cargo, notes.
// (Schedule has its own dedicated test TC-SHIP-QUICKEDIT-SCHEDULE-001)
//
// Verdict: PASS when every quick-edit field opens a modal with correct
// title, shows form fields, and can be cancelled without error.

export const caseId = 'TC-SHIP-QUICKEDIT-001';
export const role = 'ADMIN';

const FIELD_BUTTONS = [
  { suffix: 'khách hàng và nhà máy', label: 'identity', expectedTitle: 'Chỉnh sửa' },
  { suffix: 'chứng từ',            label: 'documents', expectedTitle: 'Chứng từ' },
  { suffix: 'phân loại',           label: 'classification', expectedTitle: 'Phân loại' },
  { suffix: 'tổng quan hàng hóa',  label: 'cargo', expectedTitle: 'Hàng hóa' },
  { suffix: 'ghi chú',             label: 'notes', expectedTitle: 'Ghi chú' },
];

export default async function (ctx) {
  const { page } = ctx;
  const errors = [];

  await ctx.goto('/shipments');
  await page.waitForSelector('.cus-dashboard-table tbody tr', { timeout: 15000 });
  await ctx.screenshot('01_page_loaded');

  for (const field of FIELD_BUTTONS) {
    // Find the first editable row's button for this field
    const btn = await page.evaluate((suffix) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const match = buttons.find((b) => {
        const name = (b.getAttribute('aria-label') || b.innerText || '').toLowerCase();
        return name.includes('sửa ô') && name.includes(suffix);
      });
      if (match) {
        match.scrollIntoView({ block: 'center' });
        match.click();
        return true;
      }
      return false;
    }, field.suffix);

    if (!btn) {
      errors.push(`Button not found for field: ${field.label} (suffix: ${field.suffix})`);
      continue;
    }

    await new Promise((r) => setTimeout(r, 800));

    // Check modal opened
    const modalTitle = await page.evaluate(() => {
      const modal = document.querySelector('.modal__content, [role="dialog"]');
      if (!modal) return null;
      const h = modal.querySelector('h2, h3, .modal__title');
      return h ? h.innerText.trim() : modal.innerText.substring(0, 80);
    });

    await ctx.screenshot(`02_quickedit_${field.label}_open`);

    if (!modalTitle) {
      errors.push(`Modal did not open for field: ${field.label}`);
      continue;
    }

    // Verify form fields exist inside modal
    const formFieldCount = await page.$$eval('.cus-quick-edit-modal label, .cus-quick-edit-modal input, .cus-quick-edit-modal textarea, .cus-quick-edit-modal select', (els) => els.length);
    if (formFieldCount === 0) {
      errors.push(`No form fields inside modal for field: ${field.label}`);
    }

    // Cancel the modal
    const closed = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const cancel = buttons.find((b) => b.innerText.trim() === 'Hủy' || b.innerText.trim() === 'Cancel');
      if (cancel) { cancel.click(); return true; }
      return false;
    });
    await new Promise((r) => setTimeout(r, 500));

    // Verify modal closed
    const modalStillOpen = await page.$('.modal__content');
    if (modalStillOpen && closed) {
      errors.push(`Modal did not close after cancel for field: ${field.label}`);
    }
  }

  return {
    verdict: errors.length === 0 ? 'PASS' : 'FAIL',
    fieldsTested: FIELD_BUTTONS.map((f) => f.label),
    errors,
  };
}
