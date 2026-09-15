import type { LinkedExpense, LinkedRequest } from '../api/forwarderClient';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Loader2, Plus, ArrowRight, Clock } from 'lucide-react';
import { EmptyState, Pagination } from '../design-system';
import { formatCurrency, formatDate } from '../lib/format';
import { groupExpensesByContainer } from '../lib/expense-breakdown';
import { ADVANCE_SETTLEMENT_STATUS_LABELS, type AdvanceSettlementStatus } from '@tingting/shared';
import { PageHeader } from '../components/UI';
import { ClickableCard } from '../components/shared/ClickableCard';
import { StatusStrip } from '../components/shared/StatusStrip';
import { useForwarderSettlements } from '../hooks/useForwarderQueries';
import { useCatalogs } from '../hooks/useCatalogs';
import { usePageAnimations, useListAnimations, useCounterAnimation } from '../hooks/animations';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import './ForwarderSettlementsPage.css';
import '../components/shared/HeroKpiRow.css';

/** Generate business codes — NEVER show raw IDs */
function advanceRequestCode(id: number): string {
  return `TU-${String(id).padStart(4, '0')}`;
}

/** Status strip colors matching ForwarderTripsPage pattern */
const STATUS_STRIP: Record<AdvanceSettlementStatus, string> = {
  DRAFT: 'var(--warning)',
  RECORDED: 'var(--success, #059669)',
  VOIDED: '#DC2626',
  REVERSED: '#64748B',
};

interface Settlement {
  id: number;
  code: string;
  forwarderId: number;
  totalExpenseAmount: string;
  refundAmount: string;
  status: AdvanceSettlementStatus;
  checkedBy: number | null;
  checkedAt: string | null;
  approvedBy: number | null;
  approvedAt: string | null;
  note: string | null;
  createdAt: string;
  forwarderName?: string;
  checkerName?: string;
  approverName?: string;
  linkedRequests?: LinkedRequest[];
  linkedExpenses?: LinkedExpense[];
}

