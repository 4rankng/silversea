import React from 'react';
import './InputWithPrefix.css';
import { formatMoneyInput, normalizeMoneyInput } from '../../lib/moneyInput';

interface InputWithPrefixProps {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix: string;
  mono?: boolean;
  style?: React.CSSProperties;
  /** Pass type="money" to enable live VND formatting (e.g. 10.000.000). Raw numeric string is stored. */
  type?: string;
}

function cursorPosFromDigitsRight(formatted: string, digitsFromRight: number): number {
  if (digitsFromRight === 0) return formatted.length;
  let count = 0;
  for (let i = formatted.length - 1; i >= 0; i--) {
    if (/\d/.test(formatted[i])) {
      count++;
      if (count === digitsFromRight) return i;
    }
  }
  return 0;
}

export function InputWithPrefix({ id, value, onChange, placeholder, prefix, mono, style, type }: InputWithPrefixProps) {
  const isMoney = type === 'money';
  const inputRef = React.useRef<HTMLInputElement>(null);
  const digitsRightRef = React.useRef<number | null>(null);

  const displayValue = isMoney ? formatMoneyInput(value) : value;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (isMoney) {
      const el = e.target;
      const cursorPos = el.selectionEnd ?? el.value.length;
      const afterCursor = el.value.slice(cursorPos);
      digitsRightRef.current = (afterCursor.match(/\d/g) ?? []).length;
      onChange(normalizeMoneyInput(el.value));
    } else {
      onChange(e.target.value);
    }
  }

  React.useLayoutEffect(() => {
    if (!isMoney) return;
    const input = inputRef.current;
    if (!input || document.activeElement !== input) return;
    if (digitsRightRef.current === null) return;

    const pos = cursorPosFromDigitsRight(input.value, digitsRightRef.current);
    input.setSelectionRange(pos, pos);
    digitsRightRef.current = null;
  });

  return (
    <div className="tc-input-prefix" style={style}>
      <input
        id={id}
        name={id}
        ref={isMoney ? inputRef : undefined}
        className={`input${mono ? ' mono' : ''}`}
        type={isMoney ? 'text' : (type ?? 'text')}
        inputMode={isMoney ? 'numeric' : undefined}
        value={displayValue}
        placeholder={placeholder}
        onChange={handleChange}
      />
      <span className="tc-prefix-label">{prefix}</span>
    </div>
  );
}
