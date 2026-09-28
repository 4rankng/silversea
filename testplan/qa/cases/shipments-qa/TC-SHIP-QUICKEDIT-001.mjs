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
//
// Two corrections this case used to get wrong:
//   1. The "FCL row" detector keyed off the READ-ONLY schedule cell
//     (`td[data-label='Lịch trình & điều xe'] div.cus-inline-trigger--readonly`).
//     That cell renders for EVERY non-LCL lot, FCL or not, so the detector
//     clicked an LCL lot and got a modal where the case expected navigation.
//     The real FCL signal is the identity trigger itself: CusShipmentRow.tsx:112
//     gives it the FCL-only title "Xem và chỉnh nhà máy theo từng container"
//     and drops aria-haspopup, because it navigates instead of opening a dialog.
//   2. `fields === 0` was treated as a defect in the documents modal. It is not:
//     CusQuickEdit.tsx:51-53 renders the Bill/Booking inputs only when the lot
//     has a trade direction, and otherwise renders the guidance "Chọn Nhập hoặc
//     Xuất trong mục Phân loại trước khi cập nhật Bill/Booking." — zero inputs is
//     the CORRECT shape there. The assertion is direction-aware below.
//
// The board is opened at `?limit=200` (the widest page size the app offers) so
// both row kinds are chosen by cargo mode, not by page-1 luck. BLOCKED names the
// env when a rung has no row to exercise; only a broken contract is a FAIL.
//
// Mutation surface: READ-ONLY rungs — every open closes via Hủy, no data
// writes. Taps stay on ONE fixture row per rung. Finders are aria-label-only
// and scoped to .cus-dashboard-table (document-wide innerText matching used
// to land on wrong-page buttons after in-case navigation).

export const caseId = 'TC-SHIP-QUICKEDIT-001';
export const role = 'ADMIN';

