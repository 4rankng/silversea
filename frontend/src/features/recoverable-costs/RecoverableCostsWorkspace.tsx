import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { OPS_EXPENSE_TYPE_DEFAULTS, Role } from '@tingting/shared';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getModernRole } from '../../lib/role-helpers';
import {
  AlertCircle,
  FileCheck2,
  FileText,
  RefreshCw,
  Scale,
} from 'lucide-react';
import { Btn, StatusPill, type PillVariant } from '../../components/UI';
import { EmptyState, Pagination, UuiSelectField } from '../../design-system';
import { SortHeader } from '../../components/shared/SortHeader';
import { nextTableSort, type TableSortState } from '../../lib/table-sort';
import { RECOVERABLE_COST_SORT_KEYS, type RecoverableCostSortKey } from '@tingting/shared';
import { ApiError } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import {
  customerServiceFinanceClient,
  type RecoverableCost,
  type RecoverableEligibilityState,
} from '../../api/customerServiceFinanceClient';
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import './RecoverableCostsWorkspace.css';
import './RecoverableCostsPagination.css';
import '../../styles/table-sort.css';

const PAGE_SIZE = 25;

const ELIGIBILITY_LABELS: Record<RecoverableEligibilityState, string> = {
  READY_FOR_REVIEW: 'Cần hoàn thiện dữ liệu',
  ELIGIBLE: 'Đủ điều kiện lập Giấy báo nợ',
  BLOCKED: 'Chưa đủ điều kiện',
  ALREADY_CLAIMED: 'Đã ghi nhận vào Giấy báo nợ',
  ADJUSTMENT_REQUIRED: 'Cần lập điều chỉnh',
};

const APPROVAL_LABELS: Record<RecoverableCost['approvalStatus'], string> = {
  RECORDED: 'Đã ghi nhận',
  DRAFT: 'Cần hoàn thiện',
  VOIDED: 'Đã hủy',
  PENDING: 'Cần hoàn thiện',
  APPROVED: 'Đã ghi nhận',
  REJECTED: 'Đã hủy',
  RETURN_FOR_EVIDENCE: 'Cần bổ sung chứng từ',
};

function eligibilityTone(state: RecoverableEligibilityState): PillVariant {
  if (state === 'ELIGIBLE' || state === 'ALREADY_CLAIMED') return 'success';
  if (state === 'BLOCKED') return 'danger';
  return 'warn';
}

function variance(item: RecoverableCost): number {
  return item.sellAmount - item.buyAmount;
}

function evidenceLabel(item: RecoverableCost): string {
  if (item.invoiceNumber) return `Hóa đơn ${item.invoiceNumber}`;
  if (item.noInvoiceEvidenceTypes.length > 0) {
    return `${item.noInvoiceEvidenceTypes.length} chứng từ thay thế`;
  }
  return 'Chưa có chứng từ';
}

function expenseLabel(item: RecoverableCost): string {
  return item.expenseTypeName?.trim()
    || OPS_EXPENSE_TYPE_DEFAULTS[item.expenseType]?.name
    || 'Khoản chi khác';
}

function Money({ value, tone }: { value: number | null; tone?: 'positive' | 'negative' }) {
  return <span className={`recoverable-costs__money${tone ? ` is-${tone}` : ''}`}>{formatCurrency(value)}</span>;
}

function Eligibility({ item }: { item: RecoverableCost }) {
  return (
    <div className="recoverable-costs__eligibility">
      <StatusPill variant={eligibilityTone(item.eligibility.state)}>
        {ELIGIBILITY_LABELS[item.eligibility.state]}
      </StatusPill>
      {item.eligibility.blockedReason && <small>{item.eligibility.blockedReason}</small>}
    </div>
  );
}

