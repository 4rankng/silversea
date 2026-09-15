import { useRef } from 'react';
import { Calendar } from 'lucide-react';

interface NativePickerButtonProps {
  /** Native input type to surface: 'datetime-local' or 'date'. */
  kind: 'datetime-local' | 'date';
  /** Accessible name for the button. */
  label: string;
  isDisabled?: boolean;
  /** Receives the raw native value: 'YYYY-MM-DDTHH:mm' or 'YYYY-MM-DD'. */
  onPick: (value: string) => void;
}

/**
 * Calendar affordance for the 24h buffered text inputs.
 *
 * The buffered inputs render plain text fields because a visible native
 * datetime-local cannot guarantee the `HH:mm DD/MM/YYYY` display contract.
 * This button restores picker-based entry beside the text field: a hidden
 * native input opens via showPicker (click fallback for older engines) and
 * its value — already in the hooks' canonical contracts — flows through
 * onPick, so selection behaves exactly like a complete typed entry.
 */
export function NativePickerButton({ kind, label, isDisabled, onPick }: NativePickerButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const open = () => {
    const input = inputRef.current;
    if (!input) return;
    const picker = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof picker.showPicker === 'function') {
      try {
        picker.showPicker();
        return;
      } catch {
        // InvalidStateError when the field is not renderable — fall through.
      }
    }
    input.click();
  };

  return (
    <>
      <button
        type="button"
        aria-label={label}
        disabled={isDisabled}
        onClick={open}
        className="mt-px grid h-[34px] w-[34px] shrink-0 place-items-center rounded-md border border-[color:var(--line,#d1d5db)] bg-[color:var(--surface,#fff)] text-tertiary transition-colors hover:text-[color:var(--ink,#1f2937)] disabled:opacity-40"
      >
        <Calendar size={16} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        type={kind}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only absolute h-0 w-0"
        onChange={(event) => {
          if (event.target.value) onPick(event.target.value);
        }}
      />
    </>
  );
}

NativePickerButton.displayName = 'NativePickerButton';
