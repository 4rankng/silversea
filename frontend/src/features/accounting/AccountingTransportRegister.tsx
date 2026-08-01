import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AccountingTransportRegisterRow } from '@tingting/shared';
import { formatCurrency } from '../../lib/format';
import { routes } from '../../lib/routes';
import {
  buildTransportDraftUrl,
  displayBusinessDate,
  transportReadinessLabel,
} from './accountingWorkspaceUtils';
import type { AccountingTransportFilterKey } from './accountingWorkspaceTypes';

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

  return (
    <section
      className="accounting-register"
      aria-labelledby="transport-register-title"
      aria-busy={loading}
    >
      <header className="accounting-register__header">
        <div>
          <h2 id="transport-register-title">Sổ đối chiếu vận tải</h2>
          <p>{total} chuyến đủ điều kiện tài chính trong kỳ</p>
        </div>
        <form
          className="accounting-register__search"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
          role="search"
        >
          <label htmlFor="accounting-transport-search">
            Tìm chuyến, khách hàng hoặc container
          </label>
          <div className="accounting-register__search-row">
            <input
              id="accounting-transport-search"
              name="transportSearch"
              type="search"
              autoComplete="off"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Ví dụ: C-009, Silver Sea, TGHU…"
            />
            <button type="submit">Tìm</button>
          </div>
          <div className="accounting-register__filters">
            <label>
              Khách hàng
              <select
                value={customerId}
                onChange={(event) => onFilterChange('customerId', event.target.value)}
              >
                <option value="">Tất cả khách hàng</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </select>
            </label>
            <label>
              Nhà xe
              <select
                value={carrierId}
                onChange={(event) => onFilterChange('carrierId', event.target.value)}
              >
                <option value="">Tất cả nhà xe</option>
                {carriers.map((carrier) => (
                  <option key={carrier.id} value={carrier.id}>{carrier.name}</option>
                ))}
              </select>
            </label>
            <label>
              Loại xe
              <select
                value={ownership}
                onChange={(event) =>
                  onFilterChange('ownership', event.target.value)
                }
              >
                <option value="">Tất cả</option>
                <option value="OWN">Xe nhà</option>
                <option value="EXTERNAL">Nhà xe ngoài</option>
              </select>
            </label>
            <label>
              Điều kiện
              <select
                value={readiness}
                onChange={(event) =>
                  onFilterChange('readiness', event.target.value)
                }
              >
                <option value="">Tất cả</option>
                <option value="READY">Sẵn sàng</option>
                <option value="MISSING_PROFITABILITY_SNAPSHOT">
                  Thiếu dữ liệu lợi nhuận
                </option>
              </select>
            </label>
          </div>
        </form>
      </header>

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
        <p className="accounting-register__state">
          Không có chuyến phù hợp trong kỳ đã chọn.{' '}
          <button type="button" onClick={onReset}>
            Xóa bộ lọc tìm kiếm
          </button>
        </p>
      ) : (
        <>
          <div className="accounting-register__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Chuyến</th>
                  <th>Khách hàng</th>
                  <th>Nhà xe</th>
                  <th className="accounting-money">Doanh thu</th>
                  <th className="accounting-money">Chi phí</th>
                  <th className="accounting-money">Lợi nhuận</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
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

          <div className="accounting-register__cards">
            {rows.map((row) => (
              <TransportCard
                key={row.financialPostingId}
                row={row}
                selected={selectedIds.has(row.tripId)}
                onToggle={() => toggleRow(row)}
              />
            ))}
          </div>
        </>
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
        <div>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Trang trước
          </button>
          <span>
            Trang {page}
            {totalPages > 0 ? ` / ${totalPages}` : ''}
          </span>
          <button
            type="button"
            disabled={totalPages === 0 || page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Trang sau
          </button>
        </div>
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
  const tripLabel = row.tripCode ?? 'chưa có mã';

  return (
    <tr>
      <td>
        <label className="accounting-row-check">
          <input
            type="checkbox"
            checked={selected}
            disabled={row.readiness.status !== 'READY'}
            onChange={onToggle}
            aria-label={`Chọn chuyến ${tripLabel}`}
          />
          <span>
            <strong>{row.tripCode ?? 'Chuyến chưa có mã'}</strong>
            <small>{row.containerNumbers.join(', ') || 'Chưa có container'}</small>
          </span>
        </label>
      </td>
      <td>{row.customerName}</td>
      <td>{row.ownership === 'OWN' ? 'Xe nhà' : row.carrierName ?? 'Nhà xe ngoài'}</td>
      <td className="accounting-money">{formatCurrency(Number(row.revenue ?? 0))}</td>
      <td className="accounting-money">{formatCurrency(Number(row.directCost ?? 0))}</td>
      <td className="accounting-money">{formatCurrency(Number(row.profit ?? 0))}</td>
      <td>
        <span
          className={`accounting-status accounting-status--${
            row.readiness.status === 'READY' ? 'ready' : 'missing'
          }`}
        >
          {transportReadinessLabel(row)}
        </span>
      </td>
      <td>
        <Link to={routes.debtDetail(row.customerId)}>Công nợ</Link>
      </td>
    </tr>
  );
}

function TransportCard({
  row,
  selected,
  onToggle,
}: {
  row: AccountingTransportRegisterRow;
  selected: boolean;
  onToggle: () => void;
}) {
  const tripLabel = row.tripCode ?? 'Chuyến chưa có mã';

  return (
    <article className="accounting-transport-card">
      <header>
        <label className="accounting-row-check">
          <input
            type="checkbox"
            checked={selected}
            disabled={row.readiness.status !== 'READY'}
            onChange={onToggle}
            aria-label={`Chọn ${tripLabel}`}
          />
          <strong>{tripLabel}</strong>
        </label>
        <span
          className={`accounting-status accounting-status--${
            row.readiness.status === 'READY' ? 'ready' : 'missing'
          }`}
        >
          {transportReadinessLabel(row)}
        </span>
      </header>
      <p>
        {row.customerName} ·{' '}
        {row.ownership === 'OWN' ? 'Xe nhà' : row.carrierName ?? 'Nhà xe ngoài'}
      </p>
      <p>
        {displayBusinessDate(row.completionDate)} · {row.routeName} ·{' '}
        {row.containerNumbers.join(', ') || 'Chưa có container'}
      </p>
      <dl>
        <div>
          <dt>Doanh thu</dt>
          <dd>{formatCurrency(Number(row.revenue ?? 0))}</dd>
        </div>
        <div>
          <dt>Chi phí</dt>
          <dd>{formatCurrency(Number(row.directCost ?? 0))}</dd>
        </div>
        <div>
          <dt>Lợi nhuận</dt>
          <dd>{formatCurrency(Number(row.profit ?? 0))}</dd>
        </div>
        {row.ownership === 'EXTERNAL' && (
          <div>
            <dt>Phải trả nhà xe</dt>
            <dd>{formatCurrency(Number(row.carrierPayable))}</dd>
          </div>
        )}
      </dl>
      <Link to={routes.debtDetail(row.customerId)}>Mở công nợ khách hàng</Link>
    </article>
  );
}
