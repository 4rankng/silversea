import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AccountingTransportRegisterRow } from '@tingting/shared';
import type { TableSortState } from '../../lib/table-sort';
import { SortHeader } from '../../components/shared';
import { formatCurrency } from '../../lib/format';
import { routes } from '../../lib/routes';
import {
  buildTransportDraftUrl,
  transportReadinessLabel,
} from './accountingWorkspaceUtils';
import type { AccountingTransportFilterKey } from './accountingWorkspaceTypes';
import { EmptyState, FilterBar, Pagination, SummaryRail } from '../../design-system';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { FilterDropdown } from '../../components/FilterDropdown';
import { useTableRowSelection, type RowSelection } from '../../hooks/useTableRowSelection';
import { useHiddenColumns } from '../../hooks/useHiddenColumns';
import type { LedgerColumn } from '../../lib/column-visibility';
import { confirmRateAdjustments, withdrawRateAdjustments } from '../../api/accountingDebitClient';
import { billBookingReference } from '../../lib/business-reference';

/** K6.41 — 'Cột hiển thị': the register's columns in table order. Chuyến is
 *  the row's identity and Thao tác its only action column — both pinned (the
 *  picker never offers to hide them); the rest are the operator's choice. */
const REGISTER_COLUMNS: LedgerColumn[] = [
  { key: 'tripCode', label: 'Chuyến', pinned: true },
  { key: 'customerName', label: 'Khách hàng' },
  { key: 'carrierName', label: 'Nhà xe' },
  { key: 'revenue', label: 'Doanh thu' },
  { key: 'directCost', label: 'Chi phí' },
  { key: 'profit', label: 'Lợi nhuận' },
  { key: 'readiness', label: 'Trạng thái' },
  { key: 'actions', label: 'Thao tác', pinned: true },
];

type AccountingTransportRegisterProps = {
  rows: AccountingTransportRegisterRow[];
  total: number;
  totalPages: number;
  fingerprint?: string;
  page: number;
  search: string;
  customerId: string;
  carrierId: string;
  customers: Array<{ id: number; name: string }>;
  carriers: Array<{ id: number; name: string }>;
  ownership: string;
  readiness: string;
  selectionScopeKey: string;
  /** K6.41 — the four reconciliation counts over the full filtered set. */
  adjustmentCounts?: { none: number; pending: number; confirmed: number };
  loading: boolean;
  error: boolean;
  /** Server-side column sort; the parent owns the URL params. */
  sort: TableSortState | null;
  onSortChange: (key: string) => void;
  onSearchChange: (value: string) => void;
  onFilterChange: (key: AccountingTransportFilterKey, value: string) => void;
  onSearch: () => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  /** The strip's `Xóa bộ lọc` action — clears the applied search (URL semantics
   *  unchanged by this cutover). */
  onReset: () => void;
  /** Clears exactly the four criteria `Bộ lọc` owns (the dialog's `Đặt lại`). */
  onResetSecondary: () => void;
};

