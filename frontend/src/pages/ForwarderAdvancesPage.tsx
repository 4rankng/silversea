import { useState, useRef, useEffect } from 'react';
import { Wallet, Loader2, Plus, X, User, AlertCircle, Clock, FileText, CheckCircle2 } from 'lucide-react';
import { formatCurrency, formatDate } from '../lib/format';
import { ADVANCE_REQUEST_STATUS_LABELS, AdvanceSettlementStatus, type AdvanceRequestStatus } from '@tingting/shared';
import type { AdvanceSettlementWithRefs } from '@tingting/shared';
import { PageHeader, FormGroup } from '../components/UI';
import { Pagination } from '../design-system';
import { useForwarderAdvanceRequestsTable, useCreateAdvanceRequest, useForwarderAdvanceBalance, useForwarderSettlements } from '../hooks/useQueries';
import { usePageAnimations, useListAnimations, useCounterAnimation } from '../hooks/animations';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import './ForwarderAdvancesPage.css';
import '../components/shared/HeroKpiRow.css';
import { AdvanceDraftActions } from '../components/shared/AdvanceDraftActions';

const STATUS_COLORS: Record<string, string> = {
  RECORDED: 'var(--success, #059669)',
  VOIDED: 'var(--danger)',
  DRAFT: 'var(--ink-muted)',
};

type StatusFilter = '' | AdvanceRequestStatus;

