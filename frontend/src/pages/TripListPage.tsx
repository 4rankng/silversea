import React, { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, flexRender } from '@tanstack/react-table';
import { MousePointerClick, Save, X } from 'lucide-react';
import { tripClient } from '../api/tripClient';
import { qk } from '../api/keys';
import { formatCurrency } from '../lib/format';
import { parseThreshold, Role, TripStatus, TRIP_STATUS_LABELS, type TripDetail } from '@tingting/shared';
import { useFuelConfig, useSalaryPeriod } from '../hooks/useQueries';
import { useAuth } from '../hooks/useAuth';
import { useMonth } from '../hooks/useMonth';
import { ClickableCard } from '../components/shared/ClickableCard';
import { Breadcrumbs, Alert } from '../components/shared';
import { useDebouncedValue, useTableQueryState, EmptyState, Pagination } from '../design-system';
import { nextTableSort, type TableSortDir, type TableSortState } from '../lib/table-sort';
import { buildTripColumns, tripColumnAriaSort, tripRowStyle, TripMobileCard, TripFiltersBar, breakdownPctFromCounts, defaultStatusCounts, DEFAULT_WARN_THRESHOLD, PAGE_SIZE, formatMoney, STATUS_PILL_CLASS, type StatusFilter, type StatusCounts, type TripQuickEditDraft, buildTripCode, getTripDistance, getTripDisplayGrossProfit } from '../features/trips';
import { columnClass, draftChanged, figuresPayloadFromDraft, isEditableInQuickMode, quickDraftFromTrip } from './trip-list-helpers';
import { TripListHero } from './trip-list-hero';
import { useArrowKeyScroll } from './trip-list/useArrowKeyScroll';
import { useTripListAnimations } from './use-trip-list-animations';
import { useTableRowSelection } from '../hooks/useTableRowSelection';
import './TripListPage.css';

