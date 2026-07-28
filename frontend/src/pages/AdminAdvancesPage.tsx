import { useMemo, useState } from 'react';
import { Loader2, Wallet, CheckCircle2, XCircle } from 'lucide-react';
import { usePageAnimations } from '../hooks/animations';
import { formatCurrency, formatNumber, formatDate } from '../lib/format';
import {
  ADVANCE_REQUEST_STATUS_LABELS,
  AdvanceRequestStatus,
} from '@tingting/shared';
import { PageHeader, StatusPill, Toolbar, FilterPill } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { AssetIcon, type AssetIconName } from '../components/AssetIcon';
import {
  useAdminAdvanceRequests,
  useAdminAdvanceBalances,
  useApproveAdvanceRequest,
  useRejectAdvanceRequest,
} from '../hooks/useQueries';
import { advanceRequestStatusVariant } from '../lib/status-variants';
import { useFocusDeepLink } from '../hooks/useFocusDeepLink';
import './AdminAdvancesPage.css';
import { resolveEmptyIllustration } from '../lib/emptyIllustrations';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface AdvanceRequest {
  id: number;
  version: number;
  requesterName: string | null;
  requesterId: number;
  amount: number | string;
  createdAt: string;
  status: AdvanceRequestStatus;
  reason: string | null;
  approverName: string | null;
}

type StatusFilter = '' | AdvanceRequestStatus;

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
  return (
    <div
      className={`adv-kpi adv-kpi--${variant}${active ? ' is-active' : ''}${hasItems ? ' has-items' : ''}${interactive ? '' : ' adv-kpi--static'}`}
      {...(interactive
        ? { onClick, role: 'button', tabIndex: 0, onKeyDown: (e: import('react').KeyboardEvent) => e.key === 'Enter' && onClick() }
        : { 'aria-hidden': false })}
    >
      <div className="adv-kpi__label">{label}</div>
      <div className="adv-kpi__value">{value}</div>
      <div className="adv-kpi__meta">{meta}</div>
      <AssetIcon name={iconName} size={58} className="adv-kpi__asset" />
    </div>
  );
}

/* ── Desktop grid row ──────────────────────────────────────────────────── */

