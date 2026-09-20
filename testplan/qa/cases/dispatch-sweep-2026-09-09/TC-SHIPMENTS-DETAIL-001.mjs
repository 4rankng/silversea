// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-SHIPMENTS-DETAIL-001.mjs
// TC-SHIPMENTS-DETAIL-001 — Sổ cont: Cột Phân xe & Badge "Đã phân xe"
// Source: Báo cáo khách hàng 2026-09-08 / Image 3

export const caseId = 'TC-SHIPMENTS-DETAIL-001';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  await ctx.goto('/shipments-detail?dateScope=all');
  await page.waitForSelector('.shipment-container-ledger table', { timeout: 15000 });

  // Narrow to the QA0920 fixture chain so a 'Đã điều xe' row lands on page 1
  // (the full ledger paginates at 20 rows and the dispatched fixture sits
  // deeper). Fixture rows are lead-approved QA0920-* data.
  const searchBox = await page.$('input[placeholder*="Bill/Book"]');
  if (searchBox) {
    await searchBox.click();
    await page.keyboard.type('QA0920-BL-RE', { delay: 20 });
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 2000));
  }

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

  const CURRENT_LABELS = ['Chờ phân xe', 'Đã điều xe', 'Đang chạy', 'Hoàn thành', 'Đã tạo chuyến'];
  const plannedRows = rows.filter((r) => CURRENT_LABELS.includes(r.badge));
  const dieuXeRows = rows.filter((r) => r.badge === 'Đã điều xe');
  const platedRows = rows.filter((r) => Boolean(r.plate));

  const ok = rows.length > 0 && plannedRows.length > 0 && platedRows.length > 0 && dieuXeRows.length > 0;
  return {
    verdict: ok ? 'PASS' : 'FAIL',
    totalRows: rows.length,
    plannedCount: plannedRows.length,
    dieuXeCount: dieuXeRows.length,
    platedCount: platedRows.length,
    samplePlanned: plannedRows.slice(0, 3),
  };
}
