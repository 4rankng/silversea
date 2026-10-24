// USearchableField — the searchable combobox adapter for the shipment
// create form. Split from uui-fields.tsx (structure-guard ceiling): it is
// the only adapter with allowsCustomValue + the 20260917_14/13
// suggestion-display fixes. Its commit contract: typed text in an
// allowsCustomValue field is live-committed through onCustomValue; an id
// select only ever commits through picked-option ids — blur and bare Enter
// re-fire the existing selection (RAC semantics), never the option label.
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ComboBox, matchesComboboxSearch } from '../../../components/untitled-ui/base/select/combobox';
import { SelectItem } from '../../../components/untitled-ui/base/select/select-item';
import { Header, ListBoxSection } from 'react-aria-components';

interface USearchableFieldProps {
  size?: 'sm' | 'md';
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{
    value: string;
    label: string;
    searchText?: string;
    supportingText?: string;
    /**
     * FB-138 (design direction 24/10, owner-approved) — group the option
     * under a section header (uppercase label + divider). Options sharing a
     * `section` render inside ONE grouped block, first-appearance order;
     * an option WITHOUT `section` renders before the first group, headerless.
     */
    section?: string;
  }>;
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
   * Open the suggestion menu when the user TYPES into the field
   * (menuTrigger "input") instead of only on click/arrow keys. Unlike
   * `searchable` (focus trigger) the menu stays closed while the user merely
   * tabs through or clicks elsewhere — typing is the open signal, which is
   * what table cells want (20260921_1: gõ sau khi Tab sang ô LOẠI CONTAINER
   * không hiện gợi ý).
   */
  openOnType?: boolean;
  /**
   * "Create from typed text" footer option rendered at the end of the
   * listbox. It always matches the filter (its search text carries the typed
   * value) and selection hands the typed text to the caller instead of
   * committing a value — the create dialogs open from the dropdown, not the
   * row (20260920_26).
   */
  createOption?: { label?: (typed: string) => string; onSelect: (typed: string) => void };
  /**
   * Receives the programmatic open handle once the combobox state exists
   * (card 20261002_272 — the paired-field Tab hand-off: the sibling field's
   * Tab keydown focuses this input and calls `open()`; bare focus and
   * pass-through still never open — menuTrigger semantics are unchanged).
   */
  openApiRef?: { current: { open: () => void } | null };
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
  openOnType,
  onCustomValue,
  hideLabel,
  createOption,
  openApiRef,
}: USearchableFieldProps) {
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label;
  // Local input text so type-to-search survives the controlled re-renders.
  // Synced with the selected option's label whenever `value` changes externally
  // (form reset, dialog-create success, etc.). A custom (allowsCustomValue)
  // value that is NOT in the catalog must show at mount too — the same rule
  // the sync effect applies later (round 19: the reassign dialog seeds a
  // plate the carrier list may not carry yet).
  const [inputValue, setInputValue] = useState<string>(selected?.label ?? (allowsCustomValue ? value ?? '' : ''));
  // The user's LAST REAL PICK only. Typing is tracked by inputValue and must
  // never touch selectedKey: with allowsCustomValue each keystroke calls
  // onChange(text), and a selectedKey that follows the form value makes
  // react-aria treat a typed string matching an option as 'picked' — closing
  // the suggestion menu mid-word (20260917_14).
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  // The live custom-typed text (FB-105 §4.2 passthrough). When the caller's
  // onCustomValue resolves an exact option-label match to the catalog id, the
  // form value flips to that id mid-word — the sync effect below must not
  // adopt it as chosenKey, or react-aria reads the controlled selectedKey
  // change as a real pick and closes the dropdown exactly when the user
  // finishes typing a full label (card 261022213755b: gõ đủ "GLC" làm menu
  // kho đóng ngầm, chỉ "LC" mới thấy). Cleared on real picks, clear and blur
  // so later external value changes adopt their key normally.
  const typedCustomTextRef = useRef<string | null>(null);
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
    // TiepVu22Oct-3 (stale-state race, same family as 261022213755b): a LIVE
    // typing session owns the visible text. The free-text passthrough clears
    // the form id on every NON-matching keystroke (value: id → ''), and this
    // effect used to answer that flip with setInputValue('') — overwriting
    // the user's newest keystroke with the older state transition. Typing a
    // full label over an existing pick ("Kho ST" → "GLC") ate the first
    // character: the field showed "LC" while the user had typed "GLC". The
    // exact-label branch below keeps its own law: when the passthrough
    // RESOLVES a typed label to the catalog id mid-word, the resolved label
    // equals the typed text, so skipping the write loses nothing.
    const typedText = typedCustomTextRef.current;
    const typingSessionLive = allowsCustomValue
      && typedText != null
      && typedText !== '';
    lastSyncedValue.current = value;
    lastSyncedLabel.current = selectedLabel;
    if (!typingSessionLive) {
      // Custom (allowsCustomValue) values are not in the catalog, so `selected`
      // is undefined — keep the applied value in the input instead of blanking it.
      setInputValue(selectedLabel ?? (allowsCustomValue ? value ?? '' : ''));
    }
    // FB-066 lần 3 (card 201026101600): chosenKey is the user's LAST REAL
    // PICK only — the module invariant at the chosenKey declaration ("typing
    // must never touch selectedKey"). The old `?? (allowsCustomValue ? value
    // ?? null : null)` fallback fed a phantom key on EVERY keystroke of a custom-typed value,
    // which matched react-aria's internal auto-select and made
    // KeepSuggestionsOpen treat the mid-word menu close as a real pick —
    // suggestions (and the "Thêm mới" create option) never came back while
    // typing. A custom value shows through inputValue above; it is not a pick.
    // Card 261022213755b: the SAME law covers the exact-label passthrough —
    // onCustomValue resolving a typed label to the catalog id flips `value`
    // mid-word, and adopting that id here would snap the dropdown shut the
    // moment the full label is typed. While the resolved label IS the live
    // typed text, the change came from typing, not from a pick.
    const fromLiveTyping = typingSessionLive && selectedLabel === typedText;
    setChosenKey(fromLiveTyping ? null : selected?.value ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, selectedLabel]);
  // 20260922_4: bare Enter (menu open, no highlighted option) commits the
  // UNIQUE filtered match — the same predicate/normalization the menu itself
  // filters with, over the caller's options only (the __create__ footer is
  // excluded so it can never make a real option look ambiguous). Zero or
  // multiple matches → null: nothing commits, the typed text stays and the
  // menu stays open; free/ambiguous text never rides into an id handler
  // (the id-select contract from the null-selection guard is unchanged).
  const commitEnterMatch = (typedText: string): { id: string; label: string } | null => {
    if (!searchable) return null;
    const matches = options.filter((option) => matchesComboboxSearch(`${option.label} ${option.searchText ?? ''}`.trim(), typedText));
    if (matches.length !== 1) return null;
    const match = matches[0];
    // A bare-Enter commit IS a real pick (TiepVu22Oct-3 review): end the
    // typing session so later external value changes adopt their key and
    // label normally — same law as the menu pick and the __create__ pick.
    // The ambiguous/no-match return above KEEPS the session: free text must
    // stay owned by the typist.
    typedCustomTextRef.current = null;
    setChosenKey(match.value);
    onChange(match.value);
    setInputValue(match.label);
    return { id: String(match.value), label: match.label };
  };
  // FB-138 — grouped options: options carrying a `section` fold into RAC
  // Section nodes (Header + Collection); the create footer and sectionless
  // options stay plain items after them. First-appearance order.
  type ComboItem = {
    id: string | number;
    label?: string;
    searchText?: string;
    supportingText?: string;
    children?: ComboItem[];
  };
  const comboBoxItems: ComboItem[] = (() => {
    const toComboItem = (option: { value: string; label: string; searchText?: string; supportingText?: string }): ComboItem => ({
      id: option.value,
      label: option.label,
      searchText: option.searchText,
      supportingText: option.supportingText,
    });
    const hasSections = options.some((option) => option.section != null && option.section !== '');
    if (!hasSections) {
      return options.map(toComboItem).concat(createOption ? [{
        id: '__create__',
        label: createOption.label ? createOption.label(inputValue ?? '') : '+ Thêm',
        searchText: inputValue ?? '',
        supportingText: undefined,
      }] : []);
    }
    const sections: ComboItem[] = [];
    const sectionById = new Map<string, ComboItem>();
    for (const option of options) {
      const key = option.section ?? '';
      let group = sectionById.get(key);
      if (group == null) {
        group = { id: `section:${key}`, ...(key ? { label: key } : {}), children: [] };
        sectionById.set(key, group);
        sections.push(group);
      }
      group.children!.push(toComboItem(option));
    }
    return sections.concat(createOption ? [{
      id: '__create__',
      label: createOption.label ? createOption.label(inputValue ?? '') : '+ Thêm',
      searchText: inputValue ?? '',
      supportingText: undefined,
    }] : []);
  })();
  const renderItem = (item: ComboItem) => (
    <SelectItem
      id={item.id}
      value={item}
      data-value={String(item.id)}
      className={optionClassName}
      label={item.label}
      // The search chain rides textValue (filter-only) — rendering it
      // as supportingText bloated every dropdown row (20260917_13).
      // An explicit supportingText is different: the caller opts a
      // specific field into a visible secondary line (FB-007: the
      // factory phone in the picker options).
      textValue={`${item.label} ${item.searchText ?? ''}`.trim()}
      {...(item.supportingText ? { supportingText: item.supportingText } : {})}
    />
  );
  return (
    <div className={`csc-searchable-field${error ? ' csc-searchable-field--error' : ''}${className ? ` ${className}` : ''}`}>
      <ComboBox
        size={size}
        onEnterCommit={searchable ? commitEnterMatch : undefined}
        aria-label={hideLabel ? label : undefined}
        label={hideLabel ? undefined : label}
        // `searchable` mode opens the popover on focus (so the user sees the
        // option list and can type to filter immediately) — the default
        // `manual` + `openOnPress` combo only opens on keyboard, which made
        // the field feel like a closed select.
        menuTrigger={searchable ? 'focus' : openOnType ? 'input' : 'manual'}
        openOnPress
        selectedKey={searchable && allowsCustomValue ? chosenKey : (value || null)}
        inputValue={
          searchable
            ? inputValue
            : selected?.label ?? (allowsCustomValue ? value : undefined)
        }
        onClear={() => {
          onChange('');
          setInputValue('');
          // Clear is an empty-text commit on the custom-value channel too.
          // The raw free-text names (factoryName / pickupWarehouseName /
          // raw port names …) are written ONLY through onCustomValue, so a
          // 'Xoá' without this call left the discarded text alive: it
          // silently satisfied the required checks and rode into
          // pickup_location/delivery_location (FB-105 card 171026115800).
          onCustomValue?.('');
          typedCustomTextRef.current = null;
        }}
        onBlur={() => {
          // Leaving the field ends the typing session: later external value
          // changes (dialog apply, form reset) must adopt their key again.
          typedCustomTextRef.current = null;
        }}
        onSelectionChange={(key) => {
          if (createOption && String(key) === '__create__') {
            // FB-066 lần 3 (card 201026101600): the create row is a REAL pick
            // — mark it on both key channels (internal + controlled agree), or
            // KeepSuggestionsOpen reads the mismatch as a mid-word auto-select
            // and pops the suggestions back open over the create dialog this
            // onSelect opens (with react-aria's ariaHideOutside still scoped to
            // the popover, that dialog renders aria-hidden to AT and tests).
            // Card 261022213755b review: a real pick also ends the typing
            // session so the post-dialog value (the created item's id) can
            // adopt its key normally.
            typedCustomTextRef.current = null;
            setChosenKey('__create__');
            createOption.onSelect(inputValue);
            return;
          }
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
          // A real pick ends any live typing session (card 261022213755b):
          // the pick's own key must be adoptable by the sync effect below.
          typedCustomTextRef.current = null;
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
                // Track the live typed text before the passthrough so the
                // sync effect can tell a typing-resolved id from a real pick
                // (card 261022213755b — see typedCustomTextRef).
                typedCustomTextRef.current = text;
                onCustomValue?.(text);
                if (!allowsCustomValue && text === '') {
                  onChange('');
                }
              },
            }
          : allowsCustomValue
            ? { allowsCustomValue: true, onInputChange: (text: string) => onChange(text) }
            : createOption || openOnType
              ? { onInputChange: (text: string) => setInputValue(text) }
              : {})}
        items={comboBoxItems as Array<{ id: string | number; label?: string; searchText?: string; supportingText?: string }>}
        placeholder={placeholder}
        isDisabled={disabled}
        isRequired={required}
        isInvalid={Boolean(error)}
        hint={error ?? hint}
        hideRequiredIndicator={!required}
        shortcut={shortcut}
        popoverClassName={popoverClassName}
        className="csc-uui-field csc-control-boundary"
        {...(openApiRef ? { onReady: (api: { open: () => void }) => { openApiRef.current = api; } } : {})}
      >
        {/* FB-138 — a section item renders as a grouped block (Header +
            its options as STATIC SelectItems — no <Collection>: the dynamic
            Collection wrapper feeds React's dev render-diff logger a node
            whose `childNodes` getter throws, aborting the pick's commit
            (browser dev builds; 2026-10-24 driver probe). React-aria's
            combobox filter still drops emptied sections automatically. */}
        {(item: {
          id: string | number;
          label?: string;
          searchText?: string;
          supportingText?: string;
          children?: Array<{ id: string | number; label?: string; searchText?: string; supportingText?: string }>;
        }) => (Array.isArray(item.children)
          ? (
            <ListBoxSection>
              {item.label ? (
                <Header
                  // Design direction 24/10 (owner-approved): divider + label
                  // uppercase text-xs font-semibold — house tokens
                  // (text-quaternary = fg-quaternary, border-secondary) so
                  // the header styles load on every surface that mounts this
                  // field, not only pages that ship the csc-* stylesheet.
                  className="csc-combobox-section-header border-t border-secondary px-2.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-quaternary"
                >
                  {item.label}
                </Header>
              ) : null}
              {item.children.map((child) => renderItem(child))}
            </ListBoxSection>
          )
          : renderItem(item))}
      </ComboBox>

    </div>
  );
}
