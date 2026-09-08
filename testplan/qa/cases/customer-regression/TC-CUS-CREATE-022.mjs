// cases/customer-regression/TC-CUS-CREATE-022.mjs
// §1.10 / TC-CUS-CREATE-022 — Tuyến đường container X clear.

export const caseId = 'TC-CUS-CREATE-022';
export const role = 'CUS';

export default async function (ctx) {
  await ctx.goto('/shipments/new');

  const cust = await ctx.pickComboboxByPlaceholder('Gõ để tìm kiếm', 'Long Minh');
  if (!cust.ok) return { verdict: 'BLOCKED', errors: [`kh: ${cust.error}`] };
  const hinhThuc = await ctx.pickHinhThucNhapKhau();
  if (!hinhThuc.ok) return { verdict: 'BLOCKED', errors: [`hình thức: ${hinhThuc.error}`] };

  const tdPick = await ctx.pickCombobox('Tuyến đường', 'Quế Võ');
  if (!tdPick.ok) return { verdict: 'BLOCKED', errors: [`tuyến: ${tdPick.error}`] };
  await ctx.screenshot('a_tuyen_picked');

  const before = await ctx.comboboxValue('Tuyến đường');
  const clear = await ctx.clearCombobox('Tuyến đường');
  await ctx.screenshot('b_tuyen_cleared');
  const after = await ctx.comboboxValue('Tuyến đường');

  const ok = Boolean(before) && after === '' && clear.ok;
  return { verdict: ok ? 'PASS' : 'FAIL', before, after, clearResult: clear };
}
