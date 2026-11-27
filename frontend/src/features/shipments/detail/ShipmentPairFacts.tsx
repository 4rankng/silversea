import type { ShipmentPairFacts as ShipmentPairFactsModel } from './shipment-pair-facts';
import './ShipmentPairFacts.css';

/**
 * SIL-1020 (KB Ch.3 §3.5 K3.40) — the chi tiết lô PHÂN LOẠI block on the
 * post-create review page: the lot's ONE pair relation ('Đơn' / 'Kẹp' /
 * 'Kết hợp' / 'Lẻ') plus the "tên lô ghép cùng" row while the lot rides an
 * ACTIVE pair. Renders on EVERY viewed lot (the ShipmentLotStatusBlock law —
 * absence is not data); the partner row renders only when a pair exists.
 * Presentation: static text, wrap-never-truncate (design-guidelines §4).
 */
export function ShipmentPairFacts({ facts }: { facts: ShipmentPairFactsModel }) {
  return (
    <section className="shipment-pair-facts" aria-label="Phân loại ghép">
      <div className="shipment-pair-facts__row">
        <span className="shipment-pair-facts__label">PHÂN LOẠI</span>
        <span className="shipment-pair-facts__value">{facts.classificationLabel}</span>
      </div>
      {facts.partnerNames.length > 0 && (
        <div className="shipment-pair-facts__row">
          <span className="shipment-pair-facts__label">Ghép cùng</span>
          <span className="shipment-pair-facts__value">{facts.partnerNames.join(', ')}</span>
        </div>
      )}
    </section>
  );
}
