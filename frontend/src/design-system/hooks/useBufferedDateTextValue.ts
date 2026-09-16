import { type RefObject, useEffect, useRef, useState } from 'react';
import { formatDateTime24, parseDateTime24 } from '../../lib/format';

export const formatDateInput = (iso: string) => formatDateTime24(`${iso}T00:00`).slice(6);

export function validateDateInputText(text: string, min = '', max = '') {
  const parsed = text.trim() ? parseDateTime24(`00:00 ${text}`)?.slice(0, 10) ?? null : '';
  return parsed == null ? 'Nhập ngày hợp lệ theo DD/MM/YYYY.'
    : parsed && min && parsed < min ? `Chọn ngày từ ${formatDateInput(min)}.`
    : parsed && max && parsed > max ? `Chọn ngày đến ${formatDateInput(max)}.` : '';
}

/** Display a stable DD/MM/YYYY draft while committing only valid ISO dates. */
export function useBufferedDateTextValue({ value, onChange, min = '', max = '', inputRef }: {
  value: string; onChange: (value: string) => void; min?: string; max?: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [draft, setDraft] = useState(() => formatDateInput(value));
  const [touched, setTouched] = useState(false);
  const lastExternal = useRef(value);
  const parsed = draft.trim() ? parseDateTime24(`00:00 ${draft}`)?.slice(0, 10) ?? null : '';
  const validation = validateDateInputText(draft, min, max);
  const message = touched ? validation : '';

  useEffect(() => {
    if (value === lastExternal.current) return;
    lastExternal.current = value;
    setDraft(formatDateInput(value));
    setTouched(false);
  }, [value]);

  useEffect(() => { inputRef.current?.setCustomValidity(validation); }, [inputRef, validation]);

  const emit = (next: string) => {
    // The parent may reject a date against a just-updated range boundary.
    // A previous attempt is not acknowledgement: allow it again after that
    // boundary changes, and allow clearing before the next parent render.
    onChange(next);
  };
  const update = (text: string) => {
    inputRef.current?.setCustomValidity(validateDateInputText(text, min, max));
    setDraft(text);
    setTouched(false);
    const next = text.trim() ? parseDateTime24(`00:00 ${text}`)?.slice(0, 10) : '';
    if (next != null && (!next || ((!min || next >= min) && (!max || next <= max)))) emit(next);
  };
  return { draft, setDraft, touched, setTouched, parsed, validation, message, emit, update };
}
