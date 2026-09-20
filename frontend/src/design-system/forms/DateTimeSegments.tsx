import { Fragment, useEffect, useRef, type InputHTMLAttributes, type KeyboardEvent, type Ref } from 'react';
import { InputBase } from '../../components/untitled-ui/base/input/input';
import './DateTimeSegments.css';

export interface SegmentSpec {
  key: 'hh' | 'mm' | 'dd' | 'mm2' | 'yyyy';
  ariaLabel: string;
  placeholder: string;
  maxLength: number;
  min: number;
  max: number;
}

/** Segments of the canonical `${hh}:${mm}` time draft. */
export const TIME_SEGMENT_SPECS: SegmentSpec[] = [
  { key: 'hh', ariaLabel: 'Giờ', placeholder: 'HH', maxLength: 2, min: 0, max: 23 },
  { key: 'mm', ariaLabel: 'Phút', placeholder: 'mm', maxLength: 2, min: 0, max: 59 },
];
/** Segments of the canonical `${dd}/${mm}/${yyyy}` date draft. */
export const DATE_SEGMENT_SPECS: SegmentSpec[] = [
  { key: 'dd', ariaLabel: 'Ngày', placeholder: 'DD', maxLength: 2, min: 1, max: 31 },
  { key: 'mm2', ariaLabel: 'Tháng', placeholder: 'MM', maxLength: 2, min: 1, max: 12 },
  { key: 'yyyy', ariaLabel: 'Năm', placeholder: 'YYYY', maxLength: 4, min: 0, max: 9999 },
];

const isOutOfRange = (spec: SegmentSpec, text: string) =>
  text.length === spec.maxLength && (Number(text) < spec.min || Number(text) > spec.max);

