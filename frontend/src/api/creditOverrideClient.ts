import { api } from '../lib/api';

export type CreditOverrideScopeType = 'SHIPMENT' | 'EXPIRY';
export type CreditOverrideStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';
export type CreditOverrideTier = 'FINANCE_TIER_1' | 'DIRECTOR';
export type CreditOverrideWorkflowStatus =
  | 'PENDING_CHECK'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED_FOR_EVIDENCE'
  | 'CANCELED'
  | 'SUPERSEDED';

export interface CreditOverrideRequestRecord {
  id: number;
  customerId: number;
  shipmentId: number | null;
  scopeType: CreditOverrideScopeType;
  status: CreditOverrideStatus;
  requiredTier: CreditOverrideTier;
  reason: string;
  requestedBy: number;
  requestedRole: string;
  approvedBy: number | null;
  approvedRole: string | null;
  approvedAt: string | null;
  rejectedBy: number | null;
  rejectedRole: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  proposedAmount: string;
  outstandingAmount: string;
  approvedCommitmentAmount: string;
  totalExposure: string;
  creditLimit: string;
  warningThreshold: string;
  overLimitAmount: string;
  overLimitRatio: string;
  repeatException: boolean;
  expiresAt: string | null;
  consumedTripId: number | null;
  consumedAt: string | null;
  version: number;
  requestVersion: number;
  workflowStatus: CreditOverrideWorkflowStatus;
  governanceActionId: number | null;
  checkedBy: number | null;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCreditOverrideRequestInput {
  customerId: number;
  proposedAmount: number;
  reason: string;
  shipmentId?: number | null;
  expiresAt?: string | null;
}

export interface RejectCreditOverrideRequestInput {
  expectedVersion: number;
  reason: string;
}

export interface CreditOverrideListFilters {
  status?: string;
  customerId?: number;
  limit?: number;
}

function toQuery(filters?: CreditOverrideListFilters): string {
  if (!filters) return '';
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.customerId != null) query.set('customerId', String(filters.customerId));
  if (filters.limit != null) query.set('limit', String(filters.limit));
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export const creditOverrideClient = {
  listRequests: (filters?: CreditOverrideListFilters) =>
    api.get<CreditOverrideRequestRecord[]>(`/finance/credit-overrides${toQuery(filters)}`),

  getRequest: (id: number) =>
    api.get<CreditOverrideRequestRecord>(`/finance/credit-overrides/${id}`),

  createRequest: (body: CreateCreditOverrideRequestInput) =>
    api.post<CreditOverrideRequestRecord>('/finance/credit-overrides', body),

  checkRequest: (id: number, expectedVersion: number) =>
    api.post<CreditOverrideRequestRecord>(`/finance/credit-overrides/${id}/check`, { expectedVersion }),

  approveRequest: (id: number, expectedVersion: number) =>
    api.post<CreditOverrideRequestRecord>(`/finance/credit-overrides/${id}/approve`, { expectedVersion }),

  rejectRequest: (id: number, body: RejectCreditOverrideRequestInput) =>
    api.post<CreditOverrideRequestRecord>(`/finance/credit-overrides/${id}/reject`, body),
};
