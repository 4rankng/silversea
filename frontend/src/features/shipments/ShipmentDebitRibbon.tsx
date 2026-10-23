import { RotateCcw } from 'lucide-react';
import { Button as UUIButton } from '../../components/untitled-ui/base/buttons/button';
import { DisabledActionTip } from '../../components/shared/DisabledActionTip';
import {
  InlineLabelSelect, SearchableSelect, UnifiedDateRangePicker, FilterBar,
  type SearchableSelectOption,
} from '../../design-system';

/**
 * ShipmentDebitRibbon — the ONE filter strip of `/shipments-debit`
 * (card 20260927_153; owner redesign 23/10, spec v2 (d)).
 *
 * ONE date mechanism survives: the Unified Date Range Picker (trigger +
 * preset rail + dual-month calendar, auto-apply). The old trio — the topbar
 * month chip (now hidden on this route, Topbar.tsx), the separate Từ/Đến
 * field pair, and the quick-range pills — is gone from this surface, and
 * every remaining control still auto-applies straight into the URL.
 *
 * The strip stays a COMPOSITION of shared primitives: no filter layout, no
 * control width beyond the sanctioned page sizing below, and no filter state
 * of its own. The page hands it values and URL writers only.
 *
 * Owner spec v2 asked for a 'Khoản mục' select here; the L1 summary wire has
 * no category dimension to filter on, so shipping one would be a fake
 * control. The slot keeps the REAL secondary criterion — Khóa lô — correctly
 * spelled at the spec'd 180px; a real khoản mục filter needs a wire field
 * first (recorded in the redesign QA README, not silently invented).
 */

/** Khóa lô — the lot-lock criterion plus the 'ALL' value that clears it. */
const LOCK_FILTERS = [
  { id: 'ALL', label: 'Tất cả' },
  { id: 'OPEN', label: 'Đang mở' },
  { id: 'LOCKED', label: 'Đã khóa' },
];

export interface ShipmentDebitRibbonProps {
  /** Khách hàng axis ('' = every customer) — owner 2026-10-17. */
  customerValue: string;
  /** The bootstrap customers mapped to combobox options by the page. */
  customerOptions: SearchableSelectOption[];
  /** Raw customer id string ('' clears the URL param). */
  onCustomerChange: (value: string) => void;
  /** Delivery-date bounds, ISO 'YYYY-MM-DD' ('' = unset). */
  deliveryFrom: string;
  deliveryTo: string;
  /** Auto-applies the complete range into the URL. */
  onDeliveryRangeChange: (range: { from: string; to: string }) => void;
  /** Lot-lock criterion; 'ALL' is the unset value the URL carries by absence. */
  lockStatus: 'ALL' | 'OPEN' | 'LOCKED';
  /** Raw key from the lock criterion ('ALL' clears the URL param). */
  onLockChange: (lockKey: string) => void;
  /** How many criteria are applied right now (customer + range + lock). */
  appliedCount: number;
  /** Clears every filter of the strip. */
  onClear: () => void;
}

export function ShipmentDebitRibbon({
  customerValue,
  customerOptions,
  onCustomerChange,
  deliveryFrom,
  deliveryTo,
  onDeliveryRangeChange,
  lockStatus,
  onLockChange,
  appliedCount,
  onClear,
}: ShipmentDebitRibbonProps) {
  const range = { from: deliveryFrom, to: deliveryTo };
  return (
    <FilterBar
      actions={appliedCount > 0 ? (
        <UUIButton
          className="shipment-debit-ribbon__clear"
          size="sm"
          color="tertiary"
          iconLeading={RotateCcw}
          onPress={onClear}
          aria-label={`Xóa bộ lọc (${appliedCount})`}
        >
          {`Xóa bộ lọc (${appliedCount})`}
        </UUIButton>
      ) : (
        <DisabledActionTip
          id="shipment-debit-clear-filters"
          reason="Chưa có bộ lọc nào để xóa."
        >
          <UUIButton
            className="shipment-debit-ribbon__clear"
            size="sm"
            color="tertiary"
            iconLeading={RotateCcw}
            aria-disabled
            aria-label="Xóa bộ lọc"
            onPress={() => undefined}
          >
            Xóa bộ lọc
          </UUIButton>
        </DisabledActionTip>
      )}
    >
      {/* Owner 2026-10-17: the Khách hàng picker leads the lane — a bar child
          never folds, so the customer axis stays visible at every width. */}
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
      {/* Owner redesign 23/10 (audit #4): the ONE date mechanism — preset
          rail + dual-month calendar in a single popover, auto-apply. */}
      <UnifiedDateRangePicker
        id="shipment-debit-date-range"
        className="shipment-debit-ribbon__range"
        ariaLabel="Khoảng ngày quyết toán"
        value={range}
        onChange={onDeliveryRangeChange}
      />
      {/* The strip's one secondary criterion, correctly spelled, spec'd
          width. Rides as a bar child — it never folds behind `Bộ lọc`. */}
      <InlineLabelSelect
        id="shipment-debit-lock"
        className="shipment-debit-ribbon__lock"
        label="Khóa lô"
        items={LOCK_FILTERS}
        selectedKey={lockStatus}
        onSelectionChange={onLockChange}
        ariaLabel="Trạng thái khóa lô"
      />
    </FilterBar>
  );
}
