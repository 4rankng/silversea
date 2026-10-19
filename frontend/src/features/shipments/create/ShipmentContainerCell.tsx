import { ChevronDown } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import './ShipmentContainerCell.css';

const CELL_CONTROL_SELECTOR = 'input, button, select, textarea, [role="combobox"]';

interface ShipmentContainerCellProps {
  label: string;
  value: string;
  placeholder: string;
  displayTitle?: string;
  /** Always-visible muted second line (e.g. factory address under the name). */
  subValue?: string;
  /** Always-visible trailing affordance beside the value (e.g. factory detail peek). */
  actions?: ReactNode;
  children: ReactNode;
  fieldId?: string;
  error?: string;
  className?: string;
  alwaysVisible?: boolean;
  /** Catalog-picker cell: the editor chrome reveals only while a picker menu
   *  is open inside the cell — a committed pick collapses to the value text
   *  (plus any actions) even though the input keeps focus (card 101026163000). */
  picker?: boolean;
  /** Committed-pick DOM collapse (card 171026113500, FB-006 round 17). Opt-in
   *  refinement of `picker`: once this cell holds a value, its editor leaves
   *  the visible DOM — and the accessibility tree, with it — instead of merely
   *  fading to `opacity: 0` behind the value band. The fade was decided by a
   *  descendant's `aria-expanded`, so any state that kept a picker menu open
   *  (or simply kept focus inside the cell) put the full combobox and its
   *  "Xoá" button back on screen over the picked name — for screen readers and
   *  DOM-level checks they were there the whole time. Activating the cell
   *  brings its editor back for a re-pick; a committed pick, or focus leaving
   *  the cell, collapses it again. The value band and `actions` (the factory
   *  detail magnifier) were never part of the editor and stay visible. */
  collapsePickedEditor?: boolean;
  /** Grouped mobile chrome (mobile UX consult 16/10): renders the visible
   *  field label — with the required asterisk as its own colored mark — above
   *  the control, and a trailing chevron on picker value bands so every
   *  control reads tappable on the stacked phone record. Presentational only:
   *  the accessible name still comes from the real control, the `data-label`
   *  attribute keeps the full label string (QA1-007 asterisk contract), and
   *  hosts without the flag render exactly as before. */
  mobileFieldChrome?: boolean;
  onRevert?: (value: string) => void;
}

/**
 * Value-first table cell for the repeatable FCL editor.
 *
 * The real accessible control stays mounted for native tab order and form
 * semantics. Its visual chrome is revealed only while the cell owns focus.
 *
 * `collapsePickedEditor` cells (card 171026113500) go one step further: once a
 * value is committed their editor is not part of the visible DOM at all until
 * the cell is activated again, so the picked value — plus the cell's `actions`
 * — is the whole cell.
 */
