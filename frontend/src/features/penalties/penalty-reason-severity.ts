/* ─── Severity helpers ─── */
export type Severity = 'low' | 'mid' | 'high';
export const SEV_OPTIONS: { value: Severity; label: string; color: string }[] = [
  { value: 'low', label: 'Nhẹ', color: 'var(--ink-3)' },
  { value: 'mid', label: 'Trung bình', color: 'var(--warning)' },
  { value: 'high', label: 'Nghiêm trọng', color: 'var(--danger)' },
];
export const sevLabel: Record<string, string> = { high: 'Nghiêm trọng', mid: 'Trung bình', low: 'Nhẹ' };
export const sevPill: Record<string, string> = { high: 'danger', mid: 'warn', low: 'neutral' };
