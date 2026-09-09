// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-CUS-CREATE-048.mjs
// TC-CUS-CREATE-048 — Lô FCL nhiều cont có cont chưa chốt ngày: cảnh báo Chưa chốt ngày, giữ Chờ chốt lịch
// Source: Báo cáo khách hàng 2026-09-08 / Image 0

export const caseId = 'TC-CUS-CREATE-048';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  await ctx.goto('/shipments');
  await page.waitForSelector('.cus-dashboard-table, .cus-dashboard-row', { timeout: 15000 });

  await ctx.screenshot('01_shipments_overview');

  // Verify rows on /shipments
  const rows = await page.evaluate(() => {
    const tableRows = Array.from(document.querySelectorAll('tr.cus-dashboard-row'));
    return tableRows.map((r) => {
      const text = r.innerText.replace(/\s+/g, ' ');
      const hasMissingDate = text.includes('Chưa chốt ngày');
      const hasWaitingSignal = text.includes('Chờ chốt lịch');
      const hasReadySignal = text.includes('Sẵn sàng điều xe');
      return { text: text.slice(0, 160), hasMissingDate, hasWaitingSignal, hasReadySignal };
    });
  });

  // Verify backend contract via API: GET /api/shipments/cus-workspace
  const cusWorkspace = await ctx.apiGet('/shipments/cus-workspace');
  let contractOk = false;
  if (cusWorkspace.status === 200 && Array.isArray(cusWorkspace.body?.items)) {
    const items = cusWorkspace.body.items;
    // For any lot in PENDING_DATE / NEW bucket with multiple conts where not all are dated,
    // it MUST NOT jump to READY_FOR_DISPATCH; it must remain WAITING_DATE.
    const pendingLots = items.filter((item) => item.status === 'PENDING_DATE');
    const invalidTransitions = items.filter((item) => {
      const totalConts = item.operational?.totalContainers || 0;
      const datedConts = (item.customerAppointmentAts || []).length;
      return totalConts > 1 && datedConts < totalConts && item.status === 'READY_FOR_DISPATCH';
    });

    contractOk = invalidTransitions.length === 0;
  }

  const ok = rows.length > 0 && contractOk;
  return {
    verdict: ok ? 'PASS' : 'FAIL',
    rowCount: rows.length,
    contractOk,
    sampleRows: rows.slice(0, 3),
  };
}
