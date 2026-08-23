import { useState } from 'react';
import { Loader2, Wallet, CheckCircle2, XCircle, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { usePageAnimations } from '../hooks/animations';
import { formatNumber, formatDate } from '../lib/format';
import {
  ADVANCE_REQUEST_STATUS_LABELS,
  AdvanceRequestStatus,
  Role,
  type AdvanceRequestWithRefs,
} from '@tingting/shared';
import { PageHeader, StatusPill, Toolbar, FilterPill } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { AssetIcon, type AssetIconName } from '../components/AssetIcon';
import { Money } from '../components/shared/Money';
import {
  useAdminAdvanceBalances,
  useApproveAdvanceRequest,
  useRejectAdvanceRequest,
} from '../hooks/useQueries';
import { forwarderClient } from '../api/forwarderClient';
import { qk } from '../api/keys';
import { advanceRequestStatusVariant } from '../lib/status-variants';
import { useFocusDeepLink } from '../hooks/useFocusDeepLink';
import { useAuth } from '../hooks/useAuth';
import { Pagination, UuiSelectField } from '../design-system';
import { useTableQueryState } from '../design-system/hooks/useTableQueryState';
import { nextTableSort, type TableSortState } from '../lib/table-sort';
import './AdminAdvancesPage.css';
import '../styles/table-sort.css';
import '../styles/operational-table-typography.css';
import { resolveEmptyIllustration } from '../lib/emptyIllustrations';

/* ── Types ─────────────────────────────────────────────────────────────── */

type AdvanceRequest = AdvanceRequestWithRefs;

interface AdvanceListEnvelope {
  items: AdvanceRequest[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** Full-set counts per status (status filter excluded) — KPIs/pills. */
  statusCounts: Record<string, number>;
  /** Full-set amount totals per status — KPI meta lines. */
  statusAmounts: Record<string, number>;
}

export function buildAdvanceDecision(
  request: Pick<AdvanceRequest, 'id' | 'version'>,
  reason: string,
): { id: number; expectedVersion: number; reason: string } | null {
  const normalizedReason = reason.trim();
  return normalizedReason
    ? { id: request.id, expectedVersion: request.version, reason: normalizedReason }
    : null;
}

type StatusFilter = '' | AdvanceRequestStatus;

/** Server-side sort vocabulary for the advance grid (backend whitelist keys). */
type AdvanceSortKey = 'requesterName' | 'amount' | 'createdAt' | 'status' | 'reason';

/** Sortable header cell for the div-based grid header — same button contract
 * as the record-table/DataTable sort headers (table-sort.css). The grid is
 * not table markup, so sort state is conveyed by the icon, not aria-sort. */
function GridSortHeader({
  label,
  sortKey,
  sort,
  onSortChange,
  align,
}: {
  label: string;
  sortKey: AdvanceSortKey;
  sort: TableSortState | null;
  onSortChange: (key: string) => void;
  align?: 'right' | 'center';
}) {
  const active = sort?.by === sortKey;
  return (
    <div className={align === 'right' ? 'col-right' : align === 'center' ? 'col-center' : undefined}>
      <button type="button" className="table-sort-button" onClick={() => onSortChange(sortKey)}>
        {label}
        {active
          ? (sort!.dir === 'asc'
            ? <ArrowUp size={13} aria-hidden="true" />
            : <ArrowDown size={13} aria-hidden="true" />)
          : <ArrowUpDown size={13} aria-hidden="true" className="table-sort-button__icon--idle" />}
      </button>
    </div>
  );
}

const TABS: { key: StatusFilter; label: string }[] = [
  { key: '', label: 'Tất cả' },
  { key: AdvanceRequestStatus.PENDING, label: 'Chờ duyệt' },
  { key: AdvanceRequestStatus.APPROVED, label: 'Đã duyệt' },
  { key: AdvanceRequestStatus.REJECTED, label: 'Từ chối' },
];

/* ── Compact KPI card — matches dashboard .wf-kpi proportions ─────────── */

interface AdvKPIProps {
  label: string;
  value: number;
  meta: string;
  variant: 'warn' | 'success' | 'danger';
  iconName: AssetIconName;
  active?: boolean;
  hasItems?: boolean;
  // Omit onClick for a summary-only stat (no filter to toggle). Renders as a
  // non-interactive element instead of a dead role="button" in the tab order.
  onClick?: () => void;
}

function AdvKPI({ label, value, meta, variant, iconName, active = false, hasItems = false, onClick }: AdvKPIProps) {
  const interactive = typeof onClick === 'function';
  const content = (
    <>
      <div className="adv-kpi__label">{label}</div>
      <div className="adv-kpi__value">{value}</div>
      <div className="adv-kpi__meta">{meta}</div>
      <AssetIcon name={iconName} size={58} className="adv-kpi__asset" />
    </>
  );
  const className = `adv-kpi adv-kpi--${variant}${active ? ' is-active' : ''}${hasItems ? ' has-items' : ''}${interactive ? '' : ' adv-kpi--static'}`;

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

function AdvanceGridRow({
  req,
  approveMutation,
  rejectMutation,
  focusId,
  canPropose,
}: {
  req: AdvanceRequest;
  approveMutation: ReturnType<typeof useApproveAdvanceRequest>;
  rejectMutation: ReturnType<typeof useRejectAdvanceRequest>;
  focusId?: string;
  canPropose: boolean;
}) {
  const [decisionReason, setDecisionReason] = useState('');
  const isApproving = approveMutation.isPending && approveMutation.variables?.id === req.id;
  const isRejecting = rejectMutation.isPending && rejectMutation.variables?.id === req.id;
  const isPending = req.status === AdvanceRequestStatus.PENDING;

  return (
    <div className="adv-grid-row" id={focusId}>
      {/* Requester */}
      <div className="adv-requester">
        <div className="adv-avatar">
          <Wallet size={16} />
        </div>
        <span className="adv-requester-name">
          {req.requesterName || 'Đối tác không còn trong danh sách'}
        </span>
      </div>

      {/* Amount */}
      <div className="adv-amount">
        <Money value={Number(req.amount)} />
      </div>

      {/* Date */}
      <div className="adv-date">
        {formatDate(req.createdAt)}
      </div>

      {/* Status */}
      <div>
        <StatusPill variant={advanceRequestStatusVariant(req.status)}>
          {ADVANCE_REQUEST_STATUS_LABELS[req.status]}
        </StatusPill>
      </div>

      {/* Reason */}
      <div className="adv-reason">{req.reason}</div>

      {/* Actions / Approver */}
      <div className="adv-actions">
        {isPending && canPropose ? (
          <>
            <input
              className="form-input"
              aria-label={`Lý do xử lý đề nghị của ${req.requesterName || 'đối tác không xác định'}`}
              value={decisionReason}
              onChange={(event) => setDecisionReason(event.target.value)}
              placeholder="Lý do đề nghị"
            />
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              onClick={() => approveMutation.mutate(buildAdvanceDecision(req, decisionReason)!)}
              disabled={isApproving || isRejecting || !buildAdvanceDecision(req, decisionReason)}
              title="Gửi đề nghị duyệt"
              aria-label={`Gửi đề nghị duyệt cho ${req.requesterName || 'đối tác không xác định'}`}
              style={{ color: 'var(--success)' }}
            >
              {isApproving ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              onClick={() => rejectMutation.mutate(buildAdvanceDecision(req, decisionReason)!)}
              disabled={isApproving || isRejecting || !buildAdvanceDecision(req, decisionReason)}
              title="Gửi đề nghị từ chối"
              aria-label={`Gửi đề nghị từ chối cho ${req.requesterName || 'đối tác không xác định'}`}
              style={{ color: 'var(--danger)' }}
            >
              {isRejecting ? <Loader2 size={16} className="spin" /> : <XCircle size={16} />}
            </button>
          </>
        ) : isPending ? (
          <span className="adv-readonly-state">Chỉ có quyền xem</span>
        ) : req.approverName ? (
          <div className="adv-approver">
            bởi <strong>{req.approverName}</strong>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Mobile card ───────────────────────────────────────────────────────── */

function AdvanceMobileCard({
  req,
  approveMutation,
  rejectMutation,
  focusId,
  canPropose,
}: {
  req: AdvanceRequest;
  approveMutation: ReturnType<typeof useApproveAdvanceRequest>;
  rejectMutation: ReturnType<typeof useRejectAdvanceRequest>;
  focusId?: string;
  canPropose: boolean;
}) {
  const [decisionReason, setDecisionReason] = useState('');
  const isApproving = approveMutation.isPending && approveMutation.variables?.id === req.id;
  const isRejecting = rejectMutation.isPending && rejectMutation.variables?.id === req.id;
  const isPending = req.status === AdvanceRequestStatus.PENDING;

  return (
    <div className="adv-mcard" id={focusId}>
      {/* Top: avatar + name + status */}
      <div className="adv-mcard__top">
        <div className="adv-mcard__left">
          <div className="adv-mcard__avatar">
            <Wallet size={16} />
          </div>
          <span className="adv-mcard__name">
            {req.requesterName || 'Đối tác không còn trong danh sách'}
          </span>
        </div>
        <StatusPill variant={advanceRequestStatusVariant(req.status)}>
          {ADVANCE_REQUEST_STATUS_LABELS[req.status]}
        </StatusPill>
      </div>

      {/* Amount — prominent */}
      <div className="adv-mcard__amount">
        <Money value={Number(req.amount)} />
      </div>

      {/* Meta: date + reason */}
      <div className="adv-mcard__meta">
        <div className="adv-mcard__meta-row">
          <span className="adv-mcard__meta-label">Ngày tạo</span>
          <span className="adv-mcard__meta-value">{formatDate(req.createdAt)}</span>
        </div>
        {req.reason && (
          <div className="adv-mcard__meta-row">
            <span className="adv-mcard__meta-label">Lý do</span>
            <span className="adv-mcard__meta-value">{req.reason}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      {isPending && canPropose ? (
        <div className="adv-mcard__actions">
          <label className="adv-decision-reason">
            <span>Lý do đề nghị</span>
            <input
              className="form-input"
              value={decisionReason}
              onChange={(event) => setDecisionReason(event.target.value)}
              placeholder="Nhập căn cứ xử lý"
            />
          </label>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => approveMutation.mutate(buildAdvanceDecision(req, decisionReason)!)}
            disabled={isApproving || isRejecting || !buildAdvanceDecision(req, decisionReason)}
          >
            {isApproving ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
            Gửi đề nghị duyệt
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => rejectMutation.mutate(buildAdvanceDecision(req, decisionReason)!)}
            disabled={isApproving || isRejecting || !buildAdvanceDecision(req, decisionReason)}
          >
            {isRejecting ? <Loader2 size={16} className="spin" /> : <XCircle size={16} />}
            Gửi đề nghị từ chối
          </button>
        </div>
      ) : isPending ? (
        <div className="adv-readonly-state adv-readonly-state--mobile">
          Bạn chỉ có quyền xem yêu cầu này.
        </div>
      ) : req.approverName ? (
        <div className="adv-mcard__meta-row" style={{ marginTop: 4 }}>
          <span className="adv-mcard__meta-label">Duyệt bởi</span>
          <span className="adv-mcard__meta-value" style={{ fontWeight: 600, color: 'var(--ink)' }}>
            {req.approverName}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function AdminAdvancesPage({ embedded = false }: { embedded?: boolean }) {
  // Server-driven listing: page/limit/status go to the endpoint, so no silent
  // 50-row cap; counts/amounts come from the full-set envelope aggregates.
  // sortBy/sortDir ride the filters bag so every sort change resets the page.
  const table = useTableQueryState<
    AdvanceRequest,
    { status?: string; sortBy?: AdvanceSortKey; sortDir?: 'asc' | 'desc' },
    AdvanceListEnvelope
  >({
    endpoint: forwarderClient.listAllAdvanceRequests,
    queryKey: qk.adminForwarder.advanceRequestsAll,
    defaultPageSize: 50,
  });
  const { data: balancesData } = useAdminAdvanceBalances();
  const { rootRef } = usePageAnimations({ ready: !table.isLoading });
  const approveMutation = useApproveAdvanceRequest();
  const rejectMutation = useRejectAdvanceRequest();
  const { user } = useAuth();
  const canPropose = user?.role === Role.ADMIN || user?.role === Role.MANAGER;

  const statusFilter = (table.filters.status ?? '') as StatusFilter;
  const setStatusFilter = (next: StatusFilter) => {
    table.setFilter('status', next === '' ? undefined : next);
  };

  const sort: TableSortState | null = table.filters.sortBy
    ? { by: table.filters.sortBy, dir: table.filters.sortDir ?? 'asc' }
    : null;
  const handleSort = (key: string) => {
    const next = nextTableSort(sort, key);
    table.setFilters({
      ...table.filters,
      sortBy: next.by as AdvanceSortKey,
      sortDir: next.dir,
    });
  };

  /* ── Focus deep-link: scroll to item from ?focus=<id> ──────────────── */
  // Called for its side effect (scrolling to the focused item); return value unused.
  useFocusDeepLink('adv');

  /* ── Full-set counts & amounts from the server envelope ─────────────── */
  const statusCounts = table.query.data?.statusCounts ?? {};
  const statusAmounts = table.query.data?.statusAmounts ?? {};
  const countOf = (status: AdvanceRequestStatus) => statusCounts[status] ?? 0;
  const amountOf = (status: AdvanceRequestStatus) => statusAmounts[status] ?? 0;
  const totalCount =
    countOf(AdvanceRequestStatus.PENDING) +
    countOf(AdvanceRequestStatus.APPROVED) +
    countOf(AdvanceRequestStatus.REJECTED);

  const tabCounts: Record<StatusFilter, number> = {
    '': totalCount,
    [AdvanceRequestStatus.PENDING]: countOf(AdvanceRequestStatus.PENDING),
    [AdvanceRequestStatus.APPROVED]: countOf(AdvanceRequestStatus.APPROVED),
    [AdvanceRequestStatus.REJECTED]: countOf(AdvanceRequestStatus.REJECTED),
  };

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div ref={rootRef} className="adv-page">
      {!embedded && (
        <>
          <Breadcrumbs
            className="adv-page__crumbs"
            items={[
              { label: 'Tổng quan', to: '/dashboard' },
              { label: 'Tạm ứng & hoàn ứng' },
            ]}
          />
          <PageHeader
            title="Tạm ứng & hoàn ứng"
            iconName="advances"
            description="Xem yêu cầu tạm ứng và gửi đề nghị vào Trung tâm phê duyệt."
          />
        </>
      )}

      {/* ── KPI strip ─────────────────────────────────────────────────── */}
      <div className="adv-kpi-row">
        <AdvKPI
          label="Chờ duyệt"
          value={countOf(AdvanceRequestStatus.PENDING)}
          meta={`${formatNumber(amountOf(AdvanceRequestStatus.PENDING))} ₫`}
          variant="warn"
          iconName="advances"
          active={statusFilter === AdvanceRequestStatus.PENDING}
          hasItems={countOf(AdvanceRequestStatus.PENDING) > 0}
          onClick={() => setStatusFilter(statusFilter === AdvanceRequestStatus.PENDING ? '' : AdvanceRequestStatus.PENDING)}
        />
        <AdvKPI
          label="Đã duyệt"
          value={countOf(AdvanceRequestStatus.APPROVED)}
          meta={`${formatNumber(amountOf(AdvanceRequestStatus.APPROVED))} ₫`}
          variant="success"
          iconName="paid"
          active={statusFilter === AdvanceRequestStatus.APPROVED}
          onClick={() => setStatusFilter(statusFilter === AdvanceRequestStatus.APPROVED ? '' : AdvanceRequestStatus.APPROVED)}
        />
        <AdvKPI
          label="Từ chối"
          value={countOf(AdvanceRequestStatus.REJECTED)}
          meta={`${formatNumber(amountOf(AdvanceRequestStatus.REJECTED))} ₫`}
          variant="danger"
          iconName="unpaid"
          active={statusFilter === AdvanceRequestStatus.REJECTED}
          onClick={() => setStatusFilter(statusFilter === AdvanceRequestStatus.REJECTED ? '' : AdvanceRequestStatus.REJECTED)}
        />
        <AdvKPI
          label="Tồn tạm ứng"
          value={balancesData?.items.length ?? 0}
          meta={`${formatNumber(balancesData ? Number(balancesData.totalOutstanding) : 0)} ₫`}
          variant="success"
          iconName="cashflow"
          hasItems={(balancesData?.items.length ?? 0) > 0}
        />
      </div>

      {/* ── Card wrapper ──────────────────────────────────────────────── */}
      <div className="adv-panel">
        {/* Filter tabs */}
        <Toolbar>
          {TABS.map((tab) => (
            <FilterPill
              key={tab.key}
              active={statusFilter === tab.key}
              onClick={() => setStatusFilter(tab.key)}
              count={tabCounts[tab.key]}
            >
              {tab.label}
            </FilterPill>
          ))}
        </Toolbar>
        <label className="adv-mobile-filter">
          <span>Lọc theo trạng thái</span>
          <UuiSelectField
            id="adv-status-filter"
            label="Lọc theo trạng thái"
            hideLabel
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            options={TABS.map((tab) => ({
              value: tab.key || 'all',
              label: `${tab.label} (${tabCounts[tab.key]})`,
            }))}
          />
        </label>

        {table.isLoading ? (
          <div className="adv-loading">
            <Loader2 size={24} className="spin" style={{ color: 'var(--ink-3)' }} />
          </div>
        ) : table.rows.length === 0 ? (
          <div className="adv-empty">
            <img src={resolveEmptyIllustration('empty-advances')} alt="" aria-hidden="true" style={{ width: 160, height: 132, objectFit: 'contain', marginBottom: 4 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div className="adv-empty-text">Không có yêu cầu tạm ứng nào</div>
            <div className="adv-empty-hint">Giao nhận có thể gửi yêu cầu từ ứng dụng di động</div>
          </div>
        ) : (
          <>
            {/* Desktop: grid header + rows */}
            <div className="adv-grid-head ops-table">
              <GridSortHeader label="Người yêu cầu" sortKey="requesterName" sort={sort} onSortChange={handleSort} />
              <GridSortHeader label="Số tiền" sortKey="amount" sort={sort} onSortChange={handleSort} align="right" />
              <GridSortHeader label="Ngày tạo" sortKey="createdAt" sort={sort} onSortChange={handleSort} align="center" />
              <GridSortHeader label="Trạng thái" sortKey="status" sort={sort} onSortChange={handleSort} />
              <GridSortHeader label="Lý do" sortKey="reason" sort={sort} onSortChange={handleSort} />
              <div />
            </div>

            <div>
              {table.rows.map((req) => (
                <AdvanceGridRow
                  key={req.id}
                  req={req}
                  approveMutation={approveMutation}
                  rejectMutation={rejectMutation}
                  focusId={`adv-${req.id}`}
                  canPropose={canPropose}
                />
              ))}
            </div>

            {/* Mobile: stacked cards */}
            <div className="adv-cards">
              {table.rows.map((req) => (
                <AdvanceMobileCard
                  key={req.id}
                  req={req}
                  approveMutation={approveMutation}
                  rejectMutation={rejectMutation}
                  focusId={`adv-${req.id}`}
                  canPropose={canPropose}
                />
              ))}
            </div>

            <Pagination
              page={table.page}
              totalPages={table.totalPages}
              totalItems={table.total}
              pageSize={table.pageSize}
              onChange={table.setPage}
            />
          </>
        )}
      </div>
    </div>
  );
}
