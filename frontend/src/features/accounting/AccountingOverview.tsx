import type { UseQueryResult } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarDays,
  ChartNoAxesCombined,
  CircleDollarSign,
  FileCheck2,
  ReceiptText,
  Truck,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../../lib/format';
import { routes } from '../../lib/routes';
import type {
  PayablesSummary,
  ProfitabilitySummary,
  ReceivablesSummary,
} from './accountingWorkspaceTypes';
import { displayBusinessDate } from './accountingWorkspaceUtils';

type AccountingOverviewProps = {
  to: string;
  transportViewHref: string;
  receivables: UseQueryResult<ReceivablesSummary, Error>;
  payables: UseQueryResult<PayablesSummary, Error>;
  profitability: UseQueryResult<ProfitabilitySummary, Error>;
};

export function AccountingOverview({
  to,
  transportViewHref,
  receivables,
  payables,
  profitability,
}: AccountingOverviewProps) {
  return (
    <>
      <section className="accounting-kpis" aria-label="Chỉ số kế toán">
        <Kpi
          label="Phải thu"
          value={formatCurrency(receivables.data?.totalOutstanding ?? 0)}
          meta={`${receivables.data?.totalCustomers ?? 0} khách hàng`}
          icon={ReceiptText}
          loading={receivables.isLoading}
          unavailable={receivables.isError}
        />
        <Kpi
          label="Quá hạn"
          value={formatCurrency(receivables.data?.overdueAmount ?? 0)}
          meta={`${receivables.data?.overdueCustomers ?? 0} khách cần xử lý`}
          icon={CalendarDays}
          loading={receivables.isLoading}
          unavailable={receivables.isError}
          tone="danger"
        />
        <Kpi
          label="Phải trả"
          value={formatCurrency(Number(payables.data?.totalOutstanding ?? 0))}
          meta={`${payables.data?.totalSuppliers ?? 0} nhà cung cấp / nhà xe`}
          icon={WalletCards}
          loading={payables.isLoading}
          unavailable={payables.isError}
        />
        <Kpi
          label="Lợi nhuận kỳ"
          value={formatCurrency(profitability.data?.totals.profit ?? 0)}
          meta={
            profitability.data?.reconciliation.status === 'RECONCILED'
              ? 'Đã đối chiếu nguồn'
              : 'Còn nguồn cần bổ sung'
          }
          icon={ChartNoAxesCombined}
          loading={profitability.isLoading}
          unavailable={profitability.isError}
          tone="positive"
        />
      </section>

      <p className="accounting-provenance">
        Kỳ dữ liệu đến {displayBusinessDate(to)} · Tổng hợp từ công nợ phải thu, công nợ phải trả
        và báo cáo lợi nhuận
      </p>

      <section className="accounting-workflows" aria-label="Nghiệp vụ kế toán">
        <WorkflowLink
          to={routes.debt}
          icon={ReceiptText}
          title="Công nợ phải thu"
          description="Theo dõi tuổi nợ, số đã thu, số còn lại và khách hàng quá hạn."
          metric={`${receivables.data?.overdueCustomers ?? 0} cần chú ý`}
        />
        <WorkflowLink
          to={routes.payables}
          icon={CircleDollarSign}
          title="Công nợ phải trả"
          description="Đối chiếu nhà cung cấp, nhà xe và các nghĩa vụ đã ghi nhận."
          metric={`${payables.data?.overdueSuppliers ?? 0} quá hạn`}
        />
        <Link
          className="accounting-workflow accounting-workflow--button"
          to={transportViewHref}
        >
          <span className="accounting-workflow__icon" aria-hidden="true">
            <Truck size={20} />
          </span>
          <span className="accounting-workflow__body">
            <strong>Đối chiếu vận tải</strong>
            <span>
              Kiểm tra chuyến đã hoàn thành, e-POD và nguồn tài chính trước khi lập
              chứng từ.
            </span>
          </span>
          <span className="accounting-workflow__metric">Theo kỳ đã chọn</span>
          <ArrowRight
            className="accounting-workflow__arrow"
            aria-hidden="true"
            size={18}
          />
        </Link>
        <WorkflowLink
          to={routes.finance}
          icon={ChartNoAxesCombined}
          title="Báo cáo lãi lỗ"
          description="Đối chiếu doanh thu, chi phí, lợi nhuận và nguồn chưa phân loại."
          metric={`${
            profitability.data?.sourceCoverage.missingAttribution ?? 0
          } nguồn thiếu phân bổ`}
        />
        <WorkflowLink
          to={routes.governanceActions}
          icon={FileCheck2}
          title="Trung tâm phê duyệt"
          description="Kiểm tra các đề nghị tài chính cần phân tách người lập và người duyệt."
          metric="Mở hàng đợi"
        />
        <WorkflowLink
          to={routes.treasury}
          icon={WalletCards}
          title="Sổ quỹ / ngân hàng"
          description="Xem số dư sổ sách từ các chuyển động tiền có liên kết nguồn."
          metric="Xem vị thế tiền"
        />
      </section>
    </>
  );
}

function Kpi({
  label,
  value,
  meta,
  icon: Icon,
  loading,
  unavailable,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  meta: string;
  icon: LucideIcon;
  loading: boolean;
  unavailable?: boolean;
  tone?: 'neutral' | 'positive' | 'danger';
}) {
  return (
    <article className={`accounting-kpi accounting-kpi--${tone}`} aria-busy={loading}>
      <div className="accounting-kpi__head">
        <span>{label}</span>
        <Icon aria-hidden="true" size={19} />
      </div>
      <strong>{loading ? 'Đang tải…' : unavailable ? 'Không khả dụng' : value}</strong>
      <small>{meta}</small>
    </article>
  );
}

function WorkflowLink({
  to,
  icon: Icon,
  title,
  description,
  metric,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
  metric: string;
}) {
  return (
    <Link className="accounting-workflow" to={to}>
      <span className="accounting-workflow__icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <span className="accounting-workflow__body">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="accounting-workflow__metric">{metric}</span>
      <ArrowRight
        className="accounting-workflow__arrow"
        aria-hidden="true"
        size={18}
      />
    </Link>
  );
}