function AdvanceGridRow({
  req,
  approveMutation,
  rejectMutation,
  focusId,
}: {
  req: AdvanceRequest;
  approveMutation: ReturnType<typeof useApproveAdvanceRequest>;
  rejectMutation: ReturnType<typeof useRejectAdvanceRequest>;
  focusId?: string;
}) {
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
          {req.requesterName || `Đối tác ${req.requesterId}`}
        </span>
      </div>

      {/* Amount */}
      <div className="adv-amount">
        {formatCurrency(Number(req.amount))}
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
        {isPending ? (
          <>
            <button
              className="btn btn--ghost btn--icon btn--sm"
              onClick={() => approveMutation.mutate({ id: req.id, expectedVersion: req.version })}
              disabled={isApproving || isRejecting}
              title="Duyệt yêu cầu"
              style={{ color: 'var(--success)' }}
            >
              {isApproving ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
            </button>
            <button
              className="btn btn--ghost btn--icon btn--sm"
              onClick={() => rejectMutation.mutate({ id: req.id, expectedVersion: req.version })}
              disabled={isApproving || isRejecting}
              title="Từ chối yêu cầu"
              style={{ color: 'var(--danger)' }}
            >
              {isRejecting ? <Loader2 size={16} className="spin" /> : <XCircle size={16} />}
            </button>
          </>
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
}: {
  req: AdvanceRequest;
  approveMutation: ReturnType<typeof useApproveAdvanceRequest>;
  rejectMutation: ReturnType<typeof useRejectAdvanceRequest>;
  focusId?: string;
}) {
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
            {req.requesterName || `Đối tác ${req.requesterId}`}
          </span>
        </div>
        <StatusPill variant={advanceRequestStatusVariant(req.status)}>
          {ADVANCE_REQUEST_STATUS_LABELS[req.status]}
        </StatusPill>
      </div>

      {/* Amount — prominent */}
      <div className="adv-mcard__amount">
        {formatCurrency(Number(req.amount))}
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
      {isPending ? (
        <div className="adv-mcard__actions">
          <button
            className="btn btn--primary"
            onClick={() => approveMutation.mutate({ id: req.id, expectedVersion: req.version })}
            disabled={isApproving || isRejecting}
          >
            {isApproving ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
            Duyệt
          </button>
          <button
            className="btn btn--danger"
            onClick={() => rejectMutation.mutate({ id: req.id, expectedVersion: req.version })}
            disabled={isApproving || isRejecting}
          >
            {isRejecting ? <Loader2 size={16} className="spin" /> : <XCircle size={16} />}
            Từ chối
          </button>
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

export default function AdminAdvancesPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');

  // Fetch ALL requests once — client-side filtering for accurate counts/totals
  const { data, isLoading } = useAdminAdvanceRequests();
  const { data: balancesData } = useAdminAdvanceBalances();
  const { rootRef } = usePageAnimations({ ready: !isLoading });
  const approveMutation = useApproveAdvanceRequest();
  const rejectMutation = useRejectAdvanceRequest();

  const allRequests: AdvanceRequest[] = useMemo(
    () => (data?.items ?? []) as AdvanceRequest[],
    [data],
  );

  /* ── Focus deep-link: scroll to item from ?focus=<id> ──────────────── */
  // Called for its side effect (scrolling to the focused item); return value unused.
  useFocusDeepLink('adv');

  /* ── Derived counts & totals ─────────────────────────────────────────── */
  const stats = useMemo(() => {
    const counts: Record<string, number> = { total: 0, [AdvanceRequestStatus.PENDING]: 0, [AdvanceRequestStatus.APPROVED]: 0, [AdvanceRequestStatus.REJECTED]: 0 };
    const totals: Record<string, number> = { [AdvanceRequestStatus.PENDING]: 0, [AdvanceRequestStatus.APPROVED]: 0, [AdvanceRequestStatus.REJECTED]: 0 };

    for (const req of allRequests) {
      counts.total++;
      const s = req.status as string;
      if (s in counts) counts[s]++;
      const amt = Number(req.amount) || 0;
      if (s in totals) totals[s] += amt;
    }
    return { counts, totals };
  }, [allRequests]);

  const filtered = useMemo(() => {
    if (!statusFilter) return allRequests;
    return allRequests.filter((r) => r.status === statusFilter);
  }, [allRequests, statusFilter]);

  /* ── Tab counts ──────────────────────────────────────────────────────── */
  const tabCounts = useMemo(() => ({
    '': stats.counts.total,
    [AdvanceRequestStatus.PENDING]: stats.counts.PENDING,
    [AdvanceRequestStatus.APPROVED]: stats.counts.APPROVED,
    [AdvanceRequestStatus.REJECTED]: stats.counts.REJECTED,
  }), [stats]);

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div ref={rootRef} className="adv-page">
      <Breadcrumbs
        className="adv-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Tạm ứng' },
        ]}
      />
      <PageHeader
        title="Quản lý tạm ứng"
        iconName="advances"
        description="Duyệt hoặc từ chối yêu cầu tạm ứng"
      />

      {/* ── KPI strip ─────────────────────────────────────────────────── */}
      <div className="adv-kpi-row">
        <AdvKPI
          label="Chờ duyệt"
          value={stats.counts.PENDING}
          meta={`${formatNumber(stats.totals.PENDING)} ₫`}
          variant="warn"
          iconName="advances"
          active={statusFilter === AdvanceRequestStatus.PENDING}
          hasItems={stats.counts.PENDING > 0}
          onClick={() => setStatusFilter(statusFilter === AdvanceRequestStatus.PENDING ? '' : AdvanceRequestStatus.PENDING)}
        />
        <AdvKPI
          label="Đã duyệt"
          value={stats.counts.APPROVED}
          meta={`${formatNumber(stats.totals.APPROVED)} ₫`}
          variant="success"
          iconName="paid"
          active={statusFilter === AdvanceRequestStatus.APPROVED}
          onClick={() => setStatusFilter(statusFilter === AdvanceRequestStatus.APPROVED ? '' : AdvanceRequestStatus.APPROVED)}
        />
        <AdvKPI
          label="Từ chối"
          value={stats.counts.REJECTED}
          meta={`${formatNumber(stats.totals.REJECTED)} ₫`}
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

        {isLoading ? (
          <div className="adv-loading">
            <Loader2 size={24} className="spin" style={{ color: 'var(--ink-3)' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="adv-empty">
            <img src={resolveEmptyIllustration('empty-advances')} alt="" aria-hidden="true" style={{ width: 160, height: 132, objectFit: 'contain', marginBottom: 4 }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <div className="adv-empty-text">Không có yêu cầu tạm ứng nào</div>
            <div className="adv-empty-hint">Giao nhận có thể gửi yêu cầu từ ứng dụng di động</div>
          </div>
        ) : (
          <>
            {/* Desktop: grid header + rows */}
            <div className="adv-grid-head">
              <div>Người yêu cầu</div>
              <div className="col-right">Số tiền</div>
              <div className="col-center">Ngày tạo</div>
              <div>Trạng thái</div>
              <div>Lý do</div>
              <div />
            </div>

            <div>
              {filtered.map((req) => (
                <AdvanceGridRow
                  key={req.id}
                  req={req}
                  approveMutation={approveMutation}
                  rejectMutation={rejectMutation}
                  focusId={`adv-${req.id}`}
                />
              ))}
            </div>

            {/* Mobile: stacked cards */}
            <div className="adv-cards">
              {filtered.map((req) => (
                <AdvanceMobileCard
                  key={req.id}
                  req={req}
                  approveMutation={approveMutation}
                  rejectMutation={rejectMutation}
                  focusId={`adv-${req.id}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer count */}
      {filtered.length > 0 && (
        <div className="adv-footer">
          {filtered.length} yêu cầu tạm ứng
        </div>
      )}
    </div>
  );
}
