import { Checkbox } from './untitled-ui/base/checkbox/checkbox';
import { hideableColumns, type LedgerColumn } from '../lib/column-visibility';

/**
 * The picker's list and its reset, shared by both of the picker's homes (the bar
 * trigger's popover and the `Bộ lọc` dialog block). One markup source, so the
 * two placements cannot drift apart — the card's rule read as code.
 *
 * Rows are the vendored Untitled UI checkbox (`base/checkbox/checkbox.tsx`,
 * listed in `installed.json`): a react-aria checkbox with an accessible label,
 * not a new primitive invented for this control.
 */

export interface ColumnPickerPanelProps {
  columns: readonly LedgerColumn[];
  hidden: readonly string[];
  customized: boolean;
  onToggle: (key: string) => void;
  onReset: () => void;
}

export function ColumnPickerPanel({ columns, hidden, customized, onToggle, onReset }: ColumnPickerPanelProps) {
  const options = hideableColumns(columns);
  if (options.length === 0) return null;

  return (
    <div className="column-picker__body">
      <div className="column-picker__options" role="group" aria-label="Cột hiển thị">
        {options.map((column) => (
          <Checkbox
            key={column.key}
            size="sm"
            className="column-picker__option"
            label={<span className="column-picker__option-label">{column.label}</span>}
            isSelected={!hidden.includes(column.key)}
            onChange={() => onToggle(column.key)}
          />
        ))}
      </div>
      <button
        type="button"
        className="column-picker__reset"
        onClick={onReset}
        disabled={!customized}
      >
        Mặc định
      </button>
    </div>
  );
}
