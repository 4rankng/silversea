import type { ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';
import { Select as UUISelect } from '../../components/untitled-ui/base/select/select';
import { currentPathname, hasOperationalDensity } from '../../lib/operational-density';
import './UuiSelectField.css';

/**
 * Shared Untitled UI select adapter — the only sanctioned select control in
 * the app.
 *
 * React Aria renders the trigger button and listbox popover (portalled to the
 * body), so the menu is never clipped by the page layout and never falls back
 * to the OS-styled native picker. The event-shaped `onChange` mirrors a native
 * `<select>` so existing `e.target.value` state handlers migrate verbatim.
 *
 * Once there are `SEARCH_THRESHOLD` or more options, the control renders as a
 * type-to-search combobox instead of a plain listbox — long catalogs
 * (customers, drivers, vehicles, ...) are unusable to scroll through blind.
 * Short enum-style pickers (status, yes/no) stay a plain click-to-open list.
 *
 * Never render a raw `<select>` in user-facing UI — the ESLint guard
 * `@tingting/no-native-select` (eslint.config.js) blocks it. The only allowed
 * native select lives in the vendored UUI accessibility fallback.
 */
export interface UuiSelectFieldProps {
  id?: string;
  /** Visually rendered label; required for accessibility. */
  label: string;
  value: string;
  /** Native-select-shaped change event: `(e) => setState(e.target.value)`. */
  onChange: (event: { target: { value: string } }) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  /** Hide the visible label (still announced via aria-label). */
  hideLabel?: boolean;
  /** Overrides the accessible name; use for repeated rows where every control shares one visible label. */
  ariaLabel?: string;
  ariaDescribedBy?: string;
  /** Flags the control as invalid to assistive tech without switching `hint` to the red `error` styling. */
  invalid?: boolean;
  /** Inline layout: label left, control right — for filter toolbars. */
  inline?: boolean;
  /** Accepted for API parity; the trigger shows the first option when unselected. Also used as the search input's placeholder once the combobox variant kicks in. */
  placeholder?: string;
  /** `content` shrinks the control to its label; default fills the wrapper. */
  width?: 'stretch' | 'content';
  /** Extra classes for the wrapper, control, and popover elements. */
  wrapperClassName?: string;
  controlClassName?: string;
  popoverClassName?: string;
  /** Compact filters by default; ordinary form controls can opt into md. */
  size?: 'sm' | 'md';
}

const EMPTY_SELECT_KEY = '__EMPTY_SELECT_VALUE__';

/** Below this many options a plain click-to-open list is easier to scan than typing to filter. */
const SEARCH_THRESHOLD = 5;

function asEvent(value: string) {
  return { target: { value } };
}

export function UuiSelectField({
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
  ariaLabel,
  ariaDescribedBy,
  invalid,
  inline,
  placeholder,
  width = 'stretch',
  wrapperClassName,
  controlClassName,
  popoverClassName,
  size = 'sm',
}: UuiSelectFieldProps) {
  const generatedId = useId();
  const messageId = `${id ?? generatedId}-message`;
  const descriptionIds = [ariaDescribedBy, (error || hint) ? messageId : undefined].filter(Boolean).join(' ') || undefined;
  const classes = [
    'ds-uui-select',
    hasOperationalDensity(currentPathname()) ? 'ds-uui-select--operational' : '',
    inline ? 'ds-uui-select--inline' : '',
    width === 'content' ? 'ds-uui-select--content' : '',
    wrapperClassName ?? '',
  ].filter(Boolean).join(' ');

  const items = options.map((option) => ({ id: option.value || EMPTY_SELECT_KEY, label: option.label, isDisabled: option.disabled }));
  const selectedLabel = value ? options.find((option) => option.value === value)?.label ?? '' : '';

  // Type-to-search text, independent from the committed `value` so the user
  // can filter freely before picking an option. Resynced with the selected
  // option's label whenever `value`/`options` change externally.
  const [searchText, setSearchText] = useState(selectedLabel);
  useEffect(() => {
    setSearchText(selectedLabel);
  }, [value, selectedLabel]);

  const isSearchable = options.length >= SEARCH_THRESHOLD;

  return (
    <div className={classes}>
      {isSearchable ? (
        <UUISelect.ComboBox
          id={id}
          size={size}
          aria-label={ariaLabel ?? (hideLabel ? label : undefined)}
          aria-describedby={descriptionIds}
          label={hideLabel ? undefined : label}
          menuTrigger="focus"
          openOnPress
          selectedKey={value || null}
          inputValue={searchText}
          onInputChange={setSearchText}
          onSelectionChange={(key) => {
            if (key == null) return;
            const nextValue = key === EMPTY_SELECT_KEY ? '' : String(key);
            onChange(asEvent(nextValue));
            setSearchText(nextValue ? options.find((option) => option.value === nextValue)?.label ?? '' : '');
          }}
          items={items}
          placeholder={placeholder ?? options.find(option => option.value === '')?.label ?? 'Gõ để tìm kiếm'}
          isDisabled={disabled}
          isRequired={required}
          isInvalid={invalid ?? Boolean(error)}
          hideRequiredIndicator={!required}
          popoverClassName={popoverClassName ?? 'ds-uui-select__popover'}
          className="ds-uui-select__control"
          triggerClassName={controlClassName}
        >
          {(item) => <UUISelect.Item id={item.id} label={item.label} isDisabled={item.isDisabled} selectionIndicatorAlign="left" />}
        </UUISelect.ComboBox>
      ) : (
        <UUISelect
          id={id}
          size={size}
          aria-label={ariaLabel ?? (hideLabel ? label : undefined)}
          aria-describedby={descriptionIds}
          label={hideLabel ? undefined : label}
          selectedKey={value || EMPTY_SELECT_KEY}
          onSelectionChange={(key) => onChange(asEvent(key === EMPTY_SELECT_KEY ? '' : String(key)))}
          items={items}
          isDisabled={disabled}
          isRequired={required}
          isInvalid={invalid ?? Boolean(error)}
          hideRequiredIndicator={!required}
          popoverClassName={popoverClassName ?? 'ds-uui-select__popover'}
          className="ds-uui-select__control"
          triggerClassName={controlClassName}
        >
          {(item) => <UUISelect.Item id={item.id} label={item.label} isDisabled={item.isDisabled} selectionIndicatorAlign="left" />}
        </UUISelect>
      )}
      {error
        ? <span id={messageId} className="ds-uui-select__error">{error}</span>
        : hint && <span id={messageId} className="ds-uui-select__hint">{hint}</span>}
    </div>
  );
}
