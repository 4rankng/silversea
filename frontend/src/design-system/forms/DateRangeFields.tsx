import { Tabs, type TabItem } from '../Tabs';
import { BufferedUuiDateInput } from './BufferedUuiDateInput';
import './DateRangeFields.css';

/**
 * DateRangeFields — the ONE from/to date filter of the app (CHIEF ruling
 * 2026-09-27: "choose from and to separately instead of one long control" →
 * "I dont want daterangepicker").
 *
 * Two independent single-date fields, side by side: each one is a normal
 * DD/MM/YYYY input with its own one-month calendar (the shared
 * `BufferedUuiDateInput`), never a merged range trigger and never a shared
 * dual-calendar popover. Cross-clamping is behavioural only: picking Từ after
 * Đến clears the now-invalid Đến (and vice versa), and each field passes the
 * other's value as `min`/`max` so the calendar disables out-of-range days.
 *
 * Layout: `.date-range-fields` is a transparent 2-track grid, so the pair is
 * one control group at every width — inside a filter bar it takes two tracks
 * (ListFilterBar.css) and on phones it keeps the 2-up rhythm. Order is
 * enforced by `min`/`max` between the two fields, so the calendar disables
 * out-of-range days and a typed out-of-order date is refused.
 *
 * Quick ranges (Hôm nay / 7 ngày qua / Tháng này …) are NOT hidden in a
 * popover: they ride beside the fields as `DateRangePresets` — the same boxed
 * segmented control the shipment workboards already use for date scopes.
 */

export interface DateRangeValue {
  /** Inclusive ISO 'YYYY-MM-DD'; '' = unset. */
  from: string;
  to: string;
}

export interface DateRangePreset {
  id: string;
  label: string;
  /** Evaluated on click so relative ranges stay today-anchored. */
  range: () => DateRangeValue;
}

export interface DateRangeFieldsProps {
  from: string;
  to: string;
  onChange: (value: DateRangeValue) => void;
  /** Accessible name of the two-field group. */
  ariaLabel: string;
  fromLabel?: string;
  toLabel?: string;
  /** Field density — `sm` matches the 32px filter toolbars. */
  size?: 'sm' | 'md';
  /** Base id; the Từ field takes it, the Đến field takes `${id}-to`. */
  id?: string;
  className?: string;
}

export function DateRangeFields({
  from,
  to,
  onChange,
  ariaLabel,
  fromLabel = 'Từ ngày',
  toLabel = 'Đến ngày',
  size = 'sm',
  id,
  className = '',
}: DateRangeFieldsProps) {
  // Order is enforced by the fields themselves: each one carries the other's
  // value as `min`/`max`, so a complete date that would invert the range is
  // refused before it can be emitted (typed or picked) — no clamp is needed
  // here, and a clamp could never fire anyway.
  const setFrom = (value: string) => onChange({ from: value, to });
  const setTo = (value: string) => onChange({ from, to: value });

  return (
    <div className={`date-range-fields${className ? ` ${className}` : ''}`} role="group" aria-label={ariaLabel}>
      <BufferedUuiDateInput
        id={id}
        className="date-range-fields__from"
        label={fromLabel}
        fieldPrefix="Từ"
        size={size}
        value={from}
        onChange={setFrom}
        inputProps={{ max: to || undefined }}
      />
      {/* The seam marker: decorative only — the two fields stay independent
          controls (CHIEF 2026-09-27: "I dont want daterangepicker"). */}
      <span className="date-range-fields__arrow" aria-hidden="true">→</span>
      <BufferedUuiDateInput
        id={id ? `${id}-to` : undefined}
        className="date-range-fields__to"
        label={toLabel}
        fieldPrefix="Đến"
        size={size}
        value={to}
        onChange={setTo}
        inputProps={{ min: from || undefined }}
      />
    </div>
  );
}

export interface DateRangePresetsProps {
  presets: DateRangePreset[];
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  ariaLabel: string;
  className?: string;
}

/** The quick-range segmented control that rides beside `DateRangeFields`. */
export function DateRangePresets({ presets, value, onChange, ariaLabel, className }: DateRangePresetsProps) {
  const active = presets.find((preset) => {
    const range = preset.range();
    return range.from === value.from && range.to === value.to;
  })?.id ?? '';
  const tabs: TabItem[] = presets.map((preset) => ({ id: preset.id, label: preset.label }));
  return (
    <Tabs
      className={className}
      variant="boxed"
      ariaLabel={ariaLabel}
      tabs={tabs}
      value={active}
      onChange={(id) => {
        const preset = presets.find((candidate) => candidate.id === id);
        if (preset) onChange(preset.range());
      }}
    />
  );
}
