import type { UseQueryResult } from '@tanstack/react-query';
import {
  ArrowRight,
  ChartNoAxesCombined,
  CircleDollarSign,
  Fuel,
  FileCheck2,
  ReceiptText,
  Truck,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../../lib/format';
import { routes } from '../../lib/routes';
import { SummaryRail, type SummaryRailItem } from '../../design-system';
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
  // Rail values degrade to an em dash while loading or when an authority
  // fails — the workspace banner already names the failing source.
  const dash = '—';
  const overdueAmount = receivables.data?.overdueAmount ?? 0;
  const summaryItems: SummaryRailItem[] = [
    {
      label: 'Phải thu',
      value: receivables.isLoading || receivables.isError
        ? dash
        : formatCurrency(receivables.data?.totalOutstanding ?? 0),
    },
    {
      label: 'Khách hàng',
      value: receivables.isLoading || receivables.isError
        ? dash
        : (receivables.data?.totalCustomers ?? 0),
    },
    {
      label: 'Quá hạn',
      value: receivables.isLoading || receivables.isError
        ? dash
        : formatCurrency(overdueAmount),
      tone: overdueAmount > 0 ? 'warning' : undefined,
    },
    {
      label: 'Phải trả',
      value: payables.isLoading || payables.isError
        ? dash
        : formatCurrency(Number(payables.data?.totalOutstanding ?? 0)),
    },
    {
      label: 'Nhà cung cấp / nhà xe',
      value: payables.isLoading || payables.isError
        ? dash
        : (payables.data?.totalSuppliers ?? 0),
    },
    {
      label: 'Lợi nhuận kỳ',
      value: profitability.isLoading || profitability.isError
        ? dash
        : formatCurrency(profitability.data?.totals.profit ?? 0),
    },
  ];

  return (
    <>
      <SummaryRail ariaLabel="Chỉ số kế toán" items={summaryItems} />

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
          to={routes.accountingFuelEvidence}
          icon={Fuel}
          title="Soát OCR nhiên liệu"
          description="Kế toán xác nhận hoặc từ chối ảnh màn hình bơm trước khi đối chiếu nhiên liệu."
          metric="Mở hàng đợi OCR"
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
