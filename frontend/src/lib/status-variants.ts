import type { AdvanceRequestStatus, AdvanceSettlementStatus } from '@tingting/shared';

type StatusVariant = 'neutral' | 'info' | 'warn' | 'success' | 'danger';

export function advanceRequestStatusVariant(status: AdvanceRequestStatus): StatusVariant {
  switch (status) {
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
    default: return 'neutral';
  }
}

export function advanceSettlementStatusVariant(status: AdvanceSettlementStatus): StatusVariant {
  switch (status) {
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
    case 'REVERSED': return 'info';
    default: return 'neutral';
  }
}
