// Extracted from ShipmentsPage.tsx (card 20260918_D2, structural-debt
// recovery): the advanced-filters region of the CUS workboard toolbar.
// Purely presentational — every value and write-back arrives via props;
// URL params contract unchanged, classnames unchanged (CSS parity pinned
// by the page's styles pins).
import { ShipmentCusBucket, SHIPMENT_CUS_BUCKET_LABELS } from '@tingting/shared';
import { BufferedUuiDateInput, UuiSelectField } from '../design-system';

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
