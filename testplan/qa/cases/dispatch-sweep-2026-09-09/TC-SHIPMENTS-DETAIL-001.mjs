// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-SHIPMENTS-DETAIL-001.mjs
// TC-SHIPMENTS-DETAIL-001 — Sổ cont: Cột Phân xe & Badge "Đã phân xe"
// Source: Báo cáo khách hàng 2026-09-08 / Image 3

export const caseId = 'TC-SHIPMENTS-DETAIL-001';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  await ctx.goto('/shipments-detail?dateScope=all');
  await page.waitForSelector('.shipment-container-ledger table', { timeout: 15000 });

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

  const plannedRows = rows.filter((r) => r.badge === 'Đã phân xe');
  const platedRows = rows.filter((r) => Boolean(r.plate));

  const ok = rows.length > 0 && plannedRows.length > 0 && platedRows.length > 0;
  return {
    verdict: ok ? 'PASS' : 'FAIL',
    totalRows: rows.length,
    plannedCount: plannedRows.length,
    platedCount: platedRows.length,
    samplePlanned: plannedRows.slice(0, 3),
  };
}
