import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronRight, Loader2, Plus, Search } from 'lucide-react';
import type { ForwarderTripSummary } from '@tingting/shared';
import { SHIPMENT_STATUS_LABELS } from '@tingting/shared';
import { PageHeader } from '../components/UI';
import { useDebouncedValue } from '../design-system';
import { formatDate } from '../lib/format';
import { useForwarderTrips } from '../hooks/useQueries';
import { ForwarderTripWorkspace } from './ForwarderTripDetailPage';
import './ForwarderTripsPage.css';

function billLabel(trip: ForwarderTripSummary): string {
  return trip.billNumber || trip.bookingNumber || trip.shipmentCode || trip.tripCode || `Chuyến #${trip.id}`;
}

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

export default function ForwarderTripsPage() {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isLoading, error } = useForwarderTrips(undefined, {
    search: debouncedSearch || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  const trips = useMemo(() => data?.items ?? [], [data?.items]);

  useEffect(() => {
    if (trips.length === 0) {
      setSelectedTripId(null);
      return;
    }
    if (!selectedTripId || !trips.some((trip) => trip.id === selectedTripId)) {
      setSelectedTripId(trips[0].id);
    }
  }, [selectedTripId, trips]);

  const selectTrip = (tripId: number) => {
    setSelectedTripId(tripId);
    if (window.matchMedia('(max-width: 767px)').matches) {
      window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  return (
    <div className="ops-bill-page">
      <PageHeader
        title="Chi phí hiện trường"
        description="Tìm lệnh theo Bill, kiểm tra thông tin vận chuyển và ghi nhận khoản chi thực tế"
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
            placeholder="Nhập số Bill, Booking, tờ khai, container hoặc khách hàng"
          />
        </label>
        <div className="ops-bill-date-range">
          <CalendarDays size={17} aria-hidden="true" />
          <label>
            <span>Từ ngày</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <span className="ops-bill-date-range__separator">đến</span>
          <label>
            <span>Đến ngày</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
        </div>
      </section>

      {isLoading ? (
        <div className="ops-bill-state"><Loader2 className="spin" size={22} /> Đang tải lệnh vận chuyển…</div>
      ) : error ? (
        <div className="ops-bill-state ops-bill-state--error" role="alert">Không thể tải danh sách lệnh vận chuyển.</div>
      ) : trips.length === 0 ? (
        <div className="ops-bill-state">Không tìm thấy lệnh phù hợp. Hãy kiểm tra số Bill hoặc khoảng ngày.</div>
      ) : (
        <>
          <div className="ops-bill-result-bar">
            <strong>{trips.length} lệnh</strong>
            <span>Chọn một dòng để xem và ghi nhận chi phí</span>
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
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => (
                  <tr
                    key={trip.id}
                    className={selectionClass(trip, trip.id === selectedTripId)}
                    aria-selected={trip.id === selectedTripId}
                    onClick={() => selectTrip(trip.id)}
                  >
                    <td>{formatDate(trip.departureDate)}</td>
                    <td><strong>{trip.customerName || '—'}</strong><small>{trip.factoryName || trip.routeName || '—'}</small></td>
                    <td><button type="button" onClick={() => selectTrip(trip.id)}>{billLabel(trip)}</button></td>
                    <td>{trip.declarationNumbers || '—'}</td>
                    <td>{directionLabel(trip.tradeDirection)}</td>
                    <td>{trip.containerTypeSummary || trip.cargoTypeName || '—'}</td>
                    <td>{trip.containerNumbers || '—'}</td>
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
                key={trip.id}
                className={selectionClass(trip, trip.id === selectedTripId)}
                onClick={() => selectTrip(trip.id)}
                aria-pressed={trip.id === selectedTripId}
              >
                <span className="ops-bill-mobile-list__head">
                  <strong>{billLabel(trip)}</strong>
                  <ChevronRight size={18} aria-hidden="true" />
                </span>
                <span className="ops-bill-mobile-list__status">{shipmentStatusLabel(trip.shipmentStatus)}</span>
                <span className="ops-bill-mobile-list__facts">
                  <span><small>Ngày vận chuyển</small>{formatDate(trip.departureDate)}</span>
                  <span><small>Khách hàng</small>{trip.customerName || '—'}</span>
                  <span><small>Nhà máy</small>{trip.factoryName || '—'}</span>
                  <span><small>Container</small>{trip.containerTypeSummary || trip.containerNumbers || '—'}</span>
                </span>
              </button>
            ))}
          </div>

          {selectedTripId && (
            <section ref={detailRef} className="ops-bill-detail" aria-label="Chi tiết lệnh và chi phí">
              <ForwarderTripWorkspace key={selectedTripId} tripId={selectedTripId} embedded />
            </section>
          )}
        </>
      )}
    </div>
  );
}
