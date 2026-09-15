import React from 'react';
import { OPS_EXPENSE_TYPE_DEFAULTS } from '@tingting/shared';
import type { AncillaryExpenseType } from '@tingting/shared';
import { formatNumber } from '../../lib/format';
import type { CatalogData } from '../../hooks/useCatalogs';

export function AncillaryTableTotals({ buy, sell }: { buy: number; sell: number }) {
  return <tfoot><tr><td colSpan={1}>Tổng</td><td className="num">{formatNumber(buy)}</td>
    <td className="num">{formatNumber(sell)}</td><td className="num" style={{ color: 'var(--success)' }}>{formatNumber(sell)}</td>
    <td colSpan={2}></td></tr></tfoot>;
}

export function AncillaryMobileTotals({ buy, sell }: { buy: number; sell: number }) {
  return <div className="ancillary-fees__mobile-totals"><span className="ancillary-fees__mobile-totals-label">Tổng</span>
    <div className="ancillary-fees__mobile-totals-nums">
      <div><span className="ancillary-fee-card__label">Gốc</span><span className="mono">{formatNumber(buy)}</span></div>
      <div><span className="ancillary-fee-card__label">Báo khách</span><span className="mono">{formatNumber(sell)}</span></div>
      <div><span className="ancillary-fee-card__label">Báo nợ</span><span className="mono" style={{ color: 'var(--success)', fontWeight: 700 }}>{formatNumber(sell)}</span></div>
    </div>
  </div>;
}

export function AncillaryEmptyState() {
  return <p style={{ margin: 0, padding: '8px 0', fontSize: 'var(--text-body-size)', color: 'var(--fg-2)' }}>
    Chưa có dịch vụ đi kèm. Thêm phí nâng/hạ, hải quan hoặc cân hàng khi phát sinh.
  </p>;
}

export interface AncillaryFeesCardProps {
  tripId: number;
  readOnly?: boolean;
  hideAddButton?: boolean;
}

export const EXPENSE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(OPS_EXPENSE_TYPE_DEFAULTS).map(([k, v]) => [k, v.name])
);

export function feeTypeLabel(code: string): string {
  return EXPENSE_TYPE_LABELS[code] ?? code;
}

// Single source of truth for the markup formula. Changing the multiplier
// (e.g. to 1.18) or per-type override only requires editing this one helper —
// previously the same `Math.round(buy * 1.2)` lived in 3 places including
// the prefill-detection check, which silently produced wrong auto-suggestions
// when the formula drifted out of sync.
export const MARKUP_MULTIPLIER = 1.2;
export function suggestedSellFor(buyNum: number, hasMarkup: boolean): string {
  if (!hasMarkup) return String(buyNum);
  if (!buyNum) return '';
  return String(Math.round(buyNum * MARKUP_MULTIPLIER));
}

export function resolveMarkupConfig(
  catalogTypes: CatalogData['forwarderExpenseTypes'] | undefined,
  code: string,
): boolean {
  const fromCatalog = catalogTypes?.find(t => t.code === code)?.defaultMarkup;
  return fromCatalog ?? (OPS_EXPENSE_TYPE_DEFAULTS[code]?.defaultMarkup ?? false);
}

export const EMPTY_FORM = {
  expenseType: 'LIFTING' as AncillaryExpenseType,
  buyAmount: '',
  sellAmount: '',
  settlementMethod: 'OPS_ADVANCE' as 'COMPANY_DIRECT' | 'OPS_ADVANCE',
  supplierId: '',
  forwarderId: '',
  containerNumber: '',
  invoiceNumber: '',
  invoiceDate: '',
  declarationNumber: '',
  note: '',
};
