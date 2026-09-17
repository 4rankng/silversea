import React from 'react';
import './InlineForm.css';

export function InlineForm({ children }: { colSpan?: number; children: React.ReactNode }) {
  return (
    <div data-config-form className="config-inline-form">
      {children}
    </div>
  );
}
