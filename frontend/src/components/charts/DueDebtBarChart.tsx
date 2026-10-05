import { useEffect, useId, useRef, useState } from 'react';
import { formatCompact, formatCurrency, formatNumber } from '../../lib/format';
import { useChartTooltipPosition } from './useChartTooltipPosition';

/**
 * 4-column due-debt bar chart — 'Tổng quát về tiền' block on the accounting
 * overview (card 370 / REQ-5.10-02). One bar per due-debt group on a shared
 * money axis; the distinct-customer count is a secondary label under each
 * column ('3 khách'). Colors escalate with lateness: the upcoming-due group is
 * the success tone, overdue groups run warning → warning-deep → danger
 * (mirroring the debt aging dots in features/debt/aging.ts).
 *
 * House inline-SVG pattern copied structurally from RevenueTrendChart and
 * DepositWeeklyChart: responsive width via ResizeObserver, invisible per-column
 * hit areas, data-chart-* test seams, and an HTML tooltip overlay placed by
 * useChartTooltipPosition so popups never overflow their clipping ancestors.
 * The tooltip is exposed to assistive tech as role="tooltip" linked from the
 * chart's aria-describedby, and its content is mirrored in the SVG <desc>.
 * No chart library.
 */

export interface DueDebtGroup {
  key: 'dueSoon5d' | 'overdue1to10' | 'overdue11to30' | 'overdue30plus';
  /** Verbatim group caption shown under the column, e.g. 'Quá hạn 1–10 ngày'. */
  label: string;
  /** Outstanding amount of the group's obligations, raw VND. */
  amount: number;
  /** Distinct customers with at least one obligation in the group. */
  customers: number;
}

export interface DueDebtBarChartProps {
  /** Due-debt groups in contract order; labels rendered verbatim. */
  groups: DueDebtGroup[];
  /** Custom SVG dimensions — defaults to Dashboard standard 760×280 */
  width?: number;
  height?: number;
  /** Compact formatter for the money axis labels */
  formatY?: (v: number) => string;
  /** Full formatter for money values in the tooltip */
  formatTooltip?: (v: number) => string;
}

const GROUP_COLORS: Record<DueDebtGroup['key'], string> = {
  dueSoon5d: 'var(--success)',
  overdue1to10: 'var(--warning)',
  overdue11to30: 'var(--warning-deep, #914A16)',
  overdue30plus: 'var(--danger)',
};

