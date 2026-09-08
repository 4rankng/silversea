/**
 * Multi-select companion to `SearchableSelect`. Same portal + flip + scroll
 * positioning (via the shared `useSearchableSelectPosition` hook), different
 * trigger (chip row) and popover body (checkbox list). Selected items are
 * rendered as chips inside the trigger; removing a chip calls
 * `onMultiChange` with the reduced array; "Bỏ chọn tất cả" in the footer
 * empties the selection.
 *
 * The component deliberately mirrors `SearchableSelect`'s UX (search input,
 * keyboard nav, mobile full-screen dialog) so dispatchers see one consistent
 * picker behaviour regardless of mode.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useSearchableSelectPosition } from './useSearchableSelectPosition';
import './SearchableSelect.css';

export interface SearchableMultiSelectOption {
  value: string;
  label: string;
  searchText?: string;
  /** Render-only override for the trigger chip text. Defaults to `label`. */
  chipLabel?: string;
}

export interface SearchableMultiSelectProps {
  id: string;
  name?: string;
  values: ReadonlyArray<string>;
  onChange: (values: string[]) => void;
  options: SearchableMultiSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  searchDebounceMs?: number;
  size?: 'sm' | 'md';
  /** Localised label for the "clear all" action. */
  clearAllLabel?: string;
  /** Suffix rendered in the trigger chip count, e.g. "đã chọn". */
  countSuffix?: string;
  /** Label used in the accessibility names: trigger reads "Chọn X…" /
   *  "Đã chọn N X", the listbox reads "Danh sách X". Without it the trigger
   *  falls back to the placeholder and an unlabelled listbox. */
  selectionLabel?: string;
  /**
   * Debounced notification while the popover is open and the search input
   * changes — mirrors `SearchableSelect`'s contract. Use it to refetch
   * server-filtered options; the list keeps filtering the returned rows
   * locally on top.
   */
  onSearchChange?: (query: string) => void;
  /** Notify when the popover opens/closes. */
  onOpenChange?: (isOpen: boolean) => void;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi')
    .trim();
}