function Evidence({ item }: { item: RecoverableCost }) {
  return (
    <div className="recoverable-costs__evidence">
      <FileText size={15} aria-hidden="true" />
      <span>{evidenceLabel(item)}</span>
      {item.invoiceDate && <small>{formatDate(item.invoiceDate)}</small>}
    </div>
  );
}

function SourceAction({ item }: { item: RecoverableCost }) {
  return <Link className="btn btn--secondary btn--sm" to={`/trips/${item.tripId}`}>
    {item.eligibility.state === 'BLOCKED' || item.eligibility.state === 'READY_FOR_REVIEW' ? 'Hoàn thiện khoản chi' : 'Xem khoản chi'}
  </Link>;
}

function DesktopLedger({ items, footer, sort, onSortChange }: {
  items: RecoverableCost[];
  footer?: ReactNode;
  sort: TableSortState | null;
  onSortChange: (key: string) => void;
}) {
  return (
    <div className="record-table-wrap recoverable-costs__ledger" data-testid="recoverable-cost-ledger">
      <table className="record-table ops-table">
        <thead>
          <tr className="recoverable-costs__group-head">
            <th colSpan={4}>Lô hàng và chi phí</th>
            <th colSpan={5}>Đối soát thu hồi</th>
            <th>Chứng từ</th>
            <th colSpan={2}>Kiểm tra</th>
          </tr>
          <tr>
            <SortHeader label="Khách hàng" sortKey="customerName" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Lô hàng" sortKey="shipmentCode" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Chuyến" sortKey="tripCode" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Khoản chi" sortKey="expenseName" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Chi thực tế" sortKey="buyAmount" sort={sort} onSortChange={onSortChange} className="num" />
            <SortHeader label="Chi hộ" sortKey="recoverablePrincipalAmount" sort={sort} onSortChange={onSortChange} className="num" />
            <SortHeader label="Phí dịch vụ" sortKey="serviceFeeAmount" sort={sort} onSortChange={onSortChange} className="num" />
            <SortHeader label="Thu khách" sortKey="sellAmount" sort={sort} onSortChange={onSortChange} className="num" />
            <SortHeader label="Chênh lệch thu/chi" sortKey="variance" sort={sort} onSortChange={onSortChange} className="num" />
            <SortHeader label="Hóa đơn / chứng từ" sortKey="evidence" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Trạng thái" sortKey="eligibility" sort={sort} onSortChange={onSortChange} />
            <th aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const difference = variance(item);
            return (
              <tr key={item.id}>
                <td className="recoverable-costs__customer" data-label="Khách hàng"><strong>{item.customerName}</strong></td>
                <td data-label="Lô hàng"><strong>{item.shipmentCode ?? 'Chưa có mã lô'}</strong></td>
                <td data-label="Chuyến">{item.tripCode ?? 'Chưa có mã chuyến'}</td>
                <td data-label="Khoản chi">
                  <div className="recoverable-costs__expense">
                    <strong>{expenseLabel(item)}</strong>
                    <small>{formatDate(item.expenseDate)} · {APPROVAL_LABELS[item.approvalStatus]}</small>
                  </div>
                </td>
                <td className="num" data-label="Chi thực tế"><Money value={item.buyAmount} /></td>
                <td className="num" data-label="Chi hộ"><Money value={item.recoverablePrincipalAmount} /></td>
                <td className="num" data-label="Phí dịch vụ"><Money value={item.serviceFeeAmount} /></td>
                <td className="num" data-label="Thu khách"><Money value={item.sellAmount} /></td>
                <td className="num" data-label="Chênh lệch thu/chi"><Money value={difference} tone={difference < 0 ? 'negative' : 'positive'} /></td>
                <td data-label="Hóa đơn / chứng từ"><Evidence item={item} /></td>
                <td data-label="Trạng thái"><Eligibility item={item} /></td>
                <td className="recoverable-costs__action record-table__action" data-label=""><SourceAction item={item} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

function MobileRecords({ items, footer }: { items: RecoverableCost[]; footer?: ReactNode }) {
  return (
    <div className="recoverable-costs__records" data-testid="recoverable-cost-records">
      {items.map((item) => {
        const difference = variance(item);
        return (
          <article className="recoverable-costs__record" key={item.id}>
            <header>
              <div>
                <p>{item.customerName}</p>
                <h2>{item.shipmentCode ?? item.tripCode ?? 'Chưa có mã lô hàng'}</h2>
                <span>{item.tripCode && item.shipmentCode ? item.tripCode : expenseLabel(item)}</span>
              </div>
              <Eligibility item={item} />
            </header>
            <div className="recoverable-costs__record-context">
              <strong>{expenseLabel(item)}</strong>
              <span>{formatDate(item.expenseDate)} · {APPROVAL_LABELS[item.approvalStatus]}</span>
              <Evidence item={item} />
            </div>
            <dl>
              <div><dt>Chi thực tế</dt><dd><Money value={item.buyAmount} /></dd></div>
              <div><dt>Chi hộ</dt><dd><Money value={item.recoverablePrincipalAmount} /></dd></div>
              <div><dt>Phí dịch vụ</dt><dd><Money value={item.serviceFeeAmount} /></dd></div>
              <div><dt>Thu khách</dt><dd><Money value={item.sellAmount} /></dd></div>
              <div className="recoverable-costs__record-variance"><dt>Chênh lệch thu/chi</dt><dd><Money value={difference} tone={difference < 0 ? 'negative' : 'positive'} /></dd></div>
            </dl>
            <SourceAction item={item} />
          </article>
        );
      })}
      {footer}
    </div>
  );
}

export function RecoverableCostsWorkspace() {
  // Role-branched framing per P0-W4: the same `/recoverable-costs` page serves
  // two audiences. CUS views it as the per-shipment collection list
  // ("chi phí thu hộ cần đối soát" — what the customer owes back to us).
  // Accountant / Admin / Manager view it as the per-record ledger
  // ("chi phí cần kiểm tra" — completeness before customer billing).
  // When the auth context is missing (unit tests) we fall back to the
  // accountant framing so existing tests stay green.
  const user = useAuth()?.user;
  const currentRole = user ? getModernRole(user.role) : null;
  const isCus = currentRole === Role.CUS;
  const headerEyebrow = isCus ? 'Đối soát chi phí thu hộ' : 'Đối soát chi phí lô hàng';
  const headerTitle = isCus ? 'Chi phí thu hộ cần đối soát' : 'Chi phí cần kiểm tra';
  const headerSubtitle = isCus
    ? 'Theo dõi các khoản chi phát sinh trên chuyến cần thu hồi từ khách hàng, theo từng lô hàng.'
    : 'Kiểm tra tiền chi hộ, phí dịch vụ và chứng từ trước khi lập Giấy báo nợ.';
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<TableSortState | null>(null);
  const [data, setData] = useState<{ items: RecoverableCost[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const handleSortChange = (key: string) => {
    setSort(current => nextTableSort(current, key));
    setPage(1);
  };

  // Primitive deps only: the load callback must not depend on the `sort`
  // object (a fresh object each toggle would retrigger the effect endlessly).
  const sortBy = sort?.by;
  const sortDir = sort?.dir;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await customerServiceFinanceClient.listRecoverableCosts({
        page,
        limit: PAGE_SIZE,
        approvalStatus: status || undefined,
        // Runtime-guarded narrowing: handleSortChange only feeds keys from
        // the SortHeader whitelist, so this guards the typed client param.
        sortBy: sortBy && (RECOVERABLE_COST_SORT_KEYS as readonly string[]).includes(sortBy)
          ? (sortBy as RecoverableCostSortKey)
          : undefined,
        sortDir,
      }));
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : 'Không thể tải danh sách chi phí cần kiểm tra.');
    } finally {
      setLoading(false);
    }
  }, [page, status, sortBy, sortDir]);

  useEffect(() => { void load(); }, [load]);

  const pageTotals = useMemo(() => (data?.items ?? []).reduce((totals, item) => ({
    buy: totals.buy + item.buyAmount,
    sell: totals.sell + item.sellAmount,
    variance: totals.variance + variance(item),
  }), { buy: 0, sell: 0, variance: 0 }), [data?.items]);

  const pagination = data && data.total > PAGE_SIZE ? (
    <Pagination
      page={page}
      totalPages={Math.ceil(data.total / PAGE_SIZE)}
      totalItems={data.total}
      pageSize={PAGE_SIZE}
      onChange={setPage}
    />
  ) : null;

  return (
    <main className="recoverable-costs" aria-labelledby="recoverable-costs-title">
      <header className="recoverable-costs__header">
        <div>
          <p className="recoverable-costs__eyebrow">{headerEyebrow}</p>
          <h1 id="recoverable-costs-title">{headerTitle}</h1>
          <p>{headerSubtitle}</p>
        </div>
        <Btn
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={16} className={loading ? 'spin' : ''} aria-hidden="true" />}
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Đang tải' : 'Tải lại'}
        </Btn>
      </header>

      <section className="recoverable-costs__summary" aria-label="Tổng hợp trang hiện tại">
        <div><span>Khoản phù hợp</span><strong>{data?.total ?? 0}</strong><small>Theo bộ lọc hiện tại</small></div>
        <div><span>Chi thực tế</span><strong>{formatCurrency(pageTotals.buy)}</strong><small>Trang hiện tại</small></div>
        <div><span>Thu khách</span><strong>{formatCurrency(pageTotals.sell)}</strong><small>Trang hiện tại</small></div>
        <div className={pageTotals.variance < 0 ? 'is-negative' : 'is-positive'}>
          <span>Chênh lệch thu/chi</span><strong>{formatCurrency(pageTotals.variance)}</strong><small>Trang hiện tại</small>
        </div>
      </section>

      <section className="recoverable-costs__toolbar" aria-label="Bộ lọc chi phí">
        <UuiSelectField
          label="Trạng thái khoản chi"
          value={status}
          options={[
            { value: '', label: 'Tất cả trạng thái' },
            { value: 'DRAFT', label: 'Cần hoàn thiện' },
            { value: 'RECORDED', label: 'Đã ghi nhận' },
            { value: 'VOIDED', label: 'Đã hủy' },
          ]}
          onChange={(event) => { setStatus(event.target.value); setPage(1); }}
        />
        <div className="recoverable-costs__toolbar-meta" aria-live="polite">
          <Scale size={17} aria-hidden="true" />
          <span>{loading ? 'Đang cập nhật dữ liệu…' : `${data?.total ?? 0} khoản chi phí`}</span>
        </div>
      </section>

      {error && (
        <div className="recoverable-costs__notice" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
          <Btn variant="ghost" size="sm" onClick={() => void load()}>Thử lại</Btn>
        </div>
      )}

      {loading && !data ? (
        <div className="recoverable-costs__loading" role="status" aria-live="polite">
          <RefreshCw size={18} className="spin" aria-hidden="true" />
          <span>Đang tải danh sách chi phí cần kiểm tra…</span>
        </div>
      ) : !error && data?.items.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title="Không có chi phí phù hợp"
          description={status ? 'Xóa hoặc thay đổi bộ lọc để xem các khoản chi phí khác.' : 'Các khoản chi phí cần kiểm tra sẽ xuất hiện tại đây.'}
        />
      ) : data && data.items.length > 0 ? (
        <section className="recoverable-costs__workspace" aria-busy={loading}>
          <MobileRecords items={data.items} footer={pagination} />
          <DesktopLedger items={data.items} footer={pagination} sort={sort} onSortChange={handleSortChange} />
        </section>
      ) : null}

    </main>
  );
}
