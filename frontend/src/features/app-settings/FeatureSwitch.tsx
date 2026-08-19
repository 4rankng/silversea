import { useId, type ReactNode } from 'react';

type FeatureSwitchProps = {
  icon: ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  onChange: () => void;
  disabled: boolean;
};

export function FeatureSwitch({ icon, label, description, enabled, onChange, disabled }: FeatureSwitchProps) {
  const descriptionId = useId();

  return (
    <div className="cfg-section cfg-feature">
      <button
        type="button"
        className="cfg-feature__button"
        role="switch"
        aria-checked={enabled}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={onChange}
      >
        <span className="cfg-feature__icon" aria-hidden="true">{icon}</span>
        <span className="cfg-feature__copy">
          <span className="cfg-feature__label">{label}</span>
          <span id={descriptionId} className="cfg-feature__description">{description}</span>
          <span className="cfg-feature__state">{enabled ? 'Đang bật' : 'Đang tắt'}</span>
        </span>
        <span className={`cfg-toggle ${enabled ? 'is-on' : ''}`} aria-hidden="true">
          <span className="cfg-toggle-knob" />
        </span>
      </button>
    </div>
  );
}
