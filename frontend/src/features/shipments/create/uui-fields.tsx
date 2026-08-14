import type { ReactNode } from 'react';
import { Input as UUIInput } from '../../../components/untitled-ui/base/input/input';
import { ComboBox } from '../../../components/untitled-ui/base/select/combobox';
import { NativeSelect } from '../../../components/untitled-ui/base/select/select-native';
import { SelectItem } from '../../../components/untitled-ui/base/select/select-item';
import { TextArea as UUITextArea } from '../../../components/untitled-ui/base/textarea/textarea';

/**
 * Feature-local Untitled UI field adapters for the shipment-create workspace.
 *
 * They mirror the props of the legacy design-system fields (event-based
 * `onChange`, `error`, `hint`) so the workspace JSX can swap primitives
 * without touching its state handlers, and keep the `getByLabelText` /
 * `data-field-id` contracts used by tests and focus management.
 */

type HtmlInputEvent = { target: { value: string } };

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
}: UTextFieldProps) {
  return (
    <UUIInput
      label={label}
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
      className="csc-uui-field"
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
  /** Allow free-typed values that don't match any option (e.g. Hãng tàu). */
  allowsCustomValue?: boolean;
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
  allowsCustomValue,
}: USearchableFieldProps) {
  const selected = options.find((option) => option.value === value);
  return (
    <div className={`csc-searchable-field${error ? ' csc-searchable-field--error' : ''}`}>
      <ComboBox
        aria-label={label}
        label={label}
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
        className="csc-uui-field"
      >
        {(item: { id: string | number; label?: string; supportingText?: string }) => (
          <SelectItem
            id={item.id}
            data-value={String(item.id)}
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
}

export function USelectField({
  label,
  value,
  onChange,
  options,
  disabled,
  required,
  error,
  hint,
}: USelectFieldProps) {
  return (
    <div className={`csc-select-field${error ? ' csc-select-field--error' : ''}`}>
      <NativeSelect
        aria-label={label}
        label={label}
        value={value}
        onChange={(event) => onChange(event)}
        options={options}
        disabled={disabled}
        required={required}
        aria-invalid={Boolean(error) || undefined}
      />
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
      label={label}
      value={value}
      onChange={(next) => onChange(asEvent(next))}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      isDisabled={disabled}
      className="csc-uui-field"
    />
  );
}
