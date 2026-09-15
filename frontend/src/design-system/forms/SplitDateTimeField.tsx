import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { InputBase } from '../../components/untitled-ui/base/input/input';
import { formatDateTime24, parseDateTime24 } from '../../lib/format';
import { usePopoverPosition } from '../../hooks/usePopoverPosition';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { DatePanel } from './DateTimePickerPanels';
import { TimePickerSurface, TIME_PICKER_MOBILE_QUERY } from './TimePickerSurface';
import { closeAfterPress } from './closeAfterPress';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import './SplitDateTimeField.css';

function splitValue(value: string) {
  const formatted = formatDateTime24(value);
  return { time: formatted.slice(0, 5), date: formatted.slice(6) };
}

/** Independent, editable 24h time/date controls with one complete datetime
 * contract. Partial drafts stay visible and invalidate their form inputs;
 * they never silently preserve an older complete timestamp for submission. */
export function SplitDateTimeField({ id: suppliedId, label, value, onChange, disabled, error, hideLabel, className }: {
  id?: string; label: string; value: string; onChange: (value: string) => void;
  disabled?: boolean; error?: string; hideLabel?: boolean; className?: string;
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
  const dateRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoringFocus = useRef(false);
  const restoreFrame = useRef<number | null>(null);
  const trigger = open === 'date' ? dateRef : timeRef;
  const active = open != null && !disabled;
  const mobileTime = useMediaQuery(TIME_PICKER_MOBILE_QUERY) && open === 'time';
  const position = usePopoverPosition(panelRef, trigger, active && open === 'date', 280, 240);
  useFocusTrap(panelRef, active && open === 'date' && keyboardPicker);
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
  useClickOutside(panelRef, () => { setTouched(true); setOpen(null); }, { enabled: active && open === 'date', escapeKey: true, additionalRefs: [groupRef] });

  useEffect(() => () => { if (restoreFrame.current != null) cancelAnimationFrame(restoreFrame.current); }, []);

  useEffect(() => { if (disabled) setOpen(null); }, [disabled]);

  useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value;
      setDraft(splitValue(value));
      setTouched(false);
    }
  }, [value]);

  const parsed = draft.time && draft.date ? parseDateTime24(`${draft.time} ${draft.date}`) : null;
  const incomplete = Boolean(draft.time || draft.date) && parsed == null;
  const validation = incomplete ? 'Nhập đủ giờ và ngày hợp lệ.' : '';
  useEffect(() => {
    timeRef.current?.setCustomValidity(validation);
    dateRef.current?.setCustomValidity(validation);
  }, [validation]);

  const update = (part: 'time' | 'date', text: string) => {
    if (disabled) return;
    setTouched(false);
    const next = { ...draft, [part]: text };
    setDraft(next);
    const complete = next.time && next.date ? parseDateTime24(`${next.time} ${next.date}`) : null;
    const emitted = complete ?? '';
    lastValue.current = emitted;
    onChange(emitted);
  };
  const openPanel = (part: 'time' | 'date', keyboard = false) => {
    if (!disabled) {
      if (restoreFrame.current != null) cancelAnimationFrame(restoreFrame.current);
      restoreFrame.current = null;
      restoringFocus.current = false;
      setKeyboardPicker(keyboard); setOpen(part);
    }
  };
  const message = error || (touched ? validation : '');
  const dateValue = parseDateTime24(`00:00 ${draft.date}`)?.slice(0, 10) ?? '';

  return <div ref={groupRef} data-split-datetime className={['split-datetime', className].filter(Boolean).join(' ')} role="group" aria-label={label}
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
      if (event.nativeEvent.isComposing || !(event.target instanceof HTMLInputElement)) return;
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
        if (!incomplete) event.target.blur();
      }
    }}>
    {!hideLabel && <span className="split-datetime__label">{label}</span>}
    <div className="split-datetime__fields">
      {(['time', 'date'] as const).map((part) => {
        const fieldLabel = part === 'time' ? 'Giờ' : 'Ngày';
        return <div className="split-datetime__field" key={part}>
          <div className="split-datetime__control">
            <InputBase id={`${id}-${part}`} ref={part === 'time' ? timeRef : dateRef} type="text" size="sm"
              aria-label={`${fieldLabel} — ${label}`} aria-invalid={Boolean(error) || (touched && incomplete)} aria-describedby={message ? `${id}-error` : undefined}
              aria-haspopup="dialog" aria-expanded={active && open === part} aria-controls={active && open === part ? `${id}-picker` : undefined}
              value={draft[part]} onChange={(event) => update(part, event.target.value)}
              onClick={() => openPanel(part)} onInvalid={() => setTouched(true)}
              onKeyDown={(event) => { if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); openPanel(part, true); } }}
              placeholder={part === 'time' ? 'HH:mm' : 'DD/MM/YYYY'} maxLength={part === 'time' ? 5 : 10}
              autoComplete="off" isDisabled={disabled} disabled={disabled} />
          </div>
        </div>;
      })}
    </div>
    {message && <small id={`${id}-error`} className="split-datetime__error" role="alert">{message}</small>}
    {active && open === 'date' && createPortal(<div id={`${id}-picker`} ref={panelRef} className="split-datetime__popover" style={{ top: position?.top ?? 12, left: position?.left ?? 12 }}
      role="dialog" aria-label={`Chọn ngày — ${label}`} data-escape-boundary="true"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } if (event.key === 'Enter') event.stopPropagation(); }}>
      <header><strong>Chọn ngày</strong><button type="button" aria-label="Đóng" onClick={close}><X size={14} aria-hidden="true" /></button></header>
      {<DatePanel value={dateValue} onChange={(next) => { update('date', `${next.slice(8, 10)}/${next.slice(5, 7)}/${next.slice(0, 4)}`); close(); }} />}
    </div>, document.body)}
    {active && open === 'time' && <TimePickerSurface id={`${id}-picker`} label={`Chọn giờ (24h) — ${label}`} value={draft.time}
      panelRef={panelRef} anchorRef={timeRef} additionalRefs={[groupRef]} keyboard={keyboardPicker}
      onDismiss={close} onExit={() => { setTouched(true); setOpen(null); }} onPick={(next) => { update('time', next); closeAfterPress(close); }} />}
  </div>;
}
