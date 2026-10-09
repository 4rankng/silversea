import { useEffect, useId, useRef, useState, type ComponentProps, type InputHTMLAttributes, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { formatDateTime24, parseDateTime24 } from '../../lib/format';
import { DatePickerSurface } from './DatePickerSurface';
import { DatePanel } from './DateTimePickerPanels';
import { TimePanel } from './TimePanel';
import { DateTimeSegments } from './DateTimeSegments';
import { TimePickerSurface, TIME_PICKER_MOBILE_QUERY } from './TimePickerSurface';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { usePopoverPosition } from '../../hooks/usePopoverPosition';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { registerOverlayToken, unregisterOverlayToken } from '../../hooks/useAnimatedOverlay';
import './SplitDateTimeField.css';

/**
 * Card 071026204700 (FB-001): one popup carrying BOTH the calendar and the
 * 24h time grid — the "popup chọn ngày + giờ kết hợp". Composes the same
 * DatePanel/TimePanel content as the per-part surfaces; the wrapper owns
 * positioning and dismissal (its children are inline panels). Opt-in via
 * `combinedPicker`; hosts without it keep the per-part popups untouched.
 */
function CombinedDateTimeSurface({ id, label, dateValue, timeValue, min, max, onDatePick, onTimePick, onApply, onDismiss, onExit, panelRef, anchorRef, additionalRefs = [], keyboard = false }: {
  id?: string; label: string; dateValue: string; timeValue: string; min?: string; max?: string;
  onDatePick: (date: string) => void; onTimePick: (time: string) => void; onApply: (time: string) => void;
  onDismiss: () => void; onExit: () => void;
  panelRef: React.RefObject<HTMLDivElement | null>; anchorRef: React.RefObject<HTMLElement | null>;
  additionalRefs?: React.RefObject<HTMLElement | null>[]; keyboard?: boolean;
}) {
  const position = usePopoverPosition(panelRef, anchorRef, true, 680, 360);
  const blurFrame = useRef<number | null>(null);
  useFocusTrap(panelRef, keyboard);
  useClickOutside(panelRef, onExit, { escapeKey: true, onEscape: onDismiss, additionalRefs: [anchorRef, ...additionalRefs] });
  // Same overlay token as the per-part surfaces: a parent dialog's window-level
  // Escape/Enter must yield to the open picker (card 20260915_6 + _8).
  const tokenRef = useRef<number | null>(null);
  useEffect(() => {
    const token = registerOverlayToken();
    tokenRef.current = token;
    return () => unregisterOverlayToken(token);
  }, []);
  useEffect(() => () => { if (blurFrame.current != null) cancelAnimationFrame(blurFrame.current); }, []);
  const closeWhenFocusLeaves = (next: Node | null) => {
    if (![panelRef, anchorRef, ...additionalRefs].some((ref) => ref.current?.contains(next))) onExit();
  };
  return createPortal(
    <div id={id} ref={panelRef} className="date-picker__popup combined-datetime__popup"
      data-positioned={position ? 'true' : undefined}
      style={{ top: position?.top ?? 0, left: position?.left ?? 0, maxHeight: position?.maxHeight }}
      role="dialog" aria-label={label} data-date-picker="true" data-time-picker-overlay="true" data-escape-boundary="true"
      onClick={(event) => event.stopPropagation()}
      onFocusCapture={() => {
        if (blurFrame.current != null) cancelAnimationFrame(blurFrame.current);
        blurFrame.current = null;
      }}
      onBlurCapture={(event) => {
        if (blurFrame.current != null) cancelAnimationFrame(blurFrame.current);
        const next = event.relatedTarget as Node | null;
        if (next) closeWhenFocusLeaves(next);
        else blurFrame.current = requestAnimationFrame(() => {
          blurFrame.current = null;
          closeWhenFocusLeaves(document.activeElement);
        });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDismiss(); }
        if (event.key === 'Enter') event.stopPropagation();
      }}>
      <header><strong>Chọn ngày giờ</strong><button type="button" aria-label="Đóng lịch" onClick={onDismiss}><X size={14} aria-hidden="true" /></button></header>
      <div className="combined-datetime__body">
        <div className="combined-datetime__date"><DatePanel value={dateValue} min={min} max={max} onChange={onDatePick} /></div>
        <div className="combined-datetime__time"><TimePanel value={timeValue} onPick={onTimePick} onApply={onApply} /></div>
      </div>
    </div>, document.body,
  );
}

function splitValue(value: string) {
  const formatted = formatDateTime24(value);
  return { time: formatted.slice(0, 5), date: formatted.slice(6) };
}

/** Independent, editable 24h time/date controls with one complete datetime
 * contract. Partial drafts stay visible and invalidate their form inputs;
 * they never silently preserve an older complete timestamp for submission. */
