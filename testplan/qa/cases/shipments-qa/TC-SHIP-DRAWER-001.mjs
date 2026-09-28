// cases/shipments-qa/TC-SHIP-DRAWER-001.mjs
// /shipments drawer: open detail, check workflow/signals/appointments,
// check document custody, check container ledger, close.
//
// Row selection is by PROPERTY, not by position. The case used to open the
// FIRST row of /shipments, which in a suite run is whatever lot an earlier case
// created most recently — and those throwaway lots have no containers, so
// CusContainerLedger rendered `<p class="cus-detail-empty">Lô hàng chưa có dữ
// liệu container.</p>` with no table and the ledger rung reported a FAIL for a
// row nobody chose. `pickContainerBearingShipment` (lib/fixtures.mjs) asks the
// API for a lot that actually has containers; when the env has none, the case is
// BLOCKED naming the env, never FAIL.
//
// Verdict: PASS when the drawer opens on a container-bearing lot, shows the
// workflow section, an appointment display, the custody select, and a
// container ledger with rows.

import { pickContainerBearingShipment } from '../../lib/fixtures.mjs';
import { QE, SEL } from '../../lib/selectors.mjs';

export const caseId = 'TC-SHIP-DRAWER-001';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  const errors = [];
  const envTag = `[${ctx.env.env}]`;

  const lot = await pickContainerBearingShipment(ctx);
const DRAWER = '.cus-shipment-drawer';
  if (!lot) {
    return {
      verdict: 'BLOCKED',
      errors: [`${envTag} no lot with containers to open — the drawer rungs need one; earlier cases in a run create container-less lots that used to land on top of the list`],
    };
  }

  // Narrow the workboard to the chosen lot through the app's own search, then
  // open THAT lot's row (CusShipmentRow.tsx:235 → `cus-dashboard-detail-<id>`).
  const board = `/shipments?limit=200&searchSuffix=${encodeURIComponent(lot.ref)}`;
  await ctx.goto(board);
  await ctx.screenshot('01_page_loaded');

  const rowPresent = await page.waitForSelector(SEL.rowDetailButton(lot.id), { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!rowPresent) {
    return {
      verdict: 'FAIL',
      lot,
      errors: [`${envTag} lot #${lot.id} (${lot.ref}, ${lot.containerCount} cont) is in the API but its row never rendered on ${board}`],
    };
  }

  const detailClicked = await page.evaluate(QE.clickRowDetailButton(lot.id));
  await new Promise((r) => setTimeout(r, 2000));
  await ctx.screenshot('02_drawer_open');

  // Check drawer opened
  const drawer = await page.$(DRAWER);
  if (!drawer) {
    return { verdict: 'FAIL', lot, detailClicked, errors: [`${envTag} drawer did not open for lot #${lot.id}`] };
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
    errors.push(`${envTag} workflow section not found in drawer`);
  } else if (!workflow.title.includes('Trạng thái')) {
    errors.push(`${envTag} workflow title unexpected: "${workflow.title}"`);
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
    errors.push(`${envTag} appointment section not found`);
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
    errors.push(`${envTag} document custody select not found`);
  }

  // --- Check container ledger ---
  // The lot was chosen for HAVING containers, so the ledger must render a table
  // with at least one line — the empty-ledger paragraph is a real defect here,
  // not the shape of a container-less lot.
  let ledger = await page.evaluate(QE.containerLedgerState);
  if (!ledger.hasTable || ledger.rowCount === 0) {
    // Ledger loads async — give it one more beat before calling it a defect.
    await new Promise((r) => setTimeout(r, 2000));
    ledger = await page.evaluate(QE.containerLedgerState);
  }
  if (!ledger.hasTable) {
    errors.push(`${envTag} no container-ledger table for lot #${lot.id} (${lot.containerCount} cont via API); empty-ledger line: "${ledger.emptyText ?? 'none'}"`);
  } else if (ledger.rowCount === 0) {
    errors.push(`${envTag} container ledger for lot #${lot.id} has 0 rows`);
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
    lot,
    detailClicked,
    workflow,
    appointments,
    custody,
    ledger: { hasTable: ledger.hasTable, rowCount: ledger.rowCount },
    errors,
  };
}
