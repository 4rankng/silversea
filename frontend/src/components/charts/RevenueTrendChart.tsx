import { useState, useRef, useEffect, useId } from 'react';

/**
 * Shared revenue + gross-profit trend chart.
 * Used consistently across Dashboard and Finance pages.
 *
 * Pattern: inline SVG with hover tooltips, invisible hit areas,
 * crosshair, and HTML overlay popup.
 */

export interface RevenueTrendChartProps {
  /** Month labels (e.g. ['T1', 'T2', … 'T12']) */
  months: string[];
  /** Revenue values — one per month */
  revenue: number[];
  /** Gross profit values — one per month */
  gross: number[];
  /** Compact formatter for y-axis labels */
  formatY?: (v: number) => string;
  /** Compact formatter for tooltip values (in "Tr" units, millions) */
  formatTooltip?: (v: number) => string;
  /** Optional: which month index is "current" — highlights that label bold */
  currentIdx?: number;
  /** Chart title shown in the header (outside this component) */
  title?: string;
  /** Custom SVG dimensions — defaults to Dashboard standard 760×280 */
  width?: number;
  height?: number;
}

export function RevenueTrendChart({
  months,
  revenue,
  gross,
  formatY,
  formatTooltip,
  currentIdx,
  title,
  width: initialW = 760,
  height: initialH = 280,
}: RevenueTrendChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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
  const activeIdx = hoverIdx;

  const mL = 46, mR = 18, mT = 14, mB = 30;
  const pW = W - mL - mR, pH = H - mT - mB;

  // Auto-scale y-axis: pick a nice step size that fits the data
  const peak = Math.max(...revenue, ...gross, 1);
  const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000];
  const step = niceSteps.find(s => s * 4 >= peak) ?? 1000;
  const yMax = Math.ceil(peak / step) * step || step;

  const X = (i: number) => mL + pW * (i / Math.max(1, revenue.length - 1));
  const Y = (v: number) => mT + pH * (1 - v / yMax);

  const path = (arr: number[]) =>
    arr.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');

  const areaPath = (arr: number[]) =>
    path(arr) + ` L ${X(arr.length - 1)} ${Y(0)} L ${X(0)} ${Y(0)} Z`;

  const gridValues = [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax];

  const ax = activeIdx !== null ? X(activeIdx) : 0;
  const ay = activeIdx !== null ? Y(revenue[activeIdx] || 0) : 0;
  const ayGp = activeIdx !== null ? Y(gross[activeIdx] || 0) : 0;

  // Default formatters (in millions). Precision scales with magnitude so two
  // different grid lines can never share one rounded caption ("1tr₫" twice):
  // quarter-ticks of a 2.2tr axis used to all collapse through Math.round.
  const yDecimals = yMax < 1 ? 2 : yMax < 10 ? 1 : 0;
  const fmtY = formatY ?? ((v: number) => {
    if (v === 0) return '0';
    const fixed = v.toFixed(yDecimals);
    return fixed.endsWith(',00') || fixed.includes('.')
      ? fixed.replace('.', ',').replace(/,?0+$/, '')
      : fixed;
  });
  const fmtTip = formatTooltip ?? ((v: number) => `${v.toFixed(1).replace('.', ',')} Tr`);
  const chartTitle = title ?? 'Xu hướng doanh thu và lợi nhuận gộp';
  const lastIndex = Math.max(0, Math.min(months.length, revenue.length, gross.length) - 1);
  const chartDescription = months.length > 0
    ? `${months.length} kỳ. Kỳ gần nhất ${months[lastIndex]}: doanh thu ${fmtTip(revenue[lastIndex] || 0)}, lợi nhuận gộp ${fmtTip(gross[lastIndex] || 0)}.`
    : 'Chưa có dữ liệu xu hướng.';

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg
        role="img"
        aria-labelledby={`${chartTitleId} ${chartDescriptionId}`}
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block', width: '100%', height: '100%', overflow: 'visible', flex: 1 }}
      >
        <title id={chartTitleId}>{chartTitle}</title>
        <desc id={chartDescriptionId}>{chartDescription}</desc>

        {/* Y-axis grid lines + labels */}
        {gridValues.map((v, i) => (
          <g key={i}>
            <line x1={mL} y1={Y(v)} x2={W - mR} y2={Y(v)} stroke="#EEF1EF" strokeWidth="1" />
            <text x={mL - 10} y={Y(v) + 3.5} textAnchor="end" fontFamily="var(--font-data)" fill="#56655C">
              {v === 0
                ? <tspan fontSize="11">0</tspan>
                : <><tspan fontSize="11">{fmtY(v)}</tspan><tspan fontSize="11">tr₫</tspan></>
              }
            </text>
          </g>
        ))}

        {/* X-axis month labels */}
        {months.map((m, i) => (
          <text key={i} x={X(i)} y={H - 10} textAnchor="middle" fontFamily="var(--font-data)" fontSize="11"
                fill={i === activeIdx ? '#005A2D' : i === currentIdx ? '#005A2D' : '#8A988F'}
                fontWeight={i === activeIdx || i === currentIdx ? '700' : '400'}>
            {m}
          </text>
        ))}

        {/* Revenue area fill */}
        <path d={areaPath(revenue)} fill="#005A2D" opacity={0.08} />

        {/* Gross profit line — house info token (graphic, not text) */}
        <path d={path(gross)} fill="none" stroke="var(--info)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Revenue line (on top) — className preserved for animation hooks */}
        <path className="wf-rev-line" d={path(revenue)} fill="none" stroke="#005A2D" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover crosshair + dots */}
        {activeIdx !== null && (
          <>
            <line x1={ax} y1={mT} x2={ax} y2={mT + pH} stroke="#005A2D" strokeWidth="1" strokeDasharray="3 4" opacity={0.45} />
            <circle cx={ax} cy={ayGp} r="3.5" fill="#fff" stroke="var(--info)" strokeWidth="2" />
            <circle cx={ax} cy={ay} r="4" fill="#fff" stroke="#005A2D" strokeWidth="2.6" />
          </>
        )}

        {/* Invisible hit areas — one per month column */}
        {months.map((_, i) => {
          const cx = X(i);
          const left  = i === 0 ? mL : (X(i - 1) + cx) / 2;
          const right = i === months.length - 1 ? W - mR : (cx + X(i + 1)) / 2;
          return (
            <rect
              key={i}
              x={left}
              y={mT}
              width={right - left}
              height={pH}
              fill="transparent"
              style={{ cursor: 'crosshair' }}
              onMouseEnter={() => setHoverIdx(i)}
            />
          );
        })}
      </svg>
      {/* Traveler dot — targeted by useDashboardAnimations via DOM query */}
      <div className="wf-chart-traveler" style={{ position: 'absolute', width: 7, height: 7, background: '#005A2D', borderRadius: '50%', left: -3.5, top: -3.5, opacity: 0, pointerEvents: 'none', zIndex: 5 }} />

      {/* HTML tooltip overlay */}
      {activeIdx !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${(ax / W) * 100}%`,
            top: `${(Math.min(ay, ayGp) / H) * 100}%`,
            transform: `translate(${activeIdx === 0 ? '0' : activeIdx === months.length - 1 ? '-100%' : '-50%'}, calc(-100% - 12px))`,
            background: 'var(--surface)',
            borderRadius: '8px',
            border: '1px solid #E2E8E5',
            padding: '10px 14px',
            pointerEvents: 'none',
            // The two Vietnamese label/value pairs need more than 160px once
            // their markers and horizontal padding are accounted for.
            minWidth: '192px',
            zIndex: 10,
          }}
        >
          <div style={{ textAlign: 'center', fontFamily: 'var(--font-data)', fontSize: '12px', fontWeight: 600, color: '#56655C', marginBottom: '8px' }}>
            {months[activeIdx]}
          </div>
          <div style={{ height: 1, background: '#EEF1EF', margin: '0 -14px 8px -14px' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: '12px', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-data)', fontSize: '12px', color: '#56655C', whiteSpace: 'nowrap' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#005A2D' }} />
              Doanh thu
            </div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: '12.5px', fontWeight: 700, color: '#005A2D', whiteSpace: 'nowrap' }}>
              {fmtTip(revenue[activeIdx] || 0)}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: '12px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-data)', fontSize: '12px', color: '#56655C', whiteSpace: 'nowrap' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--info)' }} />
              LN gộp
            </div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: '12.5px', fontWeight: 700, color: 'var(--info-text)', whiteSpace: 'nowrap' }}>
              {fmtTip(gross[activeIdx] || 0)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
