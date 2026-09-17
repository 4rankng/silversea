// cases/chungtu-regression/TC-CUS-CREATE-028.mjs
// §1.13 / TC-CUS-CREATE-028 — overview doesn't show "Chưa chốt ngày"
// when a FCL container already has customerAppointmentAt.
// Source: báo cáo khách hàng 2026-09-07.

export const caseId = 'TC-CUS-CREATE-028';
export const role = 'CUS';

export default async function (ctx) {
  // /api/shipments?page=1 returns summary items WITHOUT containers.
  // The detail endpoint returns { shipment, containers, ... }.
  // Pick the first shipment that has a BL AND at least one container with
  // customerAppointmentAt. (NEW shipments without BL can't be matched on the
  // overview row.)
  const list = await ctx.apiGet('/shipments?page=1&limit=20');
  const items = list.body.items || list.body.data || [];
  let target = null;
  for (const s of items) {
    const sBL = s.blNumber || s.bl_number;
    if (!sBL) continue;
    const detail = await ctx.apiGet(`/shipments/${s.id}`);
    const containers = detail.body.containers || [];
    // A partially scheduled lot correctly retains its waiting-for-date state.
    const hasAppt = containers.length > 0 && containers.every((c) => c.customerAppointmentAt || c.customer_appointment_at);
    if (hasAppt) {
      target = {
        id: s.id,
        blNumber: detail.body.shipment?.blNumber || sBL,
        containerCount: containers.length,
        containersWithAppt: containers.filter((c) => c.customerAppointmentAt || c.customer_appointment_at).length,
      };
      break;
    }
  }
  if (!target) return { verdict: 'BLOCKED', errors: ['no BL-bearing shipment with container appointment on staging'] };

  // Visit overview, find this shipment's row
  // The overview is paginated. Search for the selected fixture instead of
  // assuming an API page1 item is also on the default overview page.
  await ctx.goto(`/shipments?searchSuffix=${encodeURIComponent(target.blNumber)}`);
  await ctx.screenshot('a_overview');
  const rowText = await ctx.rowContaining(target.blNumber);
  if (!rowText) return { verdict: 'INCONCLUSIVE', errors: [`row for ${target.blNumber} not found in overview`] };

  const rowHasDate = /\d{1,2}\/\d{1,2}\/\d{4}/.test(rowText);
  const rowHasWaiting = /Chưa chốt ngày|Chờ chốt lịch|WAITING_DATE/i.test(rowText);

  // Visit detail to confirm the appointment is set there too (overview↔detail sync)
  await ctx.goto(`/shipments/${target.id}`);
  await ctx.screenshot('b_detail');
  const detailText = await ctx.domText();
  const detailHasDate = /\d{1,2}\/\d{1,2}\/\d{4}/.test(detailText);

  const ok = rowHasDate && !rowHasWaiting && detailHasDate;
  return {
    verdict: ok ? 'PASS' : (rowHasWaiting || !rowHasDate ? 'FAIL' : 'INCONCLUSIVE'),
    target,
    rowTextSnippet: rowText.slice(0, 400),
    rowHasDate, rowHasWaiting, detailHasDate,
  };
}
