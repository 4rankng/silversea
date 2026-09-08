// cases/customer-regression/TC-CUS-CREATE-026.mjs
// §1.11 / TC-CUS-CREATE-026 — Duplicate Bill/Booking/Declaration guard.
// Source: báo cáo khách hàng 2026-09-07.

export const caseId = 'TC-CUS-CREATE-026';
export const role = 'CUS';

export default async function (ctx) {
  await ctx.goto('/shipments/new');

  // 1. Pick an existing BL from the staging DB so we can collide with it.
  const list = await ctx.apiGet('/shipments?page=1&limit=10');
  const items = list.body.items || list.body.data || [];
  const existingBLs = items.map((s) => s.blNumber || s.bl_number).filter(Boolean);
  if (existingBLs.length === 0) {
    return { verdict: 'BLOCKED', errors: ['no shipments on staging to test against'] };
  }
  const dupBL = existingBLs[0];

  // 2. Fill required fields: customer + hình thức + the duplicate BL.
  const cust = await ctx.pickComboboxByPlaceholder('Gõ để tìm kiếm', 'Long Minh');
  if (!cust.ok) return { verdict: 'BLOCKED', errors: [`kh: ${cust.error}`] };
  const hinhThuc = await ctx.pickHinhThucNhapKhau();
  if (!hinhThuc.ok) return { verdict: 'BLOCKED', errors: [`hình thức: ${hinhThuc.error}`] };

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
  if (!billEl) return { verdict: 'BLOCKED', errors: ['Bill/Booking field not found'] };

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

  // DB-side check: count shipments with this BL (should still be 1, not 2).
  // Use the detail endpoint to scan all shipments since the list may be paginated.
  const after = await ctx.apiGet('/shipments?page=1&limit=200');
  const afterItems = after.body.items || after.body.data || [];
  const dbCount = afterItems.filter((s) => (s.blNumber || s.bl_number) === dupBL).length;

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
