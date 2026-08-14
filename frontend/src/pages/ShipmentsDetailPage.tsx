import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, RotateCcw, Search } from 'lucide-react';
import type { ShipmentCusContainerFlatResponse } from '@tingting/shared';
import { ApiError } from '../lib/api';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { PageHeader } from '../components/UI';
import { EmptyState, Pagination } from '../design-system';
import { listCusShipmentContainers } from '../api/shipmentClient';
import './ShipmentsPage.css';

const PAGE_SIZE = 20;
const SEARCH_PATTERN = /^[A-Za-z0-9]{4,5}$/;

function safeError(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function directionLabel(direction: 'IMPORT' | 'EXPORT' | null): string {
  if (direction === 'IMPORT') return 'Nhập';
  if (direction === 'EXPORT') return 'Xuất';
  return '—';
}

function dispatchStatusLabel(status: string): string {
  if (status === 'PLANNED') return 'Đã phân xe';
  if (status === 'CREATED') return 'Đã tạo chuyến';
  if (status === 'IN_TRANSIT') return 'Đang chạy';
  if (status === 'COMPLETED') return 'Hoàn thành';
  return 'Chưa điều xe';
}

/**
 * CUS container-flat view (/shipments-detail): every container of every
 * in-scope shipment on one row — same visual language as the summary screen
 * (ShipmentsPage.css), plus the đóng/trả appointment and vehicle plate per
 * container, without the shipment-identity column. Read-only sibling of the
 * worksheet; all edits stay on the summary screen.
 */
export default function ShipmentsDetailPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const suffixParam = searchParams.get('searchSuffix') ?? '';

  const [data, setData] = useState<ShipmentCusContainerFlatResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(suffixParam);
  const requestSequence = useRef(0);

  const updateParam = useCallback((key: string, value: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value) next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => setSearchInput(suffixParam), [suffixParam]);

  const loadRows = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await listCusShipmentContainers({
        page,
        limit: PAGE_SIZE,
        searchSuffix: suffixParam || undefined,
      });
      if (requestId === requestSequence.current) setData(response);
    } catch (loadError) {
      if (requestId === requestSequence.current) {
        setError(safeError(loadError, 'Không thể tải danh sách container.'));
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [page, suffixParam]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 0;
  const total = data?.total ?? 0;
  const hasFilters = Boolean(suffixParam);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Tổng hợp Lô hàng', to: '/shipments' }, { label: 'Chi tiết lô hàng' }]} />
      <PageHeader
        title="Chi tiết lô hàng"
        iconName="cargo"
        description="Toàn bộ container của các lô hàng — giờ đóng/trả và xe vận chuyển từng cont"
      />

      <form
        className="page-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          const value = searchInput.trim().toUpperCase();
          if (value && !SEARCH_PATTERN.test(value)) return;
          updateParam('searchSuffix', value || null);
        }}
      >
        <div className="toolbar-search">
          <Search size={16} aria-hidden="true" />
          <label className="sr-only" htmlFor="containers-search">Tìm theo 4-5 ký tự cuối Bill/Book hoặc tờ khai</label>
          <input
            id="containers-search"
            value={searchInput}
            maxLength={5}
            placeholder="4-5 ký tự cuối Bill/Book…"
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        {hasFilters && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => { setSearchInput(''); updateParam('searchSuffix', null); }}
          >
            <RotateCcw size={14} aria-hidden="true" /> Xóa bộ lọc
          </button>
        )}
      </form>

      {error && (
        <div className="cus-notice cus-notice--error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadRows()}>Thử lại</button>
        </div>
      )}

      {loading && !data ? (
        <div className="cus-loading"><Loader2 className="spin" aria-hidden="true" /> Đang tải container…</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Search}
          title={hasFilters ? 'Không có container phù hợp' : 'Chưa có container'}
          description={hasFilters ? 'Điều chỉnh hoặc xóa bộ lọc để xem lại danh sách.' : 'Container của các lô hàng sẽ xuất hiện tại đây.'}
          action={hasFilters ? <button type="button" className="btn btn--secondary" onClick={() => { setSearchInput(''); updateParam('searchSuffix', null); }}><RotateCcw size={17} aria-hidden="true" /> Xóa bộ lọc</button> : undefined}
        />
      ) : (
        <>
          <p id="containers-table-instructions" className="sr-only">
            Bảng container của tất cả các lô hàng, mỗi container trên một dòng.
          </p>
          <div className="cus-dashboard-viewport" role="region" aria-label="Bảng chi tiết container" aria-describedby="containers-table-instructions" tabIndex={0}>
            <table className="cus-dashboard-table">
              <caption className="sr-only">Container của tất cả các lô hàng</caption>
              <thead><tr>
                <th scope="col">Khách hàng &amp; nhà máy</th>
                <th scope="col">Chứng từ</th>
                <th scope="col">Container</th>
                <th scope="col">Nâng / Hạ</th>
                <th scope="col">Giờ hẹn đóng/trả</th>
                <th scope="col">Xe vận chuyển</th>
                <th scope="col">Điều vận</th>
              </tr></thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" data-label="Khách hàng & nhà máy">
                      <strong>{row.customerName || '—'}</strong>
                      <span>{row.factoryName || '—'}</span>
                    </th>
                    <td data-label="Chứng từ">
                      <strong>{row.billOrBookNumber || '—'}</strong>
                      <span>{directionLabel(row.direction)}</span>
                    </td>
                    <td data-label="Container">
                      <strong>{row.containerNumber || 'Chưa có số container'}</strong>
                      <span>{row.containerTypeLabel || '—'}</span>
                    </td>
                    <td data-label="Nâng / Hạ">
                      <span>{row.liftSite || '—'}</span>
                      <span>→ {row.dropoffSite || '—'}</span>
                    </td>
                    <td data-label="Giờ hẹn đóng/trả">{formatDateTime(row.customerAppointmentAt)}</td>
                    <td data-label="Xe vận chuyển">
                      <strong>{row.carrierName || '—'}</strong>
                      <span>{row.plateNumber || '—'}</span>
                    </td>
                    <td data-label="Điều vận">
                      <span className={`cus-container-dispatch cus-container-dispatch--${row.dispatchStatus.toLowerCase()}`}>
                        {dispatchStatusLabel(row.dispatchStatus)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            summary={(
              <span className="ds-pagination__summary">
                {items.length} container — {total.toLocaleString('vi-VN')} lô hàng
              </span>
            )}
            onChange={(nextPage) => updateParam('page', String(nextPage))}
          />
        </>
      )}
    </>
  );
}
