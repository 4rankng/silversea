import {
  SHIPMENT_LOT_STATUS_LABELS,
  ShipmentLotStatus,
  type ShipmentLotStatusEntry,
  type ShipmentLotStatusSummary,
} from '@tingting/shared';

/**
 * SIL-1095 (KB §1.4.3, K1.13) — the chi tiết lô status block. Five SEPARATE
 * lanes (Ghi nhận chi phí · Thiếu chứng từ · Hoàn thành vận chuyển · Đã
 * thanh toán · Đã khóa kỳ), each derived by the BE from its own existing
 * facts — never merged into one summary state, and the block ALWAYS renders
 * all five rows (QA: lô 167 showed no status area at all). A lane the wire
 * does not carry (stale deployment) renders its state as '—' — absence is
 * not data, and the region never vanishes.
 *
 * Presentation: text + house color-dot (design-guidelines §1/§2), wrap
 * without truncate (§4), static text — never fakes a control.
 */

const DOT_TONE_CLASS: Record<ShipmentLotStatusEntry['tone'], string> = {
  ok: 'lot-status-dot--ok',
  warn: 'lot-status-dot--warn',
  danger: 'lot-status-dot--danger',
  neutral: 'lot-status-dot--neutral',
};

const KB_ORDER: readonly ShipmentLotStatus[] = [
  ShipmentLotStatus.GHI_NHAN_CHI_PHI,
  ShipmentLotStatus.THIEU_CHUNG_TU,
  ShipmentLotStatus.HOAN_THANH_VAN_CHUYEN,
  ShipmentLotStatus.DA_THANH_TOAN,
  ShipmentLotStatus.DA_KHOA_KY,
];

export function ShipmentLotStatusBlock({ statusSummary }: { statusSummary?: ShipmentLotStatusSummary }) {
  const entryByStatus = new Map<ShipmentLotStatus, ShipmentLotStatusEntry>(
    (statusSummary?.entries ?? []).map((item) => [item.status, item]),
  );
  return (
    <section className="shipment-lot-status" aria-label="Trạng thái lô">
      {KB_ORDER.map((status) => {
        const entry = entryByStatus.get(status);
        const state = entry?.state ?? '—';
        return (
          <div key={status} className="shipment-lot-status__row">
            <span
              className={`shipment-lot-status__dot ${DOT_TONE_CLASS[entry?.tone ?? 'neutral']}`}
              aria-hidden="true"
            />
            <span className="shipment-lot-status__label">{SHIPMENT_LOT_STATUS_LABELS[status]}</span>
            <span className="shipment-lot-status__state">{state}</span>
            {entry?.detail != null && (
              <span className="shipment-lot-status__detail">{entry.detail}</span>
            )}
          </div>
        );
      })}
    </section>
  );
}
