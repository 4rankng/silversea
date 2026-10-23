import { RotateCcw } from 'lucide-react';
import { FilterDropdown } from '../../components/FilterDropdown';
import { Button as UUIButton } from '../../components/untitled-ui/base/buttons/button';
import { DisabledActionTip } from '../../components/shared/DisabledActionTip';
import { LclMergeModeToggle } from '../../components/shared/LclMergeModeToggle';
import {
  DateRangeFields, DateRangePresetSelect, DateRangePresets, FilterBar, InlineLabelSelect, SearchableSelect,
  type DateRangePreset, type DateRangeValue, type SearchableSelectOption,
} from '../../design-system';

/**
 * ShipmentDebitRibbon — Row 2 of `/shipments-debit` (card 20260927_153).
 *
 * ONE shared strip (card 20260927_152): the from/to delivery range and the
 * settlement quick ranges ride the bar, and the one secondary criterion —
 * Khóa lô — lives in `Bộ lọc`. The criterion renders INLINE while the strip
 * still fits two rows and folds behind the trigger only when the width leaves
 * no other choice (operator 2026-09-27: "when there is enough space we try our
 * best to display all filters, not group inside bo loc"), so the strip never
 * grows a third row and a short value never takes a whole line.
 *
 * Card _202 kept Khách hàng OFF this strip (the screen's "primary axis" on its
 * own always-visible bar). Owner request 2026-10-17 REVERSES that ruling: the
 * customer picker rides the strip again, as the FIRST control — same lane as
 * the range, the lock criterion and `Xóa lọc`. It is a bar CHILD, and bar
 * children never fold, so it stays visible at every width the strip holds
 * while the lock criterion still folds behind `Bộ lọc` when width demands.
 *
 * This file is a COMPOSITION of the shared primitives, never a second
 * implementation of them: it declares no filter layout, no filter width and no
 * state of its own, and every rule the strip obeys lives in FilterBar.css /
 * ListFilterBar.css. The page hands it values and URL writers only.
 */

/** Khóa lô — the lot-lock criterion plus the 'ALL' value that clears it. */
const LOCK_FILTERS = [
  { id: 'ALL', label: 'Tất cả' },
  { id: 'OPEN', label: 'Đang mở' },
  { id: 'LOCKED', label: 'Đã khóa' },
];

/** Settlement quick ranges (card 20260926_51) — evaluated on click so the
 *  pills stay anchored to "now" whenever the control is used. */
const toIsoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const monthBounds = (offset: number) => {
  const now = new Date();
  return { from: toIsoDate(new Date(now.getFullYear(), now.getMonth() + offset, 1)), to: toIsoDate(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)) };
};
const quarterBounds = () => {
  const now = new Date();
  const start = Math.floor(now.getMonth() / 3) * 3;
  return { from: toIsoDate(new Date(now.getFullYear(), start, 1)), to: toIsoDate(new Date(now.getFullYear(), start + 3, 0)) };
};
const SETTLEMENT_PRESETS: DateRangePreset[] = [
  { id: 'this-month', label: 'Tháng này', range: () => monthBounds(0) },
  { id: 'prev-month', label: 'Tháng trước', range: () => monthBounds(-1) },
  { id: 'this-quarter', label: 'Quý này', range: quarterBounds },
];

export interface ShipmentDebitRibbonProps {
  /** Khách hàng axis ('' = every customer) — owner 2026-10-17, back in the strip. */
  customerValue: string;
  /** The bootstrap customers mapped to combobox options by the page. */
  customerOptions: SearchableSelectOption[];
  /** Raw customer id string ('' clears the URL param). */
  onCustomerChange: (value: string) => void;
  /** Delivery-date bounds, ISO 'YYYY-MM-DD' ('' = unset). */
  deliveryFrom: string;
  deliveryTo: string;
  /** Lot-lock criterion; 'ALL' is the unset value the URL carries by absence. */
  lockStatus: 'ALL' | 'OPEN' | 'LOCKED';
  /** Raw key from the lock criterion ('ALL' clears the URL param). */
  onLockChange: (lockKey: string) => void;
  onDeliveryRangeChange: (range: DateRangeValue) => void;
  /** Clears exactly the criteria this strip owns. */
  onResetSecondary: () => void;
  /** Clears every filter of the strip. */
  onClear: () => void;
  /** Spec 23/10 (261023110000 §2) — the on-demand [📦 Gộp hàng] mode: the
   *  toggle rides the strip's actions; the page keeps the state (absent on
   *  read-only sessions ⇒ no button, no ticks). */
  mergeMode?: boolean;
  onToggleMergeMode?: () => void;
}

