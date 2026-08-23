import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, FileText, Pencil, XCircle } from 'lucide-react';
import { usePageAnimations } from '../hooks/animations';
import { formatNumber, formatDate } from '../lib/format';
import { useAuth } from '../hooks/useAuth';
import {
  ADVANCE_SETTLEMENT_STATUS_LABELS,
  AdvanceSettlementStatus,
  Role,
} from '@tingting/shared';
import type { AdvanceSettlementWithRefs } from '@tingting/shared';
import { PageHeader, StatusPill, Toolbar, FilterPill } from '../components/UI';
import { AssetIcon, type AssetIconName } from '../components/AssetIcon';
import { StatusStrip } from '../components/shared/StatusStrip';
import { Money } from '../components/shared/Money';
import {
  useAdminSettlements,
  useAdminAdvanceBalances,
  useRejectSettlement,
} from '../hooks/useForwarderQueries';
import { advanceSettlementStatusVariant } from '../lib/status-variants';
import { useFocusDeepLink } from '../hooks/useFocusDeepLink';
import {
  groupSettlementExpensesByTrip,
  summarizeSettlementExpenses,
} from './admin-advance-settlement-summary';
import './AdminAdvanceSettlementsPage.css';
import '../styles/operational-table-typography.css';
import { Pagination, UuiSelectField } from '../design-system';

/* ── Types ─────────────────────────────────────────────────────────────── */

type Settlement = AdvanceSettlementWithRefs;

type StatusFilter = '' | AdvanceSettlementStatus;

export function summarizeSettlementStats(
  settlements: Array<Pick<Settlement, 'status' | 'totalExpenseAmount'>>,
) {
  const counts: Record<string, number> = {
    total: 0,
    [AdvanceSettlementStatus.PENDING]: 0,
    [AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT]: 0,
    [AdvanceSettlementStatus.APPROVED]: 0,
    [AdvanceSettlementStatus.REVERSED]: 0,
    [AdvanceSettlementStatus.REJECTED]: 0,
  };
  const totals: Record<string, number> = {
    [AdvanceSettlementStatus.PENDING]: 0,
    [AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT]: 0,
    [AdvanceSettlementStatus.APPROVED]: 0,
    [AdvanceSettlementStatus.REVERSED]: 0,
  };

  for (const settlement of settlements) {
    counts.total++;
    const status = settlement.status as string;
    if (status in counts) counts[status]++;
    const amount = Number(settlement.totalExpenseAmount) || 0;
    if (status in totals) totals[status] += amount;
  }
  return { counts, totals };
}

const TABS: { key: StatusFilter; label: string }[] = [
  { key: '', label: 'Tất cả' },
  { key: AdvanceSettlementStatus.PENDING, label: 'Chờ xử lý' },
  { key: AdvanceSettlementStatus.APPROVED, label: 'Đã duyệt' },
  { key: AdvanceSettlementStatus.REVERSED, label: 'Đã hoàn tác' },
  { key: AdvanceSettlementStatus.REJECTED, label: 'Từ chối' },
];

const AS_PAGE_SIZE = 50;

/** The composite "Chờ xử lý" tab selects both in-review statuses server-side. */
function statusFilterParam(filter: StatusFilter): string | undefined {
  if (!filter) return undefined;
  if (filter === AdvanceSettlementStatus.PENDING) {
    return `${AdvanceSettlementStatus.PENDING},${AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT}`;
  }
  return filter;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'var(--warning, #D97706)',
  CHECKED_BY_ACCOUNTANT: '#2563EB',
  APPROVED: 'var(--success, #059669)',
  REVERSED: '#64748B',
  REJECTED: '#DC2626',
};

function settlementStatusLabel(status: AdvanceSettlementStatus): string {
  return status === AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT
    ? 'Đã kiểm tra · Chờ phê duyệt'
    : ADVANCE_SETTLEMENT_STATUS_LABELS[status];
}

/* ── Compact KPI card — mirrors AdminAdvancesPage .adv-kpi proportions ── */

interface AsKPIProps {
  label: string;
  value: number;
  meta: string;
  variant: 'warn' | 'info' | 'success' | 'danger';
  iconName: AssetIconName;
  active?: boolean;
  hasItems?: boolean;
  // Omit onClick for a summary-only stat (no filter to toggle). Renders as a
  // non-interactive element instead of a dead role="button" in the tab order.
  onClick?: () => void;
}