export default function ForwarderAdvancesPage() {
  const table = useForwarderAdvanceRequestsTable();
  const { data: envelope, isLoading: loading, error: queryError } = table.query;
  // Server-side filter — setFilter resets the page to 1 on every change.
  const activeFilter: StatusFilter = table.filters.status ?? '';
  const { data: balanceData } = useForwarderAdvanceBalance();
  // C2b/C2c — settlement (hoàn ứng) figures shown alongside advances. Buckets
  // are disjoint: "Chưa quyết toán" = requested, not yet reconciled;
  // "Đã quyết toán" = approved. Rejected settlements count in neither.
  const { data: settlementsData } = useForwarderSettlements();
  const settlements = (settlementsData?.items ?? []) as AdvanceSettlementWithRefs[];
  const pendingSettlements = settlements.filter(
    s => s.status === AdvanceSettlementStatus.DRAFT,
  );
  const recordedSettlements = settlements.filter(s => s.status === AdvanceSettlementStatus.RECORDED);
  const requestedReimbursement = pendingSettlements.reduce((sum, s) => sum + Number(s.totalExpenseAmount), 0);
  const settledPaid = recordedSettlements.reduce((sum, s) => sum + Number(s.totalExpenseAmount), 0);
  const { rootRef } = usePageAnimations({
    ready: !loading,
    selectors: ['.page-header', '.hero-kpi-row', '.fadv-form-panel', '.fwd-filter-chips', '.fadv-card-trip'],
  });
  const createAdvanceRequest = useCreateAdvanceRequest();
  const requests = table.rows;
  // Full-set aggregates (requester-scoped, status filter excluded) — pills and
  // KPIs must never derive from the current page.
  const counts = envelope?.statusCounts ?? {};
  const statusAmounts = envelope?.statusAmounts ?? {};
  const { rootRef: listRef } = useListAnimations({ itemSelector: '.fadv-card-trip', mode: 'cards', deps: [requests] });

  const [showForm, setShowForm] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [form, setForm] = useState({ amount: '', reason: '' });
  const mutationError = createAdvanceRequest.error
    ? (createAdvanceRequest.error instanceof Error ? createAdvanceRequest.error.message : 'Lỗi ghi nhận')
    : null;

  const error = queryError ? 'Không thể tải danh sách phiếu tạm ứng' : null;
  const totalRequests = Object.values(counts).reduce((sum: number, c) => sum + c, 0);
  const totalAmount = statusAmounts.RECORDED ?? 0;
  const recordedCount = counts.RECORDED ?? 0;
  const outstanding = balanceData ? Number(balanceData.outstanding) : 0;

  const prefersReduced = usePrefersReducedMotion();
  const { animateCounters } = useCounterAnimation({ duration: 1200, delay: 400 });
  const heroAmountRef = useRef<HTMLSpanElement>(null);
  const heroTotalRef = useRef<HTMLSpanElement>(null);
  const heroPendingRef = useRef<HTMLSpanElement>(null);
  const heroOutstandingRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (loading || totalRequests === 0 || prefersReduced) return;
    animateCounters([
      { el: heroAmountRef.current, value: totalAmount, format: (v: number) => Math.round(v).toLocaleString('vi-VN') },
      { el: heroTotalRef.current, value: totalRequests, suffix: ' phiếu' },
      { el: heroPendingRef.current, value: recordedCount },
      { el: heroOutstandingRef.current, value: outstanding, format: (v: number) => Math.round(v).toLocaleString('vi-VN') },
    ]);
  }, [loading, totalRequests, totalAmount, recordedCount, outstanding, animateCounters, prefersReduced]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (createAdvanceRequest.isPending) return;
    createAdvanceRequest.mutate(
      { amount: Number(form.amount), reason: form.reason },
      {
        onSuccess: () => {
          setShowForm(false);
          setForm({ amount: '', reason: '' });
        },
      },
    );
  }

  async function retryList() {
    setRetrying(true);
    try { await table.query.refetch(); } finally { setRetrying(false); }
  }

  if (loading && !retrying) return (
    <div className="fadv-page">
      <PageHeader title="Tạm ứng" description="Ghi nhận tạm ứng và theo dõi số dư" iconName="advances" />
      <div className="fadv-loading">
        <Loader2 size={20} className="spin" style={{ display: 'inline-block' }} />
        <p style={{ marginTop: 8 }}>Đang tải danh sách tạm ứng…</p>
      </div>
    </div>
  );

  if (error || retrying) return (
    <div className="fadv-page">
      <PageHeader title="Tạm ứng" description="Ghi nhận tạm ứng và theo dõi số dư" iconName="advances" />
      <div className="fadv-empty">
        <div className="fadv-empty__icon" style={{ width: 80, height: 80 }}>
          <AlertCircle size={48} />
        </div>
        <h3 className="fadv-empty__title">Không thể tải dữ liệu</h3>
        <p className="fadv-empty__desc" role="alert">{error ?? 'Đang tải lại danh sách phiếu tạm ứng…'}</p>
        <button type="button" className="btn btn--secondary" disabled={retrying || table.query.isFetching} onClick={() => void retryList()}>
          {retrying && <Loader2 size={14} className="spin" aria-hidden />}
          {retrying ? 'Đang tải lại…' : 'Thử lại'}
        </button>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="fadv-page">
      <PageHeader
        title="Tạm ứng"
        description="Ghi nhận tạm ứng và theo dõi số dư"
        iconName="advances"
        action={
          !showForm ? (
            <button className="btn btn--primary" onClick={() => setShowForm(true)}>
              <Plus size={16} /> Ghi nhận tạm ứng
            </button>
          ) : undefined
        }
      />

      {/* Hero KPI row */}
      {totalRequests > 0 && (
        <div className="hero-kpi-row">
          <div className="hero-kpi-card">
            <span className="hero-kpi-card__eyebrow">Tổng tạm ứng</span>
            <span className="hero-kpi-card__amount"><span ref={heroAmountRef}>{Math.round(totalAmount).toLocaleString('vi-VN')}</span><span className="hero-kpi-card__currency">₫</span></span>
            <span className="hero-kpi-card__subtitle">{totalRequests} phiếu tạm ứng</span>
            <Wallet size={72} className="hero-kpi-card__watermark" aria-hidden />
          </div>
          <div className="hero-kpi-stack">
            <div className="hero-kpi-mini hero-kpi-mini--accent">
              <div className="hero-kpi-mini__body">
                <span className="hero-kpi-mini__value" ref={heroOutstandingRef}>{Math.round(outstanding).toLocaleString('vi-VN')}</span>
                <span className="hero-kpi-mini__label">tồn tạm ứng (₫)</span>
              </div>
              <Wallet size={40} className="hero-kpi-mini__watermark" aria-hidden="true" />
            </div>
            <div className="hero-kpi-mini hero-kpi-mini--warn">
              <div className="hero-kpi-mini__body">
                <span className="hero-kpi-mini__value" ref={heroPendingRef}>{recordedCount}</span>
                <span className="hero-kpi-mini__label">đã ghi nhận</span>
              </div>
              <Clock size={40} className="hero-kpi-mini__watermark" aria-hidden="true" />
            </div>
          </div>
        </div>
      )}

      {/* C2b/C2c — settlement (hoàn ứng) summary: requested vs paid */}
      {settlements.length > 0 && (
        <div className="fadv-settlement-summary fade-up">
          <div className="fadv-settlement-summary__card fadv-settlement-summary__card--info">
            <span className="fadv-settlement-summary__label">Chưa quyết toán</span>
            <span className="fadv-settlement-summary__value">{formatCurrency(requestedReimbursement)}</span>
            <span className="fadv-settlement-summary__meta">{pendingSettlements.length} phiếu chờ quyết toán</span>
            <FileText size={40} className="fadv-settlement-summary__watermark" aria-hidden="true" />
          </div>
          <div className="fadv-settlement-summary__card fadv-settlement-summary__card--success">
            <span className="fadv-settlement-summary__label">Đã quyết toán</span>
            <span className="fadv-settlement-summary__value">{formatCurrency(settledPaid)}</span>
            <span className="fadv-settlement-summary__meta">{recordedSettlements.length} phiếu đã quyết toán</span>
            <CheckCircle2 size={40} className="fadv-settlement-summary__watermark" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="fadv-form-panel fade-up">
          <div className="fadv-form-panel__head">
            <div>
              <span className="fadv-form-panel__eyebrow">Phiếu mới</span>
              <h2 className="fadv-form-panel__title">
                <Wallet size={16} aria-hidden="true" />
                Ghi nhận tạm ứng
              </h2>
              <p className="fadv-form-panel__hint">Điền số tiền và lý do để ghi nhận tạm ứng.</p>
            </div>
            <button
              className="btn btn--ghost btn--sm fadv-form-panel__close"
              onClick={() => { setShowForm(false); setForm({ amount: '', reason: '' }); }}
              aria-label="Đóng biểu mẫu phiếu tạm ứng"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          {mutationError && (
            <div className="fadv-form-panel__error">{mutationError}</div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="fadv-form-panel__fields">
              <FormGroup label="Số tiền (đ)">
                <input
                  type="number"
                  min={1}
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="Ví dụ: 2.000.000"
                  required
                />
              </FormGroup>
              <FormGroup label="Lý do">
                <input
                  type="text"
                  value={form.reason}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="Nhập lý do tạm ứng"
                  required
                />
              </FormGroup>
            </div>
            <div className="fadv-form-panel__actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => { setShowForm(false); setForm({ amount: '', reason: '' }); }}
              >
                Hủy
              </button>
              <button className="btn btn--primary btn--sm" type="submit" disabled={createAdvanceRequest.isPending}>
                {createAdvanceRequest.isPending ? <Loader2 size={14} className="spin" /> : <Wallet size={14} />}
                Ghi nhận tạm ứng
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter pills */}
      {totalRequests > 0 && (
        <div className="fwd-filter-chips">
          <button
            className={`fwd-filter-chip ${activeFilter === '' ? 'fwd-filter-chip--active' : ''}`}
            onClick={() => table.setFilter('status', undefined)}
          >
            Tất cả
            <span className="fwd-filter-chip__count">{totalRequests}</span>
          </button>
          {(Object.entries(ADVANCE_REQUEST_STATUS_LABELS) as [AdvanceRequestStatus, string][]).map(([status, label]) => {
            const count = counts[status] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={status}
                className={`fwd-filter-chip ${activeFilter === status ? 'fwd-filter-chip--active' : ''}`}
                onClick={() => table.setFilter('status', activeFilter === status ? undefined : status)}
              >
                <span className="fwd-filter-chip__dot" style={{ background: STATUS_COLORS[status] }} />
                {label}
                <span className="fwd-filter-chip__count">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {totalRequests === 0 && !showForm ? (
        <div className="fadv-empty fade-up">
          <div className="fadv-empty__icon">
            <Wallet size={64} />
          </div>
          <h3 className="fadv-empty__title">Chưa có phiếu tạm ứng</h3>
          <p className="fadv-empty__desc">
            Nhấn "Ghi nhận tạm ứng" để gửi phiếu tạm ứng mới.
          </p>
        </div>
      ) : (
        <>
        <div ref={listRef} className="fadv-list">
          {requests.map((req, idx) => (
            <div
              key={req.id}
              className="fadv-card-trip fade-up"
              data-status={req.status}
              style={{
                animationDelay: `${idx * 50}ms`,
              }}
            >
              <div className="fadv-card-trip__body">
                <div className="fadv-card-trip__icon"><Wallet size={16} /></div>
                <div className="fadv-card-trip__main">
                  <div className="fadv-card-trip__head">
                    <span className="fadv-card-trip__amount">
                      {formatCurrency(Number(req.amount))}
                    </span>
                    <span className="fadv-card-trip__date">{formatDate(req.createdAt)}</span>
                    {/* Per-record status (QA-041): every row names its own
                        state with the shared vocabulary — no filter-switching
                        or approver-metadata inference required. */}
                    <span className={`fadv-card-trip__status is-${req.status.toLowerCase()}`}>
                      {ADVANCE_REQUEST_STATUS_LABELS[req.status]}
                    </span>
                  </div>
                  <div className="fadv-card-trip__reason">{req.reason}</div>
                  <AdvanceDraftActions request={req} />
                </div>
                {req.approverName && req.approvedAt && (
                  <div className="fadv-card-trip__approver">
                    <User size={12} />
                    <span>Người ghi nhận: {req.approverName}</span>
                    <span className="fadv-card-trip__meta-sep">·</span>
                    <span>{formatDate(req.approvedAt)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {table.total > 0 && (
          <Pagination
            page={table.page}
            totalPages={table.totalPages}
            totalItems={table.total}
            pageSize={table.pageSize}
            onChange={table.setPage}
          />
        )}
        </>
      )}
    </div>
  );
}