export function ShipmentDebitRibbon({
  customerValue,
  customerOptions,
  onCustomerChange,
  deliveryFrom,
  deliveryTo,
  lockStatus,
  onLockChange,
  onDeliveryRangeChange,
  onResetSecondary,
  onClear,
  mergeMode,
  onToggleMergeMode,
}: ShipmentDebitRibbonProps) {
  const range = { from: deliveryFrom, to: deliveryTo };
  // The badge counts exactly the criterion the dialog owns, so the trigger's
  // "Bộ lọc, N đang áp dụng" and `Đặt lại` describe the same criterion.
  const secondaryCount = lockStatus !== 'ALL' ? 1 : 0;
  // One implementation of the ranges per container: the visible chips in the
  // bar, the dropdown inside the dialog. Bar and dialog each render the node
  // their measured mode calls for, so exactly one exists at any width.
  const presetChips = <DateRangePresets presets={SETTLEMENT_PRESETS} value={range} onChange={onDeliveryRangeChange} ariaLabel="Khoảng ngày nhanh" />;
  const presetOptions = <DateRangePresetSelect presets={SETTLEMENT_PRESETS} value={range} onChange={onDeliveryRangeChange} ariaLabel="Khoảng ngày nhanh" />;
  // The reset arms on ANY applied criterion, so "nothing filtered" reads as a
  // dead action instead of a click that changes nothing.
  const hasFilters = deliveryFrom !== '' || deliveryTo !== '' || lockStatus !== 'ALL';
  return (
    <FilterBar
      presets={presetChips}
      actions={(
        <>
          {/* Spec 23/10 (261023110000 §2) — the on-demand merge mode rides the
              filter strip like the dispatch surfaces; OFF keeps the board free
              of leading ticks. */}
          {onToggleMergeMode && (
            <LclMergeModeToggle active={Boolean(mergeMode)} onToggle={onToggleMergeMode} />
          )}
          <DisabledActionTip
            id="shipment-debit-clear-filters"
            reason={!hasFilters ? 'Chưa có bộ lọc nào để xóa.' : null}
          >
          <UUIButton
            className="shipment-debit-ribbon__clear"
            size="sm"
            color="tertiary"
            iconLeading={RotateCcw}
            aria-disabled={!hasFilters || undefined}
            onPress={() => { if (!hasFilters) return; onClear(); }}
            aria-label="Xóa lọc"
          >
            Xóa lọc
          </UUIButton>
          </DisabledActionTip>
        </>
      )}
    >
      {/* Owner 2026-10-17 (reverses card _202): the Khách hàng picker rides the
          strip as its FIRST control — a bar child never folds, so the axis is
          visible in the same lane as the range and `Xóa lọc` at every width.
          The page keeps the URL semantics; only the control moved. */}
      <SearchableSelect
        id="shipment-debit-customer"
        className="shipment-debit-ribbon__customer"
        value={customerValue}
        onChange={onCustomerChange}
        options={customerOptions}
        placeholder="Tất cả khách hàng"
        searchPlaceholder="Tìm khách hàng…"
        emptyMessage="Không tìm thấy khách hàng phù hợp."
        clearable clearLabel="Xem tất cả khách hàng" size="sm"
      />
      <DateRangeFields
        className="shipment-debit-ribbon__range"
        id="shipment-debit-date-range"
        ariaLabel="Khoảng ngày giao"
        size="sm"
        from={deliveryFrom}
        to={deliveryTo}
        onChange={onDeliveryRangeChange}
      />
      {/* `Bộ lọc` rides LAST: it is the item that arrives and leaves as the
          width changes (the FilterBar band's own ordering contract). */}
      <FilterDropdown
        count={secondaryCount}
        ariaLabel="Bộ lọc"
        dialogLabel="Bộ lọc lô quyết toán"
        presets={presetOptions}
        onReset={onResetSecondary}
      >
        <InlineLabelSelect
          id="shipment-debit-lock"
          label="Khóa lô"
          items={LOCK_FILTERS}
          selectedKey={lockStatus}
          onSelectionChange={onLockChange}
          ariaLabel="Trạng thái khóa lô"
        />
      </FilterDropdown>
    </FilterBar>
  );
}
