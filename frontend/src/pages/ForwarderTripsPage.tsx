import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, FileSearch, Loader2, Plus, Search } from 'lucide-react';
import type { ForwarderTripSummary } from '@tingting/shared';
import { SHIPMENT_STATUS_LABELS } from '@tingting/shared';
import { qk } from '../api/keys';
import { PageHeader } from '../components/UI';
import { useDebouncedValue } from '../design-system';
import { formatDate } from '../lib/format';
import { useForwarderTrips } from '../hooks/useQueries';
import { ForwarderTripWorkspace } from './ForwarderTripDetailPage';
import { forwarderClient } from '../api/forwarderClient';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/shared/Toast';
import './ForwarderTripsPage.css';
import { ForwarderTripDateRangePicker } from './ForwarderTripDateRangePicker';

function billLabel(trip: ForwarderTripSummary): string {
  return trip.billNumber || trip.bookingNumber || trip.shipmentCode || trip.tripCode || `Lô hàng #${trip.shipmentId}`;
}

const ORDER_EXCHANGE_LABELS = {
  PENDING: 'Chờ đổi lệnh',
  IN_PROGRESS: 'Đang đổi lệnh',
  COMPLETED: 'Đã đổi lệnh',
} as const;

function directionLabel(direction: ForwarderTripSummary['tradeDirection']): string {
  if (direction === 'IMPORT') return 'Nhập';
  if (direction === 'EXPORT') return 'Xuất';
  return '—';
}

function shipmentStatusLabel(status: ForwarderTripSummary['shipmentStatus']): string {
  if (!status) return 'Chưa xác định';
  return SHIPMENT_STATUS_LABELS[status];
}

function selectionClass(trip: ForwarderTripSummary, selected: boolean): string {
  return [
    'ops-bill-row',
    'ftrip-card',
    selected ? 'is-selected' : '',
    trip.statusColor === 'paid' ? 'is-paid' : '',
    trip.statusColor === 'pending' ? 'is-pending' : '',
  ].filter(Boolean).join(' ');
}

