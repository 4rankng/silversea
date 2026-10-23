import { Check } from 'lucide-react';
import type { MouseEventHandler } from 'react';

/**
 * Visible LCL lot-select checkbox.
 *
 * Replaces the Untitled-UI `Checkbox` in the dispatch grids: that component
 * paints itself with `bg-primary` / `ring-primary` utility classes that this
 * app's stylesheet never defines, so it rendered as an invisible 16px div —
 * the checkbox column existed in the DOM but users (and QA) saw nothing
 * (card 181026145000, R23/R24 re-opens: "Bước 1 chọn đã ko thấy có").
 * This control is plain CSS on app tokens so it is always visible.
 */
interface LclSelectCheckboxProps {
  isSelected: boolean;
  isDisabled?: boolean;
  onToggle: (next: boolean) => void;
  ariaLabel: string;
  title?: string;
}

export function LclSelectCheckbox({ isSelected, isDisabled, onToggle, ariaLabel, title }: LclSelectCheckboxProps) {
  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    event.stopPropagation();
    onToggle(!isSelected);
  };
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      aria-label={ariaLabel}
      aria-disabled={isDisabled || undefined}
      title={title}
      disabled={isDisabled}
      className={`ops-lcl-check${isSelected ? ' ops-lcl-check--on' : ''}`}
      onClick={handleClick}
    >
      {isSelected && (
        <Check size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
      )}
    </button>
  );
}
