import { useId, useRef, useState } from 'react';
import { DateTimeSegments } from './DateTimeSegments';
import { TimePickerSurface } from './TimePickerSurface';
import './SplitDateTimeField.css';

/**
 * A standalone 24h TIME field — the time half of `SplitDateTimeField` on its own.
 *
 * Card 20261002_275 (AC4): the segmented time entry — auto-advance when the hour
 * is complete and in range, Backspace from an empty minute back to the hour,
 * Left/Right between segments — already lives in `DateTimeSegments` and is
 * covered by its own suite. What was missing was a way to mount that entry
 * WITHOUT a date beside it: `SplitDateTimeField` renders `['time','date']`
 * unconditionally and parses a full `YYYY-MM-DDTHH:mm`, so a surface that
 * already owns its date separately had nowhere to put it and kept a native
 * `type="time"` — the one input left in the app with no auto-advance.
 *
 * This is that mount. It deliberately reuses `SplitDateTimeField`'s class names
 * so a time-only field is pixel-identical to the time half of the combined one;
 * `split-datetime__fields` is a two-column grid, so a single child simply takes
 * the first column.
 *
 * The value contract is the segments' own draft (`'HH:mm'`, or '' when empty) —
 * NOT the combined datetime — so a parent that already keeps `date` and `time`
 * apart wires this straight to its time state.
 */
export function TimeSegmentsField({ id, label, value, onChange, disabled, readOnly, required, error, hideLabel, className, size = 'sm' }: {
  id?: string;
  /** Reused in every segment accessible name and in the picker's dialog name. */
  label: string;
  /** `'HH:mm'`, or '' for empty. Controlled — the parent owns the value. */
  value: string;
  onChange: (time: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  /** Whole-control invalid state, layered over the per-segment range gate. */
  error?: boolean;
  hideLabel?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const groupRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const active = open && !disabled && !readOnly;

  const commit = (time: string) => {
    onChange(time);
  };
  const close = () => {
    setOpen(false);
    anchorRef.current?.focus();
  };

  return (
    <div
      ref={groupRef}
      data-time-segments
      className={['split-datetime', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={label}
      onBlur={(event) => {
        if (active && event.relatedTarget && !groupRef.current?.contains(event.relatedTarget as Node)
          && !panelRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        // Escape dismisses the open panel from anywhere in the group, and must
        // not then bubble to a parent dialog that would close too.
        if (event.key === 'Escape' && active) { event.preventDefault(); event.stopPropagation(); close(); }
      }}
    >
      {!hideLabel && <span className="split-datetime__label">{label}</span>}
      <div className="split-datetime__fields">
        <div className="split-datetime__field">
          <div className="split-datetime__control">
            <DateTimeSegments
              id={`${fieldId}-time-segments`}
              part="time"
              groupAriaLabel={label}
              value={value}
              onValueChange={commit}
              disabled={disabled}
              readOnly={readOnly}
              required={required}
              error={error}
              size={size}
              anchorRef={anchorRef}
              firstSegmentId={fieldId}
              onOpenPicker={() => setOpen((was) => !was)}
              popupExpanded={active}
              popupControls={active ? `${fieldId}-picker` : undefined}
              onComplete={() => anchorRef.current?.focus()}
            />
          </div>
        </div>
      </div>
      {active && (
        <TimePickerSurface
          id={`${fieldId}-picker`}
          label={`Chọn giờ — ${label}`}
          value={value}
          onPick={commit}
          // Operator ruling 2026-09-16: a selection keeps the picker open; only
          // an explicit apply closes it.
          onApply={(time) => { commit(time); setOpen(false); anchorRef.current?.focus(); }}
          onDismiss={close}
          onExit={() => setOpen(false)}
          panelRef={panelRef}
          anchorRef={anchorRef}
          additionalRefs={[groupRef]}
        />
      )}
    </div>
  );
}
