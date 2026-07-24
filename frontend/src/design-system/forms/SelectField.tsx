import React, { useId, useState, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useClickOutside } from '../../hooks/useClickOutside';
import './TextField.css';
import './SelectField.css';

export interface SelectFieldProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> {
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
  const id = useId();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useClickOutside(containerRef, () => setIsOpen(false), { escapeKey: true, enabled: isOpen });

  // Parse standard option children to populate dropdown items
  const optionsList: { value: string; label: string }[] = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === 'option') {
      const optionProps = child.props as { value?: unknown; children?: React.ReactNode };
      const val = String(optionProps.value ?? '');
      const lbl = String(optionProps.children ?? '');
      optionsList.push({ value: val, label: lbl });
    }
  });

  const selectedValue = value !== undefined ? String(value) : '';
  const selectedOption = optionsList.find(opt => opt.value === selectedValue) || optionsList[0];
  const displayLabel = selectedOption ? selectedOption.label : (placeholder ?? '— Chọn —');

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
    setIsOpen(false);
  };

  const cls = ['ds-field', error ? 'ds-field--error' : '', className].filter(Boolean).join(' ');

  return (
    <div className={cls} ref={containerRef} style={{ position: 'relative' }}>
      <label className="ds-field__label">
        {label}
        {required && <span className="ds-field__required" aria-hidden="true"> *</span>}
      </label>

      {/* Custom Select Trigger */}
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`ds-select-trigger ${isOpen ? 'ds-select-trigger--open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
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
      >
        {children}
      </select>

      {/* Custom Dropdown Popover */}
      {isOpen && (
        <ul className="ds-select-popover" role="listbox">
          {optionsList.map((opt) => {
            const isSelected = opt.value === selectedValue;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(opt.value)}
                className={`ds-select-item ${isSelected ? 'ds-select-item--selected' : ''}`}
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
        <span className="ds-field__msg ds-field__msg--error">{error}</span>
      ) : helpText ? (
        <span className="ds-field__msg">{helpText}</span>
      ) : null}
    </div>
  );
}
