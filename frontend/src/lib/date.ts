/** Shared date formatting utilities. */

export function formatDayMonth(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const now = Date.now();
  const then = new Date(iso).getTime();
  // Card 2026-10-05_1628: an unparsable timestamp made every `diff*` NaN, so all
  // the range checks fell through and the date branch rendered the literal
  // "NaN/NaN". The two local copies this replaced both guarded with isNaN, so
  // the guard has to live here or consolidating them would have regressed it.
  if (Number.isNaN(then)) return '—';
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Vừa xong';
  if (diffMin < 60) return `${diffMin} phút trước`;
  if (diffHour < 24) return `${diffHour} giờ trước`;
  if (diffDay === 1) return 'Hôm qua';
  if (diffDay < 7) return `${diffDay} ngày trước`;
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}
