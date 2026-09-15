import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchPenaltiesPage,
  usePenaltyInsights,
  usePenaltyCatalogs,
  type PenaltyListEnvelope,
  type PenaltyRow,
  type PenaltyTableFilters,
} from '../hooks/usePenalties';
import { useAuth } from '../hooks/useAuth';
import { useMonth } from '../hooks/useMonth';
import { useSalaryPeriod, useTableQueryState } from '../design-system';
import { useCreatePenalty, useCancelPenalty } from '../features/penalties/hooks/usePenaltyMutations';
import { PenaltyTable } from '../features/penalties/components/PenaltyTable';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { PenaltyFormDrawer } from '../features/penalties/components/PenaltyFormDrawer';
import { CancelPenaltyDialog } from '../features/penalties/components/CancelPenaltyDialog';
import type { PenaltyStatusFilter } from '../features/penalties/components/penalty-table-types';
import { qk } from '../api/keys';
import { usePageAnimations, useListAnimations } from '../hooks/animations';
import { nextTableSort, type TableSortState } from '../lib/table-sort';
import './PenaltyPage.css';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';

const PAGE_SIZE = 50;

export default function PenaltyPage() {
  const { month: selMonth, year: selYear } = useMonth();
  const { data: salaryPeriod, isLoading: periodLoading } = useSalaryPeriod(selMonth, selYear);

  const { data: catalogsData } = usePenaltyCatalogs();
  const drivers = catalogsData?.drivers ?? [];
  const reasons = catalogsData?.reasons ?? [];

  const { user } = useAuth();
  const canCancel = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const createMutation = useCreatePenalty();
  const cancelMutation = useCancelPenalty();

  // The violation log is always scoped to the selected salary period. The
  // bounds arrive async (period resolve), so the list stays disabled until
  // they land in the filter bag — the first fetch is already period-scoped.
  const [periodApplied, setPeriodApplied] = useState(false);
  const table = useTableQueryState<PenaltyRow, PenaltyTableFilters, PenaltyListEnvelope>({
    endpoint: fetchPenaltiesPage,
    queryKey: qk.penalties.list,
    defaultPageSize: PAGE_SIZE,
    enabled: periodApplied,
  });
  const { filters, setFilters } = table;

  useEffect(() => {
    if (!salaryPeriod) return;
    if (filters.dateFrom === salaryPeriod.start && filters.dateTo === salaryPeriod.end) {
      setPeriodApplied(true);
      return;
    }
    setFilters({ ...filters, dateFrom: salaryPeriod.start, dateTo: salaryPeriod.end });
    setPeriodApplied(true);
    // Re-run only when the resolved period or the applied filters change.
  }, [salaryPeriod, filters, setFilters]);

  // KPI strip + scoreboard read the server insights block for the selected
  // period — one call carries every scoreboard window (the 7d/30d/90d/YTD
  // toggle is client-side).
  const insightsQuery = usePenaltyInsights(selMonth, selYear);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preselectedDriver, setPreselectedDriver] = useState<number | undefined>();
  const [cancelTarget, setCancelTarget] = useState<PenaltyRow | null>(null);
  // Focus restoration: the shared Modal releases focus when it closes, so the
  // page remembers the opener and hands focus back on both close paths.
  const cancelOpenerRef = useRef<HTMLElement | null>(null);
  const openCancelDialog = useCallback((penalty: PenaltyRow) => {
    cancelOpenerRef.current = document.activeElement as HTMLElement | null;
    setCancelTarget(penalty);
  }, []);
  const closeCancelDialog = useCallback(() => {
    setCancelTarget(null);
    cancelOpenerRef.current?.focus?.();
  }, []);
  const { rootRef } = usePageAnimations({ ready: !table.isLoading });

  useListAnimations({
    itemSelector: '.penalty-log-table tbody tr',
    mode: 'rows',
    deps: [table.rows, table.isLoading],
  });

  const openDrawer = useCallback((driverId?: number) => {
    setPreselectedDriver(driverId);
    setDrawerOpen(true);
  }, []);

  const handleCancelPenalty = useCallback(async (reason?: string) => {
    if (!cancelTarget) return;
    try {
      await cancelMutation.mutateAsync({ id: cancelTarget.id, reason });
      closeCancelDialog();
    } catch (e: unknown) {
      alert((e as Error).message || 'Lỗi khi hủy kỷ luật');
    }
  }, [cancelTarget, cancelMutation, closeCancelDialog]);

  const statusFilter: PenaltyStatusFilter = filters.status ?? 'all';
  const handleStatusFilterChange = useCallback((next: PenaltyStatusFilter) => {
    table.setFilter('status', next === 'all' ? undefined : next);
  }, [table]);

  const handleDriverFilterChange = useCallback((driverId: number | undefined) => {
    table.setFilter('driverId', driverId);
  }, [table]);

  const hasActiveFilters = statusFilter !== 'all' || table.filters.driverId != null || table.search.trim() !== '';

  const handleResetFilters = useCallback(() => {
    table.reset();
    // Reset back to the period scope, not an unbounded list.
    if (salaryPeriod) table.setFilters({ dateFrom: salaryPeriod.start, dateTo: salaryPeriod.end });
  }, [table, salaryPeriod]);

  const monthLabel = `${String(selMonth).padStart(2, '0')}/${String(selYear).slice(-2)}`;

  // Column sort rides the same filters bag as every other list param —
  // setFilter resets the page to 1 and keys the query cache on primitives.
  const sort: TableSortState | null = useMemo(() => filters.sortBy
    ? { by: filters.sortBy, dir: filters.sortDir === 'desc' ? 'desc' : 'asc' }
    : null, [filters.sortBy, filters.sortDir]);
  const handleSortChange = useCallback((key: string) => {
    const next = nextTableSort(sort, key);
    table.setFilters({
      ...table.filters,
      ...(salaryPeriod ? { dateFrom: salaryPeriod.start, dateTo: salaryPeriod.end } : {}),
      sortBy: next.by,
      sortDir: next.dir,
    });
  }, [sort, table, salaryPeriod]);

  return (
    <div ref={rootRef} className="penalty-page">
      <Breadcrumbs
        className="penalty-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Kỷ luật' },
        ]}
      />
      <PenaltyTable
        rows={table.rows}
        total={table.total}
        page={table.page}
        pageSize={table.pageSize}
        totalPages={table.totalPages}
        listLoading={table.isLoading || periodLoading || !salaryPeriod}
        onPageChange={table.setPage}
        sort={sort}
        onSortChange={handleSortChange}
        statusCounts={table.query.data?.statusCounts}
        search={table.search}
        onSearchChange={table.setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusFilterChange}
        driverFilter={table.filters.driverId}
        onDriverFilterChange={handleDriverFilterChange}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={handleResetFilters}
        drivers={drivers}
        reasons={reasons}
        insights={insightsQuery.data}
        insightsLoading={insightsQuery.isLoading}
        monthLabel={monthLabel}
        canCancel={canCancel}
        onOpenDrawer={openDrawer}
        onCancelPenalty={openCancelDialog}
      />

      <PenaltyFormDrawer
        isOpen={drawerOpen}
        onClose={() => { setDrawerOpen(false); setPreselectedDriver(undefined); }}
        drivers={drivers}
        reasons={reasons}
        onSubmit={async (body) => {
          const result = await createMutation.mutateAsync(body);
          setDrawerOpen(false);
          setPreselectedDriver(undefined);
          return result;
        }}
        preselectedDriverId={preselectedDriver}
      />

      <CancelPenaltyDialog
        isOpen={!!cancelTarget}
        onClose={closeCancelDialog}
        onConfirm={handleCancelPenalty}
        penalty={cancelTarget}
        loading={cancelMutation.isPending}
      />
    </div>
  );
}
