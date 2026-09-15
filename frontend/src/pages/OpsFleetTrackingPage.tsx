import { Loader2, RefreshCw, Truck } from 'lucide-react';
import { useOpsFleet } from '../hooks/useOpsQueries';
import './OpsFleetTrackingPage.css';
import { Btn } from '../components/UI';
import { OpsQueryFeedback } from '../features/ops/OpsQueryFeedback';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  CREATED: { label: 'Chờ nhận lệnh', color: 'var(--info, #2563eb)' },
  IN_TRANSIT: { label: 'Đang vận chuyển', color: 'var(--accent, #7c3aed)' },
  COMPLETED: { label: 'Đã hoàn thành', color: 'var(--ok, #16a34a)' },
};

const PROGRESS_LABELS: Record<string, string> = {
  ORDER_RECEIVED: 'đã nhận lệnh',
  DEPARTED: 'đã xuất phát',
  ARRIVED: 'đã đến điểm',
  FUELED: 'đã đổ dầu',
  INCIDENT: 'sự cố',
  NOTE: 'ghi chú',
  PICKED_UP: 'đã lấy hàng/vỏ',
  LOADING_OR_RETURNING: 'đang đóng/trả hàng',
  DELIVERED: 'đã giao',
};

function timeLabel(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Theo dõi phương tiện (OpsVanHanh §4): read-only — mọi thao tác ghi đều
 * không có mặt trên màn này. Tự làm mới mỗi 30 giây (hook polling).
 */
export default function OpsFleetTrackingPage() {
  const { data, isLoading, isFetching, isError, refetch } = useOpsFleet();
  const items = data?.items ?? [];

  return (
    <div className="ops-fleet page-shell">
      <header className="ops-fleet__bar">
        <h1>Theo dõi phương tiện</h1>
        <Btn
          size="sm"
          icon={isFetching ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          onClick={() => void refetch()}
          aria-label="Làm mới"
          disabled={isFetching}
        >
          Làm mới
        </Btn>
      </header>
      <p className="ops-fleet__meta">Chỉ xem · cập nhật tự động mỗi 30 giây · {items.length} xe</p>

      <div className="ops-fleet__scroll">
        <table className="tt-table ops-fleet__table">
          <thead>
            <tr>
              <th>Biển số xe</th>
              <th>Rơ-moóc</th>
              <th>Lệnh đang gán</th>
              <th>Tài xế</th>
              <th>Trạng thái</th>
              <th>Cập nhật</th>
            </tr>
          </thead>
          <tbody>
            {items.map((truck) => {
              const status = truck.status ? STATUS_LABELS[truck.status] : null;
              const progress = truck.lastEventType ? PROGRESS_LABELS[truck.lastEventType] ?? truck.lastEventType : null;
              return (
                <tr key={truck.truckId} className="ops-fleet__row">
                  <td className="ops-fleet__plate" data-label="Biển số xe">
                    <Truck size={14} aria-hidden /> {truck.licensePlate}
                  </td>
                  <td data-label="Rơ-moóc">{truck.trailerPlate ?? '—'}</td>
                  <td className="ops-fleet__wide" data-label="Lệnh đang gán">
                    {truck.tripCode
                      ? `${truck.tripCode}${truck.shipmentCode ? ` · ${truck.shipmentCode}` : ''}`
                      : '—'}
                  </td>
                  <td data-label="Tài xế">{truck.driverName ?? '—'}</td>
                  <td data-label="Trạng thái">
                    {status
                      ? <span style={{ color: status.color }}>{status.label}{progress ? ` (${progress})` : ''}</span>
                      : <span className="ops-fleet__idle">Đang rảnh</span>}
                  </td>
                  <td data-label="Cập nhật">{timeLabel(truck.updatedAt)}</td>
                </tr>
              );
            })}
            {!isLoading && !isError && items.length === 0 && (
              <tr>
                <td colSpan={6} className="ops-fleet__empty">
                  Chưa có xe nào được giao cho bạn quản lý. Liên hệ Admin để cấu hình “Ops phụ trách” trên trang Đội xe.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <OpsQueryFeedback loading={isLoading} error={isError} label="phương tiện" onRetry={refetch} />
      </div>
    </div>
  );
}
