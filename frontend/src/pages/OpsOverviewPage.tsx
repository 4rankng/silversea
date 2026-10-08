import { Activity, ArrowRight, ClipboardList, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { KPI } from '../components/UI';
import { OpsQueryFeedback } from '../features/ops/OpsQueryFeedback';
import { localDateInputValue } from '../features/ops/opsStatus';
import {
  useOpsAdvanceRequests,
  useOpsFleet,
  useOpsOrders,
  useOpsWalletSummary,
} from '../hooks/useOpsQueries';
import { formatDate, formatMoney } from '../lib/format';
import { routes } from '../lib/routes';
import './OpsOverviewPage.css';

/**
 * Tổng quan Ops (route /ops) — dashboard chỉ số công việc của một Ops:
 * kế hoạch làm hàng chờ xử lý, xe đang chạy và quỹ tạm ứng (số dư + yêu cầu
 * chờ duyệt), kèm quick links vào 3 màn Ops hiện có. Read-only, tổng hợp từ
 * đúng các endpoint các màn kia đã đọc (GET /api/ops/orders,
 * /api/ops/fleet, /api/ops/wallet/summary, /api/ops/wallet/advance-requests)
 * — không có nguồn riêng và không có write.
 *
 * Ngữ nghĩa số liệu (cố ý, pin trong test):
 * - "chờ xử lý" = lô của ngày giao dự kiến hôm nay có trạng thái khác
 *   COMPLETED (endpoint đã loại CANCELED phía server).
 * - "đang chạy" = xe có trạng thái IN_TRANSIT ("đang vận chuyển").
 * - "chờ duyệt" = yêu cầu ở bucket DRAFT "Chưa ghi sổ" — bucket duy nhất
 *   còn chờ quyết định Ghi sổ / Hủy; một yêu cầu RECORDED đã được ghi nhận
 *   (approvedAt đặt lúc tạo) nên không tính vào đây. Đếm từ aggregate
 *   statusCounts toàn bộ, không từ trang đang hiển thị.
 */
export default function OpsOverviewPage() {
  const planDate = localDateInputValue();
  const ordersQuery = useOpsOrders(planDate);
  const fleetQuery = useOpsFleet();
  const summaryQuery = useOpsWalletSummary();
  const advancesQuery = useOpsAdvanceRequests();

  const orders = ordersQuery.data?.items ?? [];
  const pendingOrders = orders.filter((order) => order.status !== 'COMPLETED').length;
  const trucks = fleetQuery.data?.items ?? [];
  const runningTrucks = trucks.filter((truck) => truck.status === 'IN_TRANSIT').length;
  const pendingAdvances = advancesQuery.data?.statusCounts?.DRAFT ?? 0;

  const ordersReady = !ordersQuery.isLoading && !ordersQuery.isError;
  const fleetReady = !fleetQuery.isLoading && !fleetQuery.isError;
  const summaryReady = !summaryQuery.isLoading && !summaryQuery.isError;
  const advancesReady = !advancesQuery.isLoading && !advancesQuery.isError;

  return (
    <div className="ops-overview page-shell">
      <header className="ops-overview__bar">
        <h1>Tổng quan Ops</h1>
      </header>
      <p className="ops-overview__provenance">
        {`Tổng hợp từ Kế hoạch làm hàng, Theo dõi phương tiện và Quỹ tạm ứng · ngày giao dự kiến ${formatDate(planDate)}`}
      </p>

      <section className="kpi-grid cols-3 ops-overview__metrics" aria-label="Chỉ số công việc">
        <div className="ops-overview__metric">
          <KPI
            label="Kế hoạch làm hàng chờ xử lý"
            value={ordersQuery.isLoading ? '…' : ordersQuery.isError ? '—' : pendingOrders}
            unit={ordersReady ? 'lô' : undefined}
            meta={
              ordersReady
                ? orders.length === 0
                  ? 'Không có lô hàng trong ngày này.'
                  : pendingOrders === 0
                    ? `Tất cả ${orders.length} lô trong ngày đã hoàn thành.`
                    : `${orders.length} lô trong ngày giao dự kiến ${formatDate(planDate)}`
                : undefined
            }
          />
          <OpsQueryFeedback
            error={ordersQuery.isError}
            label="kế hoạch làm hàng"
            onRetry={ordersQuery.refetch}
          />
        </div>

        <div className="ops-overview__metric">
          <KPI
            label="Xe đang chạy"
            value={fleetQuery.isLoading ? '…' : fleetQuery.isError ? '—' : runningTrucks}
            unit={fleetReady ? 'xe' : undefined}
            meta={
              fleetReady
                ? trucks.length === 0
                  ? 'Chưa có xe nào được giao cho bạn quản lý.'
                  : runningTrucks === 0
                    ? `Không có xe nào đang chạy · ${trucks.length} xe đang theo dõi`
                    : `đang vận chuyển · ${trucks.length} xe đang theo dõi`
                : undefined
            }
          />
          <OpsQueryFeedback
            error={fleetQuery.isError}
            label="phương tiện"
            onRetry={fleetQuery.refetch}
          />
        </div>

        <div className="ops-overview__metric">
          <KPI
            label="Số dư quỹ tạm ứng"
            value={
              summaryQuery.isLoading
                ? '…'
                : summaryQuery.isError
                  ? '—'
                  : formatMoney(summaryQuery.data!.balance)
            }
            unit={summaryReady ? '₫' : undefined}
            meta={
              advancesReady
                ? pendingAdvances === 0
                  ? 'Chưa có yêu cầu chờ duyệt.'
                  : `${pendingAdvances} yêu cầu chờ duyệt (chưa ghi sổ)`
                : advancesQuery.isLoading
                  ? '…'
                  : undefined
            }
          />
          <OpsQueryFeedback
            error={summaryQuery.isError}
            label="số dư"
            onRetry={summaryQuery.refetch}
          />
          <OpsQueryFeedback
            error={advancesQuery.isError}
            label="yêu cầu tạm ứng"
            onRetry={advancesQuery.refetch}
          />
        </div>
      </section>

      <section className="ops-overview__links" aria-label="Liên kết nhanh">
        <h2 className="ops-overview__links-title">Liên kết nhanh</h2>
        <div className="ops-overview__link-list">
          <QuickLink
            to={routes.opsOrders}
            icon={ClipboardList}
            title="Kế hoạch làm hàng"
            description="Lô hàng theo ngày giao dự kiến, ghim lô và khai chi phí."
          />
          <QuickLink
            to={routes.opsFleetTracking}
            icon={Activity}
            title="Theo dõi phương tiện"
            description="Xe, tài xế và lệnh đang gán của bạn — chỉ xem, cập nhật mỗi 30 giây."
          />
          <QuickLink
            to={routes.opsWallet}
            icon={Wallet}
            title="Quỹ tạm ứng"
            description="Số dư, xin tạm ứng, chi phí và quyết toán của bạn."
          />
        </div>
      </section>
    </div>
  );
}

/** Quick link vào màn Ops đích — icon + nhãn + mô tả, quỹ đạo arrow. */
function QuickLink({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link className="ops-overview__link" to={to}>
      <span className="ops-overview__link-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <span className="ops-overview__link-body">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <ArrowRight className="ops-overview__link-arrow" aria-hidden="true" size={18} />
    </Link>
  );
}
