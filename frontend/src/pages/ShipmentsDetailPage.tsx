import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, RotateCcw, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { ShipmentCusContainerFlatResponse } from '@tingting/shared';
import { ApiError } from '../lib/api';
import { listCusShipmentContainers } from '../api/shipmentClient';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { Skeleton } from '../components/shared/Skeleton';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { Input as UUIInput } from '../components/untitled-ui/base/input/input';
import { EmptyState, Pagination } from '../design-system';
import { PageHeader } from '../components/UI';
import { ShipmentContainerLedger } from '../features/shipments/detail/ShipmentContainerLedger';
import './ShipmentsDetailPage.css';

const PAGE_SIZE = 20;
const SEARCH_PATTERN = /^[A-Za-z0-9]{4,5}$/;

function safeError(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function ShipmentContainerLedgerSkeleton() {
  return (
    <div className="shipments-detail-skeleton" aria-label="Đang tải danh sách container" role="status">
      {Array.from({ length: 6 }).map((_, rowIndex) => (
        <div className="shipments-detail-skeleton__row" key={rowIndex}>
          <Skeleton width="18%" height={14} />
          <Skeleton width="26%" height={14} />
          <Skeleton width="22%" height={14} />
          <Skeleton width="14%" height={14} />
          <Skeleton width="16%" height={14} />
        </div>
      ))}
      <span className="sr-only">Đang tải container…</span>
    </div>
  );
}

export default function ShipmentsDetailPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const suffixParam = searchParams.get('searchSuffix') ?? '';
  const [data, setData] = useState<ShipmentCusContainerFlatResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(suffixParam);
  const [searchError, setSearchError] = useState<string | null>(null);
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

  useEffect(() => {
    setSearchInput(suffixParam);
    setSearchError(null);
  }, [suffixParam]);

  const loadRows = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setData(null);
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
  const totalShipments = data?.total ?? 0;
  const hasFilters = Boolean(suffixParam);

  const clearSearch = () => {
    setSearchInput('');
    setSearchError(null);
    updateParam('searchSuffix', null);
  };

  return (
    <div className="shipments-detail-page">
      <Breadcrumbs items={[{ label: 'Tổng hợp Lô hàng', to: '/shipments' }, { label: 'Chi tiết lô hàng' }]} />
      <PageHeader
        title="Chi tiết lô hàng"
        iconName="cargo"
        description="Danh sách container theo lô: lịch đóng/trả, xe vận chuyển và trạng thái điều vận."
      />

      <section className="shipments-detail-workspace" aria-labelledby="shipment-container-ledger-title" aria-busy={loading}>
        <div className="shipments-detail-workspace__header">
          <div className="shipments-detail-workspace__intro">
            <span className="shipments-detail-eyebrow">Sổ điều hành container</span>
            <h2 id="shipment-container-ledger-title">Tình trạng vận chuyển theo từng container</h2>
            <p>Đối chiếu lô hàng, hành trình nâng/hạ, lịch hẹn và phương tiện trên một dòng nghiệp vụ.</p>
          </div>

          <form
            className="shipments-detail-search"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const value = searchInput.trim().toUpperCase();
              if (value && !SEARCH_PATTERN.test(value)) {
                setSearchError('Nhập đúng 4 hoặc 5 ký tự chữ và số.');
                return;
              }
              setSearchError(null);
              updateParam('searchSuffix', value || null);
            }}
          >
            <UUIInput
              label="Bill/Booking hoặc tờ khai"
              size="sm"
              icon={Search}
              value={searchInput}
              onChange={(value) => {
                setSearchInput(value);
                setSearchError(null);
              }}
              placeholder="Nhập 4–5 ký tự cuối"
              hint={searchError ?? 'Dùng 4–5 ký tự cuối để tìm nhanh.'}
              isInvalid={Boolean(searchError)}
              inputProps={{
                maxLength: 5,
                inputMode: 'text',
                pattern: '[A-Za-z0-9]{4,5}',
                autoCapitalize: 'characters',
                autoCorrect: 'off',
                spellCheck: false,
              }}
              className="shipments-detail-search__field"
              wrapperClassName="shipments-detail-search__control"
              inputClassName="shipments-detail-search__input"
            />
            <div className="shipments-detail-search__actions">
              <UUIButton size="sm" color="primary" type="submit" iconLeading={<Search aria-hidden="true" />}>
                Tìm kiếm
              </UUIButton>
              {(hasFilters || searchInput) && (
                <UUIButton size="sm" color="tertiary" onPress={clearSearch} iconLeading={<RotateCcw aria-hidden="true" />}>
                  Xóa lọc
                </UUIButton>
              )}
            </div>
          </form>
        </div>

        {error && (
          <Alert
            variant="error"
            style="soft"
            className="shipments-detail-error"
            icon={<AlertCircle size={18} />}
            action={<UUIButton size="sm" color="secondary" onPress={() => void loadRows()}>Thử lại</UUIButton>}
          >
            {error}
          </Alert>
        )}

        {loading ? (
          <ShipmentContainerLedgerSkeleton />
        ) : error ? null : items.length === 0 ? (
          <EmptyState
            icon={Search}
            title={hasFilters ? 'Không có container phù hợp' : 'Chưa có container'}
            description={hasFilters ? 'Thử ký tự khác hoặc xóa bộ lọc để xem lại danh sách.' : 'Container của các lô hàng sẽ xuất hiện tại đây.'}
            action={hasFilters ? <UUIButton size="sm" color="secondary" onPress={clearSearch} iconLeading={<RotateCcw aria-hidden="true" />}>Xóa bộ lọc</UUIButton> : undefined}
          />
        ) : (
          <>
            <ShipmentContainerLedger rows={items} totalShipments={totalShipments} />
            <Pagination
              page={page}
              totalPages={totalPages}
              summary={(
                <span className="ds-pagination__summary">
                  Trang này có <b>{items.length.toLocaleString('vi-VN')}</b> container · <b>{totalShipments.toLocaleString('vi-VN')}</b> lô hàng phù hợp
                </span>
              )}
              onChange={(nextPage) => updateParam('page', String(nextPage))}
            />
          </>
        )}
      </section>
    </div>
  );
}
