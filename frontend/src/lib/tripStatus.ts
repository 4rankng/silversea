import type { TripStatus } from '@tingting/shared';

/** StatusPill variant for a trip status — shared by forwarder and driver trip pages. */
export function tripStatusVariant(status: TripStatus): 'neutral' | 'info' | 'warn' | 'success' | 'danger' {
  switch (status) {
    case 'IN_TRANSIT':
      return 'info';
    case 'COMPLETED':
      return 'success';
    case 'CANCELED':
      return 'danger';
    default:
      return 'neutral';
  }
}
