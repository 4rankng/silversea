import './Sparkline.css';

/**
 * Hand-rolled sparkline — no chart library.
 *
 * Takes a small numeric series and renders a smoothed area+line SVG. Inspired
 * by the Tailkit `a-c-statistics-11` layout but with real data instead of
 * pre-baked path strings. Tokens-only — the gradient fill uses NEPO brand
 * tokens so variants match the rest of the UI.
 *
 * T2 adoption from plans/260719-frontend-polish-tailkit/porting-notes.md.
 */

export type SparklineVariant = 'up' | 'down' | 'neutral';

export interface SparklineProps {
  /** Numeric series. Empty array renders nothing. */
  data: number[];
  /** Visual variant. Defaults to 'neutral'. 'up'/'down' colour the line. */
  variant?: SparklineVariant;
  /** SVG width in px. Height is always 32 to fit a KPI meta slot. */
  width?: number;
  /** Accessible label, e.g. "Doanh thu 7 ngày gần nhất". Required for a11y. */
  ariaLabel: string;
  className?: string;
}

const HEIGHT = 32;
const PADDING_Y = 3;

export function Sparkline({
  data,
  variant = 'neutral',
  width = 96,
  ariaLabel,
  className,
}: SparklineProps) {
  // Empty / single-point data renders a flat baseline — never throws.
  if (!data || data.length === 0) {
    return null;
  }

  const stroke = variantColor(variant);
  const fillId = `sparkline-grad-${variant}`;

  const { linePath, areaPath } = buildPaths(data, width, HEIGHT);

  return (
    <svg
      className={['ds-sparkline', `ds-sparkline--${variant}`, className].filter(Boolean).join(' ')}
      width={width}
      height={HEIGHT}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${fillId})`} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Map variant → NEPO token via direct var() reference in CSS (no hardcoding). */
function variantColor(variant: SparklineVariant): string {
  if (variant === 'up') return 'var(--accent)';
  if (variant === 'down') return 'var(--danger)';
  return 'var(--ink-3)';
}

/**
 * Build smooth line + area paths from a numeric series.
 * Uses Catmull-Rom-ish smoothing through midpoints so single-spike data
 * doesn't produce ugly corners. Path coords are pre-rounded to 2 decimals
 * to keep the SVG payload small.
 */
function buildPaths(data: number[], width: number, height: number): { linePath: string; areaPath: string } {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const drawableH = height - PADDING_Y * 2;

  const points = data.map((v, i) => {
    const x = data.length === 1 ? width / 2 : (i / (data.length - 1)) * width;
    const y = PADDING_Y + drawableH * (1 - (v - min) / range);
    return { x: round(x), y: round(y) };
  });

  if (points.length === 1) {
    // Single point — draw a flat segment at that height.
    const p = points[0];
    const linePath = `M 0 ${p.y} L ${width} ${p.y}`;
    const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
    return { linePath, areaPath };
  }

  const segs: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cx = round((p0.x + p1.x) / 2);
    segs.push(`Q ${p0.x} ${p0.y} ${cx} ${round((p0.y + p1.y) / 2)}`);
    segs.push(`Q ${p1.x} ${p1.y} ${p1.x} ${p1.y}`);
  }
  const linePath = segs.join(' ');
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
  return { linePath, areaPath };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
