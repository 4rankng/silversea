import React from 'react';
import { Wallet, Receipt, Tag, Gauge } from 'lucide-react';
import { Money } from '../../../components/shared/Money';

interface KpiStripProps {
  revenue: number;
  totalCost: number;
  grossProfit: number;
  marginPct: string | null;
  /**
   * `inline` (default) — 4 free-floating KPI tiles in a single row, used
   * when the strip is rendered as a full-width section above the body grid.
   * `rail` — 2×2 micro-grid wrapped in a single glass card, used when the
   * strip is rendered inside the right rail of the 2-col body.
   */
  variant?: 'inline' | 'rail';
}

export function KpiStrip({ revenue, totalCost, grossProfit, marginPct, variant = 'inline' }: KpiStripProps) {
  if (variant === 'rail') {
    return (
      <div className="kpi-rail">
        <div className="kpi-rail__head">
          <span className="kpi-rail__eyebrow">Tổng quan tài chính</span>
        </div>
        <div className="kpi-rail__grid">
          <div className="kpi-rail__cell">
            <div className="kpi-label">
              <span className="dot"><Wallet size={12} /></span>
              Doanh thu
            </div>
            <div className="kpi-value kpi-value--sm">
              <Money value={revenue} />
            </div>
          </div>

          <div className="kpi-rail__cell">
            <div className="kpi-label">
              <span className="dot"><Receipt size={12} /></span>
              Tổng chi phí
            </div>
            <div className="kpi-value kpi-value--sm">
              <Money value={totalCost} />
            </div>
          </div>

          <div className="kpi-rail__cell">
            <div className="kpi-label">
              <span className="dot"><Tag size={12} /></span>
              Lợi nhuận gộp
            </div>
            <div className="kpi-value kpi-value--sm">
              <Money value={grossProfit} />
            </div>
          </div>

          <div className="kpi-rail__cell">
            <div className="kpi-label">
              <span className="dot"><Gauge size={12} /></span>
              Biên LN
            </div>
            <div className="kpi-value kpi-value--sm">
              {marginPct ?? '—'}
              <span className="u">%</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="kpi">
        <div className="kpi-label">
          <span className="dot"><Wallet size={13} /></span>
          Doanh thu
        </div>
        <div className="kpi-value">
          <Money value={revenue} />
        </div>
        <div className="kpi-sub">Cước vận chuyển hợp đồng</div>
      </div>

      <div className="kpi">
        <div className="kpi-label">
          <span className="dot"><Receipt size={13} /></span>
          Tổng chi phí
        </div>
        <div className="kpi-value">
          <Money value={totalCost} />
        </div>
        <div className="kpi-sub">100% từ nhiên liệu</div>
      </div>

      <div className="kpi accent">
        <div className="kpi-label">
          <span className="dot"><Tag size={13} /></span>
          Lợi nhuận gộp
        </div>
        <div className="kpi-value">
          <Money value={grossProfit} />
        </div>
        <div className="kpi-sub">Doanh thu − Tổng chi phí</div>
      </div>

      <div className="kpi">
        <div className="kpi-label">
          <span className="dot"><Gauge size={13} /></span>
          Biên lợi nhuận
        </div>
        <div className="kpi-value">
          {marginPct ?? '—'}
          <span className="u">%</span>
        </div>
        <div className="kpi-sub">Trên doanh thu</div>
      </div>
    </>
  );
}
