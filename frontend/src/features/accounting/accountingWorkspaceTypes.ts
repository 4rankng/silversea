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

/**
 * Card 370 — one bucket of the 4-group due-debt chart. Groups are disjoint by
 * obligation effective due date (processingDueDate ?? originalDueDate) vs the
 * as-of date; `customers` is the distinct-customer count within the group.
 */
export type MoneyAlertsDueGroupKey =
  | 'dueSoon5d'
  | 'overdue1to10'
  | 'overdue11to30'
  | 'overdue30plus';

export interface MoneyAlertsDueGroup {
  key: MoneyAlertsDueGroupKey;
  label: string;
  amount: number;
  customers: number;
}

/**
 * Card 370 — GET /api/accounting/money-alerts response: fund balances, the
 * due-debt group split and the three always-on alerts in one snapshot. Every
 * field is optional so an older cached payload that lags the contract degrades
 * its own block instead of dropping the whole panel.
 */
export interface MoneyAlertsSummary {
  /** reserve = (tm + company) − payablesDue5d, all round2dp server-side. */
  funds?: { tm: number; company: number; reserve: number };
  dueDebtGroups?: MoneyAlertsDueGroup[];
  /** deposit_refund_trackers status='CHUA_HOAN_CUOC' rows. */
  unrefundedDeposits?: { count: number; amount: number };
  /** Equals the receivables dueGroups.overdue row totals exactly. */
  overdueDebt?: { customers: number; amount: number };
  /** True only when tm < 0 AND company < 0 — the sole 'Quỹ âm' condition. */
  fundNegative?: boolean;
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
