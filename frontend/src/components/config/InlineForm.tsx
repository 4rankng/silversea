import React from 'react';

export function InlineForm({ children }: { colSpan?: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', width: '100%', padding: '8px 0' }}>
      {children}
    </div>
  );
}