export default function ForwarderSettlementsPage() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<AdvanceSettlementStatus | ''>('');
  const [page, setPage] = useState(1);

  // Server-side status filter + pagination; statusCounts/totals are full-set.
  const { data: settlementsData, isLoading: loadingSettlements, error: settlementsError } = useForwarderSettlements({
    status: activeFilter || undefined,
    page,
    limit: 25,
  });
  const { rootRef } = usePageAnimations({
    ready: !loadingSettlements,
    selectors: ['.page-header', '.hero-kpi-row', '.fwd-filter-pills', '.fset-card'],
  });
  const { data: catalogs } = useCatalogs();
  const { animateCounters } = useCounterAnimation({ duration: 1200, delay: 400 });
  const heroExpenseRef = useRef<HTMLSpanElement>(null);
  const heroTotalRef = useRef<HTMLSpanElement>(null);
  const heroPendingRef = useRef<HTMLSpanElement>(null);

  const settlements = useMemo(() => (settlementsData?.items ?? []) as Settlement[], [settlementsData]);
  const expenseTypeOptions = catalogs?.forwarderExpenseTypes ?? [];

  const error = settlementsError ? 'Không thể tải danh sách phiếu thanh toán' : null;

  // Full-set stats from the server envelope (page-independent)
  const totalCount = settlementsData?.total ?? settlements.length;
  const pending = settlementsData?.totals?.pendingCount ?? 0;
  const totalExpenseAll = settlementsData?.totals?.totalExpenseAmount ?? 0;

  const prefersReduced = usePrefersReducedMotion();

  // Kick counter animations when data is ready
  useEffect(() => {
    if (loadingSettlements || settlements.length === 0 || prefersReduced) return;
    animateCounters([
      { el: heroExpenseRef.current, value: totalExpenseAll, format: (v: number) => Math.round(v).toLocaleString('vi-VN') },
      { el: heroTotalRef.current, value: totalCount, suffix: ' phiếu' },
      { el: heroPendingRef.current, value: pending, suffix: ' chờ xử lý' },
    ]);
  }, [loadingSettlements, settlements.length, totalExpenseAll, totalCount, pending, animateCounters, prefersReduced]);

  // Full-set status counts from the server envelope
  const statusCounts = (settlementsData?.statusCounts ?? {}) as Partial<Record<AdvanceSettlementStatus, number>>;

  const totalPages = settlementsData?.totalPages ?? 1;
  const effectivePage = Math.min(page, totalPages);
  useEffect(() => { setPage(1); }, [activeFilter]);

  const { rootRef: listRef } = useListAnimations({ itemSelector: '.fset-card', mode: 'cards', deps: [settlements] });

  if (loadingSettlements) return (
    <div className="fset-page">
      <PageHeader title="Phiếu thanh toán" description="Thanh toán tạm ứng" iconName="settlement" />
      <div className="fset-loading">
        <Loader2 size={20} className="spin" style={{ display: 'inline-block' }} />
        <p style={{ marginTop: 8 }}>Đang tải danh sách phiếu thanh toán…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="fset-page">
      <PageHeader title="Phiếu thanh toán" description="Thanh toán tạm ứng" iconName="settlement" />
      <div className="empty-state">
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="fset-page">
      <PageHeader
        title="Phiếu thanh toán"
        description="Thanh toán tạm ứng"
        iconName="settlement"
        action={
          <button className="btn btn--primary" onClick={() => navigate('/my-settlements/new')}>
            <Plus size={16} /> Thêm phiếu
          </button>
        }
      />

      {/* Hero KPI row */}
      {totalCount > 0 && (
        <div className="hero-kpi-row">
          <div className="hero-kpi-card">
            <span className="hero-kpi-card__eyebrow">Tổng chi phí thanh toán</span>
            <span className="hero-kpi-card__amount"><span ref={heroExpenseRef}>0</span><span className="hero-kpi-card__currency">₫</span></span>
            <span className="hero-kpi-card__subtitle">{settlements.length} phiếu thanh toán</span>
            <FileText size={72} className="hero-kpi-card__watermark" aria-hidden />
          </div>
          <div className="hero-kpi-stack">
            <div className="hero-kpi-mini hero-kpi-mini--accent">
              <div className="hero-kpi-mini__body">
                <span className="hero-kpi-mini__value" ref={heroTotalRef}>0</span>
                <span className="hero-kpi-mini__label">phiếu</span>
              </div>
              <FileText size={40} className="hero-kpi-mini__watermark" aria-hidden="true" />
            </div>
            <div className="hero-kpi-mini hero-kpi-mini--warn">
              <div className="hero-kpi-mini__body">
                <span className="hero-kpi-mini__value" ref={heroPendingRef}>0</span>
                <span className="hero-kpi-mini__label">chờ xử lý</span>
              </div>
              <Clock size={40} className="hero-kpi-mini__watermark" aria-hidden="true" />
            </div>
          </div>
        </div>
      )}

      {/* Status filter pills — matching ForwarderTripsPage design */}
      {totalCount > 0 && (
        <div className="fwd-filter-pills">
          <button
            className={`fwd-filter-pill ${activeFilter === '' ? 'fwd-filter-pill--active' : ''}`}
            onClick={() => setActiveFilter('')}
          >
            Tất cả
            <span className="fwd-filter-pill__count">{settlements.length}</span>
          </button>
          {(Object.entries(ADVANCE_SETTLEMENT_STATUS_LABELS) as [AdvanceSettlementStatus, string][]).map(([status, label]) => {
            const count = statusCounts[status] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={status}
                className={`fwd-filter-pill ${activeFilter === status ? 'fwd-filter-pill--active' : ''}`}
                data-status={status}
                onClick={() => setActiveFilter(prev => prev === status ? '' : status)}
              >
                <span className="fwd-filter-pill__dot" style={{ background: STATUS_STRIP[status] }} />
                {label}
                <span className="fwd-filter-pill__count">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {settlements.length === 0 ? (
        <EmptyState
          className="fset-empty-state fade-up"
          icon={FileText}
          title="Chưa có phiếu thanh toán"
          description="Tạo phiếu đầu tiên bằng nút Thêm phiếu ở trên."
        />
      ) : (
        <div ref={listRef} className="fset-list">
          {settlements.map((s, idx) => {
            const hasBreakdown = s.linkedExpenses && s.linkedExpenses.length > 0;
            const containerGroups = hasBreakdown ? groupExpensesByContainer(s.linkedExpenses!, expenseTypeOptions) : [];

            return (
              <ClickableCard
                key={s.id}
                to={`/my-settlements/${s.id}`}
                className="fset-card fade-up"
                style={{
                  animationDelay: `${idx * 40}ms`,
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Status strip — color tells status, no text needed */}
                <StatusStrip color={STATUS_STRIP[s.status] || '#999'} />

                <div className="fset-card__body">
                  {/* Icon tile */}
                  <div className="fset-card__icon">
                    <FileText size={16} />
                  </div>

                  {/* Main content */}
                  <div className="fset-card__main">
                    <div className="fset-card__head">
                      <span className="fset-card__code-text">{s.code}</span>
                    </div>

                    <div className="fset-card__meta">
                      <span className="fset-card__meta-item">{formatDate(s.createdAt)}</span>
                      <span className="fset-card__meta-item">
                        Chi phí: <strong>{formatCurrency(Number(s.totalExpenseAmount))}</strong>
                      </span>
                      {Number(s.refundAmount) > 0 && (
                        <span className="fset-card__meta-item">
                          Hoàn lại: <strong>{formatCurrency(Number(s.refundAmount))}</strong>
                        </span>
                      )}
                    </div>

                    {/* Breakdown grouped by container (chronological), each with
                        per-type chips — mirrors the printed settlement (C3). */}
                    {containerGroups.length > 0 && (
                      <div className="fset-card__containers">
                        {containerGroups.map(g => (
                          <div key={g.containerNumber} className="fset-container-group" style={{ marginTop: 6, paddingLeft: 8, borderLeft: '2px solid var(--accent)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span style={{ fontSize: 'var(--text-body-size)', fontWeight: 600, color: 'var(--ink-2)' }}>{g.containerNumber}</span>
                              <span style={{ fontSize: 'var(--text-body-size)', fontWeight: 700, color: 'var(--accent-2)' }}>{formatCurrency(g.total)}</span>
                            </div>
                            <div className="fset-card__chips">
                              {[...g.byType.entries()].map(([label, amount]) => (
                                <span key={label} className="fset-chip">{label}: {formatCurrency(amount)}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Linked advances */}
                    {s.linkedRequests && s.linkedRequests.length > 0 && (
                      <div className="fset-card__chips">
                        {s.linkedRequests.map(r => (
                          <span key={r.id} className="fset-chip fset-chip--linked">
                            {advanceRequestCode(r.id)} — {formatCurrency(Number(r.amount))}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Note */}
                    {s.note && (
                      <div className="fset-card__note">{s.note}</div>
                    )}

                    {/* Retained reconciliation and recording actors */}
                    {(s.checkerName || s.approverName) && (
                      <div className="fset-card__footer">
                        {s.checkerName && <span>Đối chiếu trước đây: {s.checkerName}</span>}
                        {s.approverName && <span>Ghi nhận: {s.approverName}</span>}
                      </div>
                    )}
                  </div>

                  {/* Arrow */}
                  <ArrowRight size={16} className="fset-card__arrow" />
                </div>
              </ClickableCard>
            );
          })}
        </div>
      )}
      {(settlementsData?.total ?? 0) > (settlementsData?.limit ?? 25) && (
        <Pagination page={effectivePage} totalPages={totalPages} totalItems={settlementsData?.total ?? 0} pageSize={settlementsData?.limit ?? 25} onChange={setPage} />
      )}
    </div>
  );
}
