import { useEffect, useId, useRef, useState } from 'react';
import { TimePickerSurface, TIME_PICKER_MOBILE_QUERY } from '../../../design-system/forms/TimePickerSurface';
import { closeAfterPress } from '../../../design-system/forms/closeAfterPress';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import './ShipmentScheduleTimeField.css';

export function ShipmentScheduleTimeField({ label, value, onChange, disabled, autoFocus }: {
  autoFocus?: boolean; label: string; value: string; onChange: (value: string) => void; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [keyboardPicker, setKeyboardPicker] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const invalid = Boolean(value) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const mobile = useMediaQuery(TIME_PICKER_MOBILE_QUERY);
  const restoreFrame = useRef<number | null>(null);
  useEffect(() => () => { if (restoreFrame.current != null) cancelAnimationFrame(restoreFrame.current); }, []);
  const close = () => {
    setOpen(false); input.current?.focus();
    if (restoreFrame.current != null) cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = null;
      const focused = document.activeElement;
      if (input.current && !input.current.disabled && (!focused || focused === document.body || focused === document.documentElement)) input.current.focus();
    });
  };
  return <>
    <span className="shipment-schedule-time-field">
      <input ref={input} aria-label={label} autoFocus={autoFocus} type="text" value={value} onChange={(event) => onChange(event.target.value)}
        disabled={disabled} placeholder="HH:mm" maxLength={5} autoComplete="off"
        aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
        aria-haspopup="dialog" aria-expanded={open && !disabled} aria-controls={open && !disabled ? `${id}-panel` : undefined}
        onBlur={(event) => { if (!(mobile && open) && !panel.current?.contains(event.relatedTarget)) setOpen(false); }}
        onClick={() => { if (!disabled) { setKeyboardPicker(false); setOpen(true); } }}
        onKeyDown={(event) => {
          if (event.altKey && event.key === 'ArrowDown' && !disabled) {
            event.preventDefault(); event.stopPropagation(); setKeyboardPicker(true); setOpen(true);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault(); event.stopPropagation(); close();
          } else if (event.key === 'Enter') setOpen(false);
        }} />
    </span>
    {invalid && <small id={`${id}-error`} className="shipment-schedule-time-error">Nhập giờ từ 00:00 đến 23:59 (HH:mm).</small>}
    {open && !disabled && <TimePickerSurface id={`${id}-panel`} label={`Chọn giờ (24h) — ${label}`} value={value}
      panelRef={panel} anchorRef={input} keyboard={keyboardPicker} onDismiss={close} onExit={() => setOpen(false)}
      onPick={(next) => { onChange(next); closeAfterPress(close); }} />}
  </>;
}
