/**
 * SIL-881 — the cont scope label of one Ops expense row, shared by every
 * surface that prints a cont cell (Tab Chi phí Ops, /ops/wallet history,
 * phiếu quyết toán, the duplicate panel):
 *  - single cont  → the bare number ("gắn 1 cont thì hiện số đó");
 *  - multi cont   → the merged roll-call ('5 cont: A, B, C, D, E');
 *  - chung lô     → 'Phí chung lô'.
 * Never "Không rõ container" for a row that carries conts.
 */
export function opsContainerScopeLabel(
  containerNumber: string | null | undefined,
  containerNumbers?: readonly string[] | null,
): string {
  const single = containerNumber?.trim();
  if (single) return single;
  const names = [...new Set((containerNumbers ?? []).map((name) => name.trim()).filter(Boolean))];
  if (names.length === 0) return 'Phí chung lô';
  return names.length === 1 ? names[0] : `${names.length} cont: ${names.join(', ')}`;
}