export function SplitDateTimeField({ id: suppliedId, label, value, onChange, onCommit, onCompletenessChange, disabled, readOnly, required, error, hideLabel, className, min, max, name, groupRef: externalGroupRef, inputProps, inputClassName, wrapperClassName, size = 'sm', combinedPicker = false }: {
  id?: string; label: string; value: string; onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  /** 'complete' = parsed datetime; 'empty' = all segments cleared;
   *  'incomplete' = some content but not parseable. Lets a form block the
   *  incomplete state instead of reading '' as an intentional clear. */
  onCompletenessChange?: (state: 'complete' | 'empty' | 'incomplete') => void;
  disabled?: boolean; readOnly?: boolean; required?: boolean; error?: string; hideLabel?: boolean; className?: string;
  min?: string; max?: string; name?: string; groupRef?: Ref<HTMLDivElement>; size?: 'sm' | 'md' | 'lg';
  inputClassName?: string; wrapperClassName?: string;
  /** Card 071026204700 (FB-001): open ONE popup carrying both the calendar
   *  and the 24h time grid instead of one popup per segment group. Default
   *  off — every existing host keeps its current pickers byte for byte. */
  combinedPicker?: boolean;
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
  const completeness: 'complete' | 'empty' | 'incomplete' = parsed != null
    ? 'complete'
    : (draft.time || draft.date) ? 'incomplete' : 'empty';
  useEffect(() => {
    onCompletenessChange?.(completeness);
  }, [completeness, onCompletenessChange]);
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
    // Card 081026230510 (FB-001 round 8): the appointment cluster is a tap
    // surface (card 051026230627), but the fields grid is fit-content inside
    // its 240px cell — clicks landing on the leftover dead space (and only a
    // ~3px strip was left inside the groups) opened nothing. Card
    // 091026091500 (round 8, lan 2) supersedes the 4da7470f half-measure: on
    // combinedPicker hosts the owner contract is that a click anywhere on the
    // field body — the segment inputs included — opens the combined picker;
    // the segment click still lands as a caret click (focus + select, typing
    // keeps type-over editing, card 061026172803) and the picker opens from
    // the field without stealing focus. The 061026172803 caret law keeps its
    // byte-for-byte contract on hosts without combinedPicker.
    onClick={(event) => {
      if (!combinedPicker || disabled || readOnly) return;
      if (!(event.target instanceof HTMLElement)) return;
      openPanel('date');
    }}
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
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;
      // Escape dismisses the open panel from ANY surface in the group
      // (segments, trigger button), not just text inputs; the revert and
      // commit paths stay input-scoped so plain buttons keep their keys.
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (active) { close(); return; }
        if (!(event.target instanceof HTMLInputElement)) return;
        const restored = valueAtFocus.current;
        lastValue.current = restored;
        setDraft(splitValue(restored)); setTouched(false); onChange(restored);
        event.target.blur();
      } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
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
              onComplete={part === 'time' ? () => dateRef.current?.focus() : undefined}
              onBackFromStart={part === 'date' ? () => lastTimeRef.current?.focus() : undefined}
              onForwardFromEnd={part === 'time' ? () => dateRef.current?.focus() : undefined}
              popupExpanded={active && (combinedPicker ? open != null : open === part)}
              popupControls={active && (combinedPicker ? open != null : open === part) ? `${id}-picker` : undefined}
              firstSegmentId={`${id}-${part}`} className={wrapperClassName} required={required}
              inputProps={{
                ...inputProps,
                className: inputClassName,
                'aria-invalid': invalid || inputProps?.['aria-invalid'],
                'aria-describedby': [inputProps?.['aria-describedby'], message ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined,
                onInvalid: () => setTouched(true),
                onKeyDown: (event) => { inputProps?.onKeyDown?.(event); if (!event.defaultPrevented && event.altKey && event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); openPanel(part, true); } else if (!event.defaultPrevented && open === part && !keyboardPicker && /^[0-9]$/.test(event.key)) { setOpen(null); } },
              } as ComponentProps<typeof DateTimeSegments>['inputProps']} />
          </div>
        </div>;
      })}
    </div>
    {name && <input type="hidden" name={name} form={inputProps?.form} value={parsed ?? ''} disabled={disabled} />}
    {message && <small id={`${id}-error`} className="split-datetime__error" role="alert">{message}</small>}
    {active && open && combinedPicker && <CombinedDateTimeSurface id={`${id}-picker`} label={`Chọn ngày giờ — ${label}`}
      dateValue={dateValue} timeValue={draft.time} min={min?.slice(0, 10)} max={max?.slice(0, 10)}
      panelRef={panelRef} anchorRef={trigger} additionalRefs={[groupRef]} keyboard={keyboardPicker}
      onDismiss={close} onExit={() => { setTouched(true); setOpen(null); }}
      onDatePick={(next) => { update('date', `${next.slice(8, 10)}/${next.slice(5, 7)}/${next.slice(0, 4)}`); }}
      onTimePick={(next) => update('time', next)} onApply={() => close()} />}
    {!combinedPicker && active && open === 'date' && <DatePickerSurface id={`${id}-picker`} label={`Chọn ngày — ${label}`} value={dateValue} min={min?.slice(0, 10)} max={max?.slice(0, 10)}
      panelRef={panelRef} anchorRef={dateRef} additionalRefs={[groupRef]} keyboard={keyboardPicker}
      onDismiss={close} onExit={() => { setTouched(true); setOpen(null); }}
      onPick={(next) => { update('date', `${next.slice(8, 10)}/${next.slice(5, 7)}/${next.slice(0, 4)}`); close(); }} />}
    {!combinedPicker && active && open === 'time' && <TimePickerSurface id={`${id}-picker`} label={`Chọn giờ (24h) — ${label}`} value={draft.time}
      panelRef={panelRef} anchorRef={timeRef} additionalRefs={[groupRef]} keyboard={keyboardPicker}
      onDismiss={close} onExit={() => { setTouched(true); setOpen(null); }}
      onPick={(next) => update('time', next)} onApply={() => close()} />}
  </div>;
}
