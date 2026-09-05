import React from 'react';

export function InlineForm({ children }: { colSpan?: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', width: '100%', padding: '4px 0 0' }}>
      {children}
    </div>
  );
}
