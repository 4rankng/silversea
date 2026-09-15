import React from 'react';
import './JourneyLegsCard.css';
import { Plus } from 'lucide-react';
import { CardSection } from './CardSection';
import { JourneyLegRow } from './JourneyLegRow';
import { useTripFormContext } from '../../hooks/useTripFormContext';

interface JourneyLegsCardProps {
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /**
   * Section number to display in the corner badge. Defaults to 2 since this
   * card is section #2 inside TripCreatePage. When embedded as a sub-card
   * (e.g. nested inside another section on TripEditPage), pass `null` to
   * suppress the number — otherwise the page ends up with two "2" badges
   * side-by-side, which confuses users.
   */
  number?: number | null;
}

export function JourneyLegsCard({ collapsible, defaultCollapsed, number = 2 }: JourneyLegsCardProps) {
  const form = useTripFormContext();
  const {
    legs, addLeg, removeLeg, updateLeg,
  } = form;
  const totalKm = legs.reduce((sum, leg) => sum + (Number(leg.km) || 0), 0);

  return (
    <CardSection
      number={number != null ? number : undefined}
      title="Hành trình chi tiết"
      subtitle="Khai báo các chặng đường, cự ly và tải trọng"
      badge="optional"
      collapsible={collapsible}
      defaultCollapsed={defaultCollapsed}
    >
      {legs.length === 0 ? (
        <div className="tc-journey-empty">
          <div className="tc-journey-empty__illustration" style={{ position: 'relative', border: 'none', background: 'transparent' }}>
            <img src="/assets/illustrations/empty-routes.svg" alt="" style={{ width: 80, height: 60, objectFit: 'contain' }} />
          </div>
          <div className="tc-journey-empty__text">
            <h4 style={{ margin: '0 0 4px', fontSize: 'var(--text-section-size)', fontWeight: 700, color: 'var(--fg-1)' }}>Chưa có chặng nào</h4>
            <p style={{ margin: 0, fontSize: 'var(--text-body-size)', color: 'var(--fg-3)' }}>
              Nhập địa điểm và cự ly (Km) cho từng chặng để tính nhiên liệu theo định mức. Bạn cũng có thể bỏ qua và nhập thủ công.
            </p>
          </div>
          <button type="button" className="btn btn--secondary btn--sm" onClick={addLeg}>
            <Plus size={14} />
            Thêm chặng đầu tiên
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {legs.map((leg, idx) => (
              <JourneyLegRow
                key={leg.id}
                leg={leg}
                onRemove={() => removeLeg(idx)}
                onUpdate={(field, value) => updateLeg(idx, field, value)}
                canRemove
              />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <div className="form-summary" style={{ margin: 0 }}>
              <span>Tổng số chặng: <strong>{legs.length}</strong></span>
              <span>Tổng cự ly: <strong>{totalKm.toLocaleString('vi-VN')} Km</strong></span>
            </div>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={addLeg}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={14} /> Thêm chặng
            </button>
          </div>
        </>
      )}
    </CardSection>
  );
}
