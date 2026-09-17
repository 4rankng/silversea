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
  children: ReactNode;
  fieldId?: string;
  error?: string;
  className?: string;
  alwaysVisible?: boolean;
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
  children,
  fieldId,
  error,
  className,
  onRevert,
  alwaysVisible,
}: ShipmentContainerCellProps) {
  const cellRef = useRef<HTMLTableCellElement>(null);
  const valueAtFocus = useRef(value);

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
      className={`csc-container-cell${alwaysVisible ? ' csc-container-cell--persistent' : ''}${error ? ' csc-container-cell--error' : ''}${className ? ` ${className}` : ''}`}
      onClick={activateCell}
      onFocusCapture={captureStartingValue}
      onKeyDownCapture={handleCellKeyDown}
    >
      <div className="csc-container-cell__value">
        <span
          className={`csc-container-cell__display${value ? '' : ' csc-container-cell__display--empty'}`}
          aria-hidden="true"
          title={(displayTitle ?? value) || undefined}
        >
          {value || placeholder}
        </span>
        <div className="csc-container-cell__editor">{children}</div>
      </div>
      {subValue && <span className="csc-container-cell__subvalue">{subValue}</span>}
      {error && <span className="csc-container-cell__error">{error}</span>}
    </td>
  );
}
