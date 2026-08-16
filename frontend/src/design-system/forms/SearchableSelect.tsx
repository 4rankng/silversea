import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useClickOutside } from '../../hooks/useClickOutside';
import './SearchableSelect.css';

export interface SearchableSelectOption {
  value: string;
  label: string;
  searchText?: string;
}

export interface SearchableSelectProps {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onSearchChange?: (query: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  searchDebounceMs?: number;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /**
   * Whether to expose a "Bỏ chọn" item at the top of the popover so a user
   * can clear a previously-selected value. Defaults to `true` for any field
   * that is not required; required fields always get a clear option too
   * (the parent decides whether to allow empty submission).
   */
  clearable?: boolean;
  /** Label for the clear item. Override for context-specific wording. */
  clearLabel?: string;
  /** Validation state and associated helper/error content owned by the caller. */
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
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

function isTriggerVisibleWithinScrollContainers(
  trigger: HTMLElement,
  triggerRect: DOMRect,
): boolean {
  // JSDOM and prerendering environments do not provide layout geometry.
  // Treat an unmeasured trigger as visible; real rendered controls have size.
  if (triggerRect.width === 0 && triggerRect.height === 0) return true;
  const outsideViewport = triggerRect.bottom <= 0
    || triggerRect.top >= window.innerHeight
    || triggerRect.right <= 0
    || triggerRect.left >= window.innerWidth;
  if (outsideViewport) return false;

  let ancestor = trigger.parentElement;
  while (ancestor) {
    const style = window.getComputedStyle(ancestor);
    const ancestorRect = ancestor.getBoundingClientRect();
    const clipsHorizontally = /(auto|scroll|hidden|clip)/.test(style.overflowX);
    const clipsVertically = /(auto|scroll|hidden|clip)/.test(style.overflowY);
    if (clipsHorizontally && (triggerRect.right <= ancestorRect.left || triggerRect.left >= ancestorRect.right)) {
      return false;
    }
    if (clipsVertically && (triggerRect.bottom <= ancestorRect.top || triggerRect.top >= ancestorRect.bottom)) {
      return false;
    }
    ancestor = ancestor.parentElement;
  }
  return true;
}

export function SearchableSelect({
  id,
  name,
  value,
  onChange,
  onSearchChange,
  options,
  placeholder = 'Chọn một mục',
  searchPlaceholder = 'Nhập để tìm kiếm…',
  emptyMessage = 'Không tìm thấy kết quả phù hợp.',
  disabled = false,
  required = false,
  className = '',
  searchDebounceMs = 250,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  clearable = true,
  clearLabel = 'Bỏ chọn',
  ariaInvalid,
  ariaDescribedBy,
}: SearchableSelectProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  const selectedOption = options.find((option) => option.value === value);
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
  const showClear = clearable && value !== '';
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

  const positionDesktopPopover = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover || isMobile) return;

    const viewportPadding = 16;
    const popoverGap = 6;
    const triggerRect = trigger.getBoundingClientRect();
    if (!isTriggerVisibleWithinScrollContainers(trigger, triggerRect)) {
      close();
      return;
    }

    // Reset the previous measurement before reading the popover's natural
    // size. The body portal removes table/overflow clipping; fixed viewport
    // coordinates keep the overlay attached to its trigger while scrolling.
    popover.dataset.placement = 'bottom';
    popover.style.removeProperty('--searchable-select-popover-max-height');
    popover.style.setProperty('--searchable-select-popover-top', '0px');
    popover.style.setProperty('--searchable-select-popover-left', '0px');
    popover.style.setProperty('--searchable-select-popover-width', `${triggerRect.width}px`);
    const popoverRect = popover.getBoundingClientRect();

    const spaceBelow = Math.max(
      0,
      window.innerHeight - triggerRect.bottom - viewportPadding - popoverGap,
    );
    const spaceAbove = Math.max(
      0,
      triggerRect.top - viewportPadding - popoverGap,
    );
    const placement = popoverRect.height > spaceBelow && spaceAbove > spaceBelow
      ? 'top'
      : 'bottom';
    const availableHeight = placement === 'top' ? spaceAbove : spaceBelow;

    popover.dataset.placement = placement;
    popover.style.setProperty(
      '--searchable-select-popover-max-height',
      `${Math.floor(availableHeight)}px`,
    );
    const renderedHeight = popover.getBoundingClientRect().height;

    const maximumLeft = Math.max(
      viewportPadding,
      window.innerWidth - viewportPadding - popoverRect.width,
    );
    const clampedLeft = Math.min(
      Math.max(triggerRect.left, viewportPadding),
      maximumLeft,
    );
    const requestedTop = placement === 'top'
      ? triggerRect.top - popoverGap - renderedHeight
      : triggerRect.bottom + popoverGap;
    const maximumTop = Math.max(
      viewportPadding,
      window.innerHeight - viewportPadding - renderedHeight,
    );
    const popoverTop = Math.min(
      Math.max(requestedTop, viewportPadding),
      maximumTop,
    );
    popover.style.setProperty('--searchable-select-popover-top', `${Math.round(popoverTop)}px`);
    popover.style.setProperty('--searchable-select-popover-left', `${Math.round(clampedLeft)}px`);
  }, [close, isMobile]);

  useLayoutEffect(() => {
    if (!isOpen || isMobile) return;
    positionDesktopPopover();
    window.addEventListener('resize', positionDesktopPopover);
    window.addEventListener('scroll', positionDesktopPopover, true);
    return () => {
      window.removeEventListener('resize', positionDesktopPopover);
      window.removeEventListener('scroll', positionDesktopPopover, true);
    };
  }, [filteredOptions.length, isMobile, isOpen, positionDesktopPopover, showClear]);

  useClickOutside(containerRef, close, {
    escapeKey: true,
    enabled: isOpen && !isMobile,
    additionalRefs: portaledOverlayRefs,
  });

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !onSearchChange) return;
    const timer = window.setTimeout(() => onSearchChange(query.trim()), searchDebounceMs);
    return () => window.clearTimeout(timer);
  }, [isOpen, onSearchChange, query, searchDebounceMs]);

  useEffect(() => {
    if (activeIndex >= filteredOptions.length) {
      setActiveIndex(Math.max(0, filteredOptions.length - 1));
    }
  }, [activeIndex, filteredOptions.length]);

  const open = () => {
    if (disabled) return;
    setQuery('');
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    setIsOpen(true);
  };

  const selectOption = (option: SearchableSelectOption) => {
    onChange(option.value);
    close();
  };

  const clearSelection = () => {
    onChange('');
    close();
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
      const option = filteredOptions[activeIndex];
      if (option) selectOption(option);
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

        <ul id={listboxId} className="searchable-select__list" role="listbox">
          {showClear ? (
            <li className="searchable-select__clear" role="presentation">
              <button
                type="button"
                className="searchable-select__clear-button"
                onClick={clearSelection}
                data-testid={`${id}-clear`}
              >
                <X size={14} aria-hidden="true" />
                <span>{clearLabel}</span>
              </button>
            </li>
          ) : null}
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => {
              const isSelected = option.value === value;
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
                    onClick={() => selectOption(option)}
                  >
                    <span className="searchable-select__check" aria-hidden="true">
                      {isSelected ? <Check size={15} /> : null}
                    </span>
                    <span>{option.label}</span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="searchable-select__empty">{emptyMessage}</li>
          )}
          {hasMore && onLoadMore ? (
            <li className="searchable-select__load-more" role="presentation">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Đang tải…' : 'Tải thêm kết quả'}
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </>
  ) : null;

  return (
    <div ref={containerRef} className={rootClassName}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`input searchable-select__trigger${isOpen ? ' searchable-select__trigger--open' : ''}`}
        onClick={() => (isOpen ? close() : open())}
        disabled={disabled}
        aria-haspopup={isMobile ? 'dialog' : 'listbox'}
        aria-expanded={isOpen}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-controls={isOpen ? listboxId : undefined}
        aria-required={required}
      >
        <span className={selectedOption ? 'searchable-select__value' : 'searchable-select__placeholder'}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown
          size={16}
          className={`searchable-select__chevron${isOpen ? ' searchable-select__chevron--open' : ''}`}
          aria-hidden="true"
        />
      </button>

      {name ? <input type="hidden" name={name} value={value} /> : null}

      {typeof document !== 'undefined'
        ? createPortal(selectorOverlay, document.body)
        : selectorOverlay}
    </div>
  );
}
