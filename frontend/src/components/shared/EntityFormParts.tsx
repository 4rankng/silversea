import { type ComponentType, type HTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { InputBase, TextField } from '../untitled-ui/base/input/input';
import { Label } from '../untitled-ui/base/input/label';

/** Section caption used to group entity-form fields — an icon chip, an
 * uppercase label, and a hairline divider that fills the remaining width.
 * Children render in a 1-col (mobile) / 2-col (sm+) grid. */
export function EntityFormSection({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-fg-brand-secondary">
          <Icon className="size-3.5" strokeWidth={2.25} />
        </span>
        <h4 className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-tertiary">{label}</h4>
        <div className="h-px flex-1 bg-border-secondary" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {children}
      </div>
  </section>
  );
}

/** Numeric input with an in-field unit suffix ("ngày", "tấn", "L/100km").
 * Composes the kit's TextField + InputBase so the label stays associated
 * with the input for free; the suffix is a pointer-events-none overlay. */
export function UnitInput({ label, unit, icon, value, onChange, placeholder, min, max, isRequired, autoFocus, padClassName = 'pr-12' }: {
  label: string;
  unit: string;
  icon?: ComponentType<HTMLAttributes<HTMLOrSVGElement>>;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  isRequired?: boolean;
  autoFocus?: boolean;
  /** Extra right padding class so text never runs under the suffix. */
  padClassName?: string;
}) {
  return (
    <TextField value={value} onChange={onChange} autoFocus={autoFocus} isRequired={isRequired}>
      <Label isRequired={isRequired}>{label}</Label>
      <div className="entity-unit-wrap">
        <InputBase
          type="number"
          min={min}
          max={max}
          placeholder={placeholder}
          icon={icon}
          inputClassName={padClassName}
        />
        <span className="entity-unit-suffix" aria-hidden="true">{unit}</span>
      </div>
    </TextField>
  );
}

/** Footer hint for polished entity-form modals — "✳ Trường bắt buộc". */
export function RequiredHint() {
  return (
    <p className="modal__hint">
      <span className="modal__req-mark" aria-hidden="true">*</span> Trường bắt buộc
    </p>
  );
}