function OrderExchangePanel({ item }: { item: ForwarderTripSummary }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const stages = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;
  const currentIndex = stages.indexOf(item.orderExchangeStatus);

  const advance = async () => {
    if (item.orderExchangeStatus === 'COMPLETED') return;
    setSubmitting(true);
    try {
      if (item.orderExchangeStatus === 'PENDING') {
        await forwarderClient.startOrderExchange(item.shipmentId, item.shipmentVersion);
        toast({ kind: 'success', message: 'Đã bắt đầu đổi lệnh.' });
      } else {
        await forwarderClient.completeOrderExchange(item.shipmentId, item.shipmentVersion);
        toast({ kind: 'success', message: 'Đã hoàn tất đổi lệnh.' });
      }
      await queryClient.invalidateQueries({ queryKey: qk.forwarder.tripsAll });
      if (item.tripId) await queryClient.invalidateQueries({ queryKey: qk.forwarder.tripDetail(item.tripId) });
    } catch (error) {
      toast({ kind: 'error', message: error instanceof Error ? error.message : 'Không thể cập nhật đổi lệnh.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="ops-order-exchange" aria-labelledby="ops-order-exchange-title">
      <div className="ops-order-exchange__heading">
        <div>
          <span className="ops-order-exchange__eyebrow">Đổi lệnh hãng tàu</span>
          <h2 id="ops-order-exchange-title">{billLabel(item)}</h2>
          <p>{item.tripId ? `Xe ${item.truckPlate || 'chưa được phân'} · ${item.routeName || 'Chưa có tuyến'}` : 'Có thể đổi lệnh ngay; chưa cần chờ điều vận phân xe.'}</p>
        </div>
        <span className={`ops-order-exchange__state is-${item.orderExchangeStatus.toLowerCase()}`}>
          {ORDER_EXCHANGE_LABELS[item.orderExchangeStatus]}
        </span>
      </div>
      <ol className="ops-order-exchange__steps">
        {stages.map((stage, index) => (
          <li key={stage} className={index <= currentIndex ? 'is-reached' : ''} aria-current={stage === item.orderExchangeStatus ? 'step' : undefined}>
            <span>{index < currentIndex ? <Check size={14} /> : index + 1}</span>
            <strong>{ORDER_EXCHANGE_LABELS[stage]}</strong>
          </li>
        ))}
      </ol>
      <div className="ops-order-exchange__action">
        <p>{item.orderExchangeStatus === 'COMPLETED'
          ? item.tripId ? 'Đã đủ điều kiện đổi lệnh; có thể bàn giao lệnh gốc sau khi xe được phân.' : 'Đổi lệnh đã xong. Hệ thống đang chờ điều vận phân xe.'
          : 'Trạng thái này độc lập với việc điều vận phân xe.'}</p>
        {item.orderExchangeStatus !== 'COMPLETED' && (
          <button className="btn btn--primary" type="button" onClick={() => void advance()} disabled={submitting}>
            {submitting ? 'Đang lưu…' : item.orderExchangeStatus === 'PENDING' ? 'Bắt đầu đổi lệnh' : 'Xác nhận đã đổi lệnh'}
          </button>
        )}
      </div>
    </section>
  );
}

export default function ForwarderTripsPage() {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedWorkItemKey, setSelectedWorkItemKey] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const mobileBackRef = useRef<HTMLButtonElement>(null);
  const mobileTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const mobileReturnFocusKeyRef = useRef<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isLoading, error } = useForwarderTrips(undefined, {
    search: debouncedSearch || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  const trips = useMemo(() => data?.items ?? [], [data?.items]);

  useEffect(() => {
    if (trips.length === 0) {
      setSelectedWorkItemKey(null);
      setMobileDetailOpen(false);
      return;
    }
    if (!selectedWorkItemKey || !trips.some((trip) => trip.workItemKey === selectedWorkItemKey)) {
      setSelectedWorkItemKey(trips[0].workItemKey);
    }
  }, [selectedWorkItemKey, trips]);

  const selectedItem = trips.find((trip) => trip.workItemKey === selectedWorkItemKey) ?? null;

  const selectTrip = (workItemKey: string) => {
    setSelectedWorkItemKey(workItemKey);
    if (window.matchMedia('(max-width: 767px)').matches) {
      mobileReturnFocusKeyRef.current = workItemKey;
      setMobileDetailOpen(true);
      window.requestAnimationFrame(() => {
        mobileBackRef.current?.focus({ preventScroll: true });
        detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  const closeMobileDetail = () => {
    setMobileDetailOpen(false);
    window.requestAnimationFrame(() => {
      const returnFocusKey = mobileReturnFocusKeyRef.current;
      if (returnFocusKey) mobileTriggerRefs.current.get(returnFocusKey)?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  return (
    <div className={`ops-bill-page${mobileDetailOpen ? ' is-mobile-detail-open' : ''}`}>
      <PageHeader
        title="Lệnh hiện trường"
        description="Đổi lệnh theo Bill song song với điều vận, sau đó kê khai chi phí theo chuyến"
        action={(
          <a className="btn btn--secondary ops-bill-page__advance" href="/my-advances">
            <Plus size={16} /> Yêu cầu tạm ứng
          </a>
        )}
      />

      <section className="ops-bill-toolbar" aria-label="Tìm và lọc lệnh vận chuyển">
        <label className="ops-bill-search">
          <span className="sr-only">Tìm theo Bill hoặc thông tin lô hàng</span>
          <Search size={18} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm Bill, Booking hoặc tờ khai..."
          />
        </label>
        <ForwarderTripDateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={({ dateFrom: nextDateFrom, dateTo: nextDateTo }) => {
            setDateFrom(nextDateFrom);
            setDateTo(nextDateTo);
          }}
        />
      </section>

      {isLoading ? (
        <div className="ops-bill-state"><Loader2 className="spin" size={22} /> Đang tải lệnh vận chuyển…</div>
      ) : error ? (
        <div className="ops-bill-state ops-bill-state--error" role="alert">Không thể tải danh sách lệnh vận chuyển.</div>
      ) : trips.length === 0 ? (
        <div className="ops-bill-state ops-bill-state--empty">
          <FileSearch size={28} aria-hidden="true" />
          <div>
            <strong>Chưa có lệnh phù hợp</strong>
            <p>Kiểm tra số Bill hoặc khoảng ngày, rồi thử lại.</p>
          </div>
          {(search || dateFrom || dateTo) && (
            <button type="button" onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); }}>
              Xóa bộ lọc
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="ops-bill-result-bar">
            <strong>{trips.length} lệnh</strong>
            <span className="ops-bill-result-bar__desktop-copy">Đang hiển thị lệnh đã chọn</span>
            <span className="ops-bill-result-bar__mobile-copy">Chọn lệnh để xem chi tiết</span>
          </div>

          <div className="ops-bill-table-wrap">
            <table className="ops-bill-table">
              <thead>
                <tr>
                  <th>Ngày vận chuyển</th>
                  <th>Khách hàng</th>
                  <th>Số Bill / Booking</th>
                  <th>Số tờ khai</th>
                  <th>Nhập / Xuất</th>
                  <th>Loại cont</th>
                  <th>Số container</th>
                  <th>Đổi lệnh</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => (
                  <tr
                    key={trip.workItemKey}
                    className={selectionClass(trip, trip.workItemKey === selectedWorkItemKey)}
                    aria-selected={trip.workItemKey === selectedWorkItemKey}
                    onClick={() => selectTrip(trip.workItemKey)}
                  >
                    <td>{trip.departureDate ? formatDate(trip.departureDate) : 'Chờ phân xe'}</td>
                    <td><strong>{trip.customerName || '—'}</strong><small>{trip.factoryName || trip.routeName || '—'}</small></td>
                    <td><button type="button" title={billLabel(trip)} onClick={() => selectTrip(trip.workItemKey)}>{billLabel(trip)}</button></td>
                    <td>{trip.declarationNumbers || '—'}</td>
                    <td>{directionLabel(trip.tradeDirection)}</td>
                    <td>{trip.containerTypeSummary || trip.cargoTypeName || '—'}</td>
                    <td>{trip.containerNumbers || '—'}</td>
                    <td><span className="ops-bill-status">{ORDER_EXCHANGE_LABELS[trip.orderExchangeStatus]}</span></td>
                    <td><span className="ops-bill-status">{shipmentStatusLabel(trip.shipmentStatus)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ops-bill-mobile-list" aria-label="Danh sách lệnh vận chuyển">
            {trips.map((trip) => (
              <button
                type="button"
                key={trip.workItemKey}
                ref={(element) => {
                  if (element) mobileTriggerRefs.current.set(trip.workItemKey, element);
                  else mobileTriggerRefs.current.delete(trip.workItemKey);
                }}
                className={selectionClass(trip, trip.workItemKey === selectedWorkItemKey)}
                onClick={() => selectTrip(trip.workItemKey)}
                aria-pressed={trip.workItemKey === selectedWorkItemKey}
              >
                <span className="ops-bill-mobile-list__head">
                  <span className="ops-bill-mobile-list__identity">
                    <small>Số Bill / Booking</small>
                    <strong title={billLabel(trip)}>{billLabel(trip)}</strong>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" />
                </span>
                <span className="ops-bill-mobile-list__meta">
                  <span className="ops-bill-mobile-list__status-group">
                    <span className="ops-bill-mobile-list__status">Đổi lệnh: {ORDER_EXCHANGE_LABELS[trip.orderExchangeStatus]}</span>
                    <span className="ops-bill-mobile-list__status ops-bill-mobile-list__status--shipment">Vận chuyển: {shipmentStatusLabel(trip.shipmentStatus)}</span>
                  </span>
                  <span>{trip.departureDate ? formatDate(trip.departureDate) : 'Chờ phân xe'}</span>
                </span>
                <span className="ops-bill-mobile-list__facts">
                  <span className="ops-bill-mobile-list__customer"><small>Khách hàng</small>{trip.customerName || '—'}</span>
                  <span><small>Nhà máy</small>{trip.factoryName || '—'}</span>
                  <span><small>Container</small>{trip.containerTypeSummary || trip.containerNumbers || '—'}</span>
                </span>
              </button>
            ))}
          </div>

          {selectedItem && (
            <section ref={detailRef} className="ops-bill-detail" aria-label="Chi tiết lệnh và chi phí">
              <button ref={mobileBackRef} className="ops-bill-detail__mobile-back" type="button" onClick={closeMobileDetail}>
                <ArrowLeft size={17} aria-hidden="true" /> Danh sách lệnh
              </button>
              <OrderExchangePanel item={selectedItem} />
              {selectedItem.tripId ? (
                <ForwarderTripWorkspace key={selectedItem.tripId} tripId={selectedItem.tripId} embedded />
              ) : (
                <div className="ops-bill-state">Chưa có chuyến xe. Phần kê khai chi phí sẽ mở sau khi điều vận phân xe.</div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
