import type { AdvanceRequestStatus, AdvanceSettlementStatus } from '@tingting/shared';

type StatusVariant = 'neutral' | 'info' | 'warn' | 'success' | 'danger';

export function advanceRequestStatusVariant(status: AdvanceRequestStatus): StatusVariant {
  switch (status) {
    case 'RECORDED': return 'success';
    case 'VOIDED': return 'danger';
    default: return 'neutral';
  }
}

export function advanceSettlementStatusVariant(status: AdvanceSettlementStatus): StatusVariant {
  switch (status) {
    case 'RECORDED': return 'success';
    case 'VOIDED': return 'danger';
    case 'REVERSED': return 'info';
    default: return 'neutral';
  }
}
