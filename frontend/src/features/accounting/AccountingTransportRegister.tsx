import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
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
import { EmptyState, Pagination } from '../../design-system';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { FilterDropdown } from '../../components/FilterDropdown';
import { ListFilterBar } from '../../components/ListFilterBar';
import { useTableRowSelection, type RowSelection } from '../../hooks/useTableRowSelection';

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

      {/* Card 20260927_152: the shared `ListFilterBar` owns the strip — one
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
        <ListFilterBar
          search={{
            value: search,
            onChange: onSearchChange,
            placeholder: 'Ví dụ: C-009, Silver Sea, TGHU…',
            ariaLabel: 'Tìm chuyến, khách hàng hoặc container',
            inputProps: { id: 'accounting-transport-search', name: 'transportSearch', autoComplete: 'off' },
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
        </ListFilterBar>
      </form>

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
                Xóa bộ lọc tìm kiếm
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
                  <SortHeader label="Chuyến" sortKey="tripCode" sort={sort} onSortChange={onSortChange} />
                  <SortHeader label="Khách hàng" sortKey="customerName" sort={sort} onSortChange={onSortChange} />
                  <SortHeader label="Nhà xe" sortKey="carrierName" sort={sort} onSortChange={onSortChange} />
                  <SortHeader label="Doanh thu" sortKey="revenue" sort={sort} onSortChange={onSortChange} className="num" />
                  <SortHeader label="Chi phí" sortKey="directCost" sort={sort} onSortChange={onSortChange} className="num" />
                  <SortHeader label="Lợi nhuận" sortKey="profit" sort={sort} onSortChange={onSortChange} className="num" />
                  <SortHeader label="Trạng thái" sortKey="readiness" sort={sort} onSortChange={onSortChange} />
                  <th scope="col">Thao tác</th>
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
                      selected={pickable && selection.isSelected(row.tripId)}
                      selection={selection}
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
}: {
  row: AccountingTransportRegisterRow;
  /** A trip is pickable exactly when it is financially READY: a locked row
   *  never joins the selection, so a draft is never seeded from a source the
   *  server would reject. */
  pickable: boolean;
  selected: boolean;
  selection: RowSelection<number>;
}) {
  return (
    <tr
      data-selected={selected || undefined}
      aria-selected={pickable ? selected : undefined}
      className={pickable ? 'accounting-register__row--pickable' : 'accounting-register__row--locked'}
      tabIndex={pickable ? 0 : undefined}
      {...selection.rowProps(row.tripId, { selectable: pickable })}
    >
      <td data-label="Chuyến">
        <span className="accounting-register__lead">
          <strong>{row.tripCode ?? 'Chuyến chưa có mã'}</strong>
          <small>{row.containerNumbers.join(', ') || 'Chưa có container'}</small>
        </span>
      </td>
      <td data-label="Khách hàng">{row.customerName}</td>
      <td data-label="Nhà xe">
        {row.ownership === 'OWN' ? 'Xe nhà' : row.carrierName ?? 'Nhà xe ngoài'}
        {row.ownership === 'EXTERNAL' && (
          <small className="accounting-register__payable">
            Phải trả NXC {formatCurrency(Number(row.carrierPayable))}
          </small>
        )}
      </td>
      <td data-label="Doanh thu" className="num">{formatCurrency(Number(row.revenue ?? 0))}</td>
      <td data-label="Chi phí" className="num">{formatCurrency(Number(row.directCost ?? 0))}</td>
      <td data-label="Lợi nhuận" className="num">{formatCurrency(Number(row.profit ?? 0))}</td>
      <td data-label="Trạng thái">
        <span
          className={`accounting-status accounting-status--${
            pickable ? 'ready' : 'missing'
          }`}
        >
          {transportReadinessLabel(row)}
        </span>
      </td>
      <td data-label="" className="record-table__action">
        <Link to={routes.debtDetail(row.customerId)}>
          Công nợ
        </Link>
      </td>
    </tr>
  );
}
