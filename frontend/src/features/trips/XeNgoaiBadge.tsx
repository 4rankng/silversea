import { Truck } from 'lucide-react';

/**
 * "Xe ngoài" badge — marks a trip subcontracted to an external carrier
 * (carrierType === 'EXTERNAL'). Visually identical to the customer-page
 * "Xe ngoài" badge uses the shared informational teal, distinct from the
 * completed-work emerald badge.
 *
 * This component is the source of truth for trip-list external-carrier labels.
 */
export function XeNgoaiBadge() {
  return (
    <span
      aria-label="Xe ngoài (đối tác vận tải)"
      style={{
        fontSize: 12,
        lineHeight: 1.35,
        fontWeight: 700,
        color: 'var(--info-text)',
        background: 'var(--info-soft)',
        border: '1px solid color-mix(in srgb, var(--info) 22%, transparent)',
        borderRadius: 4,
        padding: '3px 7px',
        letterSpacing: '0.02em',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <Truck size={12} aria-hidden="true" />
      Xe ngoài
    </span>
  );
}
