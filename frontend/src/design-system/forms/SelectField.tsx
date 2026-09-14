import React, { type ReactNode } from 'react';
import { UuiSelectField } from './UuiSelectField';

/**
 * Children-API select field, now delegating to the shared Untitled UI select
 * adapter. The historic homegrown popover (absolutely-positioned list inside a
 * `position: relative` container — clipped by overflow ancestors, with a
 * display:none native select fallback) is retired; call sites keep their
 * `<option>` children shape while the UUI/React Aria popover renders the menu.
 */
export interface SelectFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  helpText?: string;
  /** Shown in the trigger when no option is selected. Defaults to the first option's label. */
  placeholder?: string;
  children: ReactNode;
  className?: string;
  id?: string;
  name?: string;
  value?: string | number | readonly string[];
  onChange?: (event: { target: { value: string; name?: string } }) => void;
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function SelectField({
  label,
  required,
  error,
  helpText,
  placeholder,
  children,
  id,
  name,
  value,
  onChange,
  disabled,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: SelectFieldProps) {
  const options: Array<{ value: string; label: string; disabled?: boolean }> = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === 'option') {
      const { value: optionValue, children: optionChildren, disabled: optionDisabled } = child.props as {
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
      };
      const optionLabel = childrenToText(optionChildren);
      const optionText = String(optionValue ?? '');
      // A first option with empty value is the historic "— Chọn —" placeholder
      // entry; keep it as a real selectable empty option (UUI has no separate
      // placeholder slot when selectedKey maps over the option set).
      options.push({ value: optionText, label: optionLabel, disabled: optionDisabled });
    }
  });

  return (
    <UuiSelectField
      id={id}
      label={label}
      value={value === undefined || value === null ? '' : String(value)}
      onChange={(event) => {
        if (onChange) {
          onChange({ target: { value: event.target.value, name } });
        }
      }}
      options={options}
      disabled={disabled}
      required={required}
      error={error}
      hint={helpText}
      placeholder={placeholder}
      wrapperClassName={className}
      ariaDescribedBy={ariaDescribedBy}
      invalid={ariaInvalid}
    />
  );
}

function childrenToText(children: ReactNode): string {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join('');
  if (React.isValidElement(children)) {
    return childrenToText((children.props as { children?: ReactNode }).children);
  }
  return '';
}
