import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, ChevronRight, ChevronUp, Download, Truck } from 'lucide-react';
import { formatNumber } from '../lib/format';
import { useAuth } from '../hooks/useAuth';
import type { DashboardDecisionItem, Role, TripDetail } from '@tingting/shared';
import { ROLE_LABELS } from '@tingting/shared';
import { SkeletonLine, SkeletonKPIs } from '../components/shared/Skeleton';
import { Banner } from '../components/shared/Banner';
import { EmptyState as DsEmptyState } from '../design-system/EmptyState';
import { StatusStrip } from '../components/shared/StatusStrip';
import { AssetIcon } from '../components/AssetIcon';
import { useDashboardData } from '../features/dashboard/hooks/useDashboardData';
import { styles, fmtMoM } from '../features/dashboard/utils';
import { useMonth } from '../hooks/useMonth';
import { RevenueTrendChart } from '../components/charts/RevenueTrendChart';
import { AuditLogWidget } from '../features/dashboard/components/AuditLogWidget';
import { ApprovalQueueCard } from '../features/dashboard/components/ApprovalQueueCard';
import { useApprovalQueue, canSeeApprovalQueue } from '../features/dashboard/hooks/useApprovalQueue';
import { useDashboardAnimations } from '../features/dashboard/hooks/useDashboardAnimations';
import { CompanyInfoSetupBanner } from '../features/dashboard/components/CompanyInfoSetupBanner';
import { ManagerDecisionInbox } from '../features/dashboard/components/ManagerDecisionInbox';
import './DashboardPage.css';
import './WorkflowFinance.css';
import { ExecutiveFinancialStrip } from '../components/dashboard/ExecutiveFinancialStrip';
import { CostBreakdown, DeltaPill, decisionIcon, fmtVN, greeting, runningSum, severityLabel, type CostBreakdownItem } from '../features/dashboard/components/dashboard-presenters';

type DashboardStatTone = 'revenue' | 'cost' | 'gross' | 'net' | 'debt';

const DECISION_STRIP_COLORS: Record<DashboardDecisionItem['severity'], string> = {
  critical: 'var(--wf-red)',
  warning: 'var(--wf-amber)',
  info: 'var(--wf-blue)',
  success: 'var(--wf-green-500)',
};

interface DashboardStatProps {
  tone: DashboardStatTone;
  icon: React.ReactNode;
  label: string;
  delta?: React.ReactNode;
  value: string;
  valueRef?: (element: HTMLSpanElement | null) => void;
  description: React.ReactNode;
}

function DashboardStat({ tone, icon, label, delta, value, valueRef, description }: DashboardStatProps) {
  return (
    <div className={`d-stats d-card d-card-border bg-base-100 wf-kpi wf-kpi--${tone}`}>
      <div className="d-stat">
        <div className="d-stat-title row1">
          <span className="lbl">
            <span className="wf-kpi__icon" aria-hidden="true">{icon}</span>
            {label}
          </span>
          {delta}
        </div>
        <div className="d-stat-value val">
          <span ref={valueRef}>{value}</span> <i>đ</i>
        </div>
        <div className="d-stat-desc foot">{description}</div>
      </div>
    </div>
  );
}

/**
 * Dashboard — wireframe redesign per /wireframe/nepo-dashboard.html.
 *
 * Layout (1.62fr / 1fr split on ≥1180px, single column below):
 *   • Page head (greeting + summary + 2 actions)
 *   • 4 KPI cards (revenue / total cost / gross / net) with mom delta pills
 *   • Main grid:
 *       left  → Doanh thu & Lợi nhuận gộp chart (12 months) + sub2 (top trucks + top routes)
 *       right → Tình trạng đội xe + Cơ cấu chi phí donut + Cần chú ý list
 *
 * Styles live in DashboardPage.css under .dash-wf scope to avoid clashing
 * with the legacy widgets.
 */


