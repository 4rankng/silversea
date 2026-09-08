// cases/customer-regression/TC-CUS-CREATE-021.mjs
// §1.10 / TC-CUS-CREATE-021 — Nhà máy container X clear + re-pick.
// Source: báo cáo khách hàng 2026-09-07 (§1.10).

export const caseId = 'TC-CUS-CREATE-021';
export const role = 'CUS';

export default async function (ctx) {
  await ctx.goto('/shipments/new');

  const cust = await ctx.pickComboboxByPlaceholder('Gõ để tìm kiếm', 'Long Minh');
  if (!cust.ok) return { verdict: 'BLOCKED', errors: [`kh: ${cust.error}`] };

  const hinhThuc = await ctx.pickHinhThucNhapKhau();
  if (!hinhThuc.ok) return { verdict: 'BLOCKED', errors: [`hình thức: ${hinhThuc.error}`] };

  await ctx.screenshot('a_customer_and_hinh_thuc_picked');

  const nhPick = await ctx.pickCombobox('Nhà máy', 'ASKEY');
  if (!nhPick.ok) return { verdict: 'BLOCKED', errors: [`nhà máy: ${nhPick.error}`] };
  await ctx.screenshot('b_nhamay_picked');

  const before = await ctx.comboboxValue('Nhà máy');
  const clear = await ctx.clearCombobox('Nhà máy');
  await ctx.screenshot('c_nhamay_cleared');
  const after = await ctx.comboboxValue('Nhà máy');

  const rePick = await ctx.pickCombobox('Nhà máy', '');
  await ctx.screenshot('d_nhamay_repicked');

  const ok = Boolean(before) && after === '' && rePick.ok && clear.ok;
  return {
    verdict: ok ? 'PASS' : (clear.ok ? 'FAIL' : 'FAIL'),
    before, after, clearResult: clear, rePick,
  };
}
