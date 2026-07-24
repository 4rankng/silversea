import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
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
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
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

export function SearchableSelect({
  id,
  name,
  value,
  onChange,
  options,
  placeholder = 'Chọn một mục',
  searchPlaceholder = 'Nhập để tìm kiếm…',
  emptyMessage = 'Không tìm thấy kết quả phù hợp.',
  disabled = false,
  required = false,
  className = '',
}: SearchableSelectProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

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

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  useClickOutside(containerRef, close, {
    escapeKey: true,
    enabled: isOpen,
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

  return (
    <div ref={containerRef} className={rootClassName}>
      <button
        id={id}
        type="button"
        className={`input searchable-select__trigger${isOpen ? ' searchable-select__trigger--open' : ''}`}
        onClick={() => (isOpen ? close() : open())}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
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

      {isOpen ? (
        <div className="searchable-select__popover">
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
          </div>

          <ul id={listboxId} className="searchable-select__list" role="listbox">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => {
                const isSelected = option.value === value;
                const isActive = index === activeIndex;
                return (
                  <li
                    id={`${listboxId}-option-${option.value}`}
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    className={`searchable-select__option${isActive ? ' searchable-select__option--active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectOption(option)}
                  >
                    <span className="searchable-select__check" aria-hidden="true">
                      {isSelected ? <Check size={15} /> : null}
                    </span>
                    <span>{option.label}</span>
                  </li>
                );
              })
            ) : (
              <li className="searchable-select__empty">{emptyMessage}</li>
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
