// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-CUS-APPOINTMENT-001.mjs
// TC-CUS-APPOINTMENT-001 — Popover chỉnh sửa lịch hẹn: Giờ trước, Ngày sau khớp bảng ngoài
// Source: Báo cáo khách hàng 2026-09-08 / Image 2 Bottom

export const caseId = 'TC-CUS-APPOINTMENT-001';
export const role = 'ADMIN';

export default async function (ctx) {
  const { page } = ctx;
  await ctx.goto('/shipments');
  await page.waitForSelector('.cus-dashboard-detail', { timeout: 15000 });

  // Pick a shipment row that has containers
  const detailButtons = await page.$$('.cus-dashboard-detail');
  if (detailButtons.length === 0) {
    return { verdict: 'BLOCKED', errors: ['Không tìm thấy nút Chi tiết trên /shipments'] };
  }

  let targetBtn = detailButtons[0];
  for (const btn of detailButtons) {
    const hasContainers = await page.evaluate((el) => {
      const row = el.closest('tr');
      const text = row ? row.innerText : '';
      return text.includes('cont') || text.includes('20DC') || text.includes('40HC');
    }, btn);
    if (hasContainers) {
      targetBtn = btn;
      break;
    }
  }

  const detailId = await page.evaluate((el) => el.id, targetBtn);
  await page.click('#' + detailId);
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
    return { verdict: 'BLOCKED', errors: ['Không tìm thấy nút chỉnh sửa lịch cont (.cus-appointment-trigger) trong drawer'] };
  }

  await aptTrigger.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    el.click();
  });
  await page.waitForSelector('.cus-appointment-popover', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 600));

  await ctx.screenshot('02_appointment_popover_open');

  const fields = await page.evaluate(() => {
    const wraps = Array.from(document.querySelectorAll('.cus-appointment-popover .cus-appointment-input-wrap'));
    return wraps.map((w) => ({
      label: w.querySelector('label')?.innerText.trim(),
      type: w.querySelector('input')?.type,
      value: w.querySelector('input')?.value,
      lang: w.querySelector('input')?.getAttribute('lang'),
    }));
  });

  // Close popover
  const closeBtn = await page.$('.cus-appointment-popover__close');
  if (closeBtn) await closeBtn.click();
  await new Promise((r) => setTimeout(r, 400));

  // Close drawer
  const closeDrawer = await page.$('.drawer__close, [aria-label*="Đóng chi tiết"]');
  if (closeDrawer) await closeDrawer.click();
  await new Promise((r) => setTimeout(r, 400));

  const isGioFirst = fields.length >= 2
    && fields[0].label.toUpperCase().includes('GIỜ')
    && fields[0].type === 'time'
    && fields[1].label.toUpperCase().includes('NGÀY')
    && fields[1].type === 'date';

  return {
    verdict: isGioFirst ? 'PASS' : 'FAIL',
    fields,
    isGioFirst,
  };
}