export default function TripListPage() {
  const rootRef = useTripListAnimations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { month, year } = useMonth();
  const { data: fuelConfig } = useFuelConfig();
  const { data: salaryPeriod } = useSalaryPeriod(month, year);
  const canCopyPlan = user?.role === Role.ADMIN || user?.role === Role.MANAGER;

  const warnThreshold = useMemo(
    () => (fuelConfig
      ? parseThreshold(fuelConfig.warningThreshold, DEFAULT_WARN_THRESHOLD)
      : DEFAULT_WARN_THRESHOLD),
    [fuelConfig],
  );

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  // The pinned Trạng thái column engages only once the table is horizontally
  // scrolled — a sticky-right cell pins at the scrollport edge even at
  // scrollLeft 0, where it painted over the still-visible neighbor columns.
  const [scrolled, setScrolled] = useState(false);
  const [truckFilter, setTruckFilter] = useState<number | ''>('');
  const [customerFilter, setCustomerFilter] = useState<number | ''>('');
  const [searchInput, setSearchInput] = useState('');
  // Server-side column sort. Lives in page state and rides the table hook's
  // filters bag so every sort change refetches from page 1 (setFilters resets).
  const [sort, setSort] = useState<TableSortState | null>(null);
  const [quickEdit, setQuickEdit] = useState(false);
  const [quickDrafts, setQuickDrafts] = useState<Record<number, TripQuickEditDraft>>({});
  // Card 20260929_207: the checkbox column is gone — a row is picked by
  // clicking it (keyboard: focus the row, press Space).
  const selection = useTableRowSelection<number>();
  const { clear: clearSelection, isSelected, selectAll, selectedAmong, toggle: toggleSelection } = selection;
  const selectedIds = selection.selected;
  const [quickErrors, setQuickErrors] = useState<Record<number, string>>({});
  const [quickMessage, setQuickMessage] = useState('');
  const [quickGovernanceReason, setQuickGovernanceReason] = useState('');
  const [savingQuickEdit, setSavingQuickEdit] = useState(false);
  const [copyingPlanId, setCopyingPlanId] = useState<number | null>(null);
  const [copyPlanMessage, setCopyPlanMessage] = useState('');
  const [copyPlanError, setCopyPlanError] = useState(false);

  // Date range from salary period
  const dateFrom = salaryPeriod?.start;
  const dateTo = salaryPeriod?.end;

  // Search intent: bypass the month chip when typing a specific trip code.
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const searching = debouncedSearch.length > 0;
  const listDateFrom = searching ? undefined : dateFrom;
  const listDateTo = searching ? undefined : dateTo;

  // The list query state. Replaces ~80 lines of useState/useEffect/useMemo.
  const table = useTableQueryState<TripDetail, {
    status?: string;
    truckId?: number;
    customerId?: number;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: string;
    sortDir?: TableSortDir;
  }>({
    endpoint: (params) => tripClient.listTrips({
      page: params.page,
      limit: params.limit,
      status: params.status,
      truckId: params.truckId,
      customerId: params.customerId,
      search: params.search,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
    }),
    queryKey: qk.trips.all,
    defaultPageSize: PAGE_SIZE,
    initialSearch: '',
  });
  // Apply the form-state filters and search into the table hook. We do
  // this via a one-way assignment so the table hook stays the source of
  // truth for query execution. Sort rides the same bag so a filter change
  // can never drop it; `sort` is a state object, so it only re-triggers
  // this effect when the user actually toggles a column.
  const handleSortChange = useCallback((key: string) => {
    setSort((current) => nextTableSort(current, key));
  }, []);
  useEffect(() => {
    table.setSearch(debouncedSearch);
  // table omitted from deps: setSearch is a stable useCallback ref inside useTableQueryState
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);
  useEffect(() => {
    table.setFilters({
      status: statusFilter || undefined,
      truckId: truckFilter || undefined,
      customerId: customerFilter || undefined,
      dateFrom: listDateFrom,
      dateTo: listDateTo,
      sortBy: sort?.by,
      sortDir: sort?.dir,
    });
  // table omitted from deps: setFilters is a stable useCallback ref inside useTableQueryState
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, truckFilter, customerFilter, listDateFrom, listDateTo, sort]);

  // ── Summary query ──
  const { data: summary } = useQuery({
    queryKey: qk.trips.summary(dateFrom, dateTo),
    queryFn: () => tripClient.getTripsSummary({ dateFrom, dateTo }),
    enabled: !!dateFrom && !!dateTo,
    staleTime: 30 * 1000,
  });

  const statusCounts: StatusCounts = useMemo(() => {
    const raw = summary?.statusCounts as Partial<StatusCounts> | undefined;
    if (!raw) return defaultStatusCounts();
    return {
      all: raw.all ?? 0,
      [TripStatus.CREATED]: raw[TripStatus.CREATED] ?? 0,
      [TripStatus.IN_TRANSIT]: raw[TripStatus.IN_TRANSIT] ?? 0,
      [TripStatus.COMPLETED]: raw[TripStatus.COMPLETED] ?? 0,
      [TripStatus.CANCELED]: raw[TripStatus.CANCELED] ?? 0,
    };
  }, [summary]);
  const breakdownPct = useMemo(() => breakdownPctFromCounts(statusCounts), [statusCounts]);
  const truckOptions = useMemo(() => summary?.truckOptions ?? [], [summary?.truckOptions]);
  const customerOptions = useMemo(() => summary?.customerOptions ?? [], [summary?.customerOptions]);

  useEffect(() => {
    if (!quickEdit) return;
    setQuickDrafts((prev) => {
      // Hand `prev` back untouched when there is nothing to seed: a fresh
      // object every pass re-renders, and `table.rows` is a new `[]` while the
      // list loads, which spins this effect forever and locks the page.
      const missing = table.rows.filter((trip) => !prev[trip.id]);
      if (missing.length === 0) return prev;
      return { ...prev, ...Object.fromEntries(missing.map((trip) => [trip.id, quickDraftFromTrip(trip)])) };
    });
  }, [quickEdit, table.rows]);

  // A mode flip starts a fresh batch: drafts and selection are one working set.
  const toggleQuickEdit = useCallback(() => {
    const next = !quickEdit;
    setQuickEdit(next);
    setQuickErrors({});
    setQuickMessage('');
    clearSelection();
    setQuickDrafts(next
      ? Object.fromEntries(table.rows.map((trip) => [trip.id, quickDraftFromTrip(trip)]))
      : {});
  }, [clearSelection, quickEdit, table.rows]);

  // Card 20260929_207: no per-row checkbox remains, so `rowProps` on the row
  // is the only way in. `editableIds` is the scope the toolbar's select-all
  // label states: the rows on THIS page, never the whole filtered set.
  const editableIds = useMemo(
    () => table.rows.filter(isEditableInQuickMode).map((trip) => trip.id), [table.rows],
  );
  const allEditableSelected = selection.allOfSelected(editableIds);
  const handleSelectVisible = useCallback(() => {
    if (allEditableSelected) clearSelection();
    else selectAll(editableIds);
  }, [allEditableSelected, clearSelection, editableIds, selectAll]);

  const handleDraftChange = useCallback((tripId: number, field: keyof TripQuickEditDraft, value: string) => {
    const trip = table.rows.find((item) => item.id === tripId);
    if (!trip || !isEditableInQuickMode(trip)) return;
    setQuickDrafts((prev) => ({
      ...prev,
      [tripId]: {
        ...(prev[tripId] ?? quickDraftFromTrip(trip)),
        [field]: value,
      },
    }));
    // Editing a field implies the row belongs to the batch being saved.
    if (!isSelected(tripId)) toggleSelection(tripId);
    setQuickErrors((prev) => {
      if (!prev[tripId]) return prev;
      const next = { ...prev };
      delete next[tripId];
      return next;
    });
  }, [isSelected, table.rows, toggleSelection]);

  const selectedDirtyTrips = useMemo(
    () => table.rows.filter((trip) => selectedIds.has(trip.id) && isEditableInQuickMode(trip) && draftChanged(trip, quickDrafts[trip.id])),
    [quickDrafts, selectedIds, table.rows],
  );
  const hasCompletedQuickEdits = selectedDirtyTrips.some(
    (trip) => trip.status === TripStatus.COMPLETED,
  );

  const saveQuickEdit = useCallback(async () => {
    if (selectedDirtyTrips.length === 0 || savingQuickEdit) {
      setQuickMessage('Chưa có dòng đã chọn nào thay đổi.');
      return;
    }
    if (hasCompletedQuickEdits && !quickGovernanceReason.trim()) {
      setQuickMessage('Vui lòng nhập lý do cho các chuyến đã hoàn thành.');
      return;
    }
    setSavingQuickEdit(true);
    setQuickMessage('');
    setQuickErrors({});
    try {
      const response = await tripClient.bulkUpdateTripFigures({
        updates: selectedDirtyTrips.map((trip) => ({
          tripId: trip.id,
          mode: trip.status === TripStatus.CREATED ? 'pre-departure' : 'actuals',
          governanceReason: trip.status === TripStatus.COMPLETED
            ? quickGovernanceReason.trim()
            : undefined,
          figures: figuresPayloadFromDraft(trip, quickDrafts[trip.id] ?? quickDraftFromTrip(trip)),
        })),
      });
      const errors: Record<number, string> = {};
      for (const result of response.results) {
        if (!result.ok) errors[result.tripId] = result.error ?? 'Không thể lưu dòng này';
      }
      setQuickErrors(errors);
      setQuickMessage(response.failed > 0
        ? `Đã lưu ${response.updated} dòng, ${response.failed} dòng cần kiểm tra lại.`
        : `Đã lưu ${response.updated} dòng.`);
      if (response.updated > 0) {
        await table.query.refetch();
        // Rows that saved cleanly leave the batch; the ones that failed stay
        // picked so the operator can fix and retry them.
        selectAll(selectedAmong([...selectedIds].filter(
          (tripId) => !response.results.some((result) => result.ok && result.tripId === tripId),
        )));
      }
    } catch (err) {
      setQuickMessage(err instanceof Error ? err.message : 'Không thể lưu thay đổi.');
    } finally {
      setSavingQuickEdit(false);
    }
  }, [hasCompletedQuickEdits, quickDrafts, quickGovernanceReason, savingQuickEdit, selectAll, selectedAmong, selectedDirtyTrips, selectedIds, table.query]);

  const handleCopyPlan = useCallback(async (tripId: number) => {
    if (copyingPlanId) return;

    setCopyingPlanId(tripId);
    setCopyPlanMessage('');
    setCopyPlanError(false);
    try {
      const created = await tripClient.copyTrip(tripId);
      await Promise.all([
        table.query.refetch(),
        queryClient.invalidateQueries({ queryKey: qk.trips.summary(dateFrom, dateTo) }),
        queryClient.invalidateQueries({ queryKey: qk.trips.all }),
      ]);
      setCopyPlanMessage(`Đã copy kế hoạch thành ${buildTripCode(created)}.`);
    } catch (err) {
      setCopyPlanError(true);
      setCopyPlanMessage(err instanceof Error ? err.message : 'Không thể copy kế hoạch vận chuyển.');
    } finally {
      setCopyingPlanId(null);
    }
  }, [copyingPlanId, dateFrom, dateTo, queryClient, table.query]);

  // ── Export ──
  const handleExport = useCallback(async () => {
    const first = await tripClient.listTrips({
      status: statusFilter || undefined,
      truckId: truckFilter || undefined,
      customerId: customerFilter || undefined,
      search: debouncedSearch || undefined,
      dateFrom: listDateFrom,
      dateTo: listDateTo,
      limit: 100,
      page: 1,
    });
    const allTrips = [...first.items];
    const totalPages = Math.ceil(first.total / first.pageSize);
    if (totalPages > 1) {
      const remaining = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) =>
          tripClient.listTrips({
            status: statusFilter || undefined,
            truckId: truckFilter || undefined,
            customerId: customerFilter || undefined,
            search: debouncedSearch || undefined,
            dateFrom: listDateFrom,
            dateTo: listDateTo,
            limit: 100,
            page: i + 2,
          }),
        ),
      );
      for (const res of remaining) allTrips.push(...res.items);
    }
    const headers = ['Bill / Booking', 'Khách hàng', 'Tuyến', 'Xe', 'Ngày khởi hành', 'KM', 'Loại cont', 'Số cont', 'Dầu (L)', 'Nhà CC Dầu', 'Giá trị dầu', 'Tổng đi đường', 'Doanh thu', 'Tổng chi phí', 'LN gộp', 'Trạng thái'];
    const rows = allTrips.map((t) => {
      const containers = (t as unknown as { containers?: Array<{ containerNumber: string; containerTypeCode: string | null; containerTypeName: string | null }> }).containers ?? [];
      const typeCodes = Array.from(new Set(containers.map((c) => c.containerTypeCode || c.containerTypeName).filter(Boolean))).join(', ');
      const numbers = containers.map((c) => c.containerNumber).join(', ');
      return [
        buildTripCode(t),
        t.customer?.name ?? '',
        t.route?.name ?? '',
        t.carrierType === 'EXTERNAL' ? (t.externalPlateNumber ?? 'Xe ngoài') : (t.truck?.licensePlate ?? ''),
        t.departureDate ?? '',
        getTripDistance(t) || '',
        typeCodes, numbers,
        t.fuelLiters ?? '',
        t.fuelSupplier?.name ?? '',
        t.totalFuelCost ?? '',
        (Number(t.totalRoadAllowance ?? 0) + Number(t.tollCost ?? 0)) || '',
        t.revenue ?? '',
        t.totalCost ?? '',
        getTripDisplayGrossProfit(t),
        t.status,
      ];
    });
    const { downloadCSV } = await import('../lib/csv');
    const filterParts: string[] = [];
    if (listDateFrom && listDateTo) filterParts.push(`Từ ${listDateFrom} đến ${listDateTo}`);
    else if (listDateFrom) filterParts.push(`Từ ${listDateFrom}`);
    else if (listDateTo) filterParts.push(`Đến ${listDateTo}`);
    if (statusFilter) filterParts.push(`Trạng thái: ${statusFilter}`);
    if (truckFilter) {
      filterParts.push(`Xe: ${truckOptions.find((truck) => truck.id === truckFilter)?.licensePlate ?? 'không còn trong danh mục'}`);
    }
    if (customerFilter) {
      filterParts.push(`Khách hàng: ${customerOptions.find((customer) => customer.id === customerFilter)?.name ?? 'không còn trong danh mục'}`);
    }
    if (debouncedSearch) filterParts.push(`Tìm kiếm: "${debouncedSearch}"`);
    await downloadCSV(`so-chuyen-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows, {
      title: 'SỔ CHUYẾN ĐI',
      subtitle: filterParts.join(' · ') || 'Tất cả chuyến trong kỳ',
      columnTypes: ['text', 'text', 'text', 'text', 'date', 'km', 'text', 'text', 'liters', 'text', 'currency', 'currency', 'currency', 'currency', 'currency', 'text'],
      totalsColumns: [5, 8, 10, 11, 12, 13, 14],
      totalsLabel: 'TỔNG CỘNG',
    });
  }, [statusFilter, truckFilter, customerFilter, debouncedSearch, listDateFrom, listDateTo, truckOptions, customerOptions]);

  // ── Table instance ──
  const columns = useMemo(() => buildTripColumns(warnThreshold, {
    enabled: quickEdit,
    drafts: quickDrafts,
    errors: quickErrors,
    onDraftChange: handleDraftChange,
  }, {
    copyingPlanId,
    onCopyPlan: canCopyPlan ? handleCopyPlan : undefined,
  }, {
    sort,
    onSortChange: handleSortChange,
  }), [canCopyPlan, copyingPlanId, handleCopyPlan, handleDraftChange, quickDrafts, quickEdit, quickErrors, sort, handleSortChange, warnThreshold]);
  const tableInstance = useReactTable({
    data: table.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // ── Keyboard scroll ──
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useArrowKeyScroll(scrollRef);

  return (
    <div ref={rootRef} className={`trip-list-page${quickEdit ? ' quick-edit-mode' : ''}${scrolled ? ' is-scrolled' : ''}`}>
      <Breadcrumbs
        className="trip-list-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Sổ chuyến đi' },
        ]}
        renderLink={(to, children) => <a onClick={() => navigate(to)}>{children}</a>}
      />
      <TripListHero statusCounts={statusCounts} summary={summary} quickEdit={quickEdit} toggleQuickEdit={toggleQuickEdit} handleExport={handleExport} onAdd={() => { navigate('/trips/new'); }} breakdownPct={breakdownPct} warnThreshold={warnThreshold} month={month} />

      <TripFiltersBar
        statusCounts={statusCounts}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        searchQuery={searchInput}
        onSearch={setSearchInput}
        searching={searching}
        truckOptions={truckOptions}
        truckFilter={truckFilter}
        onTruckFilter={setTruckFilter}
        customerOptions={customerOptions}
        customerFilter={customerFilter}
        onCustomerFilter={setCustomerFilter}
      />

      <div className="table-hint">
        <MousePointerClick size={13} strokeWidth={2.2} />
        <span>
          <b>Mẹo:</b> nhấp vào một hàng để mở chi tiết chuyến
          {canCopyPlan && ', bấm Copy để tạo dòng kế hoạch tương tự'}
          &nbsp;·&nbsp; dùng ← → để cuộn ngang
        </span>
        <span className="table-legend">
          <span className="legend-item"><span className="legend-dot legend-dot--ok" />Đầy đủ số liệu</span>
          <span className="legend-item"><span className="legend-dot legend-dot--warn" />Chưa nhập đủ</span>
        </span>
      </div>
      {copyPlanMessage && (
        <div className={`copy-plan-message${copyPlanError ? ' has-error' : ''}`}>
          {copyPlanMessage}
        </div>
      )}
      {quickEdit && (
        <div className="quick-edit-toolbar">
          <div className="quick-edit-toolbar__main">
            {/* Card 20260929_207: the header's select-all checkbox is gone, so
                this button is the whole-page affordance; its label says so. */}
            <button type="button" className="btn btn--secondary" onClick={handleSelectVisible}
              disabled={editableIds.length === 0}
              title={allEditableSelected ? 'Bỏ chọn các dòng đang hiện' : `Chọn ${editableIds.length} dòng trên trang này`}>
              {allEditableSelected ? 'Bỏ chọn dòng trang này' : `Chọn cả trang này (${editableIds.length})`}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={savingQuickEdit || selectedDirtyTrips.length === 0}
              onClick={saveQuickEdit}
            >
              <Save size={15} />
              {savingQuickEdit ? 'Đang lưu…' : `Lưu ${selectedDirtyTrips.length} dòng`}
            </button>
            <button type="button" className="btn btn--secondary" onClick={toggleQuickEdit}>
              <X size={15} />
              Hủy
            </button>
          </div>
          {hasCompletedQuickEdits && (
            <label className="quick-governance-label">
              <span>Lý do thay đổi chuyến đã hoàn thành</span>
              <textarea
                aria-label="Lý do thay đổi chuyến đã hoàn thành"
                className="input"
                rows={2}
                value={quickGovernanceReason}
                onChange={(event) => setQuickGovernanceReason(event.target.value)}
                placeholder="Nêu căn cứ đối soát"
              />
            </label>
          )}
          <div className={`quick-edit-message${Object.keys(quickErrors).length > 0 ? ' has-error' : ''}`}>
            {quickMessage || 'Chỉ các chuyến chưa chốt/chưa hủy được sửa nhanh.'}
          </div>
        </div>
      )}
      <div className="table-card">
        <div className="table-scroll-wrapper">
          <div className="table-scroll-body" ref={scrollRef} tabIndex={-1} onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}>
            <div className="table-head">
              {tableInstance.getHeaderGroups().map((headerGroup) => (
                <React.Fragment key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <div
                        key={header.id}
                        className={columnClass(header.column.id)}
                        role="columnheader"
                        aria-sort={tripColumnAriaSort(header.column.id, sort)}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>

            {table.isLoading ? (
              <div className="table-empty">Đang tải danh sách chuyến đi…</div>
            ) : table.rows.length === 0 ? (
              <>
                {(searching || statusFilter || truckFilter || customerFilter) && (
                  <div className="filter-alert-wrap">
                    <Alert
                      variant="warning"
                      style="soft"
                      icon={<MousePointerClick size={16} />}
                    >
                      Không có chuyến đi khớp với bộ lọc hiện tại. Thử bỏ lọc trạng thái/tuyến/xe hoặc xóa từ khóa tìm kiếm.
                    </Alert>
                  </div>
                )}
                <EmptyState context="trips" title="Không tìm thấy chuyến đi nào." />
              </>
            ) : (
              tableInstance.getRowModel().rows.map((row) => {
                const pickable = quickEdit && isEditableInQuickMode(row.original);
                const isSelected = selection.isSelected(row.original.id);
                const cells = row.getVisibleCells().map((cell) => (
                  <div key={cell.id} className={columnClass(cell.column.id)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ));
                if (!quickEdit) {
                  // Outside quick edit the row is a link to the trip detail.
                  return (
                    <ClickableCard key={row.id} to={`/trips/${row.original.id}`} className="table-row"
                      style={tripRowStyle(row.original) as CSSProperties}>
                      {cells}
                    </ClickableCard>
                  );
                }
                // Card 20260929_207: in quick edit the row IS the control, so
                // `rowProps` is the only way in — which is what keeps a press
                // on the row's own link or money input from picking it.
                return (
                  <div
                    key={row.id}
                    role="row"
                    className={`table-row quick-edit-row${isSelected ? ' selected' : ''}${pickable ? '' : ' locked'}`}
                    style={tripRowStyle(row.original) as CSSProperties}
                    data-selected={isSelected || undefined}
                    aria-selected={pickable ? isSelected : undefined}
                    tabIndex={pickable ? 0 : undefined}
                    {...selection.rowProps(row.original.id, { selectable: pickable })}
                  >
                    {cells}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="trip-mobile-list">
          {table.isLoading ? (
            <div className="table-empty">Đang tải…</div>
          ) : table.rows.length === 0 ? (
            <div className="table-empty mobile-empty-state">
              <EmptyState variant="compact" context="trips" title="Không tìm thấy chuyến đi nào." />
            </div>
          ) : (
            table.rows.map((trip) => {
              if (!quickEdit) {
                return (
                  <TripMobileCard
                    key={trip.id}
                    trip={trip}
                    warnThreshold={warnThreshold}
                    style={tripRowStyle(trip) as CSSProperties}
                    copyingPlan={copyingPlanId === trip.id}
                    onCopyPlan={canCopyPlan ? handleCopyPlan : undefined}
                  />
                );
              }

              const editable = isEditableInQuickMode(trip);
              const draft = quickDrafts[trip.id] ?? quickDraftFromTrip(trip);
              const selected = selectedIds.has(trip.id);
              const routeLabel = trip.route?.name ?? '—';
              const totalCost = Number(trip.totalCost ?? 0);
              const grossProfit = getTripDisplayGrossProfit(trip);
              const pillClass = STATUS_PILL_CLASS[trip.status] ?? 'pill-moi';
              const quickFields: Array<{ key: keyof TripQuickEditDraft; label: string; unit?: string }> = [
                { key: 'fuelLiters', label: 'Dầu', unit: 'L' },
                { key: 'roadAllowance', label: 'Đi đường', unit: '₫' },
                { key: 'revenue', label: 'Doanh thu', unit: '₫' },
                { key: 'driverSalary', label: 'Lương chuyến', unit: '₫' },
              ];

              // Card 20260929_207: the mobile card is this same table at a
              // narrow width, so it loses the checkbox too and rides the same
              // `rowProps` — a press on a money field still edits, not picks.
              return (
                <div
                  key={trip.id}
                  role="row"
                  className={`trip-mcard trip-mcard--quick${selected ? ' selected' : ''}${!editable ? ' locked' : ''}`}
                  style={tripRowStyle(trip) as CSSProperties}
                  data-selected={selected || undefined}
                  aria-selected={editable ? selected : undefined}
                  tabIndex={editable ? 0 : undefined}
                  {...selection.rowProps(trip.id, { selectable: editable })}
                >
                  <div className="trip-mcard__top">
                    <span className="trip-mcard__check" aria-hidden="true">
                      {editable ? (selected ? 'Đã chọn' : 'Chọn') : 'Khóa'}
                    </span>
                    <span className={`status-pill ${pillClass}`}>{TRIP_STATUS_LABELS[trip.status]}</span>
                  </div>
                  <div className="trip-mcard__name">{trip.customer?.name ?? '—'}</div>
                  <div className="trip-mcard__id">
                    {buildTripCode(trip)}
                    <span className="trip-meta-sep">·</span>
                    <span>{trip.departureDate ?? '—'}</span>
                  </div>
                  <div className="trip-mcard__route">{routeLabel}</div>

                  <div className="quick-card-grid">
                    {quickFields.map((field) => (
                      <label key={field.key} className="quick-card-field">
                        <span>{field.label}</span>
                        <div className="quick-edit-cell">
                          <input
                            className="quick-money-input"
                            inputMode="decimal"
                            value={draft[field.key]}
                            disabled={!editable}
                            onChange={(event) => handleDraftChange(trip.id, field.key, event.target.value)}
                          />
                          {field.unit && <span className="quick-unit">{field.unit}</span>}
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="quick-card-summary">
                    <div>
                      <span>Tổng chi phí</span>
                      <b>{totalCost > 0 ? `${formatMoney(totalCost)} ₫` : '—'}</b>
                    </div>
                    <div>
                      <span>LN gộp</span>
                      <b className={grossProfit < 0 ? 'money-loss' : ''}>{grossProfit !== 0 ? `${formatMoney(grossProfit)} ₫` : '—'}</b>
                    </div>
                  </div>
                  {quickErrors[trip.id] && <div className="quick-card-error">{quickErrors[trip.id]}</div>}
                </div>
              );
            })
          )}
        </div>

        {table.rows.length > 0 && <Pagination page={table.page} totalPages={table.totalPages} totalItems={table.total} pageSize={table.pageSize} onChange={table.setPage} />}
      </div>
    </div>
  );
}

void formatCurrency;
