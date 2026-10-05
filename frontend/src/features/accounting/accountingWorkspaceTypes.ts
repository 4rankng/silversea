import type {
  AccountingTransportOwnership,
  AccountingTransportReadiness,
} from '@tingting/shared';
import type { DepositWeekRow } from '../../components/charts/DepositWeeklyChart';

export type { DepositWeekRow };

/**
 * One due-group of an aging summary. `count` is presence-based (entities with
 * any amount in the group), so the drill-down lists behind the overview cards
 * match the displayed counts exactly.
 */
export interface DueGroup {
  amount: number;
  count: number;
}

/**
 * Card 369 — the due-group split the overview cards render:
 * `inTerm` = aging.current > 0, `overdue` = any overdue portion > 0.
 * Amounts are rounded server-side (round2dp), and
 * inTerm.amount + overdue.amount ≈ totalOutstanding (≤ 0.02 raw).
 */
export interface DueGroups {
  inTerm: DueGroup;
  overdue: DueGroup;
}

export interface ReceivablesSummary {
  buckets: Array<{ range: string; label: string; count: number; amount: number }>;
  totalOutstanding: number;
  totalCustomers: number;
  overdueCustomers: number;
  overdueAmount: number;
  /** Optional: older cached payloads predate the due-group split. */
  dueGroups?: DueGroups;
  asOf?: string;
  timezone?: string;
  definitionVersion?: string;
  checksum?: string;
}

export interface PayablesSummary {
  totalOutstanding: number | string;
  totalSuppliers: number;
  overdueSuppliers: number;
  /** Optional: older cached payloads predate the due-group split. */
  dueGroups?: DueGroups;
  asOf?: string;
  timezone?: string;
  definitionVersion?: string;
  checksum?: string;
}

/** GET /api/accounting/deposits/weekly-summary response. */
export interface DepositWeeklySummary {
  weeks: DepositWeekRow[];
  totals: { count: number; depositAmount: number; refundedAmount: number };
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
