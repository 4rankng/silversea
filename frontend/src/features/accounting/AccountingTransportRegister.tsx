import { useEffect, useMemo, useState, type MouseEvent } from 'react';
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
  onReset: () => void;
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
}: AccountingTransportRegisterProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectionScopeKey]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.tripId)),
    [rows, selectedIds],
  );
  const draftUrl = buildTransportDraftUrl(selectedRows);

  const toggleRow = (row: AccountingTransportRegisterRow) => {
    if (row.readiness.status !== 'READY') {
      return;
    }

    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(row.tripId)) {
        next.delete(row.tripId);
        return next;
      }

      const currentCustomerId = rows.find((currentRow) => next.has(currentRow.tripId))
        ?.customerId;

      if (currentCustomerId != null && currentCustomerId !== row.customerId) {
        next.clear();
      }

      next.add(row.tripId);
      return next;
    });
  };

  const hasActiveFilters = Boolean(
    search || customerId || carrierId || ownership || readiness,
  );

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

      <form
        className="accounting-register__toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
        role="search"
      >
        <div className="accounting-register__search">
          <label className="accounting-register__search-label" htmlFor="accounting-transport-search">Tìm chuyến</label>
          <input
            id="accounting-transport-search"
            name="transportSearch"
            type="search"
            autoComplete="off"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Ví dụ: C-009, Silver Sea, TGHU…"
            aria-label="Tìm chuyến, khách hàng hoặc container"
          />
          <button type="submit">Tìm</button>
        </div>
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
        {hasActiveFilters && (
          <button type="button" className="accounting-register__reset" onClick={onReset}>
            <X size={12} aria-hidden="true" /> Xóa bộ lọc
          </button>
        )}
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
              {rows.map((row) => (
                <TransportTableRow
                  key={row.financialPostingId}
                  row={row}
                  selected={selectedIds.has(row.tripId)}
                  onToggle={() => toggleRow(row)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedRows.length > 0 && (
        <div className="accounting-selection" aria-live="polite">
          <div>
            <strong>
              Đã chọn {selectedRows.length} chuyến của {selectedRows[0].customerName}
            </strong>
            <span>
              Chỉ tạo bản nháp từ nguồn hạch toán mà máy chủ kiểm tra lại.
            </span>
          </div>
          <button type="button" onClick={() => setSelectedIds(new Set())}>
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
  selected,
  onToggle,
}: {
  row: AccountingTransportRegisterRow;
  selected: boolean;
  onToggle: () => void;
}) {
  const tripLabel = row.tripCode ?? 'Chuyến chưa có mã';
  const ready = row.readiness.status === 'READY';

  // The whole row toggles selection (dense-ledger guideline), but the in-cell
  // checkbox label and the debt link keep their own behavior — clicks on them
  // must not double-fire the row toggle.
  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <tr
      className={selected ? 'is-selected' : undefined}
      role="button"
      tabIndex={ready ? 0 : -1}
      aria-disabled={ready ? undefined : true}
      onClick={ready ? onToggle : undefined}
      onKeyDown={(event) => {
        if (!ready || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onToggle();
      }}
    >
      <td data-label="Chuyến">
        <label className="accounting-row-check" onClick={stop}>
          <input
            type="checkbox"
            checked={selected}
            disabled={!ready}
            onChange={onToggle}
            aria-label={`Chọn chuyến ${tripLabel}`}
          />
          <span>
            <strong>{row.tripCode ?? 'Chuyến chưa có mã'}</strong>
            <small>{row.containerNumbers.join(', ') || 'Chưa có container'}</small>
          </span>
        </label>
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
            ready ? 'ready' : 'missing'
          }`}
        >
          {transportReadinessLabel(row)}
        </span>
      </td>
      <td data-label="" className="record-table__action">
        <Link to={routes.debtDetail(row.customerId)} onClick={stop}>
          Công nợ
        </Link>
      </td>
    </tr>
  );
}
