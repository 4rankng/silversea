import type {
  AccountingTransportOwnership,
  AccountingTransportReadiness,
} from '@tingting/shared';

export interface ReceivablesSummary {
  buckets: Array<{ range: string; label: string; count: number; amount: number }>;
  totalOutstanding: number;
  totalCustomers: number;
  overdueCustomers: number;
  overdueAmount: number;
  asOf?: string;
  timezone?: string;
  definitionVersion?: string;
  checksum?: string;
}

export interface PayablesSummary {
  totalOutstanding: number | string;
  totalSuppliers: number;
  overdueSuppliers: number;
  asOf?: string;
  timezone?: string;
  definitionVersion?: string;
  checksum?: string;
}

export interface ProfitabilitySummary {
  totals: {
    revenue: number;
    directCost: number;
    sharedOverhead: number;
    profit: number;
  };
  reconciliation: { status: 'RECONCILED' | 'PARTIAL'; note: string };
  sourceCoverage: { missingAttribution: number };
  asOf: string;
  definitionVersion?: string;
  checksum?: string;
}

export type AccountingView = 'work' | 'overview' | 'transport';
export type AccountingTransportFilterKey = 'customerId' | 'carrierId' | 'ownership' | 'readiness';

// Sort keys accepted by the transport register endpoint (mirrors
// ACCOUNTING_TRANSPORT_SORT_KEYS in shared). The frontend list is a plain
// string whitelist for URL-param validation.
export const ACCOUNTING_TRANSPORT_SORT_KEYS = [
  'tripCode',
  'customerName',
  'carrierName',
  'revenue',
  'directCost',
  'profit',
  'readiness',
] as const;
export type AccountingTransportSortKey = (typeof ACCOUNTING_TRANSPORT_SORT_KEYS)[number];

export interface AccountingWorkspaceUrlState {
  activeView: AccountingView;
  today: string;
  from: string;
  to: string;
  month: number;
  year: number;
  transportPage: number;
  transportSearch: string;
  appliedTransportSearch: string;
  customerId?: number;
  carrierId?: number;
  ownership?: AccountingTransportOwnership;
  readiness?: AccountingTransportReadiness;
  transportSortBy?: AccountingTransportSortKey;
  transportSortDir?: 'asc' | 'desc';
}
