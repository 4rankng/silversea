import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ListFilter } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';
import { usePopoverPosition } from '../hooks/usePopoverPosition';
import './ColumnMiniFilter.css';

/**
 * ColumnMiniFilter — the ONE per-column quick filter (kanban 372: "bộ lọc
 * mini" on the phoi-phieu register's Khách hàng and Thông tin xe columns).
 *
 * A column header keeps its label as visible text and gains a small trigger
 * that opens a portaled popover holding a search input plus the Bỏ lọc / Lọc
 * pair. The shape follows the Untitled UI PRO `FilterDropdown` the repo
 * already renders (`components/FilterDropdown.tsx`, verified against the
 * installed PRO source 2026-09-27; catalog consultation 2026-10-05: base
 * `dropdown-button-advanced` is the nearest catalog entry — no dedicated
 * column-filter popover exists in the catalog), deliberately re-skinned as a
 * house primitive: PRO's surface carries `shadow-xs-skeuomorphic`, and a
 * shadow on a filter surface is flat-surface law violation. The mechanics are
 * the repo's one click-popover triple — `usePopoverPosition` +
 * `useClickOutside` + `createPortal` — so there is still exactly one
 * click-popover pattern in the codebase, not two.
 *
 * The component is presentation-only: it owns the open/draft interaction and
 * hands the applied value to the caller, which decides what the value filters.
 */

export interface ColumnMiniFilterProps {
  /** The column label — the header's visible text and the trigger's name. */
  label: ReactNode;
  /** Applied value; `''` (or `undefined`) means not filtering. */
  value?: string;
  /** Input placeholder. */
  placeholder?: string;
  /** Accessible name of the popover dialog. Defaults to `Lọc ${label}` —
   *  the same name the field inside carries, so trigger, dialog and input
   *  speak with one voice. */
  dialogLabel?: string;
  /** Visible dialog title. Defaults to `Lọc ${label}` when `label` is text. */
  title?: string;
  /** Commit the typed value ('' = filter removed). */
  onApply: (value: string) => void;
  /** The `Bỏ lọc` action — remove the filter and close. */
  onClear: () => void;
}

export function ColumnMiniFilter({
  label,
  value = '',
  placeholder,
  dialogLabel,
  title,
  onApply,
  onClear,
}: ColumnMiniFilterProps) {
  const dialogId = useId();
  const [isOpen, setIsOpen] = useState(false);
  // The draft lives only while the dialog is open: it seeds from the applied
  // value on open (so a closed popover never lies about the active filter),
  // and a dismiss without applying just throws the draft away.
  const [draft, setDraft] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(panelRef, triggerRef, isOpen, 260, 190);

  const close = useCallback(() => setIsOpen(false), []);

  useClickOutside(panelRef, close, {
    escapeKey: true,
    enabled: isOpen,
    additionalRefs: [triggerRef],
  });

  // Escape (focus is inside the panel) and a press on dead space (focus falls
  // to <body>) hand the keyboard back to the trigger; a press on another
  // control keeps that control's focus. Same contract FilterDropdown runs.
  useEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    return () => {
      const active = document.activeElement;
      if (active == null || active === document.body) trigger?.focus();
    };
  }, [isOpen]);

  // Seed the draft from the applied value and put the caret in the field —
  // the popover is a single input, so the input IS the dialog's first stop.
  useEffect(() => {
    if (!isOpen) return;
    setDraft(value);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen, value]);

  // Same fade gate FilterDropdown runs: coordinates first, then visible.
  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => panelRef.current?.setAttribute('data-open', 'true'));
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const apply = () => {
    onApply(draft.trim());
    close();
  };

  const applied = value.trim() !== '';

  const panel = isOpen ? (
    <div
      ref={panelRef}
      id={dialogId}
      className="column-mini-filter__popover"
      data-positioned={position ? 'true' : undefined}
      style={{ top: position?.top ?? 0, left: position?.left ?? 0, maxHeight: position?.maxHeight }}
      role="dialog"
      aria-label={dialogLabel ?? `Lọc ${label}`}
    >
      <label className="column-mini-filter__field">
        <span className="column-mini-filter__title">{title ?? `Lọc ${label}`}</span>
        <input
          ref={inputRef}
          className="column-mini-filter__input"
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            }
          }}
        />
      </label>
      <div className="column-mini-filter__actions">
        <button type="button" className="column-mini-filter__clear" onClick={() => { onClear(); close(); }}>
          Bỏ lọc
        </button>
        <button type="button" className="column-mini-filter__apply" onClick={apply}>
          Lọc
        </button>
      </div>
    </div>
  ) : null;

  return (
    <span className="column-mini-filter">
      <button
        ref={triggerRef}
        type="button"
        className="column-mini-filter__trigger"
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? dialogId : undefined}
      >
        <span className="column-mini-filter__label">{label}</span>
        <ListFilter size={12} className="column-mini-filter__glyph" aria-hidden="true" />
        {applied ? <span className="column-mini-filter__dot" aria-hidden="true" /> : null}
      </button>
      {typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
    </span>
  );
}
