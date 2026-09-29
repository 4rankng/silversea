import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ListFilter } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';
import { usePopoverPosition } from '../hooks/usePopoverPosition';
import { useFilterBarMode, useFilterBarViewControls } from './filter-bar-mode';
import './FilterDropdown.css';

/**
 * FilterDropdown — the ONE place the app keeps secondary filter criteria
 * (card 20260927_152).
 *
 * The operator's ruling of 2026-09-27 is what this component exists for: the
 * filter section may occupy at most TWO rows and a control may never be wider
 * than the value it holds. Eight always-visible controls cannot satisfy both, so
 * the bar keeps the criteria every list shares (search, from/to dates, quick
 * ranges, reset) and everything else moves behind one trigger that reports how
 * many are applied.
 *
 * Shape copied from the Untitled UI PRO `FilterDropdown` (verified against the
 * installed PRO source, 2026-09-27): a secondary button carrying the filter
 * glyph, the label, a count badge when anything is applied, and a trailing
 * chevron, opening a dialog with the criteria plus a reset/apply footer. PRO
 * stays a design REFERENCE, not a dependency (docs/design-guidelines.md
 * 2026-09-23): its own trigger skin carries `shadow-xs-skeuomorphic`, and a
 * shadow on a filter surface is banned by the flat-surface ruling. The popover
 * mechanics are the repo's own — `usePopoverPosition` + `useClickOutside` +
 * `createPortal`, the same triple `InlineLabelSelect` uses, so there is one
 * click-popover pattern in the codebase, not two — plus the trigger carries the
 * UUI control-geometry contract (`data-uui-control` / `data-control-size`) so
 * the bar hands it the same height token as every sibling control.
 */

export interface FilterDropdownProps {
  /** How many secondary criteria are currently applied (0 hides the badge). */
  count: number;
  /** Trigger text. */
  label?: string;
  /** Accessible name of the trigger. */
  ariaLabel: string;
  /** Accessible name of the dialog. */
  dialogLabel?: string;
  /** The secondary criteria — labelled controls, packed into as few rows as the dialog holds. */
  children: ReactNode;
  /**
   * Quick ranges, rendered INSIDE the dialog only while the bar has folded them
   * (`dialog-presets`, the phone shape). The caller passes the same node to the
   * bar, and exactly one of the two renders it.
   */
  presets?: ReactNode;
  /** Clear every secondary criterion (footer, left). */
  onReset: () => void;
  /**
   * Render the criteria inline in the bar while the strip fits two rows, and
   * collapse them behind the trigger only when the width leaves no other choice
   * (operator 2026-09-27: "when there is enough space we try our best to display
   * all filters, not group inside bo loc"; "group inside bo loc is only when we
   * have no other choice due to screensize limitation"). Set `false` for a
   * surface whose criteria are too numerous to ever show — a searchable facet
   * list, for instance.
   */
  inlineWhenRoom?: boolean;
  /** Extra classes on the root (page sizing only — never layout). */
  className?: string;
}

