import type { UseQueryResult } from '@tanstack/react-query';
import {
  ArrowRight,
  ChartNoAxesCombined,
  CircleDollarSign,
  Fuel,
  ReceiptText,
  Truck,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../../lib/format';
import { routes } from '../../lib/routes';
import { SummaryRail, type SummaryRailItem } from '../../design-system';
import { DepositWeeklyChart } from '../../components/charts/DepositWeeklyChart';
import type {
  DepositWeeklySummary,
  DueGroups,
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
  depositWeekly: UseQueryResult<DepositWeeklySummary, Error>;
  profitability: UseQueryResult<ProfitabilitySummary, Error>;
};

export function AccountingOverview({
  to,
  transportViewHref,
  receivables,
  payables,
  depositWeekly,
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

      {/* Card 369 — "Tổng quát về tiền": the two due-group debt cards and the
          weekly container-deposit chart. Amounts display the rounded dueGroups
          values; Tổng is the displayed sum of the two groups so the card shows
          the exact identity Tổng = Trong hạn + Quá hạn. */}
      <section className="accounting-money-overview" aria-label="Tổng quát về tiền">
        <h2 className="accounting-money-overview__title">Tổng quát về tiền</h2>
        <div className="accounting-due-cards">
          <DueGroupCard
            title="Nợ phải thu theo hạn nợ"
            href={routes.debt}
            asOf={to}
            entityNoun="khách hàng"
            dueGroups={receivables.data?.dueGroups}
            ready={!receivables.isLoading && !receivables.isError}
            dataUpdatedAt={receivables.dataUpdatedAt}
            onRefetch={() => { void receivables.refetch(); }}
          />
          <DueGroupCard
            title="Nợ phải trả theo hạn nợ"
            href={routes.payables}
            asOf={to}
            entityNoun="nhà cung cấp / nhà xe"
            dueGroups={payables.data?.dueGroups}
            ready={!payables.isLoading && !payables.isError}
            dataUpdatedAt={payables.dataUpdatedAt}
            onRefetch={() => { void payables.refetch(); }}
          />
        </div>
        <section className="accounting-deposit-chart" aria-label="Biểu đồ cột cược container theo tuần">
          <h3 className="accounting-deposit-chart__title">Biểu đồ cột cược container theo tuần</h3>
          <DepositWeeklyChart weeks={depositWeekly.data?.weeks ?? []} />
        </section>
      </section>

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

/** dataUpdatedAt (ms) → Vietnam wall-clock 'HH:mm' (time-first 24h convention). */
function formatAsOfTime(updatedAt: number): string {
  if (!updatedAt) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(updatedAt));
}

/**
 * Card 369 — one debt card split by due group. Each group's count is its own
 * drill-down link into the matching filtered list (`?filter=current|overdue`),
 * so clicking "Số lượng" opens exactly that group. Values degrade to an em
 * dash while loading or when the source fails — the workspace banner names
 * the failing source.
 */
function DueGroupCard({
  title,
  href,
  asOf,
  entityNoun,
  dueGroups,
  ready,
  dataUpdatedAt,
  onRefetch,
}: {
  title: string;
  href: string;
  /** The card's as-of date — drill-down lists pin it so counts match rows. */
  asOf: string;
  entityNoun: string;
  dueGroups: DueGroups | undefined;
  ready: boolean;
  dataUpdatedAt: number;
  onRefetch: () => void;
}) {
  const dash = '—';
  const inTerm = dueGroups?.inTerm ?? { amount: 0, count: 0 };
  const overdue = dueGroups?.overdue ?? { amount: 0, count: 0 };
  // Displayed Tổng is the sum of the two rounded group values, so the card
  // shows the exact identity Tổng = Trong hạn + Quá hạn.
  const totalAmount = inTerm.amount + overdue.amount;
  const inTermPct = totalAmount > 0 ? (inTerm.amount / totalAmount) * 100 : 0;
  const overduePct = totalAmount > 0 ? (overdue.amount / totalAmount) * 100 : 0;
  const asOfParam = `asOf=${encodeURIComponent(asOf)}`;

  return (
    <section className="accounting-due-card">
      <h3 className="accounting-due-card__title">{title}</h3>
      <dl className="accounting-due-card__rows">
        <div className="accounting-due-card__row accounting-due-card__row--total">
          <dt>Tổng</dt>
          <dd>{ready ? formatCurrency(totalAmount) : dash}</dd>
        </div>
        <div className="accounting-due-card__row">
          <dt>Quá hạn</dt>
          <dd>
            <span className="accounting-due-card__amount">
              {ready ? formatCurrency(overdue.amount) : dash}
            </span>
            <Link className="accounting-due-card__count" to={`${href}?filter=overdue&${asOfParam}`}>
              Số lượng: {ready ? overdue.count : dash} {entityNoun}
            </Link>
          </dd>
        </div>
        <div className="accounting-due-card__row">
          <dt>Trong hạn</dt>
          <dd>
            <span className="accounting-due-card__amount">
              {ready ? formatCurrency(inTerm.amount) : dash}
            </span>
            <Link className="accounting-due-card__count" to={`${href}?filter=current&${asOfParam}`}>
              Số lượng: {ready ? inTerm.count : dash} {entityNoun}
            </Link>
          </dd>
        </div>
      </dl>
      {/* The bar mirrors the amounts above — decorative for AT. */}
      <div className="accounting-due-card__bar" aria-hidden="true">
        <div className="accounting-due-card__bar-in-term" style={{ width: `${inTermPct}%` }} />
        <div className="accounting-due-card__bar-overdue" style={{ width: `${overduePct}%` }} />
      </div>
      <div className="accounting-due-card__footer">
        <small>Số liệu tính đến {formatAsOfTime(dataUpdatedAt)}</small>
        <button type="button" className="accounting-due-card__refresh" onClick={onRefetch}>
          Tải lại
        </button>
      </div>
    </section>
  );
}
