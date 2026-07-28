export type PendingGovernanceStatus =
  | 'PENDING_CHECK'
  | 'PENDING_APPROVAL'
  | 'RETURNED_FOR_EVIDENCE';

export interface PendingGovernanceResponse {
  status: PendingGovernanceStatus;
}

export function isGovernancePendingResponse(value: unknown): value is PendingGovernanceResponse {
  if (!value || typeof value !== 'object') return false;
  const status = (value as { status?: unknown }).status;
  return status === 'PENDING_CHECK'
    || status === 'PENDING_APPROVAL'
    || status === 'RETURNED_FOR_EVIDENCE';
}
