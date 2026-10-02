// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-CUS-APPOINTMENT-001.mjs
// TC-CUS-APPOINTMENT-001 — Popover chỉnh sửa lịch hẹn: Giờ trước, Ngày sau khớp bảng ngoài
// Source: Báo cáo khách hàng 2026-09-08 / Image 2 Bottom
//
// Row selection is by PROPERTY, not by position. The case used to open the FIRST
// `.cus-dashboard-detail` button of /shipments and then fall back to a row whose
// text happened to contain "cont"/"20DC"/"40HC" — both guesses pick whatever
// lot the run created most recently, and a container-less lot has no
// `.cus-appointment-trigger` to open at all. `pickContainerBearingShipment`
// (lib/fixtures.mjs) asks the API for a lot that actually has containers; when
// the env has none the case is BLOCKED naming the env, never FAIL.

import { pickContainerBearingShipment } from '../../lib/fixtures.mjs';
import { QE, SEL } from '../../lib/selectors.mjs';

export const caseId = 'TC-CUS-APPOINTMENT-001';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  const envTag = `[${ctx.env.env}]`;

  const lot = await pickContainerBearingShipment(ctx);
  if (!lot) {
    return {
      verdict: 'BLOCKED',
      errors: [`${envTag} no lot with containers to open — the appointment popover rung needs one`],
    };
  }

  // Narrow the workboard to the chosen lot through the app's own search, then
  // open THAT lot's row (CusShipmentRow.tsx:235 → `cus-dashboard-detail-<id>`).
  const board = `/shipments?limit=200&searchSuffix=${encodeURIComponent(lot.ref)}`;
  await ctx.goto(board);

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
  const detailLabel = await page.evaluate(QE.clickRowDetailButton(lot.id));
  await page.waitForSelector('.cus-shipment-drawer', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 1200));

  await ctx.screenshot('01_cus_drawer_open');

  let aptTrigger = await page.$('.cus-appointment-trigger');
  if (!aptTrigger) {
    const editBtn = await page.$('.cus-container-edit-action');
    if (editBtn) {
      await editBtn.evaluate((el) => el.click());
      await new Promise((r) => setTimeout(r, 600));
      aptTrigger = await page.$('.cus-appointment-trigger');
    }
  }

  if (!aptTrigger) {
    return {
      verdict: 'BLOCKED',
      lot,
      detailLabel,
      errors: [`${envTag} lot #${lot.id} (${lot.containerCount} cont) rendered no appointment trigger (.cus-appointment-trigger) in the drawer, in view or in edit mode`],
    };
  }

  await aptTrigger.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    el.click();
  });
  await page.waitForSelector('.cus-appointment-popover', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 600));

  await ctx.screenshot('02_appointment_popover_open');

  const fields = await page.evaluate(() => {
    // Current control: design-system 24h split-datetime (segments HH/mm then
    // DD/MM/YYYY; design-system.md forbids native time/date inputs).
    const pop = document.querySelector('.cus-appointment-popover');
    const dt = pop?.querySelector('[data-split-datetime]');
    const segs = dt ? Array.from(dt.querySelectorAll('input')) : [];
    const segPh = segs.map((i) => i.placeholder || i.getAttribute('aria-label') || '');
    const ph = segPh.join(' ');
    const label = dt?.getAttribute('aria-label') || segs[0]?.getAttribute('aria-label') || '';
    const native = pop ? pop.querySelectorAll('input[type="time"], input[type="date"]').length : 0;
    return [{ label, placeholder: ph, segmentCount: segs.length, nativeInputs: native }];
  });

  // Close popover
  const closeBtn = await page.$('.cus-appointment-popover__close');
  if (closeBtn) await closeBtn.click();
  await new Promise((r) => setTimeout(r, 400));

  // Close drawer
  const closeDrawer = await page.$('.drawer__close, [aria-label*="Đóng chi tiết"]');
  if (closeDrawer) await closeDrawer.click();
  await new Promise((r) => setTimeout(r, 400));

  // Spec: hour-before-date order lives in the 24h input's placeholder
  // ("HH:mm DD/MM/YYYY") — HH:mm precedes DD/MM/YYYY; no native inputs.
  const f = fields[0] || {};
  const ph = f.placeholder || '';
  const isGioFirst = fields.length >= 1
    && f.segmentCount >= 3
    && ph.indexOf('HH') !== -1 && ph.indexOf('HH') < ph.indexOf('DD')
    && f.nativeInputs === 0;

  return {
    verdict: isGioFirst ? 'PASS' : 'FAIL',
    lot,
    detailLabel,
    fields,
    isGioFirst,
    errors: isGioFirst ? [] : [`${envTag} the appointment popover on lot #${lot.id} did not render an HH:mm-before-DD/MM/YYYY 24h split control with zero native inputs: ${JSON.stringify(fields[0] ?? null)}`],
  };
}
