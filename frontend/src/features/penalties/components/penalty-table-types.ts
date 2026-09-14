import type { Driver, PenaltyReason, PenaltyStatus } from '@tingting/shared';
import type { PenaltyInsights, PenaltyRow, PenaltyStatusCounts } from '../../../hooks/usePenalties';
import type { TableSortState } from '../../../lib/table-sort';

/** Log status chip values — 'all' clears the server `status` param. */
export type PenaltyStatusFilter = 'all' | PenaltyStatus;

/** Scoreboard window toggle — client-side; every window rides the insights payload. */
export type PenaltyScoreWindow = '7d' | '30d' | '90d' | 'ytd';

export interface PenaltyTableProps {
  // ── Violation log (server-paginated via useTableQueryState) ───────────
  rows: PenaltyRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  listLoading: boolean;
  onPageChange: (page: number) => void;
  /** Active column sort — server-side via the list endpoint's sortBy/sortDir. */
  sort: TableSortState | null;
  onSortChange: (key: string) => void;
  /** Full-set status counts from the list envelope — backs the chip counts. */
  statusCounts?: PenaltyStatusCounts;
  // Filters (search is debounced + page-resetting inside the hook)
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: PenaltyStatusFilter;
  onStatusFilterChange: (filter: PenaltyStatusFilter) => void;
  driverFilter?: number;
  onDriverFilterChange: (driverId: number | undefined) => void;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  // ── Catalogs ──────────────────────────────────────────────────────────
  drivers: Driver[];
  reasons: PenaltyReason[];
  // ── Server-computed aggregates ────────────────────────────────────────
  /** Insights for the selected period — KPI strip + full scoreboard. */
  insights?: PenaltyInsights;
  /** True while the insights read is still loading. */
  insightsLoading: boolean;
  monthLabel: string;
  // ── Permissions / callbacks ───────────────────────────────────────────
  canCancel: boolean;
  /** Signed-in user id/role — pending-record authority is per-row: the
   *  submitter may cancel their own pending record, only someone else may
   *  approve it. */
  currentUserId?: number;
  currentUserRole?: string;
  onOpenDrawer: (driverId?: number) => void;
  onCancelPenalty: (penalty: PenaltyRow) => void;
  onApprovePenalty: (penalty: PenaltyRow) => void;
}
