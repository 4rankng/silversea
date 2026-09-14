import React from 'react';
import './JourneyLegRow.css';
import { Trash2 } from 'lucide-react';
import type { FormLeg } from '../../hooks/useTripForm';
import { LocationAutocomplete } from '../LocationAutocomplete';
import { UuiSelectField } from '../../design-system';

interface JourneyLegRowProps {
  leg: FormLeg;
  onRemove: () => void;
  onUpdate: (field: keyof FormLeg, value: string) => void;
  canRemove: boolean;
}

export function JourneyLegRow({ leg, onRemove, onUpdate, canRemove }: JourneyLegRowProps) {
  // Untouched blank suggestions validate to nothing: endpoints become
  // required only once a leg carries content, so auto-generated placeholders
  // from the route name can never block an unrelated save (QA-066 family).
  const legTouched = leg.origin.trim() !== '' || leg.destination.trim() !== '';
  return (
    <div className="leg-card">
      <div className="leg-card__head">
        <div className="leg-card__label">
          <span className="leg-card__seq">{leg.sequence}</span>
          Chặng {leg.sequence}
        </div>
        {canRemove && (
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onRemove} aria-label="Xóa chặng">
            <Trash2 size={15} style={{ color: 'var(--danger)' }} />
          </button>
        )}
      </div>
      <div className="leg-card__route">
        <LocationAutocomplete
          className="input input--sm"
          placeholder="Điểm đi"
          value={leg.origin}
          onChange={(val) => onUpdate('origin', val)}
          required={legTouched}
        />
        <span className="leg-card__arrow">→</span>
        <LocationAutocomplete
          className="input input--sm"
          placeholder="Điểm đến"
          value={leg.destination}
          onChange={(val) => onUpdate('destination', val)}
          required={legTouched}
        />
      </div>
      <div className="leg-card__fields">
        <div>
          <div className="leg-card__mini-label">Cự ly (Km)</div>
          <input
            className="input input--sm"
            type="number"
            placeholder="Km"
            value={leg.km}
            onChange={(e) => onUpdate('km', e.target.value)}
          />
        </div>
        <div>
          <div className="leg-card__mini-label">Tải trọng</div>
          <UuiSelectField
            id={`loading-type-${leg.sequence}`}
            label="Tải trọng"
            hideLabel
            value={leg.loadingType}
            onChange={(e) => onUpdate('loadingType', e.target.value)}
            options={[
              { value: 'HANG', label: 'Có hàng' },
              { value: 'VO', label: 'Vỏ rỗng' },
            ]}
            controlClassName="input--sm"
          />
        </div>
      </div>
    </div>
  );
}
