import { SHIPMENT_CUS_BUCKET_LABELS, type ShipmentCusBucket } from '@tingting/shared';
import { formatISODate } from '../../../lib/format';

export function CusFilterSummary({ direction, dateFrom, dateTo, bucket }: {
  direction: string; dateFrom: string; dateTo: string; bucket: string;
}) {
  return (
    <div className="cus-active-filter-summary" aria-label="Điều kiện đang áp dụng">
      {[
        direction && (direction === 'IMPORT' ? 'Nhập' : 'Xuất'),
        dateFrom && `Giao từ ${formatISODate(dateFrom)}`,
        dateTo && `đến ${formatISODate(dateTo)}`,
        bucket && SHIPMENT_CUS_BUCKET_LABELS[bucket as ShipmentCusBucket],
      ].filter(Boolean).join(' · ')}
    </div>
  );
}
