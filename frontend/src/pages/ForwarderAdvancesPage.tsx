import { useState, useRef, useEffect } from 'react';
import { Wallet, Loader2, Plus, X, User, AlertCircle, Clock, FileText, CheckCircle2 } from 'lucide-react';
import { formatCurrency, formatDate } from '../lib/format';
import { ADVANCE_REQUEST_STATUS_LABELS, AdvanceSettlementStatus, type AdvanceRequestStatus } from '@tingting/shared';
import type { AdvanceRequestWithRefs, AdvanceSettlementWithRefs } from '@tingting/shared';
import { PageHeader, FormGroup } from '../components/UI';
import { useForwarderAdvanceRequests, useCreateAdvanceRequest, useForwarderAdvanceBalance, useForwarderSettlements } from '../hooks/useQueries';
import { usePageAnimations, useListAnimations, useCounterAnimation } from '../hooks/animations';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import './ForwarderAdvancesPage.css';
import '../components/shared/HeroKpiRow.css';

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#D97706',
  CHECKED_BY_ACCOUNTANT: '#2563EB',
  APPROVED: '#059669',
  REJECTED: '#DC2626',
};

type StatusFilter = '' | AdvanceRequestStatus;

export default function ForwarderAdvancesPage() {
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('');
  const { data, isLoading: loading, error: queryError } = useForwarderAdvanceRequests(activeFilter || undefined);
  const { data: balanceData } = useForwarderAdvanceBalance();
  // C2b/C2c — settlement (hoàn ứng) figures shown alongside advances. Buckets
  // are disjoint: "Chờ duyệt hoàn ứng" = requested but not yet approved/rejected;
  // "Đã thanh toán" = approved. Rejected settlements count in neither.
  const { data: settlementsData } = useForwarderSettlements();
  const settlements = (settlementsData?.items ?? []) as AdvanceSettlementWithRefs[];
  const pendingSettlements = settlements.filter(
    s => s.status === AdvanceSettlementStatus.PENDING || s.status === AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT,
  );
  const approvedSettlements = settlements.filter(s => s.status === AdvanceSettlementStatus.APPROVED);
  const requestedReimbursement = pendingSettlements.reduce((sum, s) => sum + Number(s.totalExpenseAmount), 0);
  const settledPaid = approvedSettlements.reduce((sum, s) => sum + Number(s.totalExpenseAmount), 0);
  const { rootRef } = usePageAnimations({
    ready: !loading,
    selectors: ['.page-header', '.hero-kpi-row', '.fadv-form-panel', '.fwd-filter-pills', '.fadv-card-trip'],
  });
  const createAdvanceRequest = useCreateAdvanceRequest();
  const requests = (data?.items ?? []) as AdvanceRequestWithRefs[];
  const counts = data?.counts ?? {};
  const { rootRef: listRef } = useListAnimations({ itemSelector: '.fadv-card-trip', mode: 'cards', deps: [requests] });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ amount: '', reason: '' });
  const mutationError = createAdvanceRequest.error
    ? (createAdvanceRequest.error instanceof Error ? createAdvanceRequest.error.message : 'Lỗi tạo yêu cầu')
    : null;

  const error = queryError ? 'Không thể tải danh sách yêu cầu tạm ứng' : null;
  const totalRequests = Object.values(counts).reduce((sum: number, c) => sum + c, 0);
  const totalAmount = requests.reduce((sum, r) => sum + Number(r.amount), 0);
  const pendingCount = requests.filter(r => r.status === 'PENDING').length;
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
      { el: heroTotalRef.current, value: totalRequests, suffix: ' yêu cầu' },
      { el: heroPendingRef.current, value: pendingCount, suffix: ' chờ duyệt' },
      { el: heroOutstandingRef.current, value: outstanding, format: (v: number) => Math.round(v).toLocaleString('vi-VN') },
    ]);
  }, [loading, totalRequests, totalAmount, pendingCount, outstanding, animateCounters, prefersReduced]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createAdvanceRequest.mutateAsync(
      { amount: Number(form.amount), reason: form.reason },
      {
        onSuccess: () => {
          setShowForm(false);
          setForm({ amount: '', reason: '' });
        },
      },
    );
  }

  if (loading) return (
    <div className="fadv-page">
      <PageHeader title="Tạm ứng" description="Yêu cầu tạm ứng và theo dõi trạng thái" iconName="advances" />
      <div className="fadv-loading">
        <Loader2 size={20} className="spin" style={{ display: 'inline-block' }} />
        <p style={{ marginTop: 8 }}>Đang tải danh sách tạm ứng…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="fadv-page">
      <PageHeader title="Tạm ứng" description="Yêu cầu tạm ứng và theo dõi trạng thái" iconName="advances" />
      <div className="fadv-empty">
        <div className="fadv-empty__icon" style={{ width: 80, height: 80 }}>
          <AlertCircle size={48} />
        </div>
        <h3 className="fadv-empty__title">Không thể tải dữ liệu</h3>
        <p className="fadv-empty__desc">{error}</p>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="fadv-page">
      <PageHeader
        title="Tạm ứng"
        description="Yêu cầu tạm ứng và theo dõi trạng thái"
        iconName="advances"
        action={
          !showForm ? (
            <button className="btn btn--primary" onClick={() => setShowForm(true)}>
              <Plus size={16} /> Tạo yêu cầu
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
            <span className="hero-kpi-card__subtitle">{totalRequests} yêu cầu tạm ứng</span>
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
                <span className="hero-kpi-mini__value" ref={heroPendingRef}>{pendingCount}</span>
                <span className="hero-kpi-mini__label">chờ duyệt</span>
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
            <span className="fadv-settlement-summary__label">Chờ duyệt hoàn ứng</span>
            <span className="fadv-settlement-summary__value">{formatCurrency(requestedReimbursement)}</span>
            <span className="fadv-settlement-summary__meta">{pendingSettlements.length} phiếu chờ duyệt</span>
            <FileText size={40} className="fadv-settlement-summary__watermark" aria-hidden="true" />
          </div>
          <div className="fadv-settlement-summary__card fadv-settlement-summary__card--success">
            <span className="fadv-settlement-summary__label">Đã thanh toán</span>
            <span className="fadv-settlement-summary__value">{formatCurrency(settledPaid)}</span>
            <span className="fadv-settlement-summary__meta">{approvedSettlements.length} phiếu đã duyệt</span>
            <CheckCircle2 size={40} className="fadv-settlement-summary__watermark" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="fadv-form-panel fade-up">
          <div className="fadv-form-panel__head">
            <div>
              <span className="fadv-form-panel__eyebrow">Yêu cầu mới</span>
              <h2 className="fadv-form-panel__title">
                <Wallet size={16} aria-hidden="true" />
                Tạo yêu cầu tạm ứng
              </h2>
              <p className="fadv-form-panel__hint">Điền số tiền và lý do để gửi yêu cầu đến bộ phận duyệt.</p>
            </div>
            <button
              className="btn btn--ghost btn--sm fadv-form-panel__close"
              onClick={() => { setShowForm(false); setForm({ amount: '', reason: '' }); }}
              aria-label="Đóng biểu mẫu yêu cầu tạm ứng"
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
                Gửi yêu cầu
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter pills */}
      {totalRequests > 0 && (
        <div className="fwd-filter-pills">
          <button
            className={`fwd-filter-pill ${activeFilter === '' ? 'fwd-filter-pill--active' : ''}`}
            onClick={() => setActiveFilter('')}
          >
            Tất cả
            <span className="fwd-filter-pill__count">{totalRequests}</span>
          </button>
          {(Object.entries(ADVANCE_REQUEST_STATUS_LABELS) as [AdvanceRequestStatus, string][]).map(([status, label]) => {
            const count = counts[status] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={status}
                className={`fwd-filter-pill ${activeFilter === status ? 'fwd-filter-pill--active' : ''}`}
                onClick={() => setActiveFilter(prev => prev === status ? '' : status)}
              >
                <span className="fwd-filter-pill__dot" style={{ background: STATUS_COLORS[status] }} />
                {label}
                <span className="fwd-filter-pill__count">{count}</span>
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
          <h3 className="fadv-empty__title">Chưa có yêu cầu tạm ứng</h3>
          <p className="fadv-empty__desc">
            Nhấn "Tạo yêu cầu" để gửi yêu cầu tạm ứng mới.
          </p>
        </div>
      ) : (
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
                  </div>
                  <div className="fadv-card-trip__reason">{req.reason}</div>
                </div>
                {req.approverName && req.approvedAt && (
                  <div className="fadv-card-trip__approver">
                    <User size={12} />
                    <span>{req.status === 'APPROVED' ? 'Duyệt' : 'Từ chối'} bởi {req.approverName}</span>
                    <span className="fadv-card-trip__meta-sep">·</span>
                    <span>{formatDate(req.approvedAt)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
