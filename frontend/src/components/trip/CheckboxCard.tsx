import React from 'react';
import './CheckboxCard.css';

interface CheckboxCardProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  id?: string;
}

export function CheckboxCard({ checked, onChange, label, description, id }: CheckboxCardProps) {
  const inputId = id ?? `cb-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <label
      className={`tc-checkbox-card${checked ? ' tc-checkbox-card--checked' : ''}`}
      htmlFor={inputId}
    >
      <input id={inputId} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div className="tc-checkbox-card__text">
        <div className="tc-checkbox-card__lbl">{label}</div>
        {description && <div className="tc-checkbox-card__desc">{description}</div>}
      </div>
    </label>
  );
}
