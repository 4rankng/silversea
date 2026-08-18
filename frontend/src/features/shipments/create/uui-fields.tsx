import type { ReactNode } from 'react';
import { Input as UUIInput } from '../../../components/untitled-ui/base/input/input';
import { ComboBox } from '../../../components/untitled-ui/base/select/combobox';
import { Select as UUISelect } from '../../../components/untitled-ui/base/select/select';
import { SelectItem } from '../../../components/untitled-ui/base/select/select-item';
import { TextArea as UUITextArea } from '../../../components/untitled-ui/base/textarea/textarea';
import { BufferedUuiDateInput } from '../../../design-system/forms/BufferedUuiDateInput';

/**
 * Feature-local Untitled UI field adapters for the shipment-create workspace.
 *
 * They mirror the props of the legacy design-system fields (event-based
 * `onChange`, `error`, `hint`) so the workspace JSX can swap primitives
 * without touching its state handlers, and keep the `getByLabelText` /
 * `data-field-id` contracts used by tests and focus management.
 */

type HtmlInputEvent = { target: { value: string } };

const EMPTY_SELECT_KEY = '__EMPTY_SELECT_VALUE__';

function asEvent(value: string): HtmlInputEvent {
  return { target: { value } };
}

interface UTextFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (event: HtmlInputEvent) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  maxLength?: number;
  min?: string | number;
  step?: string | number;
  hideLabel?: boolean;
}

interface UDateFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (event: HtmlInputEvent) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  min?: string | number;
  hideLabel?: boolean;
}

/**
 * Untitled UI styled date input that buffers partial day/month/year typing
 * so digits never flash and disappear (see design-system/DateField for the
 * full rationale). Event-shaped onChange mirrors UTextField so workspace
 * state handlers do not need to change.
 */
export function UDateField({
  id,
  label,
  value,
  onChange,
  disabled,
  required,
  error,
  min,
  hideLabel,
}: UDateFieldProps) {
  return (
    <BufferedUuiDateInput
      id={id}
      label={hideLabel ? undefined : label}
      aria-label={hideLabel ? label : undefined}
      size="sm"
      value={value}
      onChange={(next) => onChange(asEvent(next))}
      isDisabled={disabled}
      isRequired={required}
      isInvalid={Boolean(error)}
      hint={error}
      inputProps={{ min }}
      className="csc-uui-field csc-control-boundary"
    />
  );
}

export function UTextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
  required,
  error,
  hint,
  maxLength,
  min,
  step,
  hideLabel,
}: UTextFieldProps) {
  return (
    <UUIInput
      size="sm"
      label={hideLabel ? undefined : label}
      aria-label={hideLabel ? label : undefined}
      value={value}
      onChange={(next) => onChange(asEvent(next))}
      type={type}
      placeholder={placeholder}
      isDisabled={disabled}
      isRequired={required}
      isInvalid={Boolean(error)}
      hint={error ?? hint}
      hideRequiredIndicator={!required}
      inputProps={{ maxLength, min, step }}
      className="csc-uui-field csc-control-boundary"
    />
  );
}

interface USearchableFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; searchText?: string }>;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  className?: string;
  popoverClassName?: string;
  optionClassName?: string;
  shortcut?: boolean;
  /** Allow free-typed values that don't match any option (e.g. Hãng tàu). */
  allowsCustomValue?: boolean;
  hideLabel?: boolean;
}

export function USearchableField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  required,
  hint,
  error,
  className,
  popoverClassName,
  optionClassName,
  shortcut,
  allowsCustomValue,
  hideLabel,
}: USearchableFieldProps) {
  const selected = options.find((option) => option.value === value);
  return (
    <div className={`csc-searchable-field${error ? ' csc-searchable-field--error' : ''}${className ? ` ${className}` : ''}`}>
      <ComboBox
        size="sm"
        aria-label={label}
        label={hideLabel ? undefined : label}
        menuTrigger="manual"
        openOnPress
        selectedKey={value || null}
        inputValue={selected?.label ?? (allowsCustomValue ? value : undefined)}
        onSelectionChange={(key) => { if (key !== null) onChange(String(key)); }}
        {...(allowsCustomValue
          ? { allowsCustomValue: true, onInputChange: (text: string) => onChange(text) }
          : {})}
        items={options.map((option) => ({
          id: option.value,
          label: option.label,
          ...(option.searchText ? { supportingText: option.searchText } : {}),
        }))}
        placeholder={placeholder}
        isDisabled={disabled}
        isRequired={required}
        isInvalid={Boolean(error)}
        hint={typeof (error ?? hint) === 'string' ? (error ?? hint) as string : undefined}
        hideRequiredIndicator={!required}
        shortcut={shortcut}
        popoverClassName={popoverClassName}
        className="csc-uui-field csc-control-boundary"
      >
        {(item: { id: string | number; label?: string; supportingText?: string }) => (
          <SelectItem
            id={item.id}
            data-value={String(item.id)}
            className={optionClassName}
            label={item.label}
            supportingText={item.supportingText}
          />
        )}
      </ComboBox>
    </div>
  );
}

interface USelectFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (event: HtmlInputEvent) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  hideLabel?: boolean;
}

export function USelectField({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
  required,
  error,
  hint,
  hideLabel,
}: USelectFieldProps) {
  return (
    <div className={`csc-select-field csc-control-boundary${error ? ' csc-select-field--error' : ''}`}>
      <UUISelect
        id={id}
        size="sm"
        aria-label={hideLabel ? label : undefined}
        label={hideLabel ? undefined : label}
        selectedKey={value || EMPTY_SELECT_KEY}
        onSelectionChange={(key) => onChange(asEvent(key === EMPTY_SELECT_KEY ? '' : String(key)))}
        items={options.map((option) => ({ id: option.value || EMPTY_SELECT_KEY, label: option.label }))}
        isDisabled={disabled}
        isRequired={required}
        isInvalid={Boolean(error)}
        hideRequiredIndicator={!required}
        popoverClassName="csc-select-popover"
        className="csc-uui-field"
      >
        {(item) => <UUISelect.Item id={item.id} label={item.label} selectionIndicatorAlign="left" />}
      </UUISelect>
      {error
        ? <span className="csc-field-error">{error}</span>
        : hint && <span className="csc-field-hint">{hint}</span>}
    </div>
  );
}

interface UTextAreaFieldProps {
  label: string;
  value: string;
  onChange: (event: HtmlInputEvent) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
}

export function UTextAreaField({
  label,
  value,
  onChange,
  rows,
  maxLength,
  placeholder,
  disabled,
}: UTextAreaFieldProps) {
  return (
    <UUITextArea
      size="sm"
      label={label}
      value={value}
      onChange={(next) => onChange(asEvent(next))}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      isDisabled={disabled}
      className="csc-uui-field csc-control-boundary"
    />
  );
}