export function FilterDropdown({
  count,
  label = 'Bộ lọc',
  ariaLabel,
  dialogLabel = 'Bộ lọc nâng cao',
  children,
  presets,
  onReset,
  inlineWhenRoom = true,
  className = '',
}: FilterDropdownProps) {
  const barMode = useFilterBarMode();
  const viewControls = useFilterBarViewControls();
  const dialogId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The REAL open state, not a literal `true`: a closed dropdown must not
  // measure (it would write coordinates for a panel that is not rendered), and
  // the first coordinates arrive one layout pass after mount — the panel stays
  // `visibility: hidden` until they do.
  const position = usePopoverPosition(panelRef, triggerRef, isOpen, 320, 320);
  const close = useCallback(() => setIsOpen(false), []);
  // Card _202: the criteria inside this dialog portal their own popovers
  // (`.searchable-select__popover`, `[role="listbox"]`, the date picker) to
  // document.body, so they are NOT inside `panelRef`. Without this selector a
  // `pointerdown` on an option read as an outside press: the dialog closed on
  // pointerdown, the listbox unmounted before the click landed, and the chosen
  // value was discarded — the filter silently did nothing. Same list the other
  // popovers in the repo pass (ShipmentsPage, ShipmentContainerLedger).
  useClickOutside(panelRef, close, {
    escapeKey: true,
    enabled: isOpen,
    additionalRefs: [triggerRef],
    ignoreSelector: '.searchable-select__popover, .searchable-select__backdrop, .react-aria-Popover, [role="listbox"], .date-picker__popup, [data-date-picker], .time-picker__popup, [data-time-picker-overlay], .modal__content',
  });

  // Escape (focus is inside the panel) and a press on dead space (focus falls
  // to <body>) both hand the keyboard back to the trigger; a press on another
  // control keeps that control's focus. The trigger is captured at effect time:
  // by the time this cleanup runs React has already detached the ref.
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

  const applied = count > 0;
  const rootClass = ['filter-dropdown', applied ? 'is-applied' : '', className].filter(Boolean).join(' ');

  // Room for everything: the criteria ARE bar items, so they need no wrapper —
  // a fragment keeps them direct children of the bar row, which is what the
  // row's own measurement and line packing read.
  if (barMode === 'inline' && inlineWhenRoom) return <>{children}</>;

  const panel = isOpen ? (
    <div
      ref={panelRef}
      id={dialogId}
      className="filter-dropdown__popover"
      // No hardcoded fallback origin anywhere: an unmeasured panel keeps
      // `data-positioned` off and the stylesheet holds it `visibility: hidden`,
      // instead of parking it in the top-left corner (the operator's 2026-09-27
      // complaint). The gate is a data attribute + CSS, NOT an inline style, so
      // jsdom (which does not load stylesheets) still sees the dialog its tests
      // need to query.
      data-positioned={position ? 'true' : undefined}
      style={{ top: position?.top ?? 0, left: position?.left ?? 0, maxHeight: position?.maxHeight }}
      role="dialog"
      aria-label={dialogLabel}
    >
      {/* No footer row (operator 2026-09-27: "move the buttons same row with ke
          hoach dropdown, remove the footer row with text chua dat dieu kien
          nao"): the actions are a flex item INSIDE the body, pinned to the end
          of the last criteria line. The applied count already rides the
          trigger's accessible name, so the hint was a second voice for it. */}
      <div className="filter-dropdown__body">
        {/* The quick ranges join the criteria when the bar folded them in here
            (`dialog-presets`) — the caller passes the same node it gives the
            bar, and only one of the two renders it. */}
        {presets && barMode === 'dialog-presets' ? (
          <div className="filter-dropdown__presets">{presets}</div>
        ) : null}
        {children}
        {/* The bar's view controls (card 20260928_193) fold in beside the
            criteria: the bar publishes them, the bar renders them itself only
            while it is `inline`, so this is the one instance at this width. */}
        {viewControls}
        <div className="filter-dropdown__actions">
          <button type="button" className="filter-dropdown__reset" onClick={onReset}>
            Đặt lại
          </button>
          <button type="button" className="filter-dropdown__apply" onClick={close}>
            Áp dụng
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className={rootClass} data-component="filter-dropdown">
      <button
        ref={triggerRef}
        type="button"
        className="filter-dropdown__trigger"
        data-uui-control="button"
        data-control-size="sm"
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? dialogId : undefined}
        aria-label={applied ? `${ariaLabel}, ${count} đang áp dụng` : ariaLabel}
      >
        <ListFilter size={14} aria-hidden="true" />
        <span className="filter-dropdown__label">{label}</span>
        {applied ? <span className="filter-dropdown__count" aria-hidden="true">{count}</span> : null}
        <ChevronDown size={14} className="filter-dropdown__chevron" aria-hidden="true" />
      </button>
      {typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
    </div>
  );
}
