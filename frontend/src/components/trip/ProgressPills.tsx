import React from 'react';
import './ProgressPills.css';

interface ProgressPillsProps {
  current: number;
  total: number;
}

export function ProgressPills({ current, total }: ProgressPillsProps) {
  const dots = Array.from({ length: total }, (_, i) => {
    if (i < current) return <span key={i} className="tc-pill-dot tc-pill-dot--done" />;
    if (i === current) return <span key={i} className="tc-pill-dot tc-pill-dot--active" />;
    return <span key={i} className="tc-pill-dot" />;
  });

  return (
    <div className="tc-progress-pills">
      {dots}
      <span style={{ marginLeft: 6 }}>
        <strong style={{ color: 'var(--fg-1)' }}>{current}</strong>/{total} hoàn tất
      </span>
    </div>
  );
}
