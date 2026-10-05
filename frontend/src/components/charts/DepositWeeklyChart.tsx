import { useEffect, useId, useRef, useState } from 'react';
import { formatCompact, formatCurrency, formatNumber } from '../../lib/format';
import { useChartTooltipPosition } from './useChartTooltipPosition';

/**
 * Weekly container-deposit chart — 'Tổng quát về tiền' block on the
 * accounting overview (card 369 / REQ-5.10-01).
 *
 * House inline-SVG pattern copied structurally from RevenueTrendChart:
 * responsive width via ResizeObserver, invisible per-week hit areas, and an
 * HTML tooltip overlay placed by useChartTooltipPosition so popups never
 * overflow their clipping ancestors. Grouped bars, 3 per week: 'Số lượng'
 * (count) scaled to its own right axis, 'Tiền cược' + 'Đã hoàn cược' sharing
 * the money axis on the left. No chart library.
 */

export interface DepositWeekRow {
  /** Monday of the calendar week, YYYY-MM-DD. */
  weekStart: string;
  /** Display label, e.g. 'Tuần 01/09'. */
  label: string;
  /** Container count for the week. */
  count: number;
  /** Total deposit for the week, raw VND. */
  depositAmount: number;
  /** Deposits refunded in the week (status DA_HOAN_CUOC), raw VND. */
  refundedAmount: number;
}

export interface DepositWeeklyChartProps {
  /** Calendar weeks Mon–Sun covering the requested range; empty weeks zeroed. */
  weeks: DepositWeekRow[];
  /** Compact formatter for the money axis labels */
  formatY?: (v: number) => string;
  /** Full formatter for money values in the tooltip */
  formatTooltip?: (v: number) => string;
  /** Custom SVG dimensions — defaults to Dashboard standard 760×280 */
  width?: number;
  height?: number;
}

type SeriesKey = 'count' | 'deposit' | 'refund';

const SERIES: { key: SeriesKey; label: string; color: string; axis: 'money' | 'count' }[] = [
  { key: 'count', label: 'Số lượng', color: 'var(--ink-3)', axis: 'count' },
  { key: 'deposit', label: 'Tiền cược', color: '#005A2D', axis: 'money' },
  { key: 'refund', label: 'Đã hoàn cược', color: 'var(--info)', axis: 'money' },
];

function seriesValue(row: DepositWeekRow, key: SeriesKey): number {
  return key === 'count' ? row.count : key === 'deposit' ? row.depositAmount : row.refundedAmount;
}

