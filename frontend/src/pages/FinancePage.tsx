import { Fragment, useState, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatNumber } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ExternalLink } from 'lucide-react';
import { EmptyIllustration } from '../components/shared';
import { PageHeader, Panel } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { AssetIcon } from '../components/AssetIcon';
import { usePnlReport, useYearlyPnl, useMonthlyTrips, useCapTable } from '../hooks/useQueries';
import { useMonth } from '../hooks/useMonth';
import { usePageAnimations, useCounterAnimation } from '../hooks/animations';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { RevenueTrendChart } from '../components/charts/RevenueTrendChart';
import { compactNum, EMPTY_CAP, EMPTY_TRIPS, EMPTY_YEARLY, marginPct, useFinanceDerived, yoyClass, yoyPct } from './finance-derived';
import { groupFinanceTripDetails } from './finance-trip-details';
import type { PnlMaintenanceItem } from '@tingting/shared';
import './FinancePage.css';

export default function FinancePage() {
  const { month, year } = useMonth();
  const [chartView, setChartView] = useState<'day' | 'month'>('day');
  const [expandedTruckIds, setExpandedTruckIds] = useState<Set<number>>(() => new Set());
  const { data: report, isLoading: loading, error: queryError } = usePnlReport(month, year);
  const { rootRef } = usePageAnimations({ ready: !loading });

  const kpiRefs = useRef<{ revenue: HTMLSpanElement | null; gross: HTMLSpanElement | null; net: HTMLSpanElement | null; margin: HTMLSpanElement | null }>({ revenue: null, gross: null, net: null, margin: null });
  const prefersReduced = usePrefersReducedMotion();

  const { data: prevReport } = usePnlReport(month, year - 1);

  const { data: allTrips = EMPTY_TRIPS } = useMonthlyTrips(year, month); const { data: capTableRaw = EMPTY_CAP } = useCapTable();
  const { data: yearlyData = EMPTY_YEARLY, isLoading: yearlyLoading } = useYearlyPnl(year);

  const error = queryError ? queryError.message || 'Không thể tải báo cáo' : null;

  const {
    fuelCost, roadCost, driverCost, maintenanceCost, companyExpenses,
    totalRevenue, otherRevenue, transRevenue, totalCosts, grossProfit, netProfit,
    totalRevenueLY, otherRevenueLY, transRevenueLY, totalCostsLY, grossProfitLY,
    companyExpensesLY, netProfitLY, activeCapTable, costPieData,
    topTrucks, categoryBreakdown, truckBreakdown, activeChartData, hasChartData,
  } = useFinanceDerived({ allTrips, report, prevReport, capTableRaw, yearlyData, month, chartView });

  const tripDetailsByTruck = useMemo(() => {
    return groupFinanceTripDetails(allTrips, report?.tripDetails);
  }, [allTrips, report?.tripDetails]);

  const toggleTruck = (truckId: number) => {
    setExpandedTruckIds((current) => {
      const next = new Set(current);
      if (next.has(truckId)) next.delete(truckId);
      else next.add(truckId);
      return next;
    });
  };


  // ── KPI counter animation ──
  const { animateCounters } = useCounterAnimation({ duration: 1200, delay: 300, stagger: 100 });

  useEffect(() => {
    if (loading || !report || prefersReduced) return;

    animateCounters([
      { el: kpiRefs.current.revenue, value: totalRevenue },
      { el: kpiRefs.current.gross, value: grossProfit },
      { el: kpiRefs.current.net, value: netProfit },
      { el: kpiRefs.current.margin, value: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0, format: (val) => val.toFixed(1) },
    ]);
  }, [report, loading, totalRevenue, grossProfit, netProfit, prefersReduced, animateCounters]);

  return (
    <div ref={rootRef} style={{ paddingBottom: 40 }}>
      <Breadcrumbs
        className="finance-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Báo cáo lãi lỗ' },
        ]}
      />
      <PageHeader
        title="Báo cáo lãi lỗ"
        iconName="profit"
        description={`Báo cáo kết quả kinh doanh Tháng ${month} / ${year} · so sánh với Tháng ${month} / ${year - 1}`}
        action={
          <div className="page-actions">
            <div className="date-chip" data-tour-id="finance-period" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--bg-2)', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
              <CalendarDays size={14} style={{ color: 'var(--brand)' }} />
              <span>Tháng {month} · <strong>{year}</strong></span>
            </div>
            <button className="btn btn--primary" onClick={async () => {
              if (!report) return;
              const headers = ['Khoản mục', `Tháng ${String(month).padStart(2,'0')}/${year}`, `Tháng ${String(month).padStart(2,'0')}/${year - 1}`];
              const rows = [
                ['Doanh thu vận tải', transRevenue, transRevenueLY],
                ['Doanh thu điều xe ngoài', report.externalMarginTotal ?? 0, prevReport?.externalMarginTotal ?? 0],
                ['Thu nhập khác', otherRevenue, otherRevenueLY],
                ['Tổng doanh thu', totalRevenue, totalRevenueLY],
                ['Nhiên liệu', fuelCost, ''],
                ['Tiền đi đường', roadCost, ''],
                ['Lương lái xe', driverCost, ''],
                ['Tổng chi phí vận hành', totalCosts, totalCostsLY],
                ['Lợi nhuận gộp', grossProfit, grossProfitLY],
                ['Lợi nhuận ròng', netProfit, netProfitLY],
              ];
              await downloadCSV(`bao-cao-lai-lo-${String(month).padStart(2, '0')}-${String(year).slice(-2)}.csv`, headers, rows, {
                title: 'BÁO CÁO LÃI LỖ',
                subtitle: `Kỳ báo cáo: Tháng ${String(month).padStart(2,'0')}/${year} · so sánh với Tháng ${String(month).padStart(2,'0')}/${year - 1}`,
                columnTypes: ['text', 'currency', 'currency'],
              });
            }}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Xuất Excel
            </button>
          </div>
        }
      />

      {/* ── KPI Hero Strip ──────────────────────────────────── */}
      <div className="pnl-kpi-strip fade-up-2" data-tour-id="finance-kpis">
        <div className="pnl-kpi">
          <div className="pnl-kpi__label">Tổng doanh thu</div>
          <div className="pnl-kpi__value"><span ref={(el) => { kpiRefs.current.revenue = el; }}>{formatNumber(totalRevenue)}</span><span className="pnl-kpi__unit">₫</span></div>
          {prevReport
            ? <div className={`pnl-kpi__delta ${totalRevenue >= totalRevenueLY ? 'pnl-kpi__delta--up' : 'pnl-kpi__delta--down'}`}>{yoyPct(totalRevenue, totalRevenueLY)} so cùng kỳ</div>
            : <div className="pnl-kpi__delta pnl-kpi__delta--neutral">—</div>
          }
          <AssetIcon name="cashflow" size={54} className="pnl-kpi__asset" />
        </div>
        <div className="pnl-kpi pnl-kpi--profit">
          <div className="pnl-kpi__label">Lợi nhuận gộp</div>
          <div className="pnl-kpi__value"><span ref={(el) => { kpiRefs.current.gross = el; }}>{formatNumber(grossProfit)}</span><span className="pnl-kpi__unit">₫</span></div>
          {prevReport
            ? <div className={`pnl-kpi__delta ${grossProfit >= grossProfitLY ? 'pnl-kpi__delta--up' : 'pnl-kpi__delta--down'}`}>{yoyPct(grossProfit, grossProfitLY)} so cùng kỳ</div>
            : <div className="pnl-kpi__delta pnl-kpi__delta--neutral">—</div>
          }
          <AssetIcon name="profit" size={54} className="pnl-kpi__asset" />
        </div>
        <div className="pnl-kpi">
          <div className="pnl-kpi__label">Biên lợi nhuận gộp</div>
          <div className="pnl-kpi__value"><span ref={(el) => { kpiRefs.current.margin = el; }}>{marginPct(grossProfit, totalRevenue)}</span><span className="pnl-kpi__unit">%</span></div>
          <div className="pnl-kpi__delta pnl-kpi__delta--neutral"
            title="Chốt sổ: chuyến đã chuyển trạng thái 'Hoàn thành' trong kỳ — doanh thu và chi phí được ghi nhận vào sổ kế toán"
          >
            {report?.tripCount ?? '—'} chuyến đã hoàn thành
          </div>
          <AssetIcon name="gross-margin" size={54} className="pnl-kpi__asset" />
        </div>
        <div className="pnl-kpi pnl-kpi--net">
          <div className="pnl-kpi__label">Lợi nhuận ròng</div>
          <div className="pnl-kpi__value"><span ref={(el) => { kpiRefs.current.net = el; }}>{formatNumber(netProfit)}</span><span className="pnl-kpi__unit">₫</span></div>
          {prevReport
            ? <div className={`pnl-kpi__delta ${netProfit >= netProfitLY ? 'pnl-kpi__delta--up' : 'pnl-kpi__delta--down'}`}>{yoyPct(netProfit, netProfitLY)} so cùng kỳ</div>
            : <div className="pnl-kpi__delta pnl-kpi__delta--neutral">—</div>
          }
          <AssetIcon name="paid" size={54} className="pnl-kpi__asset" />
        </div>
      </div>

      {error && (
        <Alert variant="error" style="soft" icon={<AlertTriangle size={16} />} className="mb-5">
          {error}
        </Alert>
      )}

      {/* ── Charts ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }} className="fade-up-3 finance-charts-row">
        {/* Revenue trend */}
        <div className="dash-wf" style={{ flex: '2 1 400px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="wf-card wf-chart" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="wf-card-h">
              <div>
                <div className="ttl">Doanh thu {chartView === 'day' ? `Tháng ${month}/${year}` : year}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="wf-chart-toggle">
                  <button className={`wf-chart-toggle__btn${chartView === 'day' ? ' is-active' : ''}`} onClick={() => setChartView('day')}>Ngày</button>
                  <button className={`wf-chart-toggle__btn${chartView === 'month' ? ' is-active' : ''}`} onClick={() => setChartView('month')}>Tháng</button>
                </div>
              </div>
            </div>
            <div className="wf-legend">
              <span className="li"><span className="sw" style={{ background: 'var(--wf-green)' }} />Doanh thu</span>
              <span className="li"><span className="sw" style={{ background: 'var(--wf-blue)' }} />Lợi nhuận gộp</span>
            </div>
            <div className="body">
              {yearlyLoading ? (
                <div style={{ padding: '40px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--wf-ink-3)', fontSize: 13, flex: 1 }}>
                  Đang tải dữ liệu...
                </div>
              ) : !hasChartData ? (
                <div style={{ padding: '40px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--wf-ink-3)', fontSize: 13, gap: 8, flex: 1 }}>
                  <EmptyIllustration name="empty-pricing" width={150} height={124} />
                  <div>
                    {chartView === 'day'
                      ? `Chưa có chuyến nào hoàn thành trong tháng ${month}/${year}`
                      : `Chưa có chuyến nào hoàn thành trong năm ${year}`}
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--wf-ink-3)' }}>Hoàn thành chuyến để xem xu hướng doanh thu</div>
                </div>
              ) : (
                <RevenueTrendChart
                  title={`Xu hướng doanh thu và lợi nhuận gộp ${chartView === 'day' ? `tháng ${month}/${year}` : `năm ${year}`}`}
                  months={activeChartData.months}
                  revenue={activeChartData.revenue}
                  gross={activeChartData.gross}
                  currentIdx={activeChartData.currentIdx}
                />
              )}
            </div>
          </div>
        </div>

        {/* Right column: cost pie + top trucks stacked */}
        <div className="panel" style={{ padding: '16px 20px', flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Cost pie */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)', marginBottom: 12 }}>
              Cơ cấu chi phí {String(month).padStart(2, '0')}/{String(year).slice(-2)}
            </div>
            {loading ? (
              <div style={{ height: 160, background: 'var(--bg-2)', borderRadius: 6 }} />
            ) : costPieData.length > 0 ? (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                {(() => {
                  const total = costPieData.reduce((s, d) => s + d.value, 0) || 1;
                  const cx = 100, cy = 100, rOuter = 80, rInner = 50;
                  let start = -Math.PI / 2;
                  const arcs = costPieData.map((d) => {
                    const angle = (d.value / total) * Math.PI * 2;
                    const end = start + angle;
                    const x1 = cx + rOuter * Math.cos(start), y1 = cy + rOuter * Math.sin(start);
                    const x2 = cx + rOuter * Math.cos(end), y2 = cy + rOuter * Math.sin(end);
                    const x3 = cx + rInner * Math.cos(end), y3 = cy + rInner * Math.sin(end);
                    const x4 = cx + rInner * Math.cos(start), y4 = cy + rInner * Math.sin(start);
                    const large = angle > Math.PI ? 1 : 0;
                    const path = `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`;
                    start = end;
                    return { path, fill: d.fill, name: d.name, value: d.value, pct: (d.value / total) * 100 };
                  });
                  return (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                        <svg viewBox="0 0 200 200" width={140} height={140} style={{ flexShrink: 0 }} role="img" aria-label={`Cơ cấu chi phí tháng ${month}/${year}`}>
                          {arcs.map((a, i) => <path key={i} d={a.path} fill={a.fill} stroke="#FFFFFF" strokeWidth={2.5} />)}
                          <text x={cx} y={cy - 7} textAnchor="middle" fontSize="12" fill="var(--ink-2)" fontFamily="var(--font-sans)">Tổng chi phí</text>
                          <text x={cx} y={cy + 11} textAnchor="middle" fontSize="14" fontWeight={700} fill="var(--ink)" fontFamily="var(--font-mono)">{compactNum(total)}</text>
                        </svg>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, width: '100%' }}>
                        {arcs.map((a, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                            <span style={{ width: 10, height: 10, background: a.fill, borderRadius: 2, flexShrink: 0 }} />
                            <span style={{ flex: 1, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                            <span style={{ fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--ink)', marginRight: 4 }}>{formatNumber(a.value)}₫</span>
                            <span style={{ color: 'var(--ink-3)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>{a.pct.toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : (
              <div style={{ height: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)', fontSize: 13, gap: 8 }}>
                <EmptyIllustration name="empty-pie" width={126} height={104} />
                <div>Chưa có dữ liệu chi phí</div>
                <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3)' }}>Hoàn thành chuyến có chi tiết nhiên liệu/đường để xem cơ cấu</div>
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ margin: '16px 0', borderTop: '1px solid var(--line)' }} />

          {/* Top trucks */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)', marginBottom: 10 }}>
              Top xe theo lợi nhuận – {String(month).padStart(2, '0')}/{String(year).slice(-2)}
            </div>
            {loading ? (
              <div style={{ height: 80, background: 'var(--bg-2)', borderRadius: 6 }} />
            ) : topTrucks.length === 0 ? (
              <div style={{ height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)', fontSize: 12 }}>
                Chưa có xe nào có chuyến hoàn thành trong tháng này
              </div>
            ) : (
              (() => {
                const maxProfit = Math.max(...topTrucks.map(t => t['LN gộp']), 1);
                const minProfit = Math.min(...topTrucks.map(t => t['LN gộp']), 0);
                const totalRange = maxProfit - minProfit;
                const svgH = topTrucks.length * 32;
                const plateW = 65;
                const valW = 75;
                const barTrackW = 280 - plateW - valW - 10;
                const zeroX = minProfit < 0 ? (plateW + 5) + (Math.abs(minProfit) / totalRange) * barTrackW : (plateW + 5);
                return (
                  <svg width="100%" height={svgH} viewBox={`0 0 280 ${svgH}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Top xe theo lợi nhuận tháng ${month}/${year}`}>
                    {topTrucks.map((t, i) => {
                      const val = t['LN gộp'];
                      const isNegative = val < 0;
                      const w = Math.max(2, (Math.abs(val) / totalRange) * barTrackW);
                      const barX = isNegative ? zeroX - w : zeroX;
                      const fill = isNegative ? 'var(--danger)' : '#059669';
                      return (
                        <g key={i} transform={`translate(0, ${i * 32})`}>
                          <text x={0} y={15} fontSize="12" fontFamily="var(--font-mono)" fontWeight={600} fill="var(--ink-2)" textAnchor="start">{t.name}</text>
                          <rect x={barX} y={4} width={w} height={14} fill={fill} rx={3} opacity={0.85} />
                          {minProfit < 0 && (
                            <line x1={zeroX} y1={0} x2={zeroX} y2={24} stroke="var(--line-2)" strokeWidth={1} strokeDasharray="2,2" />
                          )}
                          <text x={280} y={15} fontSize="11" fill={isNegative ? 'var(--danger)' : 'var(--ink-2)'} fontWeight={isNegative ? 600 : 500} textAnchor="end">{formatNumber(val)}₫</text>
                        </g>
                      );
                    })}
                  </svg>
                );
              })()
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-3)' }}>
          Đang tổng hợp báo cáo tài chính chặng...
        </div>
      ) : (
        <>
          {/* P&L Table with real data */}
          <div className="pnl-table fade-up-3" style={{ marginBottom: 24 }}>
            <div className="pnl-head">
              <div>Khoản mục</div>
              <div className="pnl-head__amount">Tháng {month} / {year}</div>
              <div className="pnl-head__yoy">Tháng {month} / {year - 1}</div>
              <div className="pnl-head__pct">YoY</div>
            </div>

            {/* REVENUE */}
            <div className="pnl-row pnl-row--section">
              <div>Doanh thu</div>
              <div></div><div></div><div></div>
            </div>

            <div className="pnl-row">
              <div className="pnl-row__label">
                Doanh thu vận tải
                <div className="pnl-row__label-sub">{report?.tripCount ?? 0} chuyến × giá cước chặng</div>
              </div>
              <div className="pnl-row__amount">{formatNumber(transRevenue)}</div>
              <div className="pnl-row__yoy">{prevReport ? formatNumber(transRevenueLY) : '—'}</div>
              <div className={`pnl-row__pct ${prevReport ? yoyClass(transRevenue, transRevenueLY) : ''}`}>{prevReport ? yoyPct(transRevenue, transRevenueLY) : '—'}</div>
            </div>

            {(report?.externalMarginTotal ?? 0) !== 0 && (
            <div className="pnl-row">
              <div className="pnl-row__label">
                Doanh thu điều xe ngoài
                <div className="pnl-row__label-sub">Lãi quản lý từ {report?.externalTripsCount ?? 0} chuyến ngoài</div>
              </div>
              <div className="pnl-row__amount">{formatNumber(report?.externalMarginTotal ?? 0)}</div>
              <div className="pnl-row__yoy">—</div>
              <div className="pnl-row__pct">—</div>
            </div>
            )}

            {(report?.serviceMarginTotal ?? 0) !== 0 && (
            <div className="pnl-row">
              <div className="pnl-row__label">
                Lãi dịch vụ đi kèm
                <div className="pnl-row__label-sub">Lãi từ dịch vụ phụ trợ</div>
              </div>
              <div className="pnl-row__amount">{formatNumber(report?.serviceMarginTotal ?? 0)}</div>
              <div className="pnl-row__yoy">—</div>
              <div className="pnl-row__pct">—</div>
            </div>
            )}

            <div className="pnl-row">
              <div className="pnl-row__label">
                Thu nhập phạt vi phạm
                <div className="pnl-row__label-sub">Phạt vi phạm, điều chỉnh khác</div>
              </div>
              <div className="pnl-row__amount">{formatNumber(otherRevenue)}</div>
              <div className="pnl-row__yoy">{prevReport ? formatNumber(otherRevenueLY) : '—'}</div>
              <div className={`pnl-row__pct ${prevReport ? yoyClass(otherRevenue, otherRevenueLY) : ''}`}>{prevReport ? yoyPct(otherRevenue, otherRevenueLY) : '—'}</div>
            </div>

            <div className="pnl-row pnl-row--subtotal">
              <div className="pnl-row__label">Tổng doanh thu</div>
              <div className="pnl-row__amount">{formatNumber(totalRevenue)}</div>
              <div className="pnl-row__yoy">{prevReport ? formatNumber(totalRevenueLY) : '—'}</div>
              <div className={`pnl-row__pct ${prevReport ? yoyClass(totalRevenue, totalRevenueLY) : ''}`}>{prevReport ? yoyPct(totalRevenue, totalRevenueLY) : '—'}</div>
            </div>

            {/* DIRECT COSTS */}
            <div className="pnl-row pnl-row--section">
              <div>Chi phí trực tiếp</div>
              <div></div><div></div><div></div>
            </div>

            <div className="pnl-row">
              <div className="pnl-row__label">
                Nhiên liệu
                <div className="pnl-row__label-sub">Dầu DO xe đầu kéo chạy chặng</div>
              </div>
              <div className="pnl-row__amount">{formatNumber(fuelCost)}</div>
              <div className="pnl-row__yoy">—</div><div className="pnl-row__pct">—</div>
            </div>

            <div className="pnl-row">
              <div className="pnl-row__label">
                Tiền đi đường
                <div className="pnl-row__label-sub">Vé BOT cầu đường &amp; luật đường</div>
              </div>
              <div className="pnl-row__amount">{formatNumber(roadCost)}</div>
              <div className="pnl-row__yoy">—</div><div className="pnl-row__pct">—</div>
            </div>

            <div className="pnl-row">
              <div className="pnl-row__label">
                Lương lái xe
                <div className="pnl-row__label-sub">Lương cơ bản + khoán chuyến + phụ cấp</div>
              </div>
              <div className="pnl-row__amount">{formatNumber(driverCost)}</div>
              <div className="pnl-row__yoy">—</div><div className="pnl-row__pct">—</div>
            </div>

            {maintenanceCost > 0 && (
            <div className="pnl-row">
              <div className="pnl-row__label">
                Bảo dưỡng &amp; sửa chữa
                <div className="pnl-row__label-sub">Chi phí bảo dưỡng xe đầu kéo</div>
              </div>
              <div className="pnl-row__amount">{formatNumber(maintenanceCost)}</div>
              <div className="pnl-row__yoy">—</div><div className="pnl-row__pct">—</div>
            </div>
            )}

            <div className="pnl-row pnl-row--subtotal">
              <div className="pnl-row__label">Tổng chi phí vận hành</div>
              <div className="pnl-row__amount">{formatNumber(totalCosts)}</div>
              <div className="pnl-row__yoy">{prevReport ? formatNumber(totalCostsLY) : '—'}</div>
              <div className={`pnl-row__pct ${prevReport ? yoyClass(totalCosts, totalCostsLY) : ''}`}>{prevReport ? yoyPct(totalCosts, totalCostsLY) : '—'}</div>
            </div>

            <div className="pnl-row pnl-row--subtotal" style={{ background: 'var(--success-soft)' }}>
              <div className="pnl-row__label" style={{ color: 'var(--success)', fontWeight: 700 }}>
                Lợi nhuận gộp · Biên {marginPct(grossProfit, totalRevenue)}%
              </div>
              <div className="pnl-row__amount" style={{ color: 'var(--success)', fontWeight: 700 }}>{formatNumber(grossProfit)}</div>
              <div className="pnl-row__yoy" style={{ color: 'var(--success)' }}>{prevReport ? formatNumber(grossProfitLY) : '—'}</div>
              <div className={`pnl-row__pct ${prevReport ? yoyClass(grossProfit, grossProfitLY) : ''}`}>{prevReport ? yoyPct(grossProfit, grossProfitLY) : '—'}</div>
            </div>

            {companyExpenses > 0 && (
            <div className="pnl-row">
              <div className="pnl-row__label">
                Chi phí công ty
                <div className="pnl-row__label-sub">Bảo hiểm, đăng kiểm, phí cố định khác</div>
              </div>
              <div className="pnl-row__amount">{formatNumber(companyExpenses)}</div>
              <div className="pnl-row__yoy">{prevReport ? formatNumber(companyExpensesLY) : '—'}</div>
              <div className={`pnl-row__pct ${prevReport ? yoyClass(companyExpenses, companyExpensesLY) : ''}`}>{prevReport ? yoyPct(companyExpenses, companyExpensesLY) : '—'}</div>
            </div>
            )}

            {companyExpenses > 0 && (
              <div className="pnl-row pnl-row--subtotal">
                <div className="pnl-row__label">Tổng chi phí hoạt động</div>
                <div className="pnl-row__amount">{formatNumber(companyExpenses)}</div>
                <div className="pnl-row__yoy">{prevReport ? formatNumber(companyExpensesLY) : '—'}</div>
                <div className={`pnl-row__pct ${prevReport ? yoyClass(companyExpenses, companyExpensesLY) : ''}`}>{prevReport ? yoyPct(companyExpenses, companyExpensesLY) : '—'}</div>
              </div>
            )}

            {/* FINAL NET PROFIT */}
            <div className="pnl-row pnl-row--final">
              <div className="pnl-row__label" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, fontSize: 12 }}>
                Lợi nhuận ròng
              </div>
              <div className="pnl-row__amount">{formatNumber(netProfit)} ₫</div>
              <div className="pnl-row__yoy">{prevReport ? formatNumber(netProfitLY) : '—'}</div>
              <div className={`pnl-row__pct ${prevReport ? yoyClass(netProfit, netProfitLY) : ''}`}>{prevReport ? yoyPct(netProfit, netProfitLY) : '—'}</div>
            </div>
          </div>

          <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: '14px 0 24px', lineHeight: 1.5 }}>
            * Lợi nhuận ròng kế toán: <strong>{formatNumber(netProfit)} ₫</strong>.
            {activeCapTable.length > 0
              ? <> Sau khi kết chuyển chia cổ đông: {activeCapTable.map((p, i) => <span key={i}>{i > 0 ? ' và ' : ''}<strong>{formatNumber(netProfit * p.pct / 100)} ₫</strong> cho {p.name} ({p.pct}%)</span>)}.</>
              : ' Chưa cấu hình bảng cổ phần.'
            }{' '}
            <Link to='/profit'
              style={{ color: 'var(--brand)', display: 'inline-flex', alignItems: 'center', fontWeight: 600, textDecoration: 'none' }}
            >
              Xem chi tiết cổ phần →
            </Link>
          </p>

          {/* Per-truck breakdown — from all active trips */}
          {truckBreakdown.length > 0 && (
            <Panel
              title="Phân tích lãi gộp theo phương tiện"
              subtitle={`Hiệu suất vận tải chi tiết của ${truckBreakdown.length} đầu xe`}
              style={{ marginTop: 20 }}
              flush
            >
              {/* ── Mobile card list (≤640px) ──────────────────────────────── */}
              <div className="mobile-only">
                <div className="truck-card-list">
                  {truckBreakdown.map(t => {
                    const margin = t.revenue > 0 ? ((t.profit / t.revenue) * 100).toFixed(1) : '0.0';
                    const barPct = t.revenue > 0 ? Math.min(100, Math.max(0, (t.profit / t.revenue) * 100)) : 0;
                    const maintComp = report?.maintenanceByComponent?.[t.id] ?? { truck: 0, trailer: 0 };
                    const isExpanded = expandedTruckIds.has(t.id);
                    const tripDetails = tripDetailsByTruck.get(t.id) ?? [];
                    return (
                      <div key={t.id} className={`truck-card${isExpanded ? ' truck-card--expanded' : ''}`}>
                        <button
                          type="button"
                          className="truck-card__toggle"
                          onClick={() => toggleTruck(t.id)}
                          aria-expanded={isExpanded}
                          aria-controls={`truck-mobile-details-${t.id}`}
                        >
                        <div className="truck-card__header">
                          <span className="truck-card__plate">
                            <ChevronDown className="truck-expand-icon" size={16} aria-hidden="true" />
                            {t.plate}
                          </span>
                          <span className={`truck-card__profit ${t.profit >= 0 ? 'truck-card__profit--up' : 'truck-card__profit--down'}`}>
                            {formatNumber(t.profit)}₫
                          </span>
                        </div>
                        <div className="truck-card__stats">
                          <div className="truck-card__stat">
                            <span className="truck-card__stat-label">Lệnh</span>
                            <span className="truck-card__stat-value">{t.trips}</span>
                          </div>
                          <div className="truck-card__stat">
                            <span className="truck-card__stat-label">Doanh thu</span>
                            <span className="truck-card__stat-value">{formatNumber(t.revenue)}</span>
                          </div>
                          <div className="truck-card__stat">
                            <span className="truck-card__stat-label">Chi phí</span>
                            <span className="truck-card__stat-value">{formatNumber(t.costs)}</span>
                          </div>
                          {(maintComp.truck > 0 || maintComp.trailer > 0) && (
                            <div className="truck-card__stat">
                              <span className="truck-card__stat-label">Bảo dưỡng</span>
                              <span className="truck-card__stat-value">
                                {maintComp.truck > 0 ? `${formatNumber(maintComp.truck)} ĐK` : ''}
                                {maintComp.truck > 0 && maintComp.trailer > 0 ? ' · ' : ''}
                                {maintComp.trailer > 0 ? `${formatNumber(maintComp.trailer)} RM` : ''}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="truck-card__bar-track">
                          <div
                            className={`truck-card__bar-fill ${t.profit >= 0 ? 'truck-card__bar-fill--up' : 'truck-card__bar-fill--down'}`}
                            style={{ width: `${Math.min(100, Math.abs(barPct))}%` }}
                          />
                        </div>
                        <div className="truck-card__margin">
                          Biên LN {margin}% · Bấm để {isExpanded ? 'thu gọn' : 'xem từng lệnh'}
                        </div>
                        </button>
                        {isExpanded && (
                          <div id={`truck-mobile-details-${t.id}`} className="truck-mobile-details">
                            {tripDetails.map(detail => (
                              <div className="truck-trip-card" key={detail.id}>
                                <div className="truck-trip-card__head">
                                  <div>
                                    <Link to={`/trips/${detail.id}`} className="truck-trip-link">
                                      {detail.tripCode}<ExternalLink size={12} aria-hidden="true" />
                                    </Link>
                                    <div>{detail.routeName} · {new Date(detail.departureDate).toLocaleDateString('vi-VN')}</div>
                                  </div>
                                  <CostCheck matches={detail.costMatches} difference={detail.costDifference} />
                                </div>
                                <div className="truck-trip-card__grid">
                                  <TripAmount label="Doanh thu ghi nhận" value={detail.revenue} />
                                  <TripAmount label="Hoa hồng KH" value={detail.customerCommission} />
                                  <TripAmount label={detail.isExternal ? 'Thuê xe' : 'Nhiên liệu'} value={detail.fuelOrHireCost} />
                                  <TripAmount label="Đi đường" value={detail.roadAllowance} />
                                  <TripAmount label="Phí trạm/vé CT" value={detail.tollAndCompanyTickets} />
                                  <TripAmount label="Lương & phụ cấp" value={detail.driverAndAllowances} />
                                  <TripAmount label="Tổng chi phí" value={detail.totalCost} />
                                  <TripAmount label="Lợi nhuận" value={detail.profit} emphasized />
                                </div>
                              </div>
                            ))}
                            <MaintenanceDetails
                              truck={maintComp.truck}
                              trailer={maintComp.trailer}
                              items={report?.maintenanceItemsByTruck?.[t.id] ?? []}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Desktop table (>640px) ─────────────────────────────────── */}
              <div className="desktop-only">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Biển số xe</th>
                        <th className="num">Lệnh</th>
                        <th className="num">Doanh thu chặng</th>
                        <th className="num">Tổng chi phí</th>
                        {maintenanceCost > 0 && (
                          <>
                            <th className="num">BD đầu kéo</th>
                            <th className="num">BD rơ-mooc</th>
                          </>
                        )}
                        <th className="num">Lợi nhuận gộp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {truckBreakdown.map(t => {
                        const maintComp = report?.maintenanceByComponent?.[t.id] ?? { truck: 0, trailer: 0 };
                        const isExpanded = expandedTruckIds.has(t.id);
                        const tripDetails = tripDetailsByTruck.get(t.id) ?? [];
                        return (
                          <Fragment key={t.id}>
                            <tr className={`truck-summary-row${isExpanded ? ' is-expanded' : ''}`}>
                              <td style={{ fontWeight: 600, color: t.id === 0 ? 'var(--fg-3)' : 'var(--fg-1)', fontStyle: t.id === 0 ? 'italic' : 'normal' }}>
                                <button
                                  type="button"
                                  className="truck-row-toggle"
                                  onClick={() => toggleTruck(t.id)}
                                  aria-expanded={isExpanded}
                                  aria-controls={`truck-details-${t.id}`}
                                >
                                  <ChevronDown className="truck-expand-icon" size={16} aria-hidden="true" />
                                  <span>{t.plate}</span>
                                  <span className="truck-row-toggle__hint">{isExpanded ? 'Thu gọn' : 'Xem chi tiết'}</span>
                                </button>
                              </td>
                              <td className="num">{t.trips}</td>
                              <td className="num">{formatNumber(t.revenue)}</td>
                              <td className="num">{formatNumber(t.costs)}</td>
                              {maintenanceCost > 0 && (
                                <>
                                  <td className="num">{maintComp.truck > 0 ? formatNumber(maintComp.truck) : '—'}</td>
                                  <td className="num">{maintComp.trailer > 0 ? formatNumber(maintComp.trailer) : '—'}</td>
                                </>
                              )}
                              <td className="num" style={{ color: t.profit >= 0 ? 'var(--brand)' : 'var(--danger)', fontWeight: 700 }}>
                                {formatNumber(t.profit)}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr id={`truck-details-${t.id}`} className="truck-details-row">
                                <td colSpan={maintenanceCost > 0 ? 7 : 5}>
                                  <div className="truck-details-panel">
                                    <div className="truck-details-panel__intro">
                                      <span><strong>{tripDetails.length}/{t.trips}</strong> lệnh trong kỳ</span>
                                      <span>“Khớp” chỉ xác nhận phép cộng các khoản bằng tổng chi phí đã lưu.</span>
                                    </div>
                                    <div className="truck-trip-table-wrap">
                                      <table className="truck-trip-table">
                                        <thead>
                                          <tr>
                                            <th>Lệnh / tuyến</th>
                                            <th className="num">Doanh thu ghi nhận</th>
                                            <th className="num">Hoa hồng KH</th>
                                            <th className="num">Nhiên liệu / thuê xe</th>
                                            <th className="num">Đi đường</th>
                                            <th className="num">Phí trạm / vé CT</th>
                                            <th className="num">Lương & phụ cấp</th>
                                            <th className="num">Tổng chi phí</th>
                                            <th className="num">Lợi nhuận</th>
                                            <th>Đối chiếu</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {tripDetails.map(detail => (
                                            <tr key={detail.id}>
                                              <td>
                                                <Link to={`/trips/${detail.id}`} className="truck-trip-link">
                                                  {detail.tripCode}<ExternalLink size={12} aria-hidden="true" />
                                                </Link>
                                                <div className="truck-trip-route">{detail.routeName} · {new Date(detail.departureDate).toLocaleDateString('vi-VN')}</div>
                                              </td>
                                              <td className="num">{formatNumber(detail.revenue)}</td>
                                              <td className="num">{detail.customerCommission ? formatNumber(detail.customerCommission) : '—'}</td>
                                              <td className="num">{formatNumber(detail.fuelOrHireCost)}</td>
                                              <td className="num">{detail.roadAllowance ? formatNumber(detail.roadAllowance) : '—'}</td>
                                              <td className="num">{detail.tollAndCompanyTickets ? formatNumber(detail.tollAndCompanyTickets) : '—'}</td>
                                              <td className="num">{detail.driverAndAllowances ? formatNumber(detail.driverAndAllowances) : '—'}</td>
                                              <td className="num"><strong>{formatNumber(detail.totalCost)}</strong></td>
                                              <td className="num" style={{ color: detail.profit >= 0 ? 'var(--brand)' : 'var(--danger)', fontWeight: 700 }}>{formatNumber(detail.profit)}</td>
                                              <td><CostCheck matches={detail.costMatches} difference={detail.costDifference} /></td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    <MaintenanceDetails
                                      truck={maintComp.truck}
                                      trailer={maintComp.trailer}
                                      items={report?.maintenanceItemsByTruck?.[t.id] ?? []}
                                    />
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </Panel>
          )}

          {/* Expense category breakdown */}
          {categoryBreakdown.length > 0 && (
            <Panel
              title="Cơ cấu chi phí theo hạng mục"
              subtitle={`Tổng hợp chi phí ${String(month).padStart(2, '0')}/${String(year).slice(-2)} phân theo loại`}
              style={{ marginTop: 20 }}
              flush
            >
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Hạng mục</th>
                      <th className="num" style={{ width: 200 }}>Tổng chi phí</th>
                      <th style={{ width: 200 }}>Tỷ trọng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const grandTotal = categoryBreakdown.reduce((s, c) => s + c.total, 0) || 1;
                      return categoryBreakdown.map((cat, i) => {
                        const pct = (cat.total / grandTotal) * 100;
                        return (
                          <tr key={i}>
                            <td style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{cat.categoryName}</td>
                            <td className="num">{formatNumber(cat.total)} ₫</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                                  <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: 'var(--brand)' }} />
                                </div>
                                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', minWidth: 40, textAlign: 'right' }}>
                                  {pct.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function CostCheck({ matches, difference }: { matches: boolean; difference: number }) {
  return matches ? (
    <span className="cost-check cost-check--ok" title="Các khoản chi phí cộng lại khớp với tổng chi phí đã lưu">
      <CheckCircle2 size={14} aria-hidden="true" /> Khớp
    </span>
  ) : (
    <span className="cost-check cost-check--warning" title={`Chênh ${formatNumber(Math.abs(difference))} ₫ so với tổng chi phí đã lưu`}>
      <AlertTriangle size={14} aria-hidden="true" /> Cần kiểm tra {formatNumber(Math.abs(difference))}₫
    </span>
  );
}

function TripAmount({ label, value, emphasized = false }: { label: string; value: number; emphasized?: boolean }) {
  return (
    <div className={emphasized ? 'truck-trip-amount truck-trip-amount--emphasized' : 'truck-trip-amount'}>
      <span>{label}</span>
      <strong>{formatNumber(value)}₫</strong>
    </div>
  );
}

function MaintenanceDetails({ truck, trailer, items }: { truck: number; trailer: number; items: PnlMaintenanceItem[] }) {
  if (truck <= 0 && trailer <= 0) return null;
  return (
    <div className="truck-maintenance-details">
      <div className="truck-maintenance-note">
        Chi phí phát sinh ngoài từng lệnh trong kỳ:
        {truck > 0 ? <> đầu kéo <strong>{formatNumber(truck)}₫</strong></> : null}
        {truck > 0 && trailer > 0 ? ' · ' : null}
        {trailer > 0 ? <> rơ-moóc <strong>{formatNumber(trailer)}₫</strong></> : null}.
      </div>
      {items.length > 0 && (
        <div className="truck-maintenance-list">
          {items.map(item => (
            <Link key={item.id} to={`/expenses/${item.id}/edit`} className="truck-maintenance-item">
              <span className="truck-maintenance-item__main">
                <strong>{item.categoryName}</strong>
                <small>
                  {item.vehicleComponent === 'TRAILER' ? 'Rơ-moóc' : 'Đầu kéo'} · {item.supplierName} · {new Date(item.expenseDate).toLocaleDateString('vi-VN')}
                  {item.note ? ` · ${item.note}` : ''}
                </small>
              </span>
              <span className="truck-maintenance-item__amount">{formatNumber(item.amount)}₫ <ExternalLink size={12} aria-hidden="true" /></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
