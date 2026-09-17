import type { ReactNode } from 'react';
import { useEffect, useState , useRef } from 'react';
import { Input as UUIInput } from '../../../components/untitled-ui/base/input/input';
import { ComboBox, filterComboboxItems } from '../../../components/untitled-ui/base/select/combobox';
import { SelectItem } from '../../../components/untitled-ui/base/select/select-item';
import { TextArea as UUITextArea } from '../../../components/untitled-ui/base/textarea/textarea';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
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
  /**
   * Soft warning rendered below the field (orange/warning tone) — separate
   * from `error` so the field stays valid while still warning the user (e.g.
   * "Số Bill đã được nhập bởi <user> lúc <hh:mm>"). The native `hint` slot
   * is reserved for `error`/info so we render the warning outside the input.
   */
  warning?: ReactNode;
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
  warning,
  maxLength,
  min,
  step,
  hideLabel,
}: UTextFieldProps) {
  return (
    <div className="csc-text-field-with-warning">
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
      {warning && !error && (
        <div
          className="csc-field-warning"
          role="status"
          aria-live="polite"
        >
          {warning}
        </div>
      )}
    </div>
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
  /**
   * Type-to-search mode. The field keeps the user's typed text in the input
   * and the ComboBox filters its dropdown as they type, but `value` is only
   * committed when the user actually picks an option — the form stays
   * constrained to existing IDs (e.g. customerId). Without this flag the
   * controlled `inputValue` resets on every keystroke, so the user cannot
   * type to filter.
   */
  searchable?: boolean;
  /**
   * Free-text passthrough for searchable mode (Lệnh chạy ngoài §4.2): every
   * keystroke also reports the raw text so the caller can decide — exact
   * option-label match selects the catalog id, anything else becomes the
   * ad-hoc raw value. Selection still commits through `onChange`.
   */
  onCustomValue?: (text: string) => void;
  hideLabel?: boolean;
  /**
   * Initial placement hint for the dropdown. Pass `"top"` for pickers whose
   * sibling action (e.g. the "+ Thêm" inline-create button) sits directly
   * below the trigger — the dropdown opens upward and never covers that
   * sibling. `shouldFlip` stays on, so the dropdown still falls back below
   * when the trigger is jammed against the viewport top.
   */
  popoverPlacement?: 'top' | 'bottom' | 'top start' | 'top end' | 'bottom start' | 'bottom end' | 'left' | 'right' | 'start' | 'end';
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
  searchable,
  onCustomValue,
  hideLabel,
  popoverPlacement,
}: USearchableFieldProps) {
  const selected = options.find((option) => option.value === value);
  // Local input text so type-to-search survives the controlled re-renders.
  // Synced with the selected option's label whenever `value` changes externally
  // (form reset, dialog-create success, etc.).
  const [inputValue, setInputValue] = useState<string>(selected?.label ?? '');
  // Re-sync the visible text only when the FORM value actually changes
  // (external reset, dialog apply). Catalog refetches rotate the `options`
  // identity and must NOT clobber in-flight typed text.
  const lastSyncedValue = useRef(value);
  useEffect(() => {
    if (lastSyncedValue.current === value) return;
    lastSyncedValue.current = value;
    // Custom (allowsCustomValue) values are not in the catalog, so `selected`
    // is undefined — keep the applied value in the input instead of blanking it.
    setInputValue(selected?.label ?? (allowsCustomValue ? value ?? '' : ''));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  // React-aria closes the dropdown when the typed text matches no option —
  // correct for the menu itself, but silent. Say WHY nothing matched, right
  // under the field, so a catalog-constrained picker (customer) never reads
  // as broken. Free-text fields (shipping line) get the same hint plus a
  // pointer that their text is kept as-is.
  const typedText = searchable ? inputValue.trim() : '';
  const noMatch = Boolean(typedText) && filterComboboxItems(options, typedText).length === 0;
  return (
    <div className={`csc-searchable-field${error ? ' csc-searchable-field--error' : ''}${className ? ` ${className}` : ''}`}>
      <ComboBox
        size="sm"
        aria-label={label}
        label={hideLabel ? undefined : label}
        // `searchable` mode opens the popover on focus (so the user sees the
        // option list and can type to filter immediately) — the default
        // `manual` + `openOnPress` combo only opens on keyboard, which made
        // the field feel like a closed select.
        menuTrigger={searchable ? 'focus' : 'manual'}
        openOnPress
        selectedKey={value || null}
        popoverPlacement={popoverPlacement}
        inputValue={
          searchable
            ? inputValue
            : selected?.label ?? (allowsCustomValue ? value : undefined)
        }
        onClear={() => {
          onChange('');
          setInputValue('');
        }}
        onSelectionChange={(key) => {
          if (key === null) return;
          onChange(String(key));
          if (searchable) {
            const picked = options.find((option) => String(option.value) === String(key));
            setInputValue(picked?.label ?? '');
          }
        }}
        {...(searchable
          ? {
              allowsCustomValue: Boolean(allowsCustomValue),
              onInputChange: (text: string) => {
                setInputValue(text);
                onCustomValue?.(text);
                if (allowsCustomValue) {
                  onChange(text);
                } else if (text === '') {
                  onChange('');
                }
              },
            }
          : allowsCustomValue
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
            value={item}
            data-value={String(item.id)}
            className={optionClassName}
            label={item.label}
            supportingText={item.supportingText}
          />
        )}
      </ComboBox>
      {noMatch && (
        <div className="csc-field-warning" role="status" aria-live="polite">
          {allowsCustomValue
            ? 'Không có kết quả phù hợp — giữ nguyên văn đã nhập nếu muốn tạo mới.'
            : 'Không có kết quả phù hợp với từ khóa đã nhập.'}
        </div>
      )}
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
    <UuiSelectField
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      required={required}
      error={error}
      hint={hint}
      hideLabel={hideLabel}
      wrapperClassName="csc-select-field"
      controlClassName="csc-uui-field"
      popoverClassName="csc-select-popover"
    />
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
