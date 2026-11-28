import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { opsBillReference } from '../features/ops/opsStatus';
import { Loader2, RefreshCw } from 'lucide-react';
import { useOpsFleet } from '../hooks/useOpsQueries';
import { useMonth } from '../hooks/useMonth';
import { Tabs } from '../design-system';
import './OpsFleetTrackingPage.css';
import { Btn } from '../components/UI';
import { OpsQueryFeedback } from '../features/ops/OpsQueryFeedback';
import { formatDateTimeShort } from '../lib/format';
import { matchesComboboxSearch } from '../components/untitled-ui/base/select/combobox';
import { routes } from '../lib/routes';

/** SIL-1311 — trạng thái lên bảng dạng chip màu + dot (`.pill` chia sẻ của
 *  cột Trạng thái /users), không còn chữ thường không phân biệt được. Chip
 *  dùng đúng shared Pill.css (nền trong suốt — luật 2026-09-08 cấm blob nền
 *  màu trong bảng dày); màu semantic phân biệt 4 trạng thái: chờ tài xế nhận
 *  lệnh = warn, đang vận chuyển = info (khớp tripStatusVariant), hoàn thành =
 *  success, rảnh = neutral. */
const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  CREATED: { label: 'Chờ nhận lệnh', cls: 'pill pill--warn' },
  IN_TRANSIT: { label: 'Đang vận chuyển', cls: 'pill pill--info' },
  COMPLETED: { label: 'Đã hoàn thành', cls: 'pill pill--success' },
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

/** SIL-1088 (K2.85) — the truck scope: mặc định là 'Tất cả xe' — màn theo dõi
 *  xe/máy có 5 mức nên mức 0 (xe chưa có việc) và mức 3 (việc đã xong vẫn tra
 *  cứu được) phải quan sát được ngay khi mở, không phụ thuộc cấu hình 'Ops
 *  phụ trách' thưa thớt; tab 'Xe phụ trách' thu hẹp về đúng phạm vi PRD §4. */
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
  const [scope, setScope] = useState<'assigned' | 'all'>('all');
  // SIL-1311 — ô tìm biển số / tài xế (fold dấu qua matchesComboboxSearch).
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { month, year } = useMonth();
  const { data, dataUpdatedAt, isLoading, isFetching, isError, refetch } = useOpsFleet({ scope, month, year });
  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim();
    if (!needle) return items;
    return items.filter((truck) => matchesComboboxSearch(
      [truck.licensePlate, truck.trailerPlate, truck.driverName, truck.billRef, truck.tripCode, truck.shipmentCode]
        .filter((value): value is string => Boolean(value))
        .join(' '),
      needle,
    ));
  }, [items, query]);
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
      <div className="ops-fleet__scope">
        <Tabs
          tabs={SCOPE_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
          value={scope}
          onChange={(id) => setScope(id as 'assigned' | 'all')}
          variant="boxed"
          ariaLabel="Phạm vi xe"
        />
        {/* SIL-1311 — ô tìm theo biển số / tài xế (fold dấu + khớp từng từ
            qua matchesComboboxSearch), lọc tại chỗ trên danh sách đã tải. */}
        <input
          type="search"
          className="input ops-fleet__search"
          aria-label="Tìm theo biển số hoặc tài xế"
          placeholder="Tìm biển số, tài xế…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <p className="ops-fleet__meta">Chỉ xem · cập nhật tự động mỗi 30 giây · tra cứu hoàn thành tháng {month}/{year} · {query.trim() ? `${filtered.length}/${items.length} xe` : `${items.length} xe`}</p>

      <div className="ops-fleet__scroll">
        <table className="tt-table ops-fleet__table">
          {/* SIL-1311 — cột Trạng thái + Cập nhật nạp được nội dung rộng nhất
              một dòng ở 1440 (chip pill + chuỗi "Dữ liệu chưa cập nhật · kiểm
              lúc …"); luật SIL-1059: bảng fixed-layout mà cột hẹp hơn nội
              dung là chữ tràn đè ô bên. */}
          <colgroup>
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '30%' }} />
          </colgroup>
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
            {filtered.map((truck) => {
              const status = truck.status ? STATUS_PILL[truck.status] : null;
              const progress = truck.lastEventType ? PROGRESS_LABELS[truck.lastEventType] ?? truck.lastEventType : null;
              // SIL-1311 — dòng có chuyến đang gán mở chi tiết lô (pattern
              // SIL-1222 của /ops/orders); dòng chưa có việc thì không có gì
              // để mở nên giữ nguyên, không mang affordance điều hướng.
              const shipmentId = truck.shipmentId;
              const openDetail = shipmentId != null
                ? () => navigate(routes.shipmentDetail(shipmentId))
                : undefined;
              return (
                <tr
                  key={truck.truckId}
                  className={`ops-fleet__row${openDetail ? ' ops-fleet__row--detail-link' : ''}`}
                  tabIndex={openDetail ? 0 : undefined}
                  onClick={openDetail}
                  onKeyDown={openDetail ? (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    openDetail();
                  } : undefined}
                >
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
                      ? (
                        <span className={`${status.cls} ops-fleet__status-pill`}>
                          <span className="dot" />
                          {status.label}{progress ? ` (${progress})` : ''}
                        </span>
                      )
                      : (
                        <span className="pill pill--neutral ops-fleet__status-pill">
                          <span className="dot" />
                          Đang rảnh
                        </span>
                      )}
                  </td>
                  <td data-label="Cập nhật">
                    {/* SIL-975 (K10.54 §10.8.5) — có bản ghi: mốc thời gian
                        bản ghi cuối; chưa có bản ghi: nhãn "Dữ liệu chưa cập
                        nhật" kèm thời điểm kiểm, không bao giờ là '—' trần.
                        SIL-1311 — mỗi cụm là một đoạn nowrap: cột hẹp thì ngắt
                        ở "·", không bao giờ cắt giữa "kiểm" và "lúc". */}
                    {truck.updatedAt
                      ? <span className="ops-fleet__nowrap">{formatDateTimeShort(truck.updatedAt)}</span>
                      : (
                        <span className="ops-fleet__missing">
                          <span className="ops-fleet__nowrap">Dữ liệu chưa cập nhật</span>
                          {checkedAtIso ? <> · <span className="ops-fleet__nowrap">kiểm lúc {formatDateTimeShort(checkedAtIso)}</span></> : null}
                        </span>
                      )}
                  </td>
                </tr>
              );
            })}
            {!isLoading && !isError && items.length > 0 && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="ops-fleet__empty">
                  Không tìm thấy xe nào khớp “{query.trim()}”.
                </td>
              </tr>
            )}
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
