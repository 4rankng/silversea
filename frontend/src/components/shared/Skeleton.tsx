import React from 'react';
import './Skeleton.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ width, height, radius, className = '', style }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width: width ?? '100%', height: height ?? 16, borderRadius: radius, ...style }}
    />
  );
}

export function SkeletonLine({ width }: { width?: string | number }) {
  return <Skeleton width={width ?? '100%'} height={12} className="skeleton--line" />;
}

export function SkeletonCircle({ size }: { size?: number }) {
  return <Skeleton width={size ?? 36} height={size ?? 36} className="skeleton--circle" />;
}

export function SkeletonCard() {
  return <Skeleton height={110} className="skeleton--card" />;
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 0' }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'flex', gap: 12 }}>
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonLine key={c} width={c === 0 ? '30%' : c === cols - 1 ? '15%' : `${55 / (cols - 2)}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonKPIs({ count = 4 }: { count?: number }) {
  return (
    <div className="kpi-grid" style={{ marginBottom: 20 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="kpi" style={{ minHeight: 110 }}>
          <SkeletonLine width="40%" />
          <div style={{ height: 8 }} />
          <Skeleton width="60%" height={22} />
        </div>
      ))}
    </div>
  );
}
