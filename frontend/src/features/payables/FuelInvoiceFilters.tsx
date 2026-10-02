import { FilterDropdown } from '../../components/FilterDropdown';
import { FilterBar, UuiSelectField } from '../../design-system';
import type { FuelInvoiceStatus } from '../../api/financialClient';

/**
 * FuelInvoiceFilters — the filter plane of the fuel-invoice panel
 * (card 20260927_152).
 *
 * ONE shared strip: the text query is the bar's own search cell, and the two
 * secondary criteria — the fuel supplier and the approval status — render
 * INLINE while the strip still fits two rows and fold behind `Bộ lọc (N)` only
 * when the width leaves no other choice (operator 2026-09-27: "when there is
 * enough space we try our best to display all filters, not group inside bo
 * loc"). The panel is a secondary section of `/payables`, so the strip keeps
 * the criteria the operator reaches for and adds none.
 *
 * This file is a COMPOSITION of the shared primitives, never a second
 * implementation of them: it declares no filter layout, no control width and no
 * state — the panel hands it values and writers only, so the labels, the
 * placeholders and the aria names stay exactly what they were.
 */

/** Approval-status options, including the empty value that clears the filter. */
const STATUS_OPTIONS: Array<{ value: '' | FuelInvoiceStatus; label: string }> = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'DRAFT', label: 'Bản nháp' },
  { value: 'RECORDED', label: 'Đã ghi nhận' },
  { value: 'VOIDED', label: 'Đã hủy' },
  { value: 'REVERSED', label: 'Đã hoàn tác' },
];

export interface FuelInvoiceFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  /** Selected fuel supplier id as a string; '' = all suppliers. */
  supplier: string;
  onSupplierChange: (value: string) => void;
  status: FuelInvoiceStatus | '';
  onStatusChange: (value: FuelInvoiceStatus | '') => void;
  /** Fuel suppliers of the catalog, sorted here so the caller passes the set. */
  suppliers: Array<{ id: number; name: string }>;
}

export function FuelInvoiceFilters({
  search,
  onSearchChange,
  supplier,
  onSupplierChange,
  status,
  onStatusChange,
  suppliers,
}: FuelInvoiceFiltersProps) {
  const supplierOptions = [
    { value: '', label: 'Tất cả nhà cung cấp nhiên liệu' },
    ...suppliers
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'))
      .map((item) => ({ value: String(item.id), label: item.name })),
  ];
  // The two criteria behind `Bộ lọc`: the count feeds the trigger badge and
  // `Đặt lại` clears exactly those two, nothing else.
  const secondaryCount = (supplier ? 1 : 0) + (status ? 1 : 0);
  const resetSecondary = () => {
    onSupplierChange('');
    onStatusChange('');
  };

  return (
    <FilterBar
      search={{
        value: search,
        onChange: onSearchChange,
        placeholder: 'Tìm theo số hóa đơn hoặc nhà cung cấp…',
        ariaLabel: 'Tìm hóa đơn nhiên liệu',
      }}
    >
      <FilterDropdown
        count={secondaryCount}
        ariaLabel="Bộ lọc"
        dialogLabel="Bộ lọc hóa đơn nhiên liệu"
        onReset={resetSecondary}
      >
        <UuiSelectField
          label="Lọc nhà cung cấp nhiên liệu"
          hideLabel
          value={supplier}
          onChange={(event) => onSupplierChange(event.target.value)}
          aria-label="Lọc nhà cung cấp nhiên liệu"
          options={supplierOptions}
          inline
        />
        <UuiSelectField
          label="Lọc trạng thái hóa đơn nhiên liệu"
          hideLabel
          value={status}
          onChange={(event) => onStatusChange(event.target.value as FuelInvoiceStatus | '')}
          aria-label="Lọc trạng thái hóa đơn nhiên liệu"
          options={STATUS_OPTIONS}
          inline
        />
      </FilterDropdown>
    </FilterBar>
  );
}
