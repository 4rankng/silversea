import { ChevronDown } from 'lucide-react';
import {
  useRef,
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
  mobileFieldChrome,
}: ShipmentContainerCellProps) {
  const cellRef = useRef<HTMLTableCellElement>(null);
  const valueAtFocus = useRef(value);
  // The visible mobile label re-colors the required mark, so the trailing
  // " *" is split out of the rendered text; `data-label` below keeps the
  // full string byte-for-byte (asterisk-contract QA1-007).
  const requiredMark = label.endsWith(' *');
  const labelText = requiredMark ? label.slice(0, -2) : label;

  const activateCell = (event: MouseEvent<HTMLTableCellElement>) => {
    const target = event.target as Element;
    if (target.closest(CELL_CONTROL_SELECTOR)) return;

    const control = cellRef.current?.querySelector<HTMLElement>(CELL_CONTROL_SELECTOR);
    if (!control || control.matches(':disabled, [aria-disabled="true"]')) return;
    control.focus();
    control.click();
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
      className={`csc-container-cell${alwaysVisible ? ' csc-container-cell--persistent' : ''}${picker ? ' csc-container-cell--picker' : ''}${error ? ' csc-container-cell--error' : ''}${className ? ` ${className}` : ''}`}
      onClick={activateCell}
      onFocusCapture={captureStartingValue}
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
