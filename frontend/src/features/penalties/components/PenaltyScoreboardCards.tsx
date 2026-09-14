import { UserRound } from 'lucide-react';
import { getGradeClass } from '../utils';
import { formatCurrency } from '../../../lib/format';
import type { PenaltyInsightsScoreboardRow } from '../../../hooks/usePenalties';

/** A scoreboard row enriched by the parent with the active window's figures. */
export interface PenaltyScoreboardCardRow extends PenaltyInsightsScoreboardRow {
  /** Formatted tenure shown under the driver name, or null when unknown. */
  tenure: string | null;
  /** Violation count under the active window (grade recomputed to match). */
  violations: number;
}

interface PenaltyScoreboardCardsProps {
  rows: PenaltyScoreboardCardRow[];
  avgStreak: number;
  driversOver90: number;
  onOpenDrawer: (driverId: number) => void;
}

/**
 * Phone-only rendering of the driver scoreboard — desktop keeps the table.
 * The parent collapses this block by default on phones so the violation
 * ledger and its status chips stay in the first viewport.
 */
export function PenaltyScoreboardCards({ rows, avgStreak, driversOver90, onOpenDrawer }: PenaltyScoreboardCardsProps) {
  return (
    <div className="mobile-only">
      <div className="penalty-m-cards">
        {rows.map((d) => {
          const gc = getGradeClass(d.grade);
          const vClass = d.violations === 0 ? 'zero' : d.violations <= 2 ? 'warn' : 'danger';
          return (
            <div key={d.driverId} className="penalty-m-card" onClick={() => onOpenDrawer(d.driverId)}>
              <div className="penalty-m-card__top">
                <div className="left">
                  <div className="penalty-driver-avatar">
                    <UserRound size={18} aria-hidden="true" />
                  </div>
                  <div className="penalty-m-card__info">
                    <div className="penalty-m-card__name">{d.name}</div>
                    <div className="penalty-m-card__id">
                      {d.truckPlate || 'Chưa phân xe'}
                    </div>
                  </div>
                </div>
                <span className={`penalty-grade-badge ${gc}`}>
                  Hạng {d.grade}
                </span>
              </div>

              <div className="penalty-m-card__meta">
                <div className="mm">
                  <span className="lab">Chuỗi an toàn</span>
                  <span className={d.streakDays >= 90 ? 'val' : 'val empty'} style={d.streakDays >= 90 ? { color: 'var(--accent)' } : undefined}>
                    {d.streakDays} ngày
                  </span>
                </div>
                <div className="mm">
                  <span className="lab">Vi phạm (kỳ lọc)</span>
                  <span className={vClass === 'zero' ? 'val empty' : `val ${vClass}`}>
                    {d.violations} vụ
                  </span>
                </div>
                <div className="mm">
                  <span className="lab">Phạt YTD</span>
                  <span className={d.fineYtd > 0 ? 'val danger' : 'val empty'}>
                    {d.fineYtd > 0 ? formatCurrency(d.fineYtd) : '—'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="penalty-table-foot">
        <div className="legend">
          <span>TB: <span className="penalty-foot-value">{avgStreak} ngày</span></span>
          <span className="penalty-foot-sep">·</span>
          <span>{driversOver90} đạt 90 ngày</span>
        </div>
      </div>
    </div>
  );
}