export function SearchableMultiSelect({
  id,
  name,
  values,
  onChange,
  options,
  placeholder = 'Chọn nhiều mục',
  searchPlaceholder = 'Nhập để tìm kiếm…',
  emptyMessage = 'Không tìm thấy kết quả phù hợp.',
  disabled = false,
  required = false,
  className = '',
  searchDebounceMs = 250,
  size = 'md',
  clearAllLabel = 'Bỏ chọn tất cả',
  countSuffix = 'đã chọn',
  selectionLabel,
  onSearchChange,
  onOpenChange,
}: SearchableMultiSelectProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const previousOpenState = useRef(isOpen);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (previousOpenState.current !== isOpen) onOpenChangeRef.current?.(isOpen);
    previousOpenState.current = isOpen;
  }, [isOpen]);

  const selectedSet = useMemo(() => new Set(values), [values]);
  const selectedOptions = useMemo(
    () => values
      .map((value) => options.find((option) => option.value === value))
      .filter((option): option is SearchableMultiSelectOption => Boolean(option)),
    [values, options],
  );
  const normalizedQuery = normalizeSearchText(query);
  const filteredOptions = useMemo(() => {
    const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);
    if (queryTerms.length === 0) return options;
    return options.filter((option) => {
      const searchableText = normalizeSearchText(
        `${option.label} ${option.searchText ?? ''}`,
      );
      return queryTerms.every((term) => searchableText.includes(term));
    });
  }, [normalizedQuery, options]);
  const portaledOverlayRefs = useMemo(() => [popoverRef], []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setActiveIndex(0);
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (!isOpen || typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 640px)').matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 640px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useSearchableSelectPosition({
    isOpen,
    isMobile,
    triggerRef,
    popoverRef,
    onClose: close,
    dependencies: [filteredOptions.length, values.length],
  });

  useClickOutside(containerRef, close, {
    escapeKey: true,
    enabled: isOpen,
    additionalRefs: portaledOverlayRefs,
  });

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (activeIndex >= filteredOptions.length) {
      setActiveIndex(Math.max(0, filteredOptions.length - 1));
    }
  }, [activeIndex, filteredOptions.length]);

  // Debounced server-search hook, mirroring SearchableSelect's contract:
  // fires only while open, `searchDebounceMs` after the query settles.
  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);
  useEffect(() => {
    if (!isOpen || !onSearchChangeRef.current) return;
    const timer = window.setTimeout(() => onSearchChangeRef.current?.(query.trim()), searchDebounceMs);
    return () => window.clearTimeout(timer);
  }, [isOpen, query, searchDebounceMs]);

  const toggleValue = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(values.filter((current) => current !== value));
    } else {
      onChange([...values, value]);
    }
  };

  const clearAll = () => {
    onChange([]);
  };

  const removeChip = (event: React.MouseEvent<HTMLButtonElement>, value: string) => {
    event.stopPropagation();
    onChange(values.filter((current) => current !== value));
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  const open = () => {
    if (disabled) return;
    setQuery('');
    setActiveIndex(0);
    setIsOpen(true);
  };

  const trapDialogFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href]',
    ));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, filteredOptions.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const option = filteredOptions[activeIndex];
      if (option) toggleValue(option.value);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const rootClassName = ['searchable-select', className].filter(Boolean).join(' ');

  const selectorOverlay = isOpen ? (
    <>
      <button
        type="button"
        className="searchable-select__backdrop"
        aria-label="Đóng danh sách lựa chọn"
        onPointerDown={(event) => {
          event.preventDefault();
          close();
        }}
        onClick={close}
      />
      <div ref={popoverRef} className="searchable-select__popover" role="dialog" aria-modal="true" aria-label={`Chọn ${placeholder}`} onKeyDown={trapDialogFocus}>
        <div className="searchable-select__search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            className="searchable-select__search-input"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
            role="combobox"
            aria-label={searchPlaceholder}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={
              filteredOptions[activeIndex]
                ? `${listboxId}-option-${filteredOptions[activeIndex].value}`
                : undefined
            }
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="searchable-select__close" onClick={close} aria-label="Đóng danh sách lựa chọn">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <ul id={listboxId} className="searchable-select__list" role="listbox" aria-multiselectable="true" aria-label={selectionLabel ? `Danh sách ${selectionLabel}` : undefined}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => {
              const isSelected = selectedSet.has(option.value);
              const isActive = index === activeIndex;
              return (
                <li key={option.value} role="presentation">
                  <button
                    id={`${listboxId}-option-${option.value}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`searchable-select__option${isActive ? ' searchable-select__option--active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => toggleValue(option.value)}
                  >
                    <span className="searchable-select__check" aria-hidden="true">
                      {isSelected ? <Check size={15} /> : null}
                    </span>
                    <span className="searchable-select__option-label">{option.label}</span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="searchable-select__empty">{emptyMessage}</li>
          )}
        </ul>

        <div className="searchable-select__multi-footer">
          <span className="searchable-select__multi-count">
            {values.length > 0
              ? `${values.length} ${countSuffix}`
              : ''}
          </span>
          <button
            type="button"
            className="searchable-select__multi-clear-all"
            onClick={clearAll}
            disabled={values.length === 0}
            data-testid={`${id}-clear-all`}
          >
            {clearAllLabel}
          </button>
        </div>
      </div>
    </>
  ) : null;

  const triggerLabel = values.length === 0
    ? placeholder
    : `${values.length} ${countSuffix}`;

  return (
    <div ref={containerRef} className={rootClassName}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`input searchable-select__trigger searchable-select__trigger--${size}${isOpen ? ' searchable-select__trigger--open' : ''}`}
        onClick={() => (isOpen ? close() : open())}
        disabled={disabled}
        aria-haspopup={isMobile ? 'dialog' : 'listbox'}
        aria-expanded={isOpen}
        aria-required={required}
        aria-label={selectionLabel
          ? (values.length === 0 ? `Chọn ${selectionLabel}…` : `Đã chọn ${values.length} ${selectionLabel}`)
          : (values.length === 0 ? placeholder : `${values.length} ${countSuffix}`)}
      >
        {values.length === 0 ? (
          <span className="searchable-select__placeholder">{triggerLabel}</span>
        ) : (
          <span className="searchable-select__trigger-chips">
            {selectedOptions.map((option) => (
              <span key={option.value} className="searchable-select__chip">
                <span className="searchable-select__chip-label">{option.chipLabel ?? option.label}</span>
                <button
                  type="button"
                  className="searchable-select__chip-remove"
                  aria-label={`Xóa ${option.chipLabel ?? option.label}`}
                  onClick={(event) => removeChip(event, option.value)}
                  tabIndex={-1}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </span>
        )}
        <ChevronDown
          size={16}
          className={`searchable-select__chevron${isOpen ? ' searchable-select__chevron--open' : ''}`}
          aria-hidden="true"
        />
      </button>

      {name ? <input type="hidden" name={name} value={values.join(',')} /> : null}

      {typeof document !== 'undefined'
        ? createPortal(selectorOverlay, document.body)
        : selectorOverlay}
    </div>
  );
}
