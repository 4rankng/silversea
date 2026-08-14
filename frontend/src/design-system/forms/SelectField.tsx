import React, { useId, useState, useRef, type KeyboardEvent } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useClickOutside } from '../../hooks/useClickOutside';
import './TextField.css';
import './SelectField.css';

/**
 * Flatten React children (string | number | element | fragment | nested arrays)
 * into a single display string — mirroring how a native `<option>` renders its
 * text content. Using `String(children)` directly would comma-join an array of
 * nodes (e.g. `{code} — {name}` becomes `"20OT, — ,20'OT"`), so we recurse and
 * concatenate text leaves only.
 */
function childrenToText(children: React.ReactNode): string {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join('');
  if (React.isValidElement(children)) {
    return childrenToText((children.props as { children?: React.ReactNode }).children);
  }
  return '';
}

export interface SelectFieldProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  label: string;
  required?: boolean;
  error?: string;
  helpText?: string;
  /** Shown in the trigger when no option is selected. Defaults to "— Chọn —". */
  placeholder?: string;
  children: React.ReactNode;
  className?: string;
}

export function SelectField({
  label,
  required,
  error,
  helpText,
  children,
  className,
  value,
  onChange,
  disabled,
  placeholder,
  ...select
}: SelectFieldProps) {
  const generatedId = useId();
  const id = select.id ?? generatedId;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [select['aria-describedby'], errorId].filter(Boolean).join(' ') || undefined;
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close dropdown when clicking outside
  useClickOutside(containerRef, () => setIsOpen(false), { escapeKey: true, enabled: isOpen });

  // Parse standard option children to populate dropdown items
  const optionsList: { value: string; label: string }[] = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === 'option') {
      const optionProps = child.props as { value?: unknown; children?: React.ReactNode };
      const val = String(optionProps.value ?? '');
      const lbl = childrenToText(optionProps.children);
      optionsList.push({ value: val, label: lbl });
    }
  });

  const selectedValue = value !== undefined ? String(value) : '';
  const selectedOption = optionsList.find(opt => opt.value === selectedValue) || optionsList[0];
  const displayLabel = selectedOption ? selectedOption.label : (placeholder ?? '— Chọn —');
  const selectedIndex = optionsList.findIndex((option) => option.value === selectedValue);
  const activeOption = optionsList[activeIndex];

  const close = (restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  };

  const open = (nextActiveIndex = selectedIndex >= 0 ? selectedIndex : 0) => {
    if (disabled) return;
    setActiveIndex(Math.max(0, Math.min(nextActiveIndex, optionsList.length - 1)));
    setIsOpen(true);
  };

  const handleSelect = (val: string) => {
    if (disabled) return;
    if (onChange) {
      // Create a simulated HTMLChangeEvent to seamlessly integrate with existing state handlers
      const simulatedEvent = {
        target: {
          value: val,
          name: select.name,
        }
      } as React.ChangeEvent<HTMLSelectElement>;
      onChange(simulatedEvent);
    }
    close(true);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || optionsList.length === 0) return;

    const currentIndex = isOpen
      ? activeIndex
      : (selectedIndex >= 0 ? selectedIndex : 0);

    if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault();
        close(true);
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen) {
        if (activeOption) handleSelect(activeOption.value);
      } else {
        open(currentIndex);
      }
      return;
    }

    let nextIndex: number | undefined;
    if (event.key === 'ArrowDown') nextIndex = Math.min(currentIndex + 1, optionsList.length - 1);
    if (event.key === 'ArrowUp') nextIndex = Math.max(currentIndex - 1, 0);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = optionsList.length - 1;

    if (nextIndex !== undefined) {
      event.preventDefault();
      open(nextIndex);
    }
  };

  const cls = ['ds-field', error ? 'ds-field--error' : '', className].filter(Boolean).join(' ');

  return (
    <div className={cls} ref={containerRef} style={{ position: 'relative' }}>
      <label htmlFor={id} className="ds-field__label">
        {label}
        {required && <span className="ds-field__required" aria-hidden="true"> *</span>}
      </label>

      {/* Custom Select Trigger */}
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => isOpen ? close() : open()}
        onKeyDown={handleTriggerKeyDown}
        className={`ds-select-trigger ${isOpen ? 'ds-select-trigger--open' : ''}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={isOpen && activeOption ? `${id}-option-${activeOption.value}` : undefined}
        aria-invalid={select['aria-invalid'] ?? Boolean(error)}
        aria-describedby={describedBy}
      >
        <span className="ds-select-trigger__value">{displayLabel}</span>
        <ChevronDown size={16} className={`ds-select-trigger__icon ${isOpen ? 'ds-select-trigger__icon--rotated' : ''}`} />
      </button>

      {/* Hidden native select to keep compatibility with standard form submit / accessibility */}
      <select
        value={selectedValue}
        onChange={onChange}
        disabled={disabled}
        style={{ display: 'none' }}
        {...select}
        id={`${id}-native`}
      >
        {children}
      </select>

      {/* Custom Dropdown Popover */}
      {isOpen && (
        <ul id={`${id}-listbox`} className="ds-select-popover" role="listbox" aria-labelledby={id}>
          {optionsList.map((opt) => {
            const isSelected = opt.value === selectedValue;
            const isActive = optionsList.indexOf(opt) === activeIndex;
            return (
              <li
                id={`${id}-option-${opt.value}`}
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(opt.value)}
                className={`ds-select-item ${isSelected ? 'ds-select-item--selected' : ''} ${isActive ? 'ds-select-item--active' : ''}`}
              >
                <span className="ds-select-item__check">
                  {isSelected && <Check size={14} />}
                </span>
                <span className="ds-select-item__label">{opt.label}</span>
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <span id={errorId} className="ds-field__msg ds-field__msg--error">{error}</span>
      ) : helpText ? (
        <span className="ds-field__msg">{helpText}</span>
      ) : null}
    </div>
  );
}
