import type { ReactNode } from 'react';
import { formatViMonth } from './formatters';

export function FinanceLoadingBlock() {
  return (
    <div className="cfg-finance-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export function FinanceVersionList({
  title,
  emptyMessage,
  rows,
  renderMeta,
}: {
  title: string;
  emptyMessage: string;
  rows: Array<{
    id: number;
    effectiveFrom: string;
    version: number;
    createdAt: string;
    createdByName: string;
  }>;
  renderMeta: (row: {
    id: number;
    effectiveFrom: string;
    version: number;
    createdAt: string;
    createdByName: string;
  }) => ReactNode;
}) {
  return (
    <div className="cfg-finance-history" role="region" aria-label={title}>
      <div className="cfg-section__heading-row">
        <h3 className="cfg-section__heading">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="cfg-field-hint">{emptyMessage}</p>
      ) : (
        <ul className="cfg-finance-history__list">
          {rows.map((row) => (
            <li key={row.id} className="cfg-finance-history__item">
              <div className="cfg-finance-history__headline">
                <strong>{formatViMonth(row.effectiveFrom)}</strong>
                <span>Phiên bản {row.version}</span>
              </div>
              <div className="cfg-finance-history__meta">
                {renderMeta(row)}
              </div>
              <div className="cfg-finance-history__foot">
                <span>{row.createdByName}</span>
                <span>{new Date(row.createdAt).toLocaleString('vi-VN')}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