export interface DateTimeSegmentsProps {
  id: string;
  part: 'time' | 'date';
  /** Field label reused in every segment/trigger accessible name. */
  groupAriaLabel: string;
  /** Canonical draft ('HH:mm' or 'DD/MM/YYYY'); segments slice it at index*3. */
  value: string;
  onValueChange: (next: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  /** Native required flag on every segment (form validation parity). */
  required?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Whole-control invalid state layered over the per-segment range gate. */
  error?: boolean;
  /** Receives the FIRST segment <input> (picker anchoring + focus restore). */
  anchorRef?: Ref<HTMLInputElement>;
  /** Receives the LAST segment <input> (backward navigation target). */
  lastSegmentRef?: Ref<HTMLInputElement>;
  /** Opens the part's picker surface from the trailing icon trigger. */
  onOpenPicker: () => void;
  /** Called when the final segment is filled with valid characters. */
  onComplete?: () => void;
  /** Called when Backspace (empty) or ArrowLeft is pressed at the start of the first segment. */
  onBackFromStart?: () => void;
  /** Called when ArrowRight is pressed at the end of the last segment. */
  onForwardFromEnd?: () => void;
  popupExpanded?: boolean;
  popupControls?: string;
  /** id for the first segment input; '' firstSegmentAriaLabel suppresses its
   * generated label when a <Label htmlFor> names it; firstSegmentProps carries
   * first-only attrs (e.g. data-date-input probes). */
  firstSegmentId?: string;
  firstSegmentAriaLabel?: string;
  firstSegmentProps?: Record<string, unknown>;
  /** Appended to the control group (consumer control skins). */
  className?: string;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'id' | 'maxLength' | 'min' | 'max' | 'size'>;
}

/** Segmented HH:mm / DD/MM/YYYY entry: auto-advance on complete in-range
 * digits, paste distribution across segments, backspace/arrows navigation,
 * and an always-visible trailing trigger that opens the picker surface. */
export function DateTimeSegments({
  id, part, groupAriaLabel, value, onValueChange, disabled, readOnly, required, size = 'sm', error,
  anchorRef, lastSegmentRef, onOpenPicker, onComplete, onBackFromStart, onForwardFromEnd,
  popupExpanded, popupControls, firstSegmentId, firstSegmentAriaLabel, firstSegmentProps, className, inputProps,
}: DateTimeSegmentsProps) {
  const specs = part === 'time' ? TIME_SEGMENT_SPECS : DATE_SEGMENT_SPECS;
  const separator = part === 'time' ? ':' : '/';
  // The canonical draft keeps the free-text contract ('19/', '20:4', '08:30'):
  // segments re-derive from it by splitting, so partially typed values from
  // either entry path display the same digits in the same slots.
  const texts = specs.map((_, index) => (value.split(separator)[index] ?? '').replace(/\D+/g, ''));
  const segRefs = useRef<(HTMLInputElement | null)[]>([]);
  const pendingFocus = useRef<number | null>(null);

  const handOff = (ref: Ref<HTMLInputElement> | undefined, node: HTMLInputElement | null) => {
    if (!ref) return;
    if (typeof ref === 'function') ref(node);
    else ref.current = node;
  };
  const assignRef = (index: number, node: HTMLInputElement | null) => {
    segRefs.current[index] = node;
    if (index === 0) handOff(anchorRef, node);
    if (index === specs.length - 1) handOff(lastSegmentRef, node);
  };

  const focusSegment = (index: number) => {
    const node = segRefs.current[index];
    if (!node) return;
    node.focus();
    const end = node.value.length;
    if (end > 0) node.setSelectionRange(end, end);
  };

  // Focus moves land after the controlled re-render so the target segment
  // already shows its next text (auto-advance, paste distribution).
  useEffect(() => {
    const index = pendingFocus.current;
    if (index == null) return;
    pendingFocus.current = null;
    focusSegment(index);
  });

  const write = (index: number, incoming: string) => {
    if (disabled || readOnly) return;
    const digits = incoming.replace(/\D+/g, '');
    const next = [...texts];
    if (incoming.length > specs[index].maxLength || /[:/]/.test(incoming)) {
      // Paste/multi-char entry: fill from this segment forward, overflow flows
      // on, and segments the stream does not reach are cleared (the pasted
      // text defines everything from this segment onward).
      let stream = digits;
      let stop = index;
      for (let cursor = index; cursor < specs.length; cursor += 1) {
        if (stream) {
          next[cursor] = stream.slice(0, specs[cursor].maxLength);
          stream = stream.slice(specs[cursor].maxLength);
          stop = cursor;
        } else next[cursor] = '';
      }
      pendingFocus.current = stop;
    } else {
      next[index] = digits.slice(0, specs[index].maxLength);
      // Auto-advance only on a complete in-range value; flagged values stay
      // put. Completing the final segment ends the entry naturally.
      if (next[index].length === specs[index].maxLength && !isOutOfRange(specs[index], next[index])) {
        if (index + 1 < specs.length) pendingFocus.current = index + 1;
        else onComplete?.();
      }
    }
    onValueChange(next.join(separator));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    inputProps?.onKeyDown?.(event);
    if (event.defaultPrevented || disabled || readOnly || event.altKey || event.ctrlKey || event.metaKey) return;
    const empty = segRefs.current[index]?.value === '';
    const first = index === 0;
    const last = index === specs.length - 1;
    // Navigation happens at the segment edges (caret at start/end) so mid-digit
    // caret moves stay native; crossing the outer edge hands off to the consumer.
    const atStart = (event.currentTarget.selectionStart ?? 0) === 0;
    const atEnd = (event.currentTarget.selectionEnd ?? 0) === event.currentTarget.value.length;
    const goBack = () => { if (first) { if (onBackFromStart) { event.preventDefault(); onBackFromStart(); } } else { event.preventDefault(); focusSegment(index - 1); } };
    const goForward = () => { if (last) { if (onForwardFromEnd) { event.preventDefault(); onForwardFromEnd(); } } else { event.preventDefault(); focusSegment(index + 1); } };
    if (event.key === 'Backspace' && empty) goBack();
    else if (event.key === 'ArrowLeft' && atStart) goBack();
    else if (event.key === 'ArrowRight' && atEnd) goForward();
    else if (event.key === separator || event.key === ':' || event.key === '/') {
      // Typing the separator pads a lone digit ('8:' → '08') and jumps ahead.
      event.preventDefault();
      if (last) { onComplete?.(); return; }
      if (texts[index].length === 1) {
        const padded = `0${texts[index]}`;
        if (!isOutOfRange(specs[index], padded)) onValueChange([...texts.slice(0, index), padded, ...texts.slice(index + 1)].join(separator));
      }
      focusSegment(index + 1);
    }
  };

  return <div id={id} role="group" data-seg-part={part} data-uui-control="segments" data-control-size={size}
    onClick={() => { if (!disabled && !readOnly) onOpenPicker(); }}
    className={['date-seg-group', error ? 'date-seg-group--error' : '', className].filter(Boolean).join(' ')}>
    {specs.map((spec, index) => {
      const outOfRange = isOutOfRange(spec, texts[index]);
      // Consumer-named first segment wins; '' suppresses the generated label
      // when a <Label htmlFor> association already names it.
      let label = `${spec.ariaLabel} — ${groupAriaLabel}`;
      if (index === 0) {
        const explicit = inputProps?.['aria-label'];
        if (typeof explicit === 'string' && explicit) label = explicit;
        else if (firstSegmentAriaLabel !== undefined) label = firstSegmentAriaLabel;
      }
      const first = index === 0;
      return <Fragment key={spec.key}
      >
        {index > 0 && <span className="date-sep" aria-hidden="true">{separator}</span>}
        <InputBase {...(first ? { ...inputProps, ...firstSegmentProps } : inputProps)} ref={(node) => assignRef(index, node)}
          id={first ? firstSegmentId : undefined} data-seg={spec.key} type="text" inputMode="numeric" size={size}
          value={texts[index]} placeholder={spec.placeholder} maxLength={spec.maxLength} autoComplete="off"
          aria-label={label || undefined} aria-invalid={Boolean(error) || outOfRange || Boolean(inputProps?.['aria-invalid']) || undefined}
          aria-haspopup={first ? 'dialog' : undefined} aria-expanded={first ? Boolean(popupExpanded) : undefined}
          aria-controls={first ? popupControls : undefined}
          onChange={(event) => write(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          onFocus={(event) => { inputProps?.onFocus?.(event); event.target.select(); }}
          isDisabled={disabled} disabled={disabled} readOnly={readOnly} isRequired={required}
          inputClassName={['date-seg', outOfRange ? 'date-seg--invalid' : '', inputProps?.className].filter(Boolean).join(' ')}
          wrapperClassName="date-seg-wrapper" />
      </Fragment>;
    })}
  </div>;
}
