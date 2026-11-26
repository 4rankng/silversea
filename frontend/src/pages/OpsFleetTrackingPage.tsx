import { useState } from 'react';
import { opsBillReference } from '../features/ops/opsStatus';
import { Loader2, RefreshCw } from 'lucide-react';
import { useOpsFleet } from '../hooks/useOpsQueries';
import { useMonth } from '../hooks/useMonth';
import { Tabs } from '../design-system';
import './OpsFleetTrackingPage.css';
import { Btn } from '../components/UI';
import { OpsQueryFeedback } from '../features/ops/OpsQueryFeedback';
import { formatDateTimeShort } from '../lib/format';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  CREATED: { label: 'Chờ nhận lệnh', color: 'var(--info, #2563eb)' },
  IN_TRANSIT: { label: 'Đang vận chuyển', color: 'var(--accent-ink, #00361B)' },
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

/** SIL-1088 (K2.85) — the truck scope: mặc định là xe Ops phụ trách (PRD §4);
 *  'Tất cả xe' mở cả đội xe để mức 0 (xe chưa có việc) quan sát được — bộ lọc
 *  mà QA tố thiếu. */
const SCOPE_TABS = [
  { id: 'assigned', label: 'Xe phụ trách' },
  { id: 'all', label: 'Tất cả xe' },
] as const;

/**
 * Theo dõi phương tiện (OpsVanHanh §4): read-only — mọi thao tác ghi đều
 * không có mặt trên màn này. Tự làm mới mỗi 30 giây (hook polling). Bộ chọn
 * tháng toàn cục điều khiển tra cứu mức 3 (công việc đã kết thúc vẫn tra cứu
 * được trong tháng đó); đổi tháng hoặc đổi phạm vi luôn gọi lại API.
 */
export default function OpsFleetTrackingPage() {
  const [scope, setScope] = useState<'assigned' | 'all'>('assigned');
  const { month, year } = useMonth();
  const { data, dataUpdatedAt, isLoading, isFetching, isError, refetch } = useOpsFleet({ scope, month, year });
  const items = data?.items ?? [];
  // SIL-975 (K10.54 §10.8.5) — the readout time ("thời điểm kiểm") rides the
  // query's last successful fetch, so a truck with no record at all still
  // names WHEN the board looked, not a bare '—'.
  const checkedAtIso = dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : null;

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
      <div className="ops-fleet__scope" role="group" aria-label="Phạm vi xe">
        <Tabs
          tabs={SCOPE_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
          value={scope}
          onChange={(id) => setScope(id as 'assigned' | 'all')}
          variant="boxed"
          ariaLabel="Phạm vi xe"
        />
      </div>
      <p className="ops-fleet__meta">Chỉ xem · cập nhật tự động mỗi 30 giây · tra cứu hoàn thành tháng {month}/{year} · {items.length} xe</p>

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
                    {truck.licensePlate}
                  </td>
                  <td data-label="Rơ-moóc">{truck.trailerPlate ?? <span className="ops-fleet__missing">Chưa có rơ-moóc</span>}</td>
                  <td className="ops-fleet__wide" data-label="Lệnh đang gán">
                    {truck.tripId != null
                      ? opsBillReference(truck.billRef)
                      : <span className="ops-fleet__missing">Chưa gán lệnh</span>}
                  </td>
                  <td data-label="Tài xế">{truck.driverName ?? <span className="ops-fleet__missing">Chưa có tài xế</span>}</td>
                  <td data-label="Trạng thái">
                    {status
                      ? <span style={{ color: status.color }}>{status.label}{progress ? ` (${progress})` : ''}</span>
                      : <span className="ops-fleet__idle">Đang rảnh</span>}
                  </td>
                  <td data-label="Cập nhật">
                    {/* SIL-975 (K10.54 §10.8.5) — có bản ghi: mốc thời gian
                        bản ghi cuối; chưa có bản ghi: nhãn "Dữ liệu chưa cập
                        nhật" kèm thời điểm kiểm, không bao giờ là '—' trần. */}
                    {truck.updatedAt
                      ? formatDateTimeShort(truck.updatedAt)
                      : (
                        <span className="ops-fleet__missing">
                          Dữ liệu chưa cập nhật{checkedAtIso ? ` · kiểm lúc ${formatDateTimeShort(checkedAtIso)}` : ''}
                        </span>
                      )}
                  </td>
                </tr>
              );
            })}
            {!isLoading && !isError && items.length === 0 && (
              <tr>
                <td colSpan={6} className="ops-fleet__empty">
                  {scope === 'all'
                    ? 'Đội xe chưa có xe nào trong danh mục.'
                    : 'Chưa có xe nào được giao cho bạn quản lý. Liên hệ Admin để cấu hình “Ops phụ trách” trên trang Đội xe, hoặc chọn “Tất cả xe” để theo dõi cả đội.'}
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