export function ShipmentContainerCell({
  label,
  value,
  placeholder,
  displayTitle,
  subValue,
  actions,
  children,
  fieldId,
  error,
  className,
  onRevert,
  alwaysVisible,
  picker,
  collapsePickedEditor,
  mobileFieldChrome,
}: ShipmentContainerCellProps) {
  const cellRef = useRef<HTMLTableCellElement>(null);
  const valueAtFocus = useRef(value);
  // A committed pick ends the cell's edit session: the editor goes back out of
  // the visible DOM (card 171026113500). `value` is the committed display
  // text, so an external update (draft load, catalog rename) collapses too.
  const [editorEditing, setEditorEditing] = useState(false);
  const committedValue = useRef(value);
  // The visible mobile label re-colors the required mark, so the trailing
  // " *" is split out of the rendered text; `data-label` below keeps the
  // full string byte-for-byte (asterisk-contract QA1-007).
  const requiredMark = label.endsWith(' *');
  const labelText = requiredMark ? label.slice(0, -2) : label;
  const picked = Boolean(collapsePickedEditor && value);

  useEffect(() => {
    if (committedValue.current === value) return;
    committedValue.current = value;
    setEditorEditing(false);
  }, [value]);

  // Activating a collapsed cell must bring the editor back BEFORE focusing it:
  // a `visibility: hidden` control cannot take focus, and the click below is
  // what opens the picker menu (the shipped cell-click reveal).
  useEffect(() => {
    if (!editorEditing) return;
    const control = cellRef.current?.querySelector<HTMLElement>(CELL_CONTROL_SELECTOR);
    if (!control || control.matches(':disabled, [aria-disabled="true"]')) return;
    control.focus();
    control.click();
  }, [editorEditing]);

  const activateCell = (event: MouseEvent<HTMLTableCellElement>) => {
    const target = event.target as Element;
    // Portaled overlays (a picker's option list, an inline create dialog) keep
    // this cell in their React ancestry, so their clicks DO bubble here even
    // though their DOM lives outside the cell. Re-activating the cell on such
    // a click re-opened the menu the pick had just closed, pinning the full
    // combobox + "Xoá" chrome over the value the operator had just chosen
    // (card 171026113500, FB-006 round 17). Only clicks inside the cell edit.
    if (!event.currentTarget.contains(target)) return;
    const control = cellRef.current?.querySelector<HTMLElement>(CELL_CONTROL_SELECTOR);
    if (!control || control.matches(':disabled, [aria-disabled="true"]')) return;
    // In-cell controls (the factory detail magnifier, the clear button) keep
    // their own job — the cell only stands in for an empty part of itself.
    if (target.closest(CELL_CONTROL_SELECTOR)) return;
    if (picked && !editorEditing) {
      setEditorEditing(true);
      return;
    }
    control.focus();
    control.click();
  };

  const releaseCell = (event: FocusEvent<HTMLTableCellElement>) => {
    if (!collapsePickedEditor || !picked) return;
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setEditorEditing(false);
  };

  const captureStartingValue = (event: FocusEvent<HTMLTableCellElement>) => {
    // React portals keep the cell in their event ancestry, but the picker
    // owns its own input/focus session outside this cell's DOM subtree.
    if (!event.currentTarget.contains(event.target as Node)) return;
    const previousTarget = event.relatedTarget as Node | null;
    if (!previousTarget || !event.currentTarget.contains(previousTarget)) {
      valueAtFocus.current = value;
    }
  };

  const handleCellKeyDown = (event: KeyboardEvent<HTMLTableCellElement>) => {
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target)) return;
    // Split controls own their partial draft, Escape and picker shortcuts.
    if (target.closest('[data-split-datetime]')) return;
    if (!target.matches('input:not([role="combobox"]), textarea')) return;

    if (event.key === 'Enter' && !event.altKey) {
      // Multiline note cells: bare Enter inserts a newline natively; only
      // Ctrl/Cmd+Enter commits the cell.
      if (target.tagName === 'TEXTAREA' && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      target.blur();
      return;
    }

    if (event.key !== 'Escape' || !onRevert) return;

    event.preventDefault();
    event.stopPropagation();
    onRevert(valueAtFocus.current);
    target.blur();
  };

  return (
    <td
      ref={cellRef}
      data-label={label}
      data-field-id={fieldId}
      className={`csc-container-cell${alwaysVisible ? ' csc-container-cell--persistent' : ''}${picker ? ' csc-container-cell--picker' : ''}${picked ? ' csc-container-cell--picked' : ''}${editorEditing ? ' csc-container-cell--editing' : ''}${error ? ' csc-container-cell--error' : ''}${className ? ` ${className}` : ''}`}
      onClick={activateCell}
      onFocusCapture={captureStartingValue}
      onBlurCapture={releaseCell}
      onKeyDownCapture={handleCellKeyDown}
    >
      {mobileFieldChrome && (
        <span className="csc-container-cell__label" aria-hidden="true">
          {labelText}
          {requiredMark && <span className="csc-container-cell__label-req">*</span>}
        </span>
      )}
      <div className="csc-container-cell__value">
        <span
          className={`csc-container-cell__display${value ? '' : ' csc-container-cell__display--empty'}`}
          aria-hidden="true"
          title={(displayTitle ?? value) || undefined}
        >
          {value || placeholder}
          {mobileFieldChrome && picker && (
            <ChevronDown size={14} className="csc-container-cell__chevron" aria-hidden="true" />
          )}
        </span>
        <div className="csc-container-cell__editor">{children}</div>
      </div>
      {subValue && <span className="csc-container-cell__subvalue">{subValue}</span>}
      {actions && <span className="csc-container-cell__actions">{actions}</span>}
      {error && <span className="csc-container-cell__error">{error}</span>}
    </td>
  );
}
