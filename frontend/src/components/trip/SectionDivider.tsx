import React from 'react';
import './SectionDivider.css';

interface SectionDividerProps {
  label: string;
  className?: string;
}

export function SectionDivider({ label, className }: SectionDividerProps) {
  return (
    <div className={`tc-section-divider${className ? ` ${className}` : ''}`}>
      <span className="tc-section-divider__line" />
      <span className="tc-section-divider__text">{label}</span>
      <span className="tc-section-divider__line" />
    </div>
  );
}