const TABLE = '.cus-dashboard-table';
// Widest page the workboard itself offers — used so a rung picks its row by
// cargo mode rather than by whatever landed on top of the list.
const BOARD = '/shipments?limit=200';
/** CusShipmentRow.tsx:112 — this title renders for an FCL lot and no other. */
const FCL_IDENTITY_TITLE = 'Xem và chỉnh nhà máy theo từng container';
/** CusQuickEdit.tsx:53 — the guidance rendered when the lot has no direction. */
const NO_DIRECTION_GUIDANCE = 'Chọn Nhập hoặc Xuất trong mục Phân loại trước khi cập nhật Bill/Booking.';

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
  const envTag = `[${ctx.env.env}]`;

  await ctx.goto(BOARD);
  await page.waitForSelector(`${TABLE} tbody tr`, { timeout: 15000 });
  await ctx.screenshot('01_page_loaded');

  // --- Rung 1: FCL identity navigates to the per-container detail view ---
  const fclClicked = await page.evaluate((fclTitle) => {
    const rows = Array.from(document.querySelectorAll('.cus-dashboard-table tbody tr'));
    for (const tr of rows) {
      const btn = tr.querySelector("button[id^='cus-inline-identity-']");
      if (!btn || btn.disabled) continue;
      // FCL = the identity trigger navigates: it carries the per-container
      // title and is NOT a dialog trigger. An LCL (or direction-less) lot has
      // aria-haspopup="dialog" instead.
      if (btn.getAttribute('title') !== fclTitle) continue;
      if (btn.hasAttribute('aria-haspopup')) continue;
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      return btn.getAttribute('aria-label');
    }
    return null;
  }, FCL_IDENTITY_TITLE);

  if (!fclClicked) {
    blocked.push(`${envTag} no FCL row on the rendered ${BOARD} board — navigation rung not exercised`);
  } else {
    await new Promise((r) => setTimeout(r, 1200));
    const nav = await page.evaluate(() => ({ path: location.pathname, search: location.search }));
    await ctx.screenshot('02_fcl_identity_navigates');
    if (nav.path !== '/shipments-detail' || !nav.search.includes('dateScope=all')) {
      errors.push(`${envTag} FCL identity did not navigate to /shipments-detail?dateScope=all… (got ${nav.path}${nav.search})`);
    }
    await ctx.goto(BOARD);
    await page.waitForSelector(`${TABLE} tbody tr`, { timeout: 15000 });
  }

  // --- Rung 2: LCL cell groups open quick-edit modals (one locked-on row) ---
  // LCL signal: the schedule cell renders an editable trigger (CusShipmentRow
  // .tsx:174-176) — the FCL/direction-less branch renders a read-only div.
  // The row's direction badge decides what the documents modal must contain.
  const lclRow = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.cus-dashboard-table tbody tr'));
    for (const tr of rows) {
      if (!tr.querySelector("td[data-label='Lịch trình & điều xe'] button[id^='cus-inline-schedule-']")) continue;
      const identity = tr.querySelector("button[id^='cus-inline-identity-']");
      const m = identity?.id.match(/-(\d+)$/);
      if (!m) continue;
      const badge = tr.querySelector('.cus-direction-badge');
      return { shipmentId: Number(m[1]), direction: badge ? badge.innerText.trim() : null };
    }
    return null;
  });

  const shipmentId = lclRow?.shipmentId ?? null;
  if (shipmentId == null) {
    blocked.push(`${envTag} no LCL row on the rendered ${BOARD} board — cell-group rungs not exercised`);
  } else {
    // 'Nhập' / 'Xuất' badge text → the single Bill/Booking field the modal owes.
    const expectedDocField = lclRow.direction === 'Nhập' ? 'Số Bill' : lclRow.direction === 'Xuất' ? 'Số Booking' : null;

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
        errors.push(`${envTag} button not clickable for ${group.label}: ${clicked}`);
        continue;
      }

      await new Promise((r) => setTimeout(r, 800));

      const modal = await page.evaluate(() => {
        const m = document.querySelector('.modal__content');
        if (!m) return null;
        const title = m.querySelector('h2, h3, .modal__title')?.innerText?.trim() ?? null;
        const fields = m.querySelectorAll('.cus-quick-edit-modal label, .cus-quick-edit-modal input, .cus-quick-edit-modal textarea, .cus-quick-edit-modal select').length;
        // The Bill/Booking inputs, named by their own label — a count of "any
        // input" cannot tell "no direction" apart from "inputs missing".
        const billBook = Array.from(m.querySelectorAll('.cus-quick-edit-modal label'))
          .map((l) => l.querySelector('span')?.innerText?.trim() ?? '')
          .filter((text) => text === 'Số Bill' || text === 'Số Booking');
        return { title, fields, billBook, text: (m.innerText || '') };
      });

      await ctx.screenshot(`03_quickedit_${group.label}_open`);

      if (!modal) {
        errors.push(`${envTag} modal did not open for field: ${group.label}`);
        continue;
      }
      if (!modal.title || !modal.title.toLowerCase().includes(group.titleIncludes.toLowerCase())) {
        errors.push(`${envTag} modal title mismatch for ${group.label}: expected to include "${group.titleIncludes}", got "${modal.title}"`);
      }

      if (group.label === 'documents') {
        // Direction-aware: the documents modal owes exactly the one field the
        // lot's direction allows, or — with no direction — the guidance line
        // and no Bill/Booking input at all.
        if (expectedDocField == null) {
          if (!modal.text.includes(NO_DIRECTION_GUIDANCE)) {
            errors.push(`${envTag} documents modal on a lot with no trade direction must show "${NO_DIRECTION_GUIDANCE}", got: "${modal.text.slice(0, 120)}"`);
          }
          if (modal.billBook.length > 0) {
            errors.push(`${envTag} documents modal rendered Bill/Booking inputs (${modal.billBook.join(', ')}) for a lot with no trade direction`);
          }
        } else if (!modal.billBook.includes(expectedDocField)) {
          errors.push(`${envTag} documents modal for direction "${lclRow.direction}" must render "${expectedDocField}", got: [${modal.billBook.join(', ') || 'none'}]`);
        }
      } else if (modal.fields === 0) {
        errors.push(`${envTag} no form fields inside modal for field: ${group.label}`);
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
        errors.push(`${envTag} modal did not close after cancel for field: ${group.label}`);
      }
    }
  }

  return {
    verdict: errors.length > 0 ? 'FAIL' : blocked.length > 0 ? 'BLOCKED' : 'PASS',
    rowUnderTest: shipmentId,
    rowDirection: lclRow?.direction ?? null,
    fclIdentityClicked: fclClicked,
    fieldsTested: FIELD_GROUPS.map((f) => f.label),
    errors,
    blocked: blocked.length > 0 ? blocked : undefined,
  };
}