function AsKPI({ label, value, meta, variant, iconName, active = false, hasItems = false, onClick }: AsKPIProps) {
  const interactive = typeof onClick === 'function';
  const content = (
    <>
      <div className="as-kpi__label">{label}</div>
      <div className="as-kpi__value">{value}</div>
      <div className="as-kpi__meta">{meta}</div>
      <AssetIcon name={iconName} size={58} className="as-kpi__asset" />
    </>
  );
  const className = `as-kpi as-kpi--${variant}${active ? ' is-active' : ''}${hasItems ? ' has-items' : ''}${interactive ? '' : ' as-kpi--static'}`;

  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-pressed={active}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={className}
    >
      {content}
    </div>
  );
}

/* ── Desktop grid row ──────────────────────────────────────────────────── */

export function SettlementGridRow({
  s,
  rejectMutation,
  focusId,
  canApproveReject,
}: {
  s: Settlement;
  rejectMutation: ReturnType<typeof useRejectSettlement>;
  focusId?: string;
  canApproveReject: boolean;
}) {
  const isRejecting = rejectMutation.isPending && rejectMutation.variables?.id === s.id;
  const canAct = s.status === AdvanceSettlementStatus.PENDING || s.status === AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT;
  const plans = groupSettlementExpensesByTrip(s.linkedExpenses ?? []);
  const rows = plans.length > 0 ? plans : [null];

  return (
    <>
      <div className="as-settlement-summary">
        <div>
          <span>Phiếu quyết toán</span>
          <Link to={`/settlements/${s.id}`}>{s.code}</Link>
        </div>
        <div>
          <span>Tạm ứng quyết toán</span>
          <strong><Money value={Number(s.totalExpenseAmount) + Number(s.refundAmount)} /></strong>
        </div>
        <div>
          <span>Tổng chi phí</span>
          <strong><Money value={Number(s.totalExpenseAmount)} /></strong>
        </div>
        <div>
          <span>Hoàn lại</span>
          <strong><Money value={Number(s.refundAmount)} /></strong>
        </div>
      </div>
      {rows.map((plan, index) => (
        <div
          className="as-grid-row"
          id={index === 0 ? focusId : undefined}
          key={plan?.tripId ?? `empty-${s.id}`}
          style={{ position: 'relative', overflow: 'hidden' }}
        >
          <StatusStrip color={STATUS_COLORS[s.status]} />

          <div className="as-date-customer">
            <span className="as-date">{plan?.departureDate ? formatDate(plan.departureDate) : formatDate(s.createdAt)}</span>
            <strong>{plan?.customerName || 'Chưa có khách hàng'}</strong>
          </div>

          <div className="as-record">
            {plan ? (
              <Link to={`/trips/${plan.tripId}`} className="as-code-link">
                {plan.tripCode || 'Chuyến chưa có mã'}
              </Link>
            ) : (
              <Link to={`/settlements/${s.id}`} className="as-code-link">{s.code}</Link>
            )}
            <span className="as-record__forwarder">
              {s.code} · {s.forwarderName || 'Chưa có tên giao nhận'}
            </span>
          </div>

          <div className="as-container-count">{plan?.containerCount ?? 0}</div>
          <div className="as-route">{plan?.routeName || 'Chưa có tuyến đường'}</div>

          <div className="as-expense-breakdown">
            {plan && plan.expenseBreakdown.length > 0 ? plan.expenseBreakdown.map(item => (
              <span className="as-expense-chip" key={item.code}>
                <span>{item.label}</span>
                <strong><Money value={item.amount} /></strong>
              </span>
            )) : <span className="as-expense-empty">Chưa có khoản chi liên kết</span>}
          </div>

          <div className="as-amount">
            <Money value={plan?.totalExpense ?? Number(s.totalExpenseAmount)} />
          </div>

          <div>
            <StatusPill variant={advanceSettlementStatusVariant(s.status)}>
              {settlementStatusLabel(s.status)}
            </StatusPill>
          </div>

          <div className={`as-actions${canAct ? '' : ' as-actions--history'}`}>
            {canAct ? (
              <>
                <Link
                  className="as-row-action"
                  to={`/settlements/${s.id}`}
                  aria-label={`${canApproveReject ? 'Kiểm tra' : 'Xem'} ${s.code}`}
                >
                  {canApproveReject && <Pencil size={15} aria-hidden="true" />}
                  {canApproveReject ? 'Kiểm tra' : 'Xem phiếu'}
                </Link>
                {canApproveReject && (
                  <button
                    className="as-reject-action"
                    onClick={() => rejectMutation.mutate({ id: s.id, expectedVersion: s.version })}
                    disabled={isRejecting}
                    title="Từ chối hoàn ứng"
                    aria-label={`Từ chối hoàn ứng ${s.code}`}
                  >
                    {isRejecting ? <Loader2 size={16} className="spin" /> : <XCircle size={16} />}
                  </button>
                )}
              </>
            ) : (
              <>
                <Link className="as-row-action as-row-action--quiet" to={`/settlements/${s.id}`}>
                  Xem phiếu
                </Link>
                {(s.approverName || s.checkerName) && (
                  <div className="as-approver">
                    {s.approverName ? <>Duyệt bởi <strong>{s.approverName}</strong></> : <>KT <strong>{s.checkerName}</strong></>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

/* ── Mobile card ───────────────────────────────────────────────────────── */

export function SettlementMobileCard({
  s,
  rejectMutation,
  focusId,
  canApproveReject,
}: {
  s: Settlement;
  rejectMutation: ReturnType<typeof useRejectSettlement>;
  focusId?: string;
  canApproveReject: boolean;
}) {
  const isRejecting = rejectMutation.isPending && rejectMutation.variables?.id === s.id;
  const canAct = s.status === AdvanceSettlementStatus.PENDING || s.status === AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT;
  const scope = summarizeSettlementExpenses(s.linkedExpenses);
  const plans = groupSettlementExpensesByTrip(s.linkedExpenses ?? []);

  return (
    <article className="as-mcard" id={focusId}>
      <StatusStrip color={STATUS_COLORS[s.status]} />

      {/* Identity and review state */}
      <div className="as-mcard__top">
        <div className="as-mcard__identity">
          <span className="as-mcard__kind">
            <FileText size={14} aria-hidden="true" />
            Phiếu hoàn ứng
          </span>
          <Link to={`/settlements/${s.id}`} className="as-mcard__code">{s.code}</Link>
          <span className="as-mcard__name">
            {s.forwarderName || 'Chưa có tên giao nhận'}
          </span>
        </div>
        <span className="as-mcard__status">
          {settlementStatusLabel(s.status)}
        </span>
      </div>

      {/* Decision amount */}
      <div className="as-mcard__amounts">
        <div className="as-mcard__amount-row">
          <span className="as-mcard__amount-label">Tổng chi phí</span>
          <span className="as-mcard__amount-value"><Money value={Number(s.totalExpenseAmount)} /></span>
        </div>
        {Number(s.refundAmount) > 0 && (
          <div className="as-mcard__refund">
            <span>Hoàn lại</span>
            <strong><Money value={Number(s.refundAmount)} /></strong>
          </div>
        )}
      </div>

      {/* Compact linked scope */}
      <div className="as-mcard__scope">
        <div className="as-mcard__scope-head">
          <span>Phạm vi quyết toán</span>
          <time dateTime={s.createdAt}>{formatDate(s.createdAt)}</time>
        </div>
        <div className="as-mcard__scope-grid">
          <div>
            <strong>{scope.expenseCount}</strong>
            <span>Khoản chi</span>
          </div>
          <div>
            <strong>{scope.tripCount}</strong>
            <span>Chuyến</span>
          </div>
          <div>
            <strong>{scope.containerCount}</strong>
            <span>Container</span>
          </div>
        </div>
      </div>

      {plans.length > 0 && (
        <div className="as-mcard__plans">
          <span className="as-mcard__plans-title">Kế hoạch vận chuyển</span>
          {plans.map(plan => (
            <div className="as-mcard__plan" key={plan.tripId}>
              <div className="as-mcard__plan-head">
                <Link to={`/trips/${plan.tripId}`}>{plan.tripCode || 'Chuyến chưa có mã'}</Link>
                <strong>{plan.containerCount} cont</strong>
              </div>
              <div className="as-mcard__plan-meta">
                {plan.departureDate ? formatDate(plan.departureDate) : 'Chưa có ngày'}
                {' · '}
                {plan.customerName || 'Chưa có khách hàng'}
                {' · '}
                {plan.routeName || 'Chưa có tuyến'}
              </div>
              <div className="as-mcard__plan-costs">
                {plan.expenseBreakdown.map(item => (
                  <span key={item.code}>{item.label}: <Money value={item.amount} /></span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {canAct ? (
        <div className="as-mcard__actions">
          {canApproveReject && (
            <Link className="btn btn--primary" to={`/settlements/${s.id}`}>
              <Pencil size={16} aria-hidden="true" /> Kiểm tra &amp; hoàn tất
            </Link>
          )}
          {canApproveReject && (
            <button
              className="btn as-mcard__reject"
              onClick={() => rejectMutation.mutate({ id: s.id, expectedVersion: s.version })}
              disabled={isRejecting}
              aria-label={`Từ chối hoàn ứng ${s.code}`}
            >
              {isRejecting ? <Loader2 size={16} className="spin" /> : <XCircle size={16} />}
              Từ chối
            </button>
          )}
        </div>
      ) : (s.approverName || s.checkerName) ? (
        <div className="as-mcard__reviewer">
          <span>{s.approverName ? 'Duyệt bởi' : 'KT kiểm tra'}</span>
          <strong>{s.approverName ?? s.checkerName}</strong>
        </div>
      ) : null}
    </article>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function AdminAdvanceSettlementsPage({ embedded = false }: { embedded?: boolean }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [page, setPage] = useState(1);

  // Server-side filtering + pagination. KPI/tab counts come from the full-set
  // aggregates in the response envelope — never a client-side slice of all rows.
  const { data, isLoading } = useAdminSettlements({
    status: statusFilterParam(statusFilter),
    page,
    limit: AS_PAGE_SIZE,
  });
  const { data: balancesData } = useAdminAdvanceBalances();
  const { rootRef } = usePageAnimations({ ready: !isLoading });
  const rejectMutation = useRejectSettlement();
  const { user } = useAuth();
  const canApproveReject = user?.role === Role.ADMIN || user?.role === Role.ACCOUNTANT;

  const settlements: Settlement[] = useMemo(
    () => (data?.items ?? []) as Settlement[],
    [data],
  );
  /* ── Focus deep-link: scroll to item from ?focus=<id> ──────────────── */
  // Called for its side effect (scrolling to the focused item); return value unused.
  useFocusDeepLink('as');

  const statusCounts = data?.statusCounts ?? {};
  const statusAmounts = data?.statusAmounts ?? {};
  const totalPages = data?.totalPages ?? 1;
  const effectivePage = Math.min(page, totalPages);
  const pendingReviewCount = (statusCounts[AdvanceSettlementStatus.PENDING] ?? 0)
    + (statusCounts[AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT] ?? 0);
  const pendingReviewAmount = (statusAmounts[AdvanceSettlementStatus.PENDING] ?? 0)
    + (statusAmounts[AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT] ?? 0);

  const applyFilter = (next: StatusFilter) => {
    setStatusFilter(next);
    setPage(1);
  };

  /* ── Tab counts (full-set, from server aggregates) ────────────────────── */
  const tabCounts = useMemo<Record<string, number>>(() => {
    const fullTotal = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
    return {
      '': fullTotal,
      [AdvanceSettlementStatus.PENDING]: pendingReviewCount,
      [AdvanceSettlementStatus.APPROVED]: statusCounts[AdvanceSettlementStatus.APPROVED] ?? 0,
      [AdvanceSettlementStatus.REVERSED]: statusCounts[AdvanceSettlementStatus.REVERSED] ?? 0,
      [AdvanceSettlementStatus.REJECTED]: statusCounts[AdvanceSettlementStatus.REJECTED] ?? 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div ref={rootRef} className="as-page">
      {!embedded && (
        <PageHeader
          title="Tạm ứng & hoàn ứng"
          iconName="settlement"
          description="Kiểm tra và xử lý phiếu hoàn ứng của giao nhận theo thẩm quyền."
        />
      )}

      {/* ── KPI strip ─────────────────────────────────────────────────── */}
      <div className="as-kpi-row">
        <AsKPI
          label="Chờ xử lý"
          value={pendingReviewCount}
          meta={`${formatNumber(pendingReviewAmount)} ₫`}
          variant="warn"
          iconName="settlement"
          active={statusFilter === AdvanceSettlementStatus.PENDING}
          hasItems={pendingReviewCount > 0}
          onClick={() => applyFilter(statusFilter === AdvanceSettlementStatus.PENDING ? '' : AdvanceSettlementStatus.PENDING)}
        />
        <AsKPI
          label="Đã duyệt"
          value={statusCounts[AdvanceSettlementStatus.APPROVED] ?? 0}
          meta={`${formatNumber(statusAmounts[AdvanceSettlementStatus.APPROVED] ?? 0)} ₫`}
          variant="success"
          iconName="paid"
          active={statusFilter === AdvanceSettlementStatus.APPROVED}
          onClick={() => applyFilter(statusFilter === AdvanceSettlementStatus.APPROVED ? '' : AdvanceSettlementStatus.APPROVED)}
        />
        <AsKPI
          label="Tồn tạm ứng"
          value={balancesData?.items.length ?? 0}
          meta={`${formatNumber(balancesData ? Number(balancesData.totalOutstanding) : 0)} ₫`}
          variant="warn"
          iconName="advances"
          hasItems={(balancesData?.items.length ?? 0) > 0}
        />
      </div>

      {/* ── Card wrapper ──────────────────────────────────────────────── */}
      <div className="as-panel">
        {/* Filter tabs */}
        <Toolbar>
          {TABS.map((tab) => (
            <FilterPill
              key={tab.key}
              active={statusFilter === tab.key}
              onClick={() => applyFilter(tab.key)}
              count={tabCounts[tab.key]}
            >
              {tab.label}
            </FilterPill>
          ))}
        </Toolbar>
        <label className="as-mobile-filter">
          <span>Lọc theo trạng thái</span>
          <UuiSelectField
            id="as-status-filter"
            label="Lọc theo trạng thái"
            hideLabel
            value={statusFilter}
            onChange={(event) => applyFilter(event.target.value === 'all' ? '' : event.target.value as StatusFilter)}
            options={TABS.map((tab) => ({
              value: tab.key || 'all',
              label: `${tab.label} (${tabCounts[tab.key]})`,
            }))}
          />
        </label>

        {isLoading ? (
          <div className="as-loading">
            <Loader2 size={24} className="spin" style={{ color: 'var(--ink-3)' }} />
          </div>
        ) : settlements.length === 0 ? (
          <div className="as-empty">
            <FileText size={40} style={{ color: 'var(--ink-4)', marginBottom: 8 }} />
            <div className="as-empty-text">Không có phiếu hoàn ứng nào</div>
            <div className="as-empty-hint">Giao nhận có thể lập phiếu thanh toán từ ứng dụng</div>
          </div>
        ) : (
          <>
            {/* Desktop ledger: sticky head pins against the .app-body
                scrollport — no internal scroll region, the page scrolls. */}
            <div
              className="as-ledger-scroll"
              role="region"
              aria-label="Danh sách phiếu hoàn ứng"
              tabIndex={0}
            >
              <div className="as-ledger ops-table">
                <div className="as-grid-head">
                  <div>Ngày / Khách hàng</div>
                  <div>Kế hoạch / Phiếu</div>
                  <div className="col-center">Số cont</div>
                  <div>Tuyến đường</div>
                  <div>Chi phí theo hạng mục</div>
                  <div className="col-right">Tổng chi</div>
                  <div>Trạng thái</div>
                  <div className="col-right">Thao tác</div>
                </div>

                <div>
                  {settlements.map((s) => (
                    <SettlementGridRow
                      key={s.id}
                      s={s}
                      rejectMutation={rejectMutation}
                      focusId={`as-${s.id}`}
                      canApproveReject={canApproveReject}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Mobile: stacked cards */}
            <div className="as-cards">
              {settlements.map((s) => (
                <SettlementMobileCard
                  key={s.id}
                  s={s}
                  rejectMutation={rejectMutation}
                  focusId={`as-${s.id}`}
                  canApproveReject={canApproveReject}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer: server-side pagination */}
      {settlements.length > 0 && (
        <Pagination
          page={effectivePage}
          totalPages={totalPages}
          totalItems={data?.total ?? 0}
          pageSize={data?.limit ?? AS_PAGE_SIZE}
          onChange={setPage}
        />
      )}
    </div>
  );
}
