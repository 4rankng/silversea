import {
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

const CELL_CONTROL_SELECTOR = 'input, button, select, textarea, [role="combobox"]';

interface ShipmentContainerCellProps {
  label: string;
  value: string;
  placeholder: string;
  children: ReactNode;
  fieldId?: string;
  error?: string;
  className?: string;
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
  children,
  fieldId,
  error,
  className,
  onRevert,
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
    const previousTarget = event.relatedTarget as Node | null;
    if (!previousTarget || !event.currentTarget.contains(previousTarget)) {
      valueAtFocus.current = value;
    }
  };

  const handleCellKeyDown = (event: KeyboardEvent<HTMLTableCellElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches('input:not([role="combobox"]), textarea')) return;

    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
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
      className={`csc-container-cell${error ? ' csc-container-cell--error' : ''}${className ? ` ${className}` : ''}`}
      onClick={activateCell}
      onFocusCapture={captureStartingValue}
      onKeyDownCapture={handleCellKeyDown}
    >
      <div className="csc-container-cell__value">
        <span
          className={`csc-container-cell__display${value ? '' : ' csc-container-cell__display--empty'}`}
          aria-hidden="true"
        >
          {value || placeholder}
        </span>
        <div className="csc-container-cell__editor">{children}</div>
      </div>
      {error && <span className="csc-container-cell__error">{error}</span>}
    </td>
  );
}