// ─── Page component ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { month: currentMonth, year: currentYear } = useMonth();
  const [chartView, setChartView] = useState<'day' | 'month'>('day');
  const [showAllAttention, setShowAllAttention] = useState(false);
  const countersAnimated = useRef(false);

  // KPI refs for counter animation — point to <span> wrapping just the number
  const kpiRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  const {
    stats, loading, prevPnlReport,
    createdTripsCount,
    receivablesSummary,
    yearlySeries,
    recentAudit,
    derived, formattedNet,
    allTrips,
  } = useDashboardData(currentMonth, currentYear);

  // Animation hook — must be after loading is defined
  const { rootRef, animateCounters } = useDashboardAnimations(!loading);

  const showApprovalQueue = canSeeApprovalQueue(user?.role);
  const { data: approvalQueue, isLoading: approvalQueueLoading } = useApprovalQueue(user?.role, user?.userId);

  // ── Derived values (non-hook computations) ──────────────────────────────
  const d = derived ?? null;
  const revenue = d?.revenue ?? 0;
  const costs = d?.costs ?? 0;
  const grossProfit = d?.grossProfit ?? 0;
  const netProfit = d?.netProfit ?? 0;
  const prevRevenue = d?.prevRevenue ?? 0;
  const prevCosts = d?.prevCosts ?? 0;
  const prevGross = d?.prevGross ?? 0;

  const revenueMoM = fmtMoM(revenue, prevRevenue);
  const costsMoM = fmtMoM(costs, prevCosts);
  const grossMoM = fmtMoM(grossProfit, prevGross);
  const netMoM = fmtMoM(netProfit, prevGross); // approx vs prev gross when prevPnl unavailable

  const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const costRatio = revenue > 0 ? (costs / revenue) * 100 : 0;

  // ── Chart series (daily + monthly) ────────────────────────────────────────
  // Daily view groups trips by departureDate; monthly view uses yearly P&L.
  // Both convert to Tr (millions). Only data points with actual data are shown.

  const dailyChartData = useMemo(() => {
    if (!allTrips || allTrips.length === 0) return { labels: [] as string[], revenue: [] as number[], gross: [] as number[] };
    const activeTrips = allTrips.filter((t: TripDetail) => t.status !== 'CANCELED');
    const dayMap = new Map<string, { revenue: number; gross: number }>();
    for (const t of activeTrips) {
      const dateKey = t.departureDate?.slice(0, 10);
      if (!dateKey) continue;
      const rev = Number(t.revenue) || 0;
      const gp = Number(t.grossProfit) || 0;
      const existing = dayMap.get(dateKey) ?? { revenue: 0, gross: 0 };
      existing.revenue += rev;
      existing.gross += gp;
      dayMap.set(dateKey, existing);
    }
    const sorted = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, v]) => v.revenue > 0 || v.gross > 0);
    return {
      labels: sorted.map(([d]) => String(parseInt(d.slice(8, 10), 10))),
      revenue: sorted.map(([, v]) => v.revenue / 1_000_000),
      gross: sorted.map(([, v]) => v.gross / 1_000_000),
    };
  }, [allTrips]);

  const { chartMonths, chartRevenue, chartGross } = useMemo(() => {
    if (chartView === 'day') {
      return {
        chartMonths: dailyChartData.labels,
        chartRevenue: runningSum(dailyChartData.revenue),
        chartGross: runningSum(dailyChartData.gross),
      };
    }
    // Monthly view — trim leading months with no data
    if (!yearlySeries || yearlySeries.length === 0) return { chartMonths: [], chartRevenue: [], chartGross: [] };
    const months = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];
    const baseIdx = currentMonth - 1;
    const allMonths = yearlySeries.map((_, i) => months[(baseIdx - yearlySeries.length + 1 + i + 12) % 12]);
    const allRev = yearlySeries.map((p) => Number(p.revenue ?? 0) / 1_000_000);
    const allGross = yearlySeries.map((p) => Number(p.grossProfit ?? 0) / 1_000_000);
    const firstDataIdx = allRev.findIndex((r, i) => r > 0 || allGross[i] > 0);
    if (firstDataIdx < 0) return { chartMonths: [], chartRevenue: [], chartGross: [] };
    return {
      chartMonths: allMonths.slice(firstDataIdx),
      chartRevenue: runningSum(allRev.slice(firstDataIdx)),
      chartGross: runningSum(allGross.slice(firstDataIdx)),
    };
  }, [chartView, dailyChartData, yearlySeries, currentMonth]);

  // ── Top trucks (by margin) ──────────────────────────────────────────────
  const topTrucks = useMemo(() => {
    const trucks = (d?.displayTrucks ?? []) as Array<{ plate?: string; licensePlate?: string; profit?: number; revenue?: number; marginPct?: number }>;
    const maxPct = Math.max(1, ...trucks.map(t => t.marginPct ?? (t.revenue ? ((t.profit ?? 0) / t.revenue) * 100 : 0)));
    return trucks.slice(0, 5).map(t => {
      const pct = t.marginPct ?? (t.revenue ? ((t.profit ?? 0) / t.revenue) * 100 : 0);
      return {
        plate: t.plate ?? t.licensePlate ?? '—',
        pct: Math.round(pct),
        widthPct: Math.max(4, Math.round((pct / maxPct) * 100)),
      };
    });
  }, [d]);

  // ── Top routes ──────────────────────────────────────────────────────────
  const topRoutes = useMemo(() => {
    const routes = (d?.displayRoutes ?? []) as Array<{ name?: string; routeName?: string; profit?: number; grossProfit?: number }>;
    return routes.slice(0, 4).map(r => ({
      name: r.name ?? r.routeName ?? '—',
      profit: r.profit ?? r.grossProfit ?? 0,
    }));
  }, [d]);

  // Keep the full P&L breakdown so the presented categories reconcile to the
  // card total. Sorting by value makes comparisons immediate without requiring
  // users to estimate angles or match a detached legend to a chart.
  const costBreakdown = useMemo<CostBreakdownItem[]>(() => {
    if (!d) return [];
    return d.slicesWithPct
      .map(slice => ({
        name: slice.label,
        value: slice.value,
        pct: slice.pct,
        color: slice.color,
      }))
      .filter(item => item.value > 0 && item.pct > 0)
      .sort((a, b) => b.value - a.value);
  }, [d]);

  // ── Fleet stats ─────────────────────────────────────────────────────────
  const fleet = useMemo(() => {
    const fs = stats?.fleetStatus ?? {};
    const totalActive = fs.ACTIVE ?? 0;
    const maintenance = fs.MAINTENANCE ?? 0;
    const idle = fs.INACTIVE ?? 0;
    const inTransit = stats?.inTransitTrips ?? 0;
    const total = stats?.totalTrucks ?? 0;
    const drivers = stats?.totalDrivers ?? 0;
    
    // ACTIVE status includes trucks currently in transit.
    // Subtract inTransit to get the mutually exclusive count of trucks that are ready/idle.
    const ready = Math.max(0, totalActive - inTransit);
    
    // Utilization: percentage of the available fleet (total - maintenance) that is currently running (inTransit)
    // This matches the utilization formula documented on the dispatch fleet view.
    const utilizable = total - maintenance;
    const utilization = utilizable > 0 ? (inTransit / utilizable) * 100 : null;
    
    return { ready, inTransit, maintenance, idle, total, drivers, utilization };
  }, [stats]);

  // ── Attention items (compose from real data) ────────────────────────────
  const attention = useMemo<DashboardDecisionItem[]>(() => {
    if (stats?.decisionItems?.length) return stats.decisionItems;

    const fallback: DashboardDecisionItem[] = [];
    if (createdTripsCount > 0) {
      fallback.push({
        id: 'dispatch-created-trips-fallback',
        kind: 'dispatch',
        severity: 'warning',
        title: `${createdTripsCount} đơn hàng chờ phân xe`,
        subtitle: 'Phân xe để không trễ giờ xuất phát',
        actionLabel: 'Phân xe',
        route: '/dispatch',
        priority: 90,
      });
    }
    if (revenue > 0) {
      fallback.push({
        id: 'profit-close-ready-fallback',
        kind: 'profit-close',
        severity: 'info',
        title: `Báo cáo lợi nhuận ${currentMonth}/${currentYear} sẵn sàng`,
        subtitle: 'Xem lại số liệu trước khi phân bổ lợi nhuận',
        actionLabel: 'Xem',
        route: '/profit',
        priority: 20,
      });
    }
    return fallback.length > 0
      ? fallback
      : [{
          id: 'all-clear-fallback',
          kind: 'all-clear',
          severity: 'success',
          title: 'Không có quyết định đang chờ',
          subtitle: 'Công nợ, phân xe, gia hạn và số liệu đều ổn',
          priority: 0,
        }];
  }, [stats?.decisionItems, createdTripsCount, revenue, currentMonth, currentYear]);
  const orderedAttention = useMemo(
    () => [...attention].sort((a, b) => b.priority - a.priority),
    [attention],
  );
  const visibleAttention = showAllAttention ? orderedAttention : orderedAttention.slice(0, 4);

  // ── Trigger KPI counter animations once data loads ──
  useEffect(() => {
    if (loading || countersAnimated.current) return;
    countersAnimated.current = true;

    // Small delay to let entrance animations start first
    const timer = setTimeout(() => {
      const refs = kpiRefs.current;
      animateCounters([
        { el: refs.revenue!, value: revenue },
        { el: refs.costs!, value: costs },
        { el: refs.gross!, value: grossProfit },
        { el: refs.net!, value: netProfit },
      ].filter(t => t.el !== null));
    }, 300);

    return () => clearTimeout(timer);
  }, [loading, revenue, costs, grossProfit, netProfit, animateCounters]);

  // ── Loading state (must be AFTER all hooks) ────────────────────────────
  if (loading) {
    return (
      <div className="dash-wf fade-up">
        <div className="wf-head"><div><SkeletonLine width="240px" /><div style={styles.thinBar} /><SkeletonLine width="320px" /></div></div>
        <SkeletonKPIs count={4} />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  // Critical-receivables banner — surfaces ONLY customers in the worst aging
  // bucket (>90 days overdue). Lesser overdue tiers (31–60, 61–90) are
  // routine and don't warrant a page-top banner. dismissKey ties dismissal to
  // the active period so a new month re-surfaces the banner.
  // Backend bucket ranges: '0-30' | '31-60' | '61-90' | '90+' (see
  // backend/src/services/aging.service.ts).
  const over90Bucket = receivablesSummary?.buckets?.find(b => b.range === '90+');
  const over90Count = over90Bucket?.count ?? 0;
  const criticalBannerKey = `over90-${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  return (
    <div className="dash-wf" ref={rootRef}>
      {over90Count > 0 && (
        <Banner
          variant="danger"
          icon={AlertTriangle}
          dismissKey={criticalBannerKey}
          action={
            <button
              type="button"
              className="wf-banner-action"
              onClick={() => navigate('/debt?filter=over90')}
            >
              Xem công nợ
            </button>
          }
        >
          <strong>{over90Count}</strong> khách hàng đang quá hạn trên 90 ngày. Cần xử lý sớm để giảm rủi ro nợ xấu.
        </Banner>
      )}
      <CompanyInfoSetupBanner />
      {/* ── page head ── */}
      <header className="wf-head">
        <div className="wf-head__copy">
          <div className="wf-eyebrow">
            <span className="d-badge d-badge-success d-badge-soft d-badge-sm">
              <Activity size={12} aria-hidden="true" /> Đang hoạt động
            </span>
            <span>Trung tâm điều hành · {String(currentMonth).padStart(2, '0')}/{currentYear}</span>
          </div>
          <h1>Tổng quan vận hành</h1>
          <div className="wf-sum">
            {greeting()}, {user?.fullName || (user?.role && ROLE_LABELS[user.role as Role]) || user?.username || 'bạn'}. Tháng {currentMonth}/{currentYear} có doanh thu{' '}
            {prevPnlReport ? (
              revenue >= prevRevenue
                ? <span className="pos">{revenueMoM} so với tháng trước</span>
                : <span className="neg">{revenueMoM} so với tháng trước</span>
            ) : <b>chưa đủ dữ liệu so sánh</b>}
            . Lợi nhuận ròng dự kiến <b>{formattedNet} ₫</b> sau phí quản lý.
          </div>
        </div>
        <div className="wf-acts">
          <button className="d-btn d-btn-sm wf-btn" onClick={() => navigate('/finance')}>
            <Download size={16} aria-hidden="true" />
            Báo cáo lãi lỗ
          </button>
          <button className="d-btn d-btn-primary d-btn-sm wf-btn wf-btn--primary" onClick={() => navigate('/dispatch')}>
            <Truck size={16} aria-hidden="true" />
            Phân xe{createdTripsCount > 0 ? ` · ${createdTripsCount} chờ` : ''}
          </button>
        </div>
      </header>

      <ManagerDecisionInbox enabled={user?.role === 'MANAGER'} />

      <ExecutiveFinancialStrip enabled={Boolean(user?.capabilities?.includes('executive_dashboard.read'))} />

      {/* ── KPI row ── */}
      <div className="wf-kpis" data-tour-id="dashboard-kpis">
        <DashboardStat
          tone="revenue"
          icon={<AssetIcon name="analytics" size={15} />}
          label={`Doanh thu · ${String(currentMonth).padStart(2, '0')}/${currentYear}`}
          delta={<DeltaPill mom={revenueMoM} />}
          value={fmtVN(revenue)}
          valueRef={element => { kpiRefs.current.revenue = element; }}
          description={<>Tháng trước · {formatNumber(prevRevenue)} ₫</>}
        />
        <DashboardStat
          tone="cost"
          icon={<AssetIcon name="expense" size={15} />}
          label="Tổng chi phí"
          delta={<DeltaPill mom={costsMoM} />}
          value={fmtVN(costs)}
          valueRef={element => { kpiRefs.current.costs = element; }}
          description={<>{costRatio.toFixed(1)}% doanh thu</>}
        />
        <DashboardStat
          tone="gross"
          icon={<AssetIcon name="gross-margin" size={15} />}
          label="Lợi nhuận gộp"
          delta={<DeltaPill mom={grossMoM} />}
          value={fmtVN(grossProfit)}
          valueRef={element => { kpiRefs.current.gross = element; }}
          description={<>Biên gộp · {grossMargin.toFixed(1)}%</>}
        />
        <DashboardStat
          tone="net"
          icon={<AssetIcon name="profit" size={15} />}
          label="Lợi nhuận ròng"
          delta={<DeltaPill mom={netMoM} />}
          value={fmtVN(netProfit)}
          valueRef={element => { kpiRefs.current.net = element; }}
          description={<>Sau phí quản lý · <button className="d-btn d-btn-link d-btn-xs wf-link" onClick={() => navigate('/profit')}>Phân chia →</button></>}
        />
        <DashboardStat
          tone="debt"
          icon={<AssetIcon name="receivables" size={15} />}
          label="Công nợ phải thu"
          value={fmtVN(receivablesSummary?.totalOutstanding ?? 0)}
          description={<>{receivablesSummary?.overdueCustomers ?? 0} khách quá hạn</>}
        />
      </div>

      {/* ── Operations grid ──
           Tiles auto-flow into rows based on their grid-column/row spans.
           The decision board is deliberately first so the user's next work is
           visible before historical analysis. On mobile every tile drops to
           full width via the .wf-bento override in DashboardPage.css. */}
      <div className="wf-bento">

        {/* Action-first priority board — the most important operational
            decisions stay in the first scan path on every breakpoint. */}
        {user?.role !== 'MANAGER' && <section
          className={`d-card d-card-border bg-base-100 wf-card wf-att wf-att--wide wf-bento-full wf-priority-board${showAllAttention ? ' is-expanded' : ''}`}
          data-tour-id="dashboard-attention"
          aria-labelledby="dashboard-priority-title"
        >
            <div className="wf-card-h">
              <div>
                <h2 className="ttl" id="dashboard-priority-title">Việc cần xử lý</h2>
                <div className="sub">Ưu tiên theo mức độ ảnh hưởng · {orderedAttention.length} mục</div>
              </div>
            </div>
            <div className="body" id="dashboard-priority-list">
              {visibleAttention.map((item, i) => {
                const iconName = decisionIcon(item.kind);
                return (
                <React.Fragment key={item.id}>
                  {i > 0 && <div className="wf-divider" />}
                  <div className={`wf-arow wf-arow--${item.severity}`}>
                    <StatusStrip color={DECISION_STRIP_COLORS[item.severity]} />
                    <div className={`ic wf-ic-${item.severity}`}>
                      <AssetIcon name={iconName} size={18} />
                    </div>
                    <div className="tx">
                      <div className="t">
                        {item.title}
                        <span className={`d-badge d-badge-soft d-badge-sm wf-severity wf-severity--${item.severity}`}>
                          {severityLabel(item.severity)}
                        </span>
                      </div>
                      <div className="s">{item.subtitle}</div>
                    </div>
                    {item.route && item.actionLabel && (
                      <div className="go">
                        <button
                          className={`d-btn d-btn-sm wf-minibtn${item.severity === 'success' ? ' d-btn-success green' : ''}`}
                          onClick={() => navigate(item.route!)}
                        >
                          <span>{item.actionLabel}</span>
                          <ChevronRight className="wf-minibtn__icon" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                </React.Fragment>
                );
              })}
              {orderedAttention.length > 4 && (
                <div className="wf-priority-more">
                  <button
                    type="button"
                    className="d-btn d-btn-link d-btn-sm wf-link"
                    aria-expanded={showAllAttention}
                    aria-controls="dashboard-priority-list"
                    onClick={() => setShowAllAttention(value => !value)}
                  >
                    {showAllAttention ? (
                      <>Thu gọn <ChevronUp aria-hidden="true" /></>
                    ) : (
                      <>Xem tất cả {orderedAttention.length} mục <ChevronRight aria-hidden="true" /></>
                    )}
                  </button>
                </div>
              )}
            </div>
          </section>}

        {/* Hero 1 — Chart (8 cols × 2 rows) */}
        <section className="d-card d-card-border bg-base-100 wf-card wf-chart wf-bento-hero" aria-labelledby="dashboard-revenue-title">
            <div className="wf-card-h">
              <div>
                <h2 className="ttl" id="dashboard-revenue-title">Doanh thu & Lợi nhuận gộp</h2>
                <div className="sub">
                  {chartMonths.length > 0
                    ? chartView === 'day'
                      ? `${chartMonths.length} ngày · Tháng ${currentMonth}/${currentYear}`
                      : `${chartMonths.length} tháng gần nhất`
                    : 'Chưa có dữ liệu'}
                </div>
              </div>
              <div className="wf-chart-actions">
                <div className="wf-chart-toggle">
                  <button className={`d-btn d-btn-sm wf-chart-toggle__btn${chartView === 'day' ? ' is-active' : ''}`} onClick={() => setChartView('day')} aria-pressed={chartView === 'day'}>Ngày</button>
                  <button className={`d-btn d-btn-sm wf-chart-toggle__btn${chartView === 'month' ? ' is-active' : ''}`} onClick={() => setChartView('month')} aria-pressed={chartView === 'month'}>Tháng</button>
                </div>
                <button className="d-btn d-btn-link d-btn-sm wf-link" onClick={() => navigate('/finance')}>Xem báo cáo
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </div>
            </div>
            <div className="wf-legend">
              <span className="li"><span className="sw" style={{ background: 'var(--wf-green)' }} />Doanh thu</span>
              <span className="li"><span className="sw" style={{ background: 'var(--wf-blue)' }} />Lợi nhuận gộp</span>
            </div>
            <div className="body">
              {(() => {
                if (chartRevenue.length === 0) {
                  return (
                    <div className="wf-chart-empty-wrap">
                      <DsEmptyState
                        title="Chưa có dữ liệu trong kỳ"
                        description="Biểu đồ sẽ xuất hiện khi kỳ này ghi nhận doanh thu hoặc lợi nhuận gộp dương."
                        illustration="/assets/illustrations/empty-revenue-period.webp"
                        className="wf-chart-empty"
                      />
                    </div>
                  );
                }
                const totalRev = chartRevenue.reduce((a, b) => a + b, 0);
                const totalGp = chartGross.reduce((a, b) => a + b, 0);
                if (totalRev === 0 && totalGp === 0) {
                  return (
                    <div className="wf-chart-empty-wrap">
                      <DsEmptyState
                        title="Chưa đủ dữ liệu lịch sử"
                        description="Biểu đồ doanh thu & lợi nhuận gộp sẽ xuất hiện tại đây sau khi có chuyến đầu tiên trong kỳ."
                        illustration="/assets/illustrations/empty-revenue-period.webp"
                        className="wf-chart-empty"
                      />
                    </div>
                  );
                }
                return <RevenueTrendChart months={chartMonths} revenue={chartRevenue} gross={chartGross} />;
              })()}
            </div>
          </section>

        {/* Fleet (4 cols × 1 row) — right of chart, row 1 */}
        <div className="d-card d-card-border bg-base-100 wf-card wf-fleet wf-bento-third">
            <div className="wf-card-h">
              <div>
                <h2 className="ttl">Tình trạng đội xe</h2>
                <div className="sub">{fleet.total} đầu kéo · {fleet.drivers} lái xe</div>
              </div>
              <button className="d-btn d-btn-link d-btn-sm wf-link" onClick={() => navigate('/fleet')}>Quản lý</button>
            </div>
            <div className="body">
              <div className="wf-fstats">
                <div className="wf-fstat"><div className="v"><span className="pip" style={{ background: 'var(--wf-green-500)' }} />{fleet.ready}</div><div className="k">Sẵn sàng</div></div>
                <div className="wf-fstat"><div className="v"><span className="pip" style={{ background: 'var(--wf-green)' }} />{fleet.inTransit}</div><div className="k">Đang chạy</div></div>
                <div className="wf-fstat"><div className="v"><span className="pip" style={{ background: 'var(--wf-amber)' }} />{fleet.maintenance}</div><div className="k">Bảo dưỡng</div></div>
                <div className="wf-fstat"><div className="v"><span className="pip" style={{ background: 'var(--wf-ink-3)' }} />{fleet.idle}</div><div className="k">Ngừng</div></div>
              </div>
              {fleet.utilization != null && (
                <div className="wf-util">
                  <span className="cap">Tỷ lệ sử dụng</span>
                  <progress className="d-progress d-progress-success track" value={Math.min(100, fleet.utilization)} max="100" aria-label="Tỷ lệ sử dụng đội xe" />
                  <span className="pct">{Math.round(fleet.utilization)}%</span>
                </div>
              )}
            </div>
          </div>

        {/* Cost composition (4 cols × 1 row) — right of chart, row 2 */}
        <div className="d-card d-card-border bg-base-100 wf-card wf-cost wf-bento-third">
            <div className="wf-card-h">
              <div>
                <h2 className="ttl">Cơ cấu chi phí</h2>
                <div className="sub">Tháng {String(currentMonth).padStart(2, '0')}/{currentYear} · xếp theo giá trị</div>
              </div>
            </div>
            <div className="body">
              {costBreakdown.length === 0 ? (
                <DsEmptyState
                  title="Chưa có chi phí trong tháng"
                  description="Cơ cấu chi phí sẽ xuất hiện sau khi có khoản chi được ghi nhận."
                  illustration="/assets/illustrations/empty-cost-composition.webp"
                  className="wf-dashboard-empty wf-dashboard-empty--cost"
                />
              ) : (
                <CostBreakdown items={costBreakdown} total={d?.totalPie ?? costs} />
              )}
            </div>
          </div>

        {/* Lợi nhuận theo xe (6 cols × 1 row) — below chart */}
        <div className="d-card d-card-border bg-base-100 wf-card wf-bento-half">
              <div className="wf-card-h">
                <div>
                  <h2 className="ttl">Lợi nhuận theo xe</h2>
                  <div className="sub">Biên gộp từng đầu kéo · {String(currentMonth).padStart(2, '0')}/{currentYear}</div>
                </div>
              </div>
              <div className="wf-vlist">
                {topTrucks.length === 0 ? (
                  <DsEmptyState
                    title="Chưa có dữ liệu xe"
                    description="Biên lợi nhuận sẽ xuất hiện khi có chuyến hoàn tất trong tháng."
                    illustration="/assets/illustrations/empty-vehicle-profit.webp"
                    className="wf-dashboard-empty wf-dashboard-empty--inline"
                  />
                ) : topTrucks.map((t, i) => (
                  <div key={i} className="wf-vrow">
                    <span className="plate" title={t.plate}>{t.plate}</span>
                    <progress className="d-progress d-progress-success bar" value={t.widthPct} max="100" aria-label={`Biên lợi nhuận xe ${t.plate}`} />
                    <span className="pct">{t.pct}%</span>
                  </div>
                ))}
              </div>
            </div>

        {/* Top tuyến sinh lời (6 cols × 1 row) — below chart, right half */}
        <div className="d-card d-card-border bg-base-100 wf-card wf-bento-half">
              <div className="wf-card-h">
                <div>
                  <h2 className="ttl">Top tuyến sinh lời</h2>
                  <div className="sub">Theo lợi nhuận gộp · {String(currentMonth).padStart(2, '0')}/{currentYear}</div>
                </div>
                <button className="d-btn d-btn-link d-btn-sm wf-link" onClick={() => navigate('/finance')}>Tất cả</button>
              </div>
              <div className="wf-rlist">
                {topRoutes.length === 0 ? (
                  <DsEmptyState
                    title="Chưa có dữ liệu tuyến"
                    description="Xếp hạng sẽ xuất hiện khi tuyến có lợi nhuận gộp."
                    illustration="/assets/illustrations/empty-profitable-routes.webp"
                    className="wf-dashboard-empty wf-dashboard-empty--inline"
                  />
                ) : topRoutes.map((r, i) => (
                  <div key={i} className="wf-rrow">
                    <span className="rk">{i + 1}</span>
                    <span className="rt" title={r.name}>{r.name}</span>
                    <span className="rv">{formatNumber(r.profit)}</span>
                  </div>
                ))}
              </div>
            </div>

        {/* Cần duyệt — full-width so its height does not inherit the much
            taller decision list beside it. */}
        {showApprovalQueue && user?.role !== 'MANAGER' && (
          <div className="wf-bento-full">
            <ApprovalQueueCard
              data={approvalQueue}
              loading={approvalQueueLoading}
              navigate={navigate}
            />
          </div>
        )}

        {/* Hoạt động gần đây (12 cols × 1 row) — full-width band, only for
            roles allowed by casbin. recentAudit is empty for DRIVER so this
            is skipped. */}
        {recentAudit.length > 0 && (
          <div className="wf-bento-full">
            <AuditLogWidget entries={recentAudit} navigate={navigate} />
          </div>
        )}
      </div>
    </div>
  );
}