/** Round a tick step up to 1/2/5×10ⁿ so every grid caption stays distinct. */
function niceTick(peak: number): number {
  if (!(peak > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(peak));
  const mant = peak / base;
  return (mant <= 1 ? 1 : mant <= 2 ? 2 : mant <= 5 ? 5 : 10) * base;
}

export function DepositWeeklyChart({
  weeks,
  formatY,
  formatTooltip,
  width: initialW = 760,
  height: initialH = 280,
}: DepositWeeklyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: initialW, height: initialH });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setDimensions({ width, height });
      }
    });

    resizeObserver.observe(el);
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const W = dimensions.width;
  const H = dimensions.height;
  const chartTitleId = useId();
  const chartDescriptionId = useId();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const activeIdx = hoverIdx !== null && hoverIdx < weeks.length ? hoverIdx : null;

  const mL = 52, mR = 40, mT = 14, mB = 30;
  const pW = Math.max(0, W - mL - mR), pH = Math.max(0, H - mT - mB);

  // Money shares the left axis, count its own right axis — so a busy deposit
  // week never flattens the count bars (and vice versa).
  const moneyPeak = Math.max(0, ...weeks.map((row) => Math.max(row.depositAmount, row.refundedAmount)));
  const countPeak = Math.max(0, ...weeks.map((row) => row.count));
  const moneyMax = niceTick(moneyPeak / 4) * 4;
  const countMax = Math.max(4, Math.ceil(countPeak / 4) * 4);

  const slot = pW / Math.max(1, weeks.length);
  const barGap = 4;
  const barW = Math.max(2, Math.min(26, (slot * 0.66 - barGap * 2) / 3));
  const groupW = barW * 3 + barGap * 2;

  const barX = (i: number, s: number) => mL + slot * i + (slot - groupW) / 2 + s * (barW + barGap);
  const yOf = (v: number, axis: 'money' | 'count') =>
    mT + pH * (1 - v / (axis === 'money' ? moneyMax : countMax));

  const ax = activeIdx !== null ? mL + slot * (activeIdx + 0.5) : 0;
  const ay = activeIdx !== null
    ? Math.min(...SERIES.map((s) => yOf(seriesValue(weeks[activeIdx], s.key), s.axis)))
    : 0;
  useChartTooltipPosition({
    isOpen: activeIdx !== null, containerRef, tooltipRef, anchorX: ax, anchorY: ay,
    chartWidth: W, chartHeight: H,
    alignment: activeIdx === 0 ? 'start' : activeIdx === weeks.length - 1 ? 'end' : 'center',
  });

  const fmtY = formatY ?? formatCompact;
  const fmtTip = formatTooltip ?? formatCurrency;
  const fmtCount = (v: number) => formatNumber(Math.round(v));
  const last = weeks[Math.max(0, weeks.length - 1)];
  const chartDescription = weeks.length > 0
    ? `${weeks.length} tuần. ${last.label}: ${fmtCount(last.count)} container, tiền cược ${fmtTip(last.depositAmount)}, đã hoàn cược ${fmtTip(last.refundedAmount)}.`
    : 'Chưa có dữ liệu cược trong kỳ.';
  const gridTicks = Array.from({ length: 5 }, (_, i) => i);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', height: '100%' }}>
      {weeks.length === 0 ? (
        <div
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-data)', fontSize: '13px', color: '#56655C',
          }}
        >
          Chưa có dữ liệu cược trong kỳ
        </div>
      ) : (
        <>
          {/* Legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 18px' }}>
            {SERIES.map((s) => (
              <div
                key={s.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontFamily: 'var(--font-data)', fontSize: '12px', color: '#56655C', whiteSpace: 'nowrap',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                {s.label}
              </div>
            ))}
          </div>

          <div
            ref={containerRef}
            style={{ position: 'relative', width: '100%', flex: 1, minHeight: 0 }}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <svg
              role="img"
              aria-labelledby={`${chartTitleId} ${chartDescriptionId}`}
              viewBox={`0 0 ${W} ${H}`}
              xmlns="http://www.w3.org/2000/svg"
              style={{ display: 'block', width: '100%', height: '100%', overflow: 'visible' }}
            >
              <title id={chartTitleId}>Tiền cược container theo tuần</title>
              <desc id={chartDescriptionId}>{chartDescription}</desc>

              {/* Grid lines — left captions are money, right captions are count */}
              {gridTicks.map((i) => (
                <g key={i}>
                  <line x1={mL} y1={yOf((moneyMax * i) / 4, 'money')} x2={W - mR} y2={yOf((moneyMax * i) / 4, 'money')} stroke="#EEF1EF" strokeWidth="1" />
                  <text x={mL - 10} y={yOf((moneyMax * i) / 4, 'money') + 3.5} textAnchor="end" fontFamily="var(--font-data)" fontSize="11" fill="#56655C">
                    {fmtY((moneyMax * i) / 4)}
                  </text>
                  <text x={W - mR + 10} y={yOf((countMax * i) / 4, 'count') + 3.5} textAnchor="start" fontFamily="var(--font-data)" fontSize="11" fill="#56655C">
                    {fmtCount((countMax * i) / 4)}
                  </text>
                </g>
              ))}

              {/* Zero baseline */}
              <line x1={mL} y1={mT + pH} x2={W - mR} y2={mT + pH} stroke="#E2E8E5" strokeWidth="1" />

              {/* X-axis week labels — visible even for zero weeks */}
              {weeks.map((row, i) => (
                <text
                  key={row.weekStart}
                  x={mL + slot * (i + 0.5)}
                  y={H - 10}
                  textAnchor="middle"
                  fontFamily="var(--font-data)"
                  fontSize="11"
                  fill={i === activeIdx ? '#005A2D' : '#8A988F'}
                  fontWeight={i === activeIdx ? '700' : '400'}
                >
                  {row.label}
                </text>
              ))}

              {/* Grouped bars — 3 per week (count / deposit / refunded) */}
              {weeks.map((row, i) =>
                SERIES.map((s, si) => {
                  const top = yOf(seriesValue(row, s.key), s.axis);
                  return (
                    <rect
                      key={`${row.weekStart}-${s.key}`}
                      data-chart-bar={s.key}
                      data-week-index={i}
                      x={barX(i, si)}
                      y={top}
                      width={barW}
                      height={Math.max(0, mT + pH - top)}
                      fill={s.color}
                      opacity={s.axis === 'count' ? 0.75 : 1}
                    />
                  );
                }),
              )}

              {/* Hover crosshair */}
              {activeIdx !== null && (
                <line x1={ax} y1={mT} x2={ax} y2={mT + pH} stroke="#005A2D" strokeWidth="1" strokeDasharray="3 4" opacity={0.45} />
              )}

              {/* Invisible hit areas — one per week column */}
              {weeks.map((row, i) => (
                <rect
                  key={`hit-${row.weekStart}`}
                  x={mL + slot * i}
                  y={mT}
                  width={slot}
                  height={pH}
                  fill="transparent"
                  style={{ cursor: 'crosshair' }}
                  onMouseEnter={() => setHoverIdx(i)}
                />
              ))}
            </svg>

            {/* HTML tooltip overlay */}
            {activeIdx !== null && (
              <div
                ref={tooltipRef}
                data-chart-tooltip=""
                style={{
                  position: 'absolute',
                  left: 'var(--chart-tooltip-left, 0px)',
                  top: 'var(--chart-tooltip-top, 0px)',
                  background: 'var(--surface)',
                  borderRadius: '8px',
                  border: '1px solid #E2E8E5',
                  padding: '10px 14px',
                  pointerEvents: 'none',
                  width: 'max-content',
                  minWidth: 'var(--chart-tooltip-min-width, 192px)',
                  maxWidth: 'var(--chart-tooltip-max-width, calc(100% - 8px))',
                  zIndex: 10,
                }}
              >
                <div style={{ textAlign: 'center', fontFamily: 'var(--font-data)', fontSize: '12px', fontWeight: 600, color: '#56655C', marginBottom: '8px' }}>
                  {weeks[activeIdx].label}
                </div>
                <div style={{ height: 1, background: '#EEF1EF', margin: '0 -14px 8px -14px' }} />
                {SERIES.map((s, si) => (
                  <div
                    key={s.key}
                    style={{
                      display: 'flex', flexWrap: 'wrap', columnGap: '12px', rowGap: 'var(--space-xs)',
                      justifyContent: 'space-between', alignItems: 'center',
                      marginBottom: si < SERIES.length - 1 ? '6px' : 0,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-data)', fontSize: '12px', color: '#56655C', whiteSpace: 'nowrap' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                      {s.label}
                    </div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '12.5px', fontWeight: 700, color: '#005A2D', whiteSpace: 'nowrap' }}>
                      {s.axis === 'money'
                        ? fmtTip(seriesValue(weeks[activeIdx], s.key))
                        : fmtCount(seriesValue(weeks[activeIdx], s.key))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
