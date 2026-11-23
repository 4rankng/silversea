import { type RefObject, useEffect, useRef, useState } from 'react';
import { formatISODate, parseDateTime24 } from '../../lib/format';

export const formatDateInput = (iso: string) => (iso ? formatISODate(iso, { empty: '' }) : '');

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
    // A loose one-digit day/month is a valid blur shorthand, but not a
    // completed typing draft. Emitting it now makes the parent's ISO echo
    // pad the segment before its next key (3 becomes03, blocking31/33).
    const complete = /^\d{2}\/\d{2}\/\d{4}$/.test(text.trim());
    const next = !text.trim() ? '' : complete ? parseDateTime24(`00:00 ${text}`)?.slice(0, 10) : null;
    if (next != null && (!next || ((!min || next >= min) && (!max || next <= max)))) emit(next);
  };
  // SIL-855 round 9: a complete draft the current bounds refuse (range order
  // enforcement) must re-commit once the peer boundary moves. In the debt
  // ledger filter, typing 20/04/2027 into Từ over a seeded 2026 range kept the
  // stale 2026 commit — the field DISPLAYED 20/04/2027 while the applied query
  // ran with 2026-04-20, because the first boundary typed can never satisfy a
  // gate built from the other boundary's old value. When min/max change, retry
  // the still-typed draft under the new bounds. Deps deliberately exclude
  // draft/value: emission re-renders with the same normalized draft and the
  // sync effect owns external value changes.
  useEffect(() => {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(draft.trim())) return;
    const next = parseDateTime24(`00:00 ${draft}`)?.slice(0, 10) ?? null;
    if (next == null || next === value) return;
    if ((!min || next >= min) && (!max || next <= max)) emit(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retry only when the peer boundary moves; emit/value/draft are re-read fresh
  }, [min, max]);
  return { draft, setDraft, touched, setTouched, parsed, validation, message, emit, update };
}
