/** Pure value helpers shared by the app-settings admin page and its sections. */

export function toThresholdPercent(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 10000) / 100) : '80';
}

export function fromThresholdPercent(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const ratio = parsed / 100;
  if (ratio < 0.01 || ratio > 0.99) return null;
  return Math.round(ratio * 10000) / 10000;
}

export function formatViDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

export function formatViMonth(value: string): string {
  return value.slice(5, 7) + '/' + value.slice(0, 4);
}

export function formatFullVnd(value: string): string {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

export function ratioToPercentInput(value: number | null): string {
  if (value == null) return '';
  return String(Math.round(value * 10000) / 100);
}

export function percentInputToNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
