// USearchableField — the searchable combobox adapter for the shipment
// create form. Split from uui-fields.tsx (structure-guard ceiling): it is
// the only adapter with allowsCustomValue + the 20260917_14/13
// suggestion-display fixes. Its commit contract: typed text in an
// allowsCustomValue field is live-committed through onCustomValue; an id
// select only ever commits through picked-option ids — blur and bare Enter
// re-fire the existing selection (RAC semantics), never the option label.
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ComboBox } from '../../../components/untitled-ui/base/select/combobox';
import { SelectItem } from '../../../components/untitled-ui/base/select/select-item';

interface USearchableFieldProps {
  size?: 'sm' | 'md';
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
  size = 'sm',
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
  const selectedLabel = selected?.label;
  // Local input text so type-to-search survives the controlled re-renders.
  // Synced with the selected option's label whenever `value` changes externally
  // (form reset, dialog-create success, etc.).
  const [inputValue, setInputValue] = useState<string>(selected?.label ?? '');
  // The user's LAST REAL PICK only. Typing is tracked by inputValue and must
  // never touch selectedKey: with allowsCustomValue each keystroke calls
  // onChange(text), and a selectedKey that follows the form value makes
  // react-aria treat a typed string matching an option as 'picked' — closing
  // the suggestion menu mid-word (20260917_14).
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  // Re-sync the visible text only when the FORM value actually changes
  // (external reset, dialog apply), or when the label for the CURRENT value
  // resolves later — a reload can restore the id before the catalog lands,
  // and the input must then catch up to the option's label. Catalog refetches
  // rotate the `options` identity but keep the label string, so they still
  // must NOT clobber in-flight typed text.
  const lastSyncedValue = useRef(value);
  const lastSyncedLabel = useRef(selectedLabel);
  useEffect(() => {
    if (lastSyncedValue.current === value && lastSyncedLabel.current === selectedLabel) return;
    lastSyncedValue.current = value;
    lastSyncedLabel.current = selectedLabel;
    // Custom (allowsCustomValue) values are not in the catalog, so `selected`
    // is undefined — keep the applied value in the input instead of blanking it.
    setInputValue(selectedLabel ?? (allowsCustomValue ? value ?? '' : ''));
    setChosenKey(selected?.value ?? (allowsCustomValue ? value ?? null : null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, selectedLabel]);
  return (
    <div className={`csc-searchable-field${error ? ' csc-searchable-field--error' : ''}${className ? ` ${className}` : ''}`}>
      <ComboBox
        size={size}
        aria-label={hideLabel ? label : undefined}
        label={hideLabel ? undefined : label}
        // `searchable` mode opens the popover on focus (so the user sees the
        // option list and can type to filter immediately) — the default
        // `manual` + `openOnPress` combo only opens on keyboard, which made
        // the field feel like a closed select.
        menuTrigger={searchable ? 'focus' : 'manual'}
        openOnPress
        selectedKey={searchable && allowsCustomValue ? chosenKey : (value || null)}
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
          if (key === null) {
            // RAC re-fires the current selection (or null) when a blur or an
            // Enter without a highlighted option settles the input. Nothing
            // may commit here — the option label must never ride into an id
            // handler (a blurred 20DC pick once wrote "20DC" into
            // containerTypeId, blanking the cell and failing the save with
            // "containerTypeId là bắt buộc"). Instead, make the visible text
            // agree with the committed value: unmatched typed text falls
            // back to the committed pick's label.
            if (searchable && !allowsCustomValue) {
              setInputValue(options.find((option) => option.value === (value ?? ''))?.label ?? '');
            }
            return;
          }
          setChosenKey(String(key));
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
                if (!allowsCustomValue && text === '') {
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
          searchText: option.searchText,
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
        {(item: { id: string | number; label?: string; searchText?: string }) => (
          <SelectItem
            id={item.id}
            value={item}
            data-value={String(item.id)}
            className={optionClassName}
            label={item.label}
            // The search chain rides textValue (filter-only) — rendering it
            // as supportingText bloated every dropdown row (20260917_13).
            textValue={`${item.label} ${item.searchText ?? ''}`.trim()}
          />
        )}
      </ComboBox>

    </div>
  );
}
