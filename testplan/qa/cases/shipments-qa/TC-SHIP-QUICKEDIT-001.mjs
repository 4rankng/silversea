// cases/shipments-qa/TC-SHIP-QUICKEDIT-001.mjs
// /shipments workboard quick-edit — CURRENT cell contract:
//   • FCL rows: the identity cell NAVIGATES to the per-container detail
//     view (/shipments-detail?dateScope=all&…) instead of opening a modal.
//     The case asserts that navigation (pathname + params), never a modal.
//   • LCL rows: identity / documents / classification / cargo open the
//     quick-edit modal. Positive control per group: open → assert title +
//     form fields → Hủy → assert closed.
//   • notes + schedule rungs are covered by
//     TC-SHIP-QUICKEDIT-SCHEDULE-001 (runs as CUS; the trigger gate now
//     spans CUS/ADMIN/DISPATCHER on unlocked lots).
// Mutation surface: READ-ONLY rungs — every open closes via Hủy, no data
// writes. Taps stay on ONE fixture row per rung. Finders are aria-label-only
// and scoped to .cus-dashboard-table (document-wide innerText matching used
// to land on wrong-page buttons after in-case navigation).
//
// Verdict: PASS when the FCL navigation asserts and every LCL cell group
// opens its modal with the expected title, shows form fields, and closes
// via Hủy without error. BLOCKED when page 1 has no LCL row to exercise.

export const caseId = 'TC-SHIP-QUICKEDIT-001';
export const role = 'ADMIN';

const TABLE = '.cus-dashboard-table';
const FIELD_GROUPS = [
  { idPrefix: 'cus-inline-identity', titleIncludes: 'Khách hàng & nhà máy', label: 'identity' },
  { idPrefix: 'cus-inline-documents', titleIncludes: 'Chứng từ', label: 'documents' },
  { idPrefix: 'cus-inline-classification', titleIncludes: 'Phân loại & hãng tàu', label: 'classification' },
  { idPrefix: 'cus-inline-cargo', titleIncludes: 'Tổng quan hàng hóa', label: 'cargo' },
];

export default async function (ctx) {
  const { page } = ctx;
  const errors = [];
  const blocked = [];

  await ctx.goto('/shipments');
  await page.waitForSelector(`${TABLE} tbody tr`, { timeout: 15000 });
  await ctx.screenshot('01_page_loaded');

  // --- Rung 1: FCL identity navigates to the per-container detail view ---
  const fclClicked = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.cus-dashboard-table tbody tr'));
    const row = rows.find((tr) => tr.querySelector("td[data-label='Lịch trình & điều xe'] div.cus-inline-trigger--readonly"));
    if (!row) return null;
    const btn = Array.from(row.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') || '').toLowerCase().startsWith('sửa ô khách hàng'));
    if (!btn) return null;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return btn.getAttribute('aria-label');
  });

  if (!fclClicked) {
    blocked.push('No FCL row on /shipments page 1 — navigation rung not exercised');
  } else {
    await new Promise((r) => setTimeout(r, 1200));
    const nav = await page.evaluate(() => ({ path: location.pathname, search: location.search }));
    await ctx.screenshot('02_fcl_identity_navigates');
    if (nav.path !== '/shipments-detail' || !nav.search.includes('dateScope=all')) {
      errors.push(`FCL identity did not navigate to /shipments-detail?dateScope=all… (got ${nav.path}${nav.search})`);
    }
    await ctx.goto('/shipments');
    await page.waitForSelector(`${TABLE} tbody tr`, { timeout: 15000 });
  }

  // --- Rung 2: LCL cell groups open quick-edit modals (one locked-on row) ---
  const shipmentId = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.cus-dashboard-table tbody tr'));
    const row = rows.find((tr) => tr.querySelector("td[data-label='Lịch trình & điều xe'] button[id^='cus-inline-schedule-']"));
    if (!row) return null;
    const identity = row.querySelector("button[id^='cus-inline-identity-']");
    const m = identity?.id.match(/-(\d+)$/);
    return m ? Number(m[1]) : null;
  });

  if (shipmentId == null) {
    blocked.push('No LCL row on /shipments page 1 — cell-group rungs not exercised');
  } else {
    for (const group of FIELD_GROUPS) {
      const clicked = await page.evaluate(({ idPrefix, shipmentId }) => {
        const btn = document.getElementById(`${idPrefix}-${shipmentId}`);
        if (!btn) return 'missing';
        if (btn.disabled) return 'disabled';
        btn.scrollIntoView({ block: 'center' });
        btn.click();
        return 'clicked';
      }, { idPrefix: group.idPrefix, shipmentId });

      if (clicked !== 'clicked') {
        errors.push(`Button not clickable for ${group.label}: ${clicked}`);
        continue;
      }

      await new Promise((r) => setTimeout(r, 800));

      const modal = await page.evaluate(() => {
        const m = document.querySelector('.modal__content');
        if (!m) return null;
        const title = m.querySelector('h2, h3, .modal__title')?.innerText?.trim() ?? null;
        const fields = m.querySelectorAll('.cus-quick-edit-modal label, .cus-quick-edit-modal input, .cus-quick-edit-modal textarea, .cus-quick-edit-modal select').length;
        return { title, fields };
      });

      await ctx.screenshot(`03_quickedit_${group.label}_open`);

      if (!modal) {
        errors.push(`Modal did not open for field: ${group.label}`);
        continue;
      }
      if (!modal.title || !modal.title.toLowerCase().includes(group.titleIncludes.toLowerCase())) {
        errors.push(`Modal title mismatch for ${group.label}: expected to include "${group.titleIncludes}", got "${modal.title}"`);
      }
      if (modal.fields === 0) {
        errors.push(`No form fields inside modal for field: ${group.label}`);
      }

      // Positive control: Hủy closes the modal.
      const closed = await page.evaluate(() => {
        const m = document.querySelector('.modal__content');
        const cancel = m ? Array.from(m.querySelectorAll('button')).find((b) => b.innerText.trim() === 'Hủy') : null;
        if (cancel) { cancel.click(); return true; }
        return false;
      });
      await new Promise((r) => setTimeout(r, 500));
      const stillOpen = await page.evaluate(() => Boolean(document.querySelector('.modal__content')));
      if (!closed || stillOpen) {
        errors.push(`Modal did not close after cancel for field: ${group.label}`);
      }
    }
  }

  return {
    verdict: errors.length > 0 ? 'FAIL' : blocked.length > 0 ? 'BLOCKED' : 'PASS',
    rowUnderTest: shipmentId ?? null,
    fieldsTested: FIELD_GROUPS.map((f) => f.label),
    errors,
    blocked: blocked.length > 0 ? blocked : undefined,
  };
}
