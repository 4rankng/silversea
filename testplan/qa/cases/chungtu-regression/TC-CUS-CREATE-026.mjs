// cases/chungtu-regression/TC-CUS-CREATE-026.mjs
// §1.11 / TC-CUS-CREATE-026 — Duplicate Bill/Booking/Declaration guard.
// Source: báo cáo khách hàng 2026-09-07.

import { findShipmentWhere } from '../../lib/fixtures.mjs';

export const caseId = 'TC-CUS-CREATE-026';
export const role = 'CUS';

export default async function (ctx) {
  const envTag = `[${ctx.env.env}]`;
  await ctx.goto('/shipments/new');

  // 1. The fixture is a lot that HAS a Bill/Booking number. Find it by PROPERTY
  //    across pages, never by position: page 1 is whatever lot ran last, so a
  //    page-1-only scan reported "no shipments available" on a DB that holds
  //    hundreds of them (card 20260928_159 — run order must not decide).
  const billOf = (shipment) => String(shipment?.blNumber ?? shipment?.bl_number ?? '').trim();
  const target = await findShipmentWhere(ctx, (shipment) => billOf(shipment).length > 0);
  if (!target) {
    return { verdict: 'BLOCKED', errors: [`${envTag} no shipment carries a Bill/Booking number on this env — nothing to collide a duplicate against`] };
  }
  const dupBL = billOf(target);

  // 2. Fill required fields: customer + hình thức + the duplicate BL.
  const cust = await ctx.pickComboboxByPlaceholder('Gõ để tìm kiếm', 'Long Minh');
  if (!cust.ok) return { verdict: 'BLOCKED', errors: [`${envTag} kh: ${cust.error}`] };
  const hinhThuc = await ctx.pickHinhThucNhapKhau();
  if (!hinhThuc.ok) return { verdict: 'BLOCKED', errors: [`${envTag} hình thức: ${hinhThuc.error}`] };

  // Find the Bill/Booking field by label
  const billHandle = await ctx.page.evaluateHandle(() => {
    const labels = Array.from(document.querySelectorAll('label, [class*="label" i]'));
    for (const lab of labels) {
      if (/Số Bill.*Booking/i.test(lab.textContent || '')) {
        const inp = lab.parentElement?.querySelector('input[type="text"], input:not([type])');
        if (inp) return inp;
      }
    }
    return null;
  });
  const billEl = billHandle.asElement();
  if (!billEl) return { verdict: 'BLOCKED', errors: [`${envTag} Bill/Booking field not found`] };

  await billEl.click();
  await ctx.page.evaluate((node) => { node.value = ''; }, billEl);
  await ctx.page.keyboard.type(dupBL, { delay: 20 });
  await ctx.settle(900); // wait for debounced duplicate check

  const inlineWarning = await ctx.page.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="alert"], [class*="warning" i]'))
      .map((e) => (e.textContent || '').trim())
      .filter((t) => t && !/Số Bill\/Booking/.test(t) && t.length > 5)
      .slice(0, 5);
  });
  await ctx.screenshot('a_bl_typed_inline_warning');

  // 3. Fill remaining required fields + container number, then submit.
  await ctx.pickComboboxByPlaceholder('^Chọn loại$', '20').catch(() => {});
  await ctx.typeInto('input[placeholder="Nhập số container"]', `TESTDUP${Math.floor(Math.random() * 10000)}`);
  await ctx.clickSubmit();
  await ctx.settle(2500);
  await ctx.screenshot('b_after_submit');

  // Find the POST /api/shipments response
  const postCall = ctx.apiCalls.find((c) =>
    c.method === 'POST' && /\/api\/shipments\/?(\?.*)?$/.test(c.url)
  );

  // DB-side check: count shipments carrying this BL across the SAME scanned
  // window the fixture came from — a page-1-only count missed lots deeper in
  // the list and read as "unchanged" for the wrong reason.
  let dbCount = 0;
  for (let page = 1; page <= 4; page += 1) {
    const res = await ctx.apiGet(`/shipments?limit=100&page=${page}`);
    const pageItems = res.body.items || res.body.data || [];
    if (pageItems.length === 0) break;
    dbCount += pageItems.filter((s) => billOf(s) === dupBL).length;
    if (pageItems.length < 100) break;
  }

  // PASS evidence: any of (a) inline warning mentions duplicate + username,
  // (b) POST returned 409, (c) DB count unchanged (= 1).
  const inlineHitDuplicate = inlineWarning.some((w) => /đã được nhập bởi/i.test(w));
  const passed = inlineHitDuplicate || postCall?.status === 409 || dbCount <= 1;
  return {
    verdict: passed ? 'PASS' : (postCall ? 'FAIL' : 'INCONCLUSIVE'),
    dupBL,
    postStatus: postCall?.status,
    postBody: postCall?.body,
    inlineWarnings: inlineWarning,
    dbCountForBL: dbCount,
    inlineHitDuplicate,
  };
}
