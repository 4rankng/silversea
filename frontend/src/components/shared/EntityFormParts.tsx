import { type ReactNode, useContext } from 'react';
import type { LucideIcon } from 'lucide-react';
import { InputBase, TextField } from '../untitled-ui/base/input/input';
import { Label } from '../untitled-ui/base/input/label';
import { HintText } from '../untitled-ui/base/input/hint-text';
import { DateInput } from '../../design-system/forms/DateInput';
import { ModalCompactContext } from '../UI';

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
        <h4 className="whitespace-normal text-xs leading-[1.5] font-semibold uppercase tracking-wider text-tertiary">{label}</h4>
        <div className="h-px flex-1 bg-border-secondary" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {children}
      </div>
  </section>
  );
}

/** Numeric input with an in-field unit suffix ("ngày", "tấn", "L/100km").
 * Composes the kit's TextField + InputBase so the label stays associated
 * with the input for free; the suffix is a pointer-events-none overlay. */
export function UnitInput({ label, unit, icon, value, onChange, placeholder, min, max, step, hint, isRequired, autoFocus, size, padClassName = 'pr-12' }: {
  label: string;
  unit: string;
  icon?: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | 'any';
  hint?: ReactNode;
  isRequired?: boolean;
  autoFocus?: boolean;
  size?: 'sm' | 'md';
  /** Extra right padding class so text never runs under the suffix. */
  padClassName?: string;
}) {
  const compact = useContext(ModalCompactContext);
  const resolvedSize = size ?? (compact ? 'sm' : 'md');
  return (
    <TextField value={value} onChange={onChange} autoFocus={autoFocus} isRequired={isRequired} size={resolvedSize}>
      <Label isRequired={isRequired}>{label}</Label>
      <div className="entity-unit-wrap">
        <InputBase
          type="number"
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          icon={icon}
          inputClassName={padClassName}
        />
        <span className="entity-unit-suffix" aria-hidden="true">{unit}</span>
      </div>
      {hint && <HintText>{hint}</HintText>}
    </TextField>
  );
}

/** Labelled date row on the kit's label plus the design-system buffered
 * DateInput, so date fields match the kit chrome inside sectioned entity
 * forms. labelSuffix renders trailing label content (e.g. truck due/overdue
 * badges). */
export function DateField({ id, label, value, onChange, isRequired, labelSuffix }: {
  id: string; label: string; value: string; onChange: (value: string) => void; isRequired?: boolean; labelSuffix?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start justify-start gap-1.5">
      <Label htmlFor={id} isRequired={isRequired}>
        {label}
        {labelSuffix}
      </Label>
      <DateInput id={id} className="input" value={value} onChange={onChange} required={isRequired} />
    </div>
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
