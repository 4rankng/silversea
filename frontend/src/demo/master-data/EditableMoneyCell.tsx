/**
 * Editable VND cell for the Rate Engine matrices (SIL-161). Displays the
 * house-formatted amount; click (or Enter) swaps to a numeric input, Enter /
 * blur commits, Esc reverts. The parent owns persistence — this cell only
 * parses and reports. Keyboard access stays on the display button.
 */
import { useEffect, useRef, useState } from 'react';
import { formatCurrency } from '@/lib/format';
import { cx } from '@/utils/cx';

/** "1.250.000đ" → 1250000; anything non-numeric → null. */
export function parseVndInput(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits === '') return null;
  return Number.parseInt(digits, 10);
}

interface EditableMoneyCellProps {
  value: number;
  /** Commit a validated new value (whole VND ≥ 0). */
  onCommit: (next: number) => void;
  /** Accessible name, e.g. "Cát Lái — 20′ · Xuất · Nâng". */
  label: string;
  testId: string;
}

export function EditableMoneyCell({ value, onCommit, label, testId }: EditableMoneyCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEditing = () => {
    if (editing) return;
    setDraft(String(value));
    setEditing(true);
  };

  const cancel = () => setEditing(false);

  const commit = () => {
    const parsed = parseVndInput(draft);
    if (parsed !== null && parsed !== value) onCommit(parsed);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        data-testid={testId}
        aria-label={`${label} — đang sửa`}
        inputMode="numeric"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') cancel();
        }}
        className={cx(
          'w-full rounded-md border border-brand bg-primary px-1.5 py-1 text-right text-sm font-semibold tabular-nums text-primary',
          'outline-hidden focus:outline-2 focus:outline-offset-1 focus:outline-brand',
        )}
      />
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={`${label} — nhấp để sửa`}
      title="Nhấp để sửa"
      onClick={startEditing}
      onFocus={startEditing}
      className={cx(
        'w-full cursor-text rounded-md px-1.5 py-1 text-right text-sm font-semibold tabular-nums text-primary',
        'transition-colors hover:bg-brand-50 focus-visible:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
      )}
    >
      {formatCurrency(value)}
    </button>
  );
}