/** Bar geometry must stay finite even if caller data misbehaves. */
function barValue(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Round a tick step up to 1/2/5×10ⁿ so every grid caption stays distinct. */
function niceTick(peak: number): number {
  if (!(peak > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(peak));
  const mant = peak / base;
  return (mant <= 1 ? 1 : mant <= 2 ? 2 : mant <= 5 ? 5 : 10) * base;
}

export function DueDebtBarChart({
  groups,
  formatY,
  formatTooltip,
  width: initialW = 760,
  height: initialH = 280,
}: DueDebtBarChartProps) {
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
  const descId = useId();
  const tooltipId = useId();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const activeIdx = hoverIdx !== null && hoverIdx < groups.length ? hoverIdx : null;

  const mL = 52, mR = 18, mT = 14, mB = 40;
  const pW = Math.max(0, W - mL - mR), pH = Math.max(0, H - mT - mB);

  const peak = Math.max(0, ...groups.map((g) => barValue(g.amount)));
  const moneyMax = niceTick(peak / 4) * 4;

  const slot = pW / Math.max(1, groups.length);
  const barW = Math.max(2, Math.min(56, slot * 0.46));
  const barX = (i: number) => mL + slot * i + (slot - barW) / 2;
  const columnX = (i: number) => mL + slot * (i + 0.5);
  const yOf = (v: number) => mT + pH * (1 - barValue(v) / moneyMax);

  const ax = activeIdx !== null ? columnX(activeIdx) : 0;
  const ay = activeIdx !== null ? yOf(groups[activeIdx].amount) : 0;
  useChartTooltipPosition({
    isOpen: activeIdx !== null, containerRef, tooltipRef, anchorX: ax, anchorY: ay,
    chartWidth: W, chartHeight: H,
    alignment: activeIdx === 0 ? 'start' : activeIdx === groups.length - 1 ? 'end' : 'center',
  });

  const fmtY = formatY ?? formatCompact;
  const fmtTip = formatTooltip ?? formatCurrency;
  const fmtCount = (v: number) => formatNumber(Math.round(barValue(v)));
  const chartDescription = groups.length > 0
    ? groups.map((g) => `${g.label}: ${fmtTip(g.amount)}, ${fmtCount(g.customers)} khách`).join('. ')
    : 'Chưa có dữ liệu công nợ trong kỳ.';
  const gridTicks = Array.from({ length: 5 }, (_, i) => i);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', height: '100%' }}>
      {groups.length === 0 ? (
        <div
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-data)', fontSize: '13px', color: '#56655C',
          }}
        >
          Chưa có dữ liệu công nợ trong kỳ
        </div>
      ) : (
        <>
          {/* Legend — the four swatches are the group severity ramp */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'flex', gap: 2 }}>
              {groups.map((g) => (
                <span key={g.key} style={{ width: 6, height: 10, borderRadius: 2, background: GROUP_COLORS[g.key] }} />
              ))}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-data)', fontSize: '12px', color: '#56655C', whiteSpace: 'nowrap',
              }}
            >
              Nhóm hạn nợ
            </span>
          </div>

          <div
            ref={containerRef}
            style={{ position: 'relative', width: '100%', flex: 1, minHeight: 0 }}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <svg
              role="img"
              aria-label="Biểu đồ cột công nợ theo nhóm hạn nợ"
              aria-describedby={activeIdx !== null ? `${descId} ${tooltipId}` : descId}
              viewBox={`0 0 ${W} ${H}`}
              xmlns="http://www.w3.org/2000/svg"
              style={{ display: 'block', width: '100%', height: '100%', overflow: 'visible' }}
            >
              <desc id={descId}>{chartDescription}</desc>

              {/* Grid lines — money axis on the left */}
              {gridTicks.map((i) => (
                <g key={i}>
                  <line x1={mL} y1={yOf((moneyMax * i) / 4)} x2={W - mR} y2={yOf((moneyMax * i) / 4)} stroke="#EEF1EF" strokeWidth="1" />
                  <text x={mL - 10} y={yOf((moneyMax * i) / 4) + 3.5} textAnchor="end" fontFamily="var(--font-data)" fontSize="11" fill="#56655C">
                    {fmtY((moneyMax * i) / 4)}
                  </text>
                </g>
              ))}

              {/* Zero baseline */}
              <line x1={mL} y1={mT + pH} x2={W - mR} y2={mT + pH} stroke="#E2E8E5" strokeWidth="1" />

              {/* X-axis group labels + customer-count sublabels — visible even
                  for empty groups, whose bars stay zero-height */}
              {groups.map((g, i) => (
                <g key={g.key}>
                  <text
                    x={columnX(i)}
                    y={H - 24}
                    textAnchor="middle"
                    fontFamily="var(--font-data)"
                    fontSize="11"
                    fill={i === activeIdx ? '#005A2D' : '#8A988F'}
                    fontWeight={i === activeIdx ? '700' : '400'}
                  >
                    {g.label}
                  </text>
                  <text
                    data-chart-count={i}
                    x={columnX(i)}
                    y={H - 10}
                    textAnchor="middle"
                    fontFamily="var(--font-data)"
                    fontSize="10.5"
                    fill="#56655C"
                  >
                    {fmtCount(g.customers)} khách
                  </text>
                </g>
              ))}

              {/* Bars — one per group, amount scale; empty groups render
                  zero-height rects at the baseline */}
              {groups.map((g, i) => {
                const top = yOf(g.amount);
                return (
                  <rect
                    key={g.key}
                    data-chart-bar="amount"
                    data-group-index={i}
                    x={barX(i)}
                    y={top}
                    width={barW}
                    height={Math.max(0, mT + pH - top)}
                    fill={GROUP_COLORS[g.key]}
                  />
                );
              })}

              {/* Hover crosshair */}
              {activeIdx !== null && (
                <line x1={ax} y1={mT} x2={ax} y2={mT + pH} stroke="#005A2D" strokeWidth="1" strokeDasharray="3 4" opacity={0.45} />
              )}

              {/* Invisible hit areas — one per group column */}
              {groups.map((g, i) => (
                <rect
                  key={`hit-${g.key}`}
                  data-chart-hit={i}
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

            {/* HTML tooltip overlay — role + aria-describedby wiring exposes
                its content to assistive tech */}
            {activeIdx !== null && (
              <div
                ref={tooltipRef}
                id={tooltipId}
                role="tooltip"
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
                  {groups[activeIdx].label}
                </div>
                <div style={{ height: 1, background: '#EEF1EF', margin: '0 -14px 8px -14px' }} />
                <div
                  style={{
                    display: 'flex', flexWrap: 'wrap', columnGap: '12px', rowGap: 'var(--space-xs)',
                    justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-data)', fontSize: '12px', color: '#56655C', whiteSpace: 'nowrap' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: GROUP_COLORS[groups[activeIdx].key] }} />
                    Công nợ
                  </div>
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: '12.5px', fontWeight: 700, color: '#005A2D', whiteSpace: 'nowrap' }}>
                    {fmtTip(groups[activeIdx].amount)}
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex', flexWrap: 'wrap', columnGap: '12px', rowGap: 'var(--space-xs)',
                    justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-data)', fontSize: '12px', color: '#56655C', whiteSpace: 'nowrap' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: GROUP_COLORS[groups[activeIdx].key] }} />
                    Khách hàng
                  </div>
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: '12.5px', fontWeight: 700, color: '#005A2D', whiteSpace: 'nowrap' }}>
                    {fmtCount(groups[activeIdx].customers)} khách
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
