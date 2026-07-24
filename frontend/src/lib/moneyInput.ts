export function normalizeMoneyInput(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatMoneyInput(raw: string): string {
  const normalized = normalizeMoneyInput(raw);
  if (!normalized) return '';
  const n = parseInt(normalized, 10);
  if (Number.isNaN(n)) return '';
  return n.toLocaleString('vi-VN');
}

export function moneyInputToNumber(value: string): number | undefined {
  const normalized = normalizeMoneyInput(value);
  return normalized ? Number(normalized) : undefined;
}
