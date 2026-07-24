import type { AdvanceRequestStatus, AdvanceSettlementStatus } from '@tingting/shared';

type StatusVariant = 'neutral' | 'info' | 'warn' | 'success' | 'danger';

export function advanceRequestStatusVariant(status: AdvanceRequestStatus): StatusVariant {
  switch (status) {
    case 'PENDING': return 'warn';
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
    default: return 'neutral';
  }
}

export function advanceSettlementStatusVariant(status: AdvanceSettlementStatus): StatusVariant {
  switch (status) {
    case 'PENDING': return 'warn';
    case 'CHECKED_BY_ACCOUNTANT': return 'info';
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
    default: return 'neutral';
  }
}
