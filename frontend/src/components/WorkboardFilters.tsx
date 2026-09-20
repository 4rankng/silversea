// Extracted from ShipmentsPage.tsx (card 20260918_D2, structural-debt
// recovery): the advanced-filters region of the CUS workboard toolbar.
// Purely presentational — every value and write-back arrives via props;
// URL params contract unchanged, classnames unchanged (CSS parity pinned
// by the page's styles pins).
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { CUS_SEARCH_PATTERN, ShipmentCusBucket, SHIPMENT_CUS_BUCKET_LABELS } from '@tingting/shared';
import { SlidersHorizontal, RotateCcw, Search, X } from 'lucide-react';
import { BufferedUuiDateInput, UuiSelectField } from '../design-system';
import { Button as UUIButton } from './untitled-ui/base/buttons/button';
import { Input as UUIInput } from './untitled-ui/base/input/input';
import { CusFilterSummary } from '../features/shipments/cus/CusFilterSummary';
import { parseDateTime24 } from '../lib/format';
import { validateDateInputText } from '../design-system/hooks/useBufferedDateTextValue';

/** Valid plan buckets — shared with the page's URL-param validation. */
export const WORKBOARD_BUCKETS = Object.values(ShipmentCusBucket);

export interface WorkboardFiltersProps {
  dateFrom: string;
  dateTo: string;
  direction: string;
  adHoc: string;
  bucket: string;
  dateResetKey: number;
  updateParam: (key: string, value: string | null) => void;
}

export function WorkboardFilters({ dateFrom, dateTo, direction, adHoc, bucket, dateResetKey, updateParam }: WorkboardFiltersProps) {
  return (
    <>
      <BufferedUuiDateInput
        id="cus-filter-date-from"
        key={`from-${dateResetKey}`}
        label="Từ ngày giao"
        size="sm"
        value={dateFrom}
        onChange={(value) => updateParam('transportDateFrom', value || null)}
        max={dateTo || undefined}
        className="shipment-uui-field"
        wrapperClassName="shipment-uui-control"
        inputClassName="shipment-uui-control__input"
      />
      <BufferedUuiDateInput
        id="cus-filter-date-to"
        key={`to-${dateResetKey}`}
        label="Đến ngày giao"
        size="sm"
        value={dateTo}
        onChange={(value) => updateParam('transportDateTo', value || null)}
        min={dateFrom || undefined}
        className="shipment-uui-field"
        wrapperClassName="shipment-uui-control"
        inputClassName="shipment-uui-control__input"
      />
      <UuiSelectField
        label="Xuất / Nhập"
        value={direction}
        onChange={(event) => updateParam('direction', event.target.value || null)}
        options={[
          { value: '', label: 'Tất cả' },
          { value: 'EXPORT', label: 'Xuất' },
          { value: 'IMPORT', label: 'Nhập' },
        ]}
        wrapperClassName="shipment-uui-field"
        controlClassName="shipment-uui-select"
      />
      <UuiSelectField
        label="Loại lô"
        value={adHoc}
        onChange={(event) => updateParam('adHoc', event.target.value || null)}
        options={[
          { value: '', label: 'Tất cả' },
          { value: 'true', label: 'Lệnh chạy ngoài' },
          { value: 'false', label: 'Thường' },
        ]}
        wrapperClassName="shipment-uui-field"
        controlClassName="shipment-uui-select"
      />
      <UuiSelectField
        label="Kế hoạch"
        value={bucket}
        onChange={(event) => updateParam('bucket', event.target.value || null)}
        options={[
          { value: '', label: 'Tất cả trạng thái' },
          ...WORKBOARD_BUCKETS.map((value) => ({ value, label: SHIPMENT_CUS_BUCKET_LABELS[value] })),
        ]}
        wrapperClassName="shipment-uui-field"
        controlClassName="shipment-uui-select"
      />
    </>
  );
}

/** The workboard toolbar shell: search, advanced toggle, filter summary and
 *  reset — extracted from ShipmentsPage.tsx (card 20260918_D2 residual).
 *  Self-contained: owns the toolbar's draft state and applies every change
 *  through `updateParam`, so the URL contract is unchanged. The page reaches
 *  in through the handle for the two crosses it keeps: date validation before
 *  the XLSX export and the shared clear. */
export interface WorkboardToolbarHandle {
  validateDates(): boolean;
  clear(): void;
}

export interface WorkboardToolbarProps {
  suffixParam: string;
  dateFrom: string;
  dateTo: string;
  direction: string;
  bucket: string;
  adHoc: string;
  hasFilters: boolean;
  updateParam: (key: string, value: string | null) => void;
  onClear: () => void;
  ref?: React.Ref<WorkboardToolbarHandle>;
}

