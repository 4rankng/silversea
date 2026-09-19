import { useEffect, useId, useRef, useState, type ComponentProps, type InputHTMLAttributes, type Ref } from 'react';
import { formatDateTime24, parseDateTime24 } from '../../lib/format';
import { DatePickerSurface } from './DatePickerSurface';
import { DateTimeSegments } from './DateTimeSegments';
import { TimePickerSurface, TIME_PICKER_MOBILE_QUERY } from './TimePickerSurface';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import './SplitDateTimeField.css';

function splitValue(value: string) {
  const formatted = formatDateTime24(value);
  return { time: formatted.slice(0, 5), date: formatted.slice(6) };
}

/** Independent, editable 24h time/date controls with one complete datetime
 * contract. Partial drafts stay visible and invalidate their form inputs;
 * they never silently preserve an older complete timestamp for submission. */
export function SplitDateTimeField({ id: suppliedId, label, value, onChange, onCommit, disabled, readOnly, required, error, hideLabel, className, min, max, name, groupRef: externalGroupRef, inputProps, inputClassName, wrapperClassName, size = 'sm' }: {
  id?: string; label: string; value: string; onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  disabled?: boolean; readOnly?: boolean; required?: boolean; error?: string; hideLabel?: boolean; className?: string;
  min?: string; max?: string; name?: string; groupRef?: Ref<HTMLDivElement>; size?: 'sm' | 'md' | 'lg';
  inputClassName?: string; wrapperClassName?: string;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'id' | 'name' | 'min' | 'max' | 'size'>;
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const [draft, setDraft] = useState(() => splitValue(value));
  const lastValue = useRef(value);
  const valueAtFocus = useRef(value);
  const [open, setOpen] = useState<'time' | 'date' | null>(null);
  const [keyboardPicker, setKeyboardPicker] = useState(false);
  const [touched, setTouched] = useState(false);
  const timeRef = useRef<HTMLInputElement>(null);
  const lastTimeRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoringFocus = useRef(false);
  const restoreFrame = useRef<number | null>(null);
  const trigger = open === 'date' ? dateRef : timeRef;
  const active = open != null && !disabled && !readOnly;
  const mobileTime = useMediaQuery(TIME_PICKER_MOBILE_QUERY) && open === 'time';
  const close = () => {
    const target = trigger.current;
    restoringFocus.current = true;
    setOpen(null);
    target?.focus();
    if (restoreFrame.current != null) cancelAnimationFrame(restoreFrame.current);
    // ListBox press cleanup may blur the field after its selected option
    // unmounts. Finish this handoff after that cleanup, never over a new focus.
    restoreFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = null;
      const focused = document.activeElement;
      if (target?.isConnected && !target.disabled && (!focused || focused === document.body || focused === document.documentElement || focused === target)) {
        target.focus();
      } else if (!groupRef.current?.contains(focused)) setTouched(true);
      restoringFocus.current = false;
    });
  };

  useEffect(() => () => { if (restoreFrame.current != null) cancelAnimationFrame(restoreFrame.current); }, []);

  useEffect(() => { if (disabled || readOnly) setOpen(null); }, [disabled, readOnly]);

  useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value;
      setDraft(splitValue(value));
      setTouched(false);
    }
  }, [value]);

  const parsed = draft.time && draft.date ? parseDateTime24(`${draft.time} ${draft.date}`) : null;
  const incomplete = Boolean(draft.time || draft.date) && parsed == null;
  const validation = incomplete ? 'Nhập đủ giờ và ngày hợp lệ.'
    : required && !parsed ? 'Vui lòng nhập ngày và giờ.'
    : parsed && min && parsed < min.slice(0, 16) ? `Chọn từ ${formatDateTime24(min)}.`
    : parsed && max && parsed > max.slice(0, 16) ? `Chọn đến ${formatDateTime24(max)}.` : '';
  useEffect(() => {
    timeRef.current?.setCustomValidity(validation);
    dateRef.current?.setCustomValidity(validation);
  }, [validation]);

  const update = (part: 'time' | 'date', text: string) => {
    if (disabled || readOnly) return;
    setTouched(false);
    const next = { ...draft, [part]: text };
    setDraft(next);
    const complete = next.time && next.date ? parseDateTime24(`${next.time} ${next.date}`) : null;
    const emitted = complete ?? '';
    lastValue.current = emitted;
    onChange(emitted);
  };
  const openPanel = (part: 'time' | 'date', keyboard = false) => {
    if (!disabled && !readOnly) {
      if (restoreFrame.current != null) cancelAnimationFrame(restoreFrame.current);
      restoreFrame.current = null;
      restoringFocus.current = false;
      setKeyboardPicker(keyboard); setOpen(part);
    }
  };
  const message = error || (touched ? validation : '');
  const dateValue = parseDateTime24(`00:00 ${draft.date}`)?.slice(0, 10) ?? '';

  return <div ref={(node) => { groupRef.current = node; if (typeof externalGroupRef === 'function') externalGroupRef(node); else if (externalGroupRef) externalGroupRef.current = node; }} data-split-datetime className={['split-datetime', className].filter(Boolean).join(' ')} role="group" aria-label={label}
    onFocusCapture={(event) => {
      if (!active && !restoringFocus.current && event.currentTarget.contains(event.target as Node) && !event.currentTarget.contains(event.relatedTarget as Node | null)) valueAtFocus.current = value;
    }}
    onBlurCapture={(event) => {
      if (restoringFocus.current || (active && mobileTime)) return;
      const next = event.relatedTarget as Node | null;
      if (!event.currentTarget.contains(next) && !panelRef.current?.contains(next)) {
        setTouched(true);
        setOpen(null);
      }
    }}
    onKeyDown={(event) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || !(event.target instanceof HTMLInputElement)) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (active) { close(); return; }
        const restored = valueAtFocus.current;
        lastValue.current = restored;
        setDraft(splitValue(restored)); setTouched(false); onChange(restored);
        event.target.blur();
      } else if (event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation();
        setOpen(null);
        setTouched(true);
        if (!validation) { onCommit?.(parsed ?? ''); event.target.blur(); }
      }
    }}>
    {!hideLabel && <span className="split-datetime__label">{label}</span>}
    <div className="split-datetime__fields">
      {(['time', 'date'] as const).map((part) => {
        const invalid = Boolean(error) || (touched && Boolean(validation));
        return <div className="split-datetime__field" key={part}>
          <div className="split-datetime__control">
            <DateTimeSegments id={`${id}-${part}-segments`} part={part} groupAriaLabel={label}
              value={draft[part]} onValueChange={(text) => update(part, text)}
              disabled={disabled} readOnly={readOnly} size={size} error={invalid}
              anchorRef={part === 'time' ? timeRef : dateRef}
              lastSegmentRef={part === 'time' ? lastTimeRef : undefined}
              onOpenPicker={() => openPanel(part)}
              onBackFromStart={part === 'date' ? () => lastTimeRef.current?.focus() : undefined}
              onForwardFromEnd={part === 'time' ? () => dateRef.current?.focus() : undefined}
              popupExpanded={active && open === part} popupControls={active && open === part ? `${id}-picker` : undefined}
              firstSegmentId={`${id}-${part}`} className={wrapperClassName} required={required}
              inputProps={{
                ...inputProps,
                className: inputClassName,
                'aria-invalid': invalid || inputProps?.['aria-invalid'],
                'aria-describedby': [inputProps?.['aria-describedby'], message ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined,
                onInvalid: () => setTouched(true),
                onKeyDown: (event) => { inputProps?.onKeyDown?.(event); if (!event.defaultPrevented && event.altKey && event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); openPanel(part, true); } },
              } as ComponentProps<typeof DateTimeSegments>['inputProps']} />
          </div>
        </div>;
      })}
    </div>
    {name && <input type="hidden" name={name} form={inputProps?.form} value={parsed ?? ''} disabled={disabled} />}
    {message && <small id={`${id}-error`} className="split-datetime__error" role="alert">{message}</small>}
    {active && open === 'date' && <DatePickerSurface id={`${id}-picker`} label={`Chọn ngày — ${label}`} value={dateValue} min={min?.slice(0, 10)} max={max?.slice(0, 10)}
      panelRef={panelRef} anchorRef={dateRef} additionalRefs={[groupRef]} keyboard={keyboardPicker}
      onDismiss={close} onExit={() => { setTouched(true); setOpen(null); }}
      onPick={(next) => { update('date', `${next.slice(8, 10)}/${next.slice(5, 7)}/${next.slice(0, 4)}`); close(); }} />}
    {active && open === 'time' && <TimePickerSurface id={`${id}-picker`} label={`Chọn giờ (24h) — ${label}`} value={draft.time}
      panelRef={panelRef} anchorRef={timeRef} additionalRefs={[groupRef]} keyboard={keyboardPicker}
      onDismiss={close} onExit={() => { setTouched(true); setOpen(null); }}
      onPick={(next) => update('time', next)} onApply={() => close()} />}
  </div>;
}
