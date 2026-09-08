// cases/customer-regression/TC-CUS-CREATE-023.mjs
// §1.10 / TC-CUS-CREATE-023 — Cảng nâng + Cảng hạ X clear.

export const caseId = 'TC-CUS-CREATE-023';
export const role = 'CUS';

export default async function (ctx) {
  await ctx.goto('/shipments/new');

  const cust = await ctx.pickComboboxByPlaceholder('Gõ để tìm kiếm', 'Long Minh');
  if (!cust.ok) return { verdict: 'BLOCKED', errors: [`kh: ${cust.error}`] };
  const hinhThuc = await ctx.pickHinhThucNhapKhau();
  if (!hinhThuc.ok) return { verdict: 'BLOCKED', errors: [`hình thức: ${hinhThuc.error}`] };

  const cn = await ctx.pickCombobox('Cảng nâng', '');
  const ch = await ctx.pickCombobox('Cảng hạ', '');
  if (!cn.ok || !ch.ok) {
    return { verdict: 'BLOCKED', errors: [`cảng nâng: ${cn.error}`, `cảng hạ: ${ch.error}`] };
  }
  await ctx.screenshot('a_cang_picked');

  const cnBefore = await ctx.comboboxValue('Cảng nâng');
  const chBefore = await ctx.comboboxValue('Cảng hạ');
  const cnClear = await ctx.clearCombobox('Cảng nâng');
  const chClear = await ctx.clearCombobox('Cảng hạ');
  await ctx.screenshot('b_cang_cleared');
  const cnAfter = await ctx.comboboxValue('Cảng nâng');
  const chAfter = await ctx.comboboxValue('Cảng hạ');

  const ok = Boolean(cnBefore) && cnAfter === '' && Boolean(chBefore) && chAfter === '' && cnClear.ok && chClear.ok;
  return {
    verdict: ok ? 'PASS' : 'FAIL',
    cnBefore, cnAfter, cnClear, chBefore, chAfter, chClear,
  };
}