export function WorkboardToolbar({ suffixParam, dateFrom, dateTo, direction, bucket, adHoc, hasFilters, updateParam, onClear, ref }: WorkboardToolbarProps) {
  const [searchInput, setSearchInput] = useState(suffixParam);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Phone/tablet: secondary criteria collapse so records start higher.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dateResetKey, setDateResetKey] = useState(0);
  const [hasDateDraft, setHasDateDraft] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => setSearchInput(suffixParam), [suffixParam]);

  useImperativeHandle(ref, () => ({
    validateDates: validateFilterDates,
    clear: () => {
      setDateResetKey((key) => key + 1);
      setHasDateDraft(false);
      setSearchInput('');
      setSearchError(null);
    },
  }));

  const validateFilterDates = () => {
    const fromInput = formRef.current?.querySelector<HTMLInputElement>('#cus-filter-date-from');
    const toInput = formRef.current?.querySelector<HTMLInputElement>('#cus-filter-date-to');
    const visibleFrom = fromInput?.value ? parseDateTime24(`00:00 ${fromInput.value}`)?.slice(0, 10) ?? '' : '';
    const visibleTo = toInput?.value ? parseDateTime24(`00:00 ${toInput.value}`)?.slice(0, 10) ?? '' : '';
    // Read the actual draft pair: a rapid submit can precede the next render
    // and its validity effect, so URL state alone is not validation evidence.
    if (fromInput) fromInput.setCustomValidity(validateDateInputText(fromInput.value, '', visibleTo));
    if (toInput) toInput.setCustomValidity(validateDateInputText(toInput.value, visibleFrom));
    const invalidInput = formRef.current?.querySelector<HTMLInputElement>('[data-date-input]:invalid');
    if (!invalidInput) return true;
    setAdvancedOpen(true);
    // Reveal collapsed criteria before moving focus to the invalid draft.
    requestAnimationFrame(() => {
      invalidInput.focus();
      invalidInput.reportValidity();
    });
    return false;
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateFilterDates()) return;
    const value = (formRef.current?.querySelector<HTMLInputElement>('#cus-filter-search')?.value ?? searchInput).trim();
    if (value && !CUS_SEARCH_PATTERN.test(value)) {
      setSearchError('Nhập một phần số Bill/Book, container hoặc tờ khai, tối thiểu 4 ký tự (không dùng % hoặc _).');
      return;
    }
    setSearchError(null);
    updateParam('searchSuffix', value || null);
  };

  // One apply model for the whole bar (2026-09-18): every control applies as it
  // changes — the text search on a short debounce. Enter still applies at once.
  useEffect(() => {
    const value = searchInput.trim();
    if (value === suffixParam) return;
    if (value && !CUS_SEARCH_PATTERN.test(value)) return;
    const timer = setTimeout(() => {
      setSearchError(null);
      updateParam('searchSuffix', value || null);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, suffixParam, updateParam]);

  const activeFilterCount = [dateFrom, dateTo, direction, bucket, adHoc].filter(Boolean).length;

  return (
    <form ref={formRef} className="cus-worksheet-toolbar" onSubmit={submitSearch} noValidate
      onInput={(event) => { if ((event.target as HTMLElement).matches('[data-date-input]')) setHasDateDraft(true); }}>
      <div className="cus-worksheet-toolbar__filters" aria-label={'Bộ lọc' + (activeFilterCount ? ' đang áp dụng ' + activeFilterCount : '')}>
        <div className="cus-search-field">
          <div className="cus-search-field__anchor">
            <UUIInput
              id="cus-filter-search"
              label="Bill/Book hoặc tờ khai"
              size="sm"
              icon={Search}
              value={searchInput}
              onChange={(value) => {
                setSearchInput(value);
                setSearchError(null);
              }}
              placeholder="Bill/Book, số container hoặc tờ khai"
              inputProps={{
                inputMode: 'text',
                pattern: '[A-Za-z0-9 .\\-\\/]{4,64}',
                autoCapitalize: 'characters',
                autoCorrect: 'off',
                spellCheck: false,
              }}
              isInvalid={Boolean(searchError)}
              aria-describedby={searchError ? 'cus-search-error' : undefined}
              className="shipment-uui-field"
              wrapperClassName="shipment-uui-control"
              inputClassName="shipment-uui-control__input shipment-uui-control__input--search"
              iconClassName="shipment-uui-control__icon"
              tooltipClassName="cus-search-field__validation-icon"
            />
            {searchInput && (
              <UUIButton
                size="sm"
                color="tertiary"
                className="shipment-uui-clear"
                onPress={() => {
                  setSearchInput('');
                  setSearchError(null);
                  updateParam('searchSuffix', null);
                }}
                aria-label="Xóa tìm kiếm"
                iconLeading={<X size={16} aria-hidden="true" />}
              />
            )}
          </div>
          {searchError && <span id="cus-search-error" className="cus-field-error" role="alert">{searchError}</span>}
        </div>

        <UUIButton
          type="button" size="sm" color="secondary" className="cus-advanced-toggle"
          aria-label="Bộ lọc nâng cao"
          aria-expanded={advancedOpen} aria-controls="cus-advanced-filters"
          onPress={() => setAdvancedOpen((o) => !o)}
          iconLeading={SlidersHorizontal}>
          Bộ lọc{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
        </UUIButton>
        {activeFilterCount > 0 && !advancedOpen && (
          <CusFilterSummary direction={direction} dateFrom={dateFrom} dateTo={dateTo} bucket={bucket} />
        )}
        <div id="cus-advanced-filters" className="cus-worksheet-advanced" data-open={advancedOpen ? '' : undefined}>
          <WorkboardFilters
            dateFrom={dateFrom}
            dateTo={dateTo}
            direction={direction}
            adHoc={adHoc}
            bucket={bucket}
            dateResetKey={dateResetKey}
            updateParam={updateParam}
          />
        </div>
      </div>

      {(hasFilters || hasDateDraft) && (
        <UUIButton
          size="sm"
          color="tertiary"
          className="shipment-uui-button shipment-uui-button--tertiary cus-worksheet-toolbar__reset"
          onPress={onClear}
          iconLeading={<RotateCcw size={16} aria-hidden="true" />}
        >
          Xóa lọc
        </UUIButton>
      )}
    </form>
  );
}
