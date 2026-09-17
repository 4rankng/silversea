import { Loader2, Wallet, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { usePageAnimations } from '../hooks/animations';
import { formatNumber, formatDate } from '../lib/format';
import {
  ADVANCE_REQUEST_STATUS_LABELS,
  AdvanceRequestStatus,
  type AdvanceRequestWithRefs,
} from '@tingting/shared';
import { PageHeader, StatusPill, Toolbar, FilterPill } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Money } from '../components/shared/Money';
import { useAdminAdvanceBalances } from '../hooks/useQueries';
import { forwarderClient } from '../api/forwarderClient';
import { qk } from '../api/keys';
import { advanceRequestStatusVariant } from '../lib/status-variants';
import { useFocusDeepLink } from '../hooks/useFocusDeepLink';
import { Pagination, UuiSelectField } from '../design-system';
import { useTableQueryState } from '../design-system/hooks/useTableQueryState';
import { nextTableSort, type TableSortState } from '../lib/table-sort';
import './AdminAdvancesPage.css';
import '../styles/table-sort.css';
import '../styles/operational-table-typography.css';
import { resolveEmptyIllustration } from '../lib/emptyIllustrations';
import { AdvanceDraftActions } from '../components/shared/AdvanceDraftActions';

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

// Direct-effect vocabulary (QA-113): saves apply immediately, so the old
// legacy unresolved records stay DRAFT and do not contribute to posted balances.
const TABS: { key: StatusFilter; label: string }[] = [
  { key: '', label: 'Tất cả' },
  { key: AdvanceRequestStatus.RECORDED, label: 'Đã ghi nhận' },
  { key: AdvanceRequestStatus.DRAFT, label: 'Chưa ghi sổ' },
  { key: AdvanceRequestStatus.VOIDED, label: 'Đã hủy' },
];

/* ── Compact KPI card — matches dashboard .wf-kpi proportions ─────────── */

interface AdvKPIProps {
  label: string;
  value: number;
  meta: string;
  variant: 'warn' | 'success' | 'danger';
  active?: boolean;
  hasItems?: boolean;
  // Omit onClick for a summary-only stat (no filter to toggle). Renders as a
  // non-interactive element instead of a dead role="button" in the tab order.
  onClick?: () => void;
}

function AdvKPI({ label, value, meta, variant, active = false, hasItems = false, onClick }: AdvKPIProps) {
  const interactive = typeof onClick === 'function';
  const content = (
    <>
      <div className="adv-kpi__label">{label}</div>
      <div className="adv-kpi__value">{value}</div>
      <div className="adv-kpi__meta">{meta}</div>
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
  focusId,
}: {
  req: AdvanceRequest;
  focusId?: string;
}) {
  const isDraft = req.status === 'DRAFT';

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

      {/* Direct-effect save: no approve/reject handoff remains. Legacy
          PENDING rows (pre-removal data) render read-only. */}
      <div className="adv-actions">
        {isDraft ? (
          <AdvanceDraftActions request={req} />
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
  focusId,
}: {
  req: AdvanceRequest;
  focusId?: string;
}) {
  const isDraft = req.status === 'DRAFT';

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

      {/* Actions — direct-effect save: no approve/reject handoff remains. */}
      {isDraft ? (
        <div className="adv-readonly-state adv-readonly-state--mobile">
          <AdvanceDraftActions request={req} />
        </div>
      ) : req.approverName ? (
        <div className="adv-mcard__meta-row" style={{ marginTop: 4 }}>
          <span className="adv-mcard__meta-label">Người ghi nhận</span>
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
    countOf(AdvanceRequestStatus.RECORDED) +
    countOf(AdvanceRequestStatus.DRAFT) +
    countOf(AdvanceRequestStatus.VOIDED);

  const tabCounts: Record<StatusFilter, number> = {
    '': totalCount,
    [AdvanceRequestStatus.DRAFT]: countOf(AdvanceRequestStatus.DRAFT),
    [AdvanceRequestStatus.RECORDED]: countOf(AdvanceRequestStatus.RECORDED),
    [AdvanceRequestStatus.VOIDED]: countOf(AdvanceRequestStatus.VOIDED),
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
            description="Xem và quản lý yêu cầu tạm ứng."
          />
        </>
      )}

      {/* ── KPI strip ─────────────────────────────────────────────────── */}
      <div className="adv-kpi-row">
        <AdvKPI
          label="Đã ghi nhận"
          value={countOf(AdvanceRequestStatus.RECORDED)}
          meta={`${formatNumber(amountOf(AdvanceRequestStatus.RECORDED))} ₫`}
          variant="success"
          active={statusFilter === AdvanceRequestStatus.RECORDED}
          onClick={() => setStatusFilter(statusFilter === AdvanceRequestStatus.RECORDED ? '' : AdvanceRequestStatus.RECORDED)}
        />
        <AdvKPI
          label="Đã hủy"
          value={countOf(AdvanceRequestStatus.VOIDED)}
          meta={`${formatNumber(amountOf(AdvanceRequestStatus.VOIDED))} ₫`}
          variant="danger"
          active={statusFilter === AdvanceRequestStatus.VOIDED}
          onClick={() => setStatusFilter(statusFilter === AdvanceRequestStatus.VOIDED ? '' : AdvanceRequestStatus.VOIDED)}
        />
        <AdvKPI
          label="Tồn tạm ứng"
          value={balancesData?.items.length ?? 0}
          meta={`${formatNumber(balancesData ? Number(balancesData.totalOutstanding) : 0)} ₫`}
          variant="success"
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
              value: tab.key,
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
                  focusId={`adv-${req.id}`}
                />
              ))}
            </div>

            {/* Mobile: stacked cards */}
            <div className="adv-cards">
              {table.rows.map((req) => (
                <AdvanceMobileCard
                  key={req.id}
                  req={req}
                  focusId={`adv-${req.id}`}
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