export function AccountingTransportRegister({
  rows,
  total,
  totalPages,
  fingerprint,
  page,
  search,
  customerId,
  carrierId,
  customers,
  carriers,
  ownership,
  readiness,
  selectionScopeKey,
  adjustmentCounts,
  loading,
  error,
  sort,
  onSortChange,
  onSearchChange,
  onFilterChange,
  onSearch,
  onPageChange,
  onRetry,
  onReset,
  onResetSecondary,
}: AccountingTransportRegisterProps) {
  // Card 20260929_207: the checkbox column is gone app-wide — the row IS the
  // control. A click picks it, a second click unpicks it, Space/Enter on a
  // focused row does the same, and the state rides `data-selected` +
  // `aria-selected` so it is both visible and readable. `rowProps` also keeps
  // a press that lands on the row's own link from also selecting the row.
  const selection = useTableRowSelection<number>();
  // `clear`/`selectAll` are stable and `selected` changes only with the picks,
  // so the two effects below can name them exactly in their dependency lists.
  const { clear, selectAll, selected } = selection;

  // A new filter/page scope must never inherit the previous picks.
  useEffect(() => {
    clear();
  }, [selectionScopeKey, clear]);

  const pickableRows = useMemo(
    () => rows.filter((row) => row.readiness.status === 'READY'),
    [rows],
  );
  const pickedRows = useMemo(
    () => pickableRows.filter((row) => selected.has(row.tripId)),
    [pickableRows, selected],
  );
  const draftUrl = buildTransportDraftUrl(pickedRows);

  // A draft belongs to ONE customer — `buildTransportDraftUrl` reads the debt
  // route off the first pick — so a selection never spans two customers:
  // picking a row of another customer replaces the set instead of filing its
  // trip under a customer that never asked for it. `selected` keeps insertion
  // order, so the newest pick is the row that crossed over.
  useEffect(() => {
    if (new Set(pickedRows.map((row) => row.customerId)).size < 2) return;
    const order = new Map([...selected].map((tripId, index) => [tripId, index]));
    const newest = pickedRows.reduce((a, b) => (order.get(b.tripId) ?? 0) > (order.get(a.tripId) ?? 0) ? b : a);
    selectAll([newest.tripId]);
  }, [pickedRows, selectAll, selected]);

  // The page-wide affordance works inside the customer in play — with nothing
  // picked yet that is the customer of the page's first pickable row, because a
  // draft can only ever belong to one customer.
  const pageScopeRows = useMemo(
    () => pickableRows.filter(
      (row) => row.customerId === (pickedRows[0]?.customerId ?? pickableRows[0]?.customerId),
    ),
    [pickableRows, pickedRows],
  );
  const pageScopeIds = useMemo(() => pageScopeRows.map((row) => row.tripId), [pageScopeRows]);
  const pageScopeCustomer = pageScopeRows[0]?.customerName;
  const allPicked = selection.allOfSelected(pageScopeIds);

  function togglePageScope() {
    if (allPicked) {
      clear();
      return;
    }
    selectAll(pageScopeIds);
  }

  const hasActiveFilters = Boolean(
    search || customerId || carrierId || ownership || readiness,
  );
  // Card 20260927_152: the badge counts exactly the criteria the `Bộ lọc` dialog
  // owns, so its `Bộ lọc, N đang áp dụng` name and `Đặt lại` describe the same set.
  const secondaryCount = [customerId, carrierId, ownership, readiness].filter(Boolean).length;

  // K6.41 — 'Cột hiển thị': the persisted per-workstation column choice (the
  // shared useHiddenColumns law every other ledger surface uses).
  const hiddenColumns = useHiddenColumns({
    storageKey: 'accounting-transport-register-hidden-cols',
    columns: REGISTER_COLUMNS,
    hasData: (column) => rows.some((row) => {
      switch (column.key) {
        case 'carrierName': return row.carrierName != null;
        case 'revenue': return row.revenue != null;
        case 'directCost': return row.directCost != null;
        case 'profit': return row.profit != null;
        default: return true;
      }
    }),
  });

  // K6.41 — [Đối soát]/[Hoàn tác] act on the SELECTED rows' live PENDING
  // rate-adjustment requests — the same confirm/withdraw endpoints the chốt
  // debit board feeds (a second entry point, not a new business path).
  const selectedRequestIds = useMemo(
    () => rows
      .filter((row) => selected.has(row.tripId) && row.adjustment.status === 'PENDING')
      .map((row) => row.adjustment.requestId)
      .filter((id): id is number => id != null),
    [rows, selected],
  );
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const queryClient = useQueryClient();
  // The register query family is ['accounting', 'transport-register', params]
  // (qk.accounting.transportRegister) — the prefix refreshes every filter page.
  const refreshRegister = () => {
    clear();
    void queryClient.invalidateQueries({ queryKey: ['accounting', 'transport-register'] });
  };
  const confirmMutation = useMutation({
    mutationFn: confirmRateAdjustments,
    onSuccess: () => { setMessage({ kind: 'ok', text: 'Đã xác nhận đối soát.' }); refreshRegister(); },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });
  const withdrawMutation = useMutation({
    mutationFn: withdrawRateAdjustments,
    onSuccess: () => { setMessage({ kind: 'ok', text: 'Đã rút yêu cầu.' }); refreshRegister(); },
    onError: (error: Error) => setMessage({ kind: 'err', text: error.message }),
  });

  // K6.41 — the four reconciliation counts, the chốt debit labels verbatim.
  const summary = useMemo(() => [
    { label: 'Lô trong kỳ', value: total },
    { label: 'Chưa đối soát', value: adjustmentCounts?.none ?? 0 },
    { label: 'Chờ xác nhận', value: adjustmentCounts?.pending ?? 0, tone: 'warning' as const },
    { label: 'Đã đối soát', value: adjustmentCounts?.confirmed ?? 0 },
  ], [total, adjustmentCounts]);

  return (
    <section
      className="accounting-register"
      aria-labelledby="transport-register-title"
      aria-busy={loading}
    >
      <header className="accounting-register__heading">
        <h2 id="transport-register-title">Sổ đối chiếu vận tải</h2>
        <p>{total} chuyến đủ điều kiện tài chính trong kỳ</p>
      </header>

      {/* K6.41 — the four reconciliation counts at the page top, the chốt
          debit labels verbatim ('Lô trong kỳ / Chưa đối soát / Chờ xác nhận /
          Đã đối soát') over the full filtered set. */}
      <SummaryRail ariaLabel="Tổng hợp đối soát vận tải" items={summary} />

      {/* Card 20260927_152: the shared `FilterBar` band owns the strip — one
          wrapping row, no page-declared layout. The search is the bar's own
          cell; the four criteria live in `Bộ lọc` (rendered inline while the
          strip still fits two rows) and the submit/reset pair rides the actions
          slot. The `<form>` stays only so Enter still applies the draft search. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
        role="search"
      >
        <FilterBar
          search={{
            value: search,
            onChange: onSearchChange,
            placeholder: 'Ví dụ: C-009, Silver Sea, TGHU…',
            ariaLabel: 'Tìm chuyến, khách hàng hoặc container',
            inputProps: { id: 'accounting-transport-search', name: 'transportSearch', autoComplete: 'off' },
          }}
          columns={{
            items: REGISTER_COLUMNS,
            hidden: hiddenColumns.hidden,
            customized: hiddenColumns.customized,
            onToggle: hiddenColumns.toggle,
            onReset: hiddenColumns.reset,
          }}
          actions={(
            <>
              <button type="submit" className="btn btn--secondary btn--sm">Tìm</button>
              {hasActiveFilters && (
                <button type="button" className="btn btn--secondary btn--sm accounting-register__reset" onClick={onReset}>
                  <X size={12} aria-hidden="true" /> Xóa bộ lọc
                </button>
              )}
              {/* Card 20260929_207: the header checkbox is gone, so the "every
                  row" affordance moved out of the table into the strip, where
                  its label states the scope it actually covers. */}
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={togglePageScope}
                disabled={pageScopeRows.length === 0}
                title={`${allPicked ? 'Bỏ chọn' : `Chọn ${pageScopeRows.length}`} chuyến của ${pageScopeCustomer} đang hiện trên trang này`}
              >
                {allPicked
                  ? 'Bỏ chọn dòng trang này'
                  : `Chọn cả trang này${pageScopeRows.length ? ` (${pageScopeRows.length} chuyến của ${pageScopeCustomer})` : ''}`}
              </button>
            </>
          )}
        >
          <FilterDropdown
            count={secondaryCount}
            ariaLabel="Bộ lọc"
            dialogLabel="Bộ lọc sổ đối chiếu vận tải"
            onReset={onResetSecondary}
          >
            <UuiSelectField
              label="Khách hàng"
              value={customerId}
              onChange={(event) => onFilterChange('customerId', event.target.value)}
              options={[
                { value: '', label: 'Tất cả khách hàng' },
                ...customers.map((customer) => ({ value: String(customer.id), label: customer.name })),
              ]}
            />
            <UuiSelectField
              label="Nhà xe"
              value={carrierId}
              onChange={(event) => onFilterChange('carrierId', event.target.value)}
              options={[
                { value: '', label: 'Tất cả nhà xe' },
                ...carriers.map((carrier) => ({ value: String(carrier.id), label: carrier.name })),
              ]}
            />
            <UuiSelectField
              label="Loại xe"
              value={ownership}
              onChange={(event) => onFilterChange('ownership', event.target.value)}
              options={[
                { value: '', label: 'Tất cả' },
                { value: 'OWN', label: 'Xe nhà' },
                { value: 'EXTERNAL', label: 'Nhà xe ngoài' },
              ]}
            />
            <UuiSelectField
              label="Điều kiện"
              value={readiness}
              onChange={(event) => onFilterChange('readiness', event.target.value)}
              options={[
                { value: '', label: 'Tất cả' },
                { value: 'READY', label: 'Sẵn sàng' },
                { value: 'MISSING_PROFITABILITY_SNAPSHOT', label: 'Thiếu dữ liệu lợi nhuận' },
                { value: 'MISSING_ACCEPTED_POD', label: 'Chờ POD' },
              ]}
            />
          </FilterDropdown>
        </FilterBar>
      </form>

      {/* K6.41 — [Đối soát]/[Hoàn tác] mirror the chốt debit action strip: the
          pair acts on the selected rows' live PENDING rate-adjustment requests
          through the same confirm/withdraw endpoints (no new business path). */}
      <div className="accounting-selection" role="group" aria-label="Đối soát điều chỉnh cước">
        <div>
          <strong>Đối soát điều chỉnh cước</strong>
          <span>
            {selectedRequestIds.length > 0
              ? `Đã chọn ${selectedRequestIds.length} dòng chờ xác nhận`
              : 'Chọn dòng đang chờ xác nhận để đối soát hoặc hoàn tác'}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={selectedRequestIds.length === 0 || confirmMutation.isPending}
          title={selectedRequestIds.length === 0 ? 'Chọn ít nhất một dòng đang chờ xác nhận để đối soát' : undefined}
          onClick={() => confirmMutation.mutate(selectedRequestIds)}
        >
          {confirmMutation.isPending ? 'Đang đối soát…' : 'Đối soát'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={selectedRequestIds.length === 0 || withdrawMutation.isPending}
          title={selectedRequestIds.length === 0 ? 'Chọn ít nhất một dòng để hoàn tác yêu cầu điều chỉnh' : undefined}
          onClick={() => withdrawMutation.mutate(selectedRequestIds)}
        >
          {withdrawMutation.isPending ? 'Đang hoàn tác…' : 'Hoàn tác'}
        </button>
      </div>
      {message && (
        <p
          className={message.kind === 'err' ? 'accounting-alert' : 'accounting-register__hint'}
          role={message.kind === 'err' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}

      {error && (
        <div className="accounting-alert" role="alert">
          Không tải được sổ đối chiếu vận tải.{' '}
          <button type="button" onClick={onRetry}>
            Thử lại
          </button>
        </div>
      )}

      {loading ? (
        <p className="accounting-register__state" aria-live="polite">
          Đang tải dữ liệu vận tải…
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          className="accounting-register__empty"
          context="trips"
          title="Không có chuyến phù hợp trong kỳ đã chọn"
          description="Nới rộng kỳ làm việc hoặc xóa bộ lọc để xem lại toàn bộ chuyến đủ điều kiện tài chính."
          action={
            hasActiveFilters ? (
              <button type="button" className="btn btn--secondary btn--sm" onClick={onReset}>
                Xóa bộ lọc
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* The selection model is no longer a checkbox column, so the board
              says it once, above the table. */}
          <p className="accounting-register__hint" role="status">
            Bấm vào một dòng để chọn · {pickableRows.length} chuyến lập được bản nháp trên trang này
          </p>
          <div className="record-table-wrap accounting-register__wrap">
            <table className="record-table ops-table accounting-register__table">
              <thead>
                <tr>
                  {!hiddenColumns.isHidden('tripCode') && <SortHeader label="Chuyến" sortKey="tripCode" sort={sort} onSortChange={onSortChange} />}
                  {!hiddenColumns.isHidden('customerName') && <SortHeader label="Khách hàng" sortKey="customerName" sort={sort} onSortChange={onSortChange} />}
                  {!hiddenColumns.isHidden('carrierName') && <SortHeader label="Nhà xe" sortKey="carrierName" sort={sort} onSortChange={onSortChange} />}
                  {!hiddenColumns.isHidden('revenue') && <SortHeader label="Doanh thu" sortKey="revenue" sort={sort} onSortChange={onSortChange} className="num" />}
                  {!hiddenColumns.isHidden('directCost') && <SortHeader label="Chi phí" sortKey="directCost" sort={sort} onSortChange={onSortChange} className="num" />}
                  {!hiddenColumns.isHidden('profit') && <SortHeader label="Lợi nhuận" sortKey="profit" sort={sort} onSortChange={onSortChange} className="num" />}
                  {!hiddenColumns.isHidden('readiness') && <SortHeader label="Trạng thái" sortKey="readiness" sort={sort} onSortChange={onSortChange} />}
                  {!hiddenColumns.isHidden('actions') && <th scope="col">Thao tác</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const pickable = row.readiness.status === 'READY';
                  return (
                    <TransportTableRow
                      key={row.financialPostingId}
                      row={row}
                      pickable={pickable}
                      selected={selection.isSelected(row.tripId)}
                      selection={selection}
                      hidden={hiddenColumns.hidden}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pickedRows.length > 0 && (
        <div className="accounting-selection" aria-live="polite">
          <div>
            <strong>Đã chọn {pickedRows.length} chuyến của {pickedRows[0].customerName}</strong>
            <span>
              Chỉ tạo bản nháp từ nguồn hạch toán mà máy chủ kiểm tra lại.
            </span>
          </div>
          <button type="button" onClick={selection.clear}>
            Bỏ chọn
          </button>
          {draftUrl && <Link to={draftUrl}>Tạo bản nháp giấy báo nợ</Link>}
        </div>
      )}

      <footer className="accounting-register__footer">
        <small>
          {fingerprint
            ? `Mã đối chiếu: ${fingerprint.slice(0, 12)}`
            : 'Mã đối chiếu sẽ xuất hiện khi tải xong'}
        </small>
        <Pagination page={page} totalPages={Math.max(1, totalPages)} totalItems={total} pageSize={25} onChange={onPageChange} disabled={loading} />
      </footer>
    </section>
  );
}

function TransportTableRow({
  row,
  pickable,
  selected,
  selection,
  hidden,
}: {
  row: AccountingTransportRegisterRow;
  /** A trip is pickable exactly when it is financially READY: a locked row
   *  never joins the selection, so a draft is never seeded from a source the
   *  server would reject. */
  pickable: boolean;
  selected: boolean;
  selection: RowSelection<number>;
  /** K6.41 — the 'Cột hiển thị' choice: hidden keys render no cell. */
  hidden: readonly string[];
}) {
  // A row joins the selection when it can act: READY rows feed the draft, rows
  // carrying a live PENDING rate-adjustment feed [Đối soát]/[Hoàn tác].
  const selectable = pickable || row.adjustment.status === 'PENDING';
  return (
    <tr
      data-selected={selected || undefined}
      aria-selected={selectable ? selected : undefined}
      className={selectable ? 'accounting-register__row--pickable' : 'accounting-register__row--locked'}
      tabIndex={selectable ? 0 : undefined}
      {...selection.rowProps(row.tripId, { selectable })}
    >
      {!hidden.includes('tripCode') && (
        <td data-label="Chuyến">
          <span className="accounting-register__lead">
            <strong>{billBookingReference(row.tripCode)}</strong>
            <small>{row.containerNumbers.join(', ') || 'Chưa có container'}</small>
          </span>
        </td>
      )}
      {!hidden.includes('customerName') && <td data-label="Khách hàng">{row.customerName}</td>}
      {!hidden.includes('carrierName') && (
        <td data-label="Nhà xe">
          {row.ownership === 'OWN' ? 'Xe nhà' : row.carrierName ?? 'Nhà xe ngoài'}
          {row.ownership === 'EXTERNAL' && (
            <small className="accounting-register__payable">
              Phải trả NXC {formatCurrency(Number(row.carrierPayable))}
            </small>
          )}
        </td>
      )}
      {/* Card 191026202000: a chuyến with no profitability snapshot posts no
          revenue/cost/profit (the wire types them nullable). `Number(x ?? 0)`
          turned that "chưa chốt" into a REAL 0 ₫ — a number no accountant can
          tell from a genuine zero, and the cost cell is exactly what they scan
          for. formatCurrency already owns the missing contract ('— ₫'); hand it
          the raw value so a null stays a missing fact. */}
      {!hidden.includes('revenue') && <td data-label="Doanh thu" className="num">{formatCurrency(row.revenue)}</td>}
      {!hidden.includes('directCost') && <td data-label="Chi phí" className="num">{formatCurrency(row.directCost)}</td>}
      {!hidden.includes('profit') && <td data-label="Lợi nhuận" className="num">{formatCurrency(row.profit)}</td>}
      {!hidden.includes('readiness') && (
        <td data-label="Trạng thái">
          <span
            className={`accounting-status accounting-status--${
              pickable ? 'ready' : 'missing'
            }`}
          >
            {transportReadinessLabel(row)}
          </span>
        </td>
      )}
      {!hidden.includes('actions') && (
        <td data-label="" className="record-table__action">
          <Link to={routes.debtDetail(row.customerId)}>
            Công nợ
          </Link>
        </td>
      )}
    </tr>
  );
}
