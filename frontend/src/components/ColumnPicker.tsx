import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Columns3 } from 'lucide-react';
import { ColumnPickerPanel } from './ColumnPickerPanel';
import { useClickOutside } from '../hooks/useClickOutside';
import { usePopoverPosition } from '../hooks/usePopoverPosition';
import { useFilterBarMode } from './filter-bar-mode';
import type { LedgerColumn } from '../lib/column-visibility';
import './ColumnPicker.css';

/**
 * ColumnPicker — the ONE column-visibility control (card 20260928_193).
 *
 * The card exists because card `20260917_4` had shipped this feature as a
 * page-local row of checkboxes inside `/shipments-detail`'s advanced-filter
 * panel, and commit `03d584ec` deleted both the mechanism and its storage one
 * day after QA passed it. Rebuilding it page-locally would repeat the defect the
 * 2026-09-27 one-filter-plane law names ("one pattern, one implementation"), so
 * the control is a shared component the shared bar hosts.
 *
 * Its PLACE on the bar is measured, never declared — the same rule the criteria
 * themselves obey (operator 2026-09-27: "group inside bo loc is only when we have
 * no other choice due to screensize limitation"):
 *
 *   `inline`  — everything the surface has fits the two-row budget, so the picker
 *               is a bar item: a compact trigger with its own popover;
 *   folded    — the bar is out of room, so the picker renders as an inline block
 *               INSIDE `Bộ lọc`, beside the criteria it now shares a home with.
 *               Not a second popover: a portalled panel inside the dialog would
 *               read as "outside" to the dialog's own dismiss handler and close
 *               the very panel it was opened from.
 *
 * Design provenance (AGENTS.md "reference before invention"):
 *   - Untitled UI PRO (`untitledui` MCP, `version: 8`): searched for a
 *     table/column-settings primitive — the public catalog returns
 *     `base/dropdown` (`npx untitledui@latest add dropdown`) and `base/checkbox`;
 *     no column-settings component exists there, and both are already vendored
 *     under `src/components/untitled-ui/` (`base/checkbox/checkbox.tsx`), which
 *     is what the panel composes for its rows.
 *   - Tailkit UI (`a-c-tables-15`, "In Card Alternate with Search and Actions"):
 *     the layout idea that a table's controls ride the SAME toolbar line as the
 *     search, not a separate strip. Retokenized to house tokens — its
 *     `secondary-*` ramp does not exist here and its `shadow-xs` is banned by the
 *     flat-surface law (§3).
 *   - The trigger/panel MECHANICS are the repo's own one click-popover triple
 *     (`usePopoverPosition` + `useClickOutside` + `createPortal`) that
 *     `FilterDropdown` and `InlineLabelSelect` already use, so the codebase keeps
 *     one popover pattern rather than two.
 */

export interface ColumnPickerProps {
  /** The surface's columns in table order (pinned ones are not offered). */
  columns: readonly LedgerColumn[];
  /** The effective hidden keys — what the table is currently hiding. */
  hidden: readonly string[];
  /** A stored choice exists, so "Mặc định" has a default to restore. */
  customized: boolean;
  onToggle: (key: string) => void;
  onReset: () => void;
}

export function ColumnPicker({ columns, hidden, customized, onToggle, onReset }: ColumnPickerProps) {
  const mode = useFilterBarMode();
  const dialogId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(panelRef, triggerRef, isOpen, 260, 240);
  const close = () => setIsOpen(false);
  useClickOutside(panelRef, close, { escapeKey: true, enabled: isOpen, additionalRefs: [triggerRef] });

  // Escape (focus inside the panel) and a press on dead space both hand the
  // keyboard back to the trigger — the FilterDropdown contract, verbatim.
  useEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    return () => {
      const active = document.activeElement;
      if (active == null || active === document.body) trigger?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => panelRef.current?.setAttribute('data-open', 'true'));
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  // The bar folded the criteria away: the picker is one of them now. The block
  // carries its own caption, so it reads as a labelled criterion inside the
  // dialog instead of a bare list of checkboxes.
  if (mode !== 'inline') {
    return (
      <div className="column-picker column-picker--inline" data-component="column-picker">
        <span className="column-picker__caption">Cột hiển thị</span>
        <ColumnPickerPanel columns={columns} hidden={hidden} customized={customized} onToggle={onToggle} onReset={onReset} />
      </div>
    );
  }

  const hiddenCount = hidden.length;
  const panel = isOpen ? (
    <div
      ref={panelRef}
      id={dialogId}
      className="column-picker__popover"
      data-positioned={position ? 'true' : undefined}
      style={{ top: position?.top ?? 0, left: position?.left ?? 0, maxHeight: position?.maxHeight }}
      role="dialog"
      aria-label="Cột hiển thị"
    >
      <ColumnPickerPanel columns={columns} hidden={hidden} customized={customized} onToggle={onToggle} onReset={onReset} />
    </div>
  ) : null;

  return (
    <div className="column-picker" data-component="column-picker">
      <button
        ref={triggerRef}
        type="button"
        className="column-picker__trigger"
        data-uui-control="button"
        data-control-size="sm"
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? dialogId : undefined}
        aria-label={hiddenCount > 0 ? `Cột hiển thị, đang ẩn ${hiddenCount} cột` : 'Cột hiển thị'}
      >
        <Columns3 size={14} aria-hidden="true" />
        <span className="column-picker__label">Cột</span>
        {hiddenCount > 0 ? <span className="column-picker__count" aria-hidden="true">{hiddenCount}</span> : null}
        <ChevronDown size={14} className="column-picker__chevron" aria-hidden="true" />
      </button>
      {typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
    </div>
  );
}
