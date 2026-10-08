import { RotateCcw } from 'lucide-react';
import { FilterDropdown } from '../../components/FilterDropdown';
import { Button as UUIButton } from '../../components/untitled-ui/base/buttons/button';
import { DisabledActionTip } from '../../components/shared/DisabledActionTip';
import {
  DateRangeFields, DateRangePresetSelect, DateRangePresets, FilterBar, InlineLabelSelect,
  type DateRangePreset, type DateRangeValue,
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
 * Card _202: Khách hàng LEFT this strip. It is the screen's primary axis, not
 * a criterion — it rides the page header, always visible and never folded
 * behind `Bộ lọc`. The page hands this strip its range + lock criteria and URL
 * writers only.
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
}

export function ShipmentDebitRibbon({
  deliveryFrom,
  deliveryTo,
  lockStatus,
  onLockChange,
  onDeliveryRangeChange,
  onResetSecondary,
  onClear,
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
      )}
    >
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
