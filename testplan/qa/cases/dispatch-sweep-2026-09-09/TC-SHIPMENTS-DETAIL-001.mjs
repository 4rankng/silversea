// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-SHIPMENTS-DETAIL-001.mjs
// TC-SHIPMENTS-DETAIL-001 — Sổ cont: Cột Phân xe & Badge "Đã phân xe"
// Source: Báo cáo khách hàng 2026-09-08 / Image 3
//
// The ledger is narrowed to a lead-approved QA0920-* fixture because the full
// ledger paginates at 20 rows and the dispatched fixture sits deeper. That
// fixture is a STAGING seed: on an env without it the search empties the
// ledger, and the old case read `totalRows: 0` as a FAIL — a missing fixture
// reported as a product defect. An absent fixture is now BLOCKED, naming both
// the fixture and the env the run actually hit.
//
// The search field is addressed by its ACCESSIBLE NAME
// (ShipmentContainersPage.tsx:251 renders
// `ariaLabel: 'Container, Bill/Booking hoặc tờ khai'`); the old
// `input[placeholder*="Bill/Book"]` matched nothing, so the filter never ran.

import { SEL } from '../../lib/selectors.mjs';

export const caseId = 'TC-SHIPMENTS-DETAIL-001';
export const role = 'ADMIN';

/** Staging seed family (Báo cáo khách hàng 2026-09-08, Image 3). */
const QA0920_FIXTURE = 'QA0920-BL-RE';
const SEARCH = SEL.searchInput('Container, Bill/Booking hoặc tờ khai');

export default async function (ctx) {
  const { page } = ctx;
  const envTag = `[${ctx.env.env}]`;

  await ctx.goto('/shipments-detail?dateScope=all');
  await page.waitForSelector('.shipment-container-ledger table', { timeout: 15000 });

  const searchBox = await page.$(SEARCH);
  if (!searchBox) {
    return {
      verdict: 'BLOCKED',
      errors: [`${envTag} the container-ledger search input is not reachable by accessible name (${SEARCH}) — the fixture narrowing could not be attempted`],
    };
  }
  await searchBox.click();
  await page.keyboard.type(QA0920_FIXTURE, { delay: 20 });
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 2000));

  await ctx.screenshot('01_shipments_detail_ledger');

  const rows = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('.shipment-container-ledger tbody tr'));
    return trs.map((r) => {
      const badge = r.querySelector('.shipment-container-ledger__dispatch-badge')?.innerText.trim();
      const plate = r.querySelector('.shipment-container-ledger__plate')?.innerText.trim();
      const vehicle = r.querySelector('td[data-label="Phân xe"] strong')?.innerText.trim();
      const cont = r.querySelector('td[data-label="Số cont"]')?.innerText.replace(/\s+/g, ' ').trim();
      return { cont, vehicle, plate, badge };
    });
  });

  // The fixture is the subject of this rung. If the search matched nothing,
  // the env does not carry the fixture — BLOCKED, never FAIL.
  if (rows.length === 0) {
    return {
      verdict: 'BLOCKED',
      fixture: QA0920_FIXTURE,
      totalRows: 0,
      errors: [`${envTag} the ${QA0920_FIXTURE} fixture chain is not present on this env — searching for it emptied the ledger, so the "Đã điều xe" / "Phân xe" column could not be checked`],
    };
  }

  const CURRENT_LABELS = ['Chờ phân xe', 'Đã điều xe', 'Đang chạy', 'Hoàn thành', 'Đã tạo chuyến'];
  const plannedRows = rows.filter((r) => CURRENT_LABELS.includes(r.badge));
  const dieuXeRows = rows.filter((r) => r.badge === 'Đã điều xe');
  const platedRows = rows.filter((r) => Boolean(r.plate));

  const missing = [];
  if (plannedRows.length === 0) missing.push('no row carries a current-status badge');
  if (platedRows.length === 0) missing.push('no row shows a plate in the Phân xe column');
  if (dieuXeRows.length === 0) missing.push('no row is badged "Đã điều xe"');
  const ok = missing.length === 0;

  return {
    verdict: ok ? 'PASS' : 'FAIL',
    fixture: QA0920_FIXTURE,
    totalRows: rows.length,
    plannedCount: plannedRows.length,
    dieuXeCount: dieuXeRows.length,
    platedCount: platedRows.length,
    samplePlanned: plannedRows.slice(0, 3),
    errors: ok ? [] : [`${envTag} ${QA0920_FIXTURE}: ${missing.join('; ')} — see samplePlanned`],
  };
}
