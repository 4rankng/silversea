import { Hourglass } from 'lucide-react';

/**
 * 'Chờ biển' chip (KB §7.2.1 K7.20): an external-carrier assignment awaiting
 * its real plate number renders this chip on every surface that names the
 * vehicle — the dispatch line (/dispatch-detail row + card), the trips table
 * (/trips, desktop + mobile card), and the trip detail (/trips/:id external
 * carrier card). One vocabulary, one look; the visible text IS the accessible
 * name QA greps for. Warning palette — a pending action, not an error.
 */
export function WaitingPlateChip() {
  return (
    <span
      title="Xe ngoài chưa có biển số — chờ nhập biển số"
      style={{
        fontSize: 'var(--text-caption-size)',
        lineHeight: 1.35,
        fontWeight: 700,
        color: 'var(--warning-text)',
        background: 'var(--warning-soft)',
        border: '1px solid color-mix(in srgb, var(--warning) 22%, transparent)',
        borderRadius: 4,
        padding: '2px 6px',
        letterSpacing: '0.02em',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    >
      <Hourglass size={12} aria-hidden="true" />
      Chờ biển
    </span>
  );
}
