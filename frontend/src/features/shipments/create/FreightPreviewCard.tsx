import { useFreightPreview } from '../../../hooks/usePricingQueries';
import type { FreightPreviewInput } from '../../../api/pricingClient';
import type { ShipmentPricingProjection } from '../../../api/shipmentClient';
import { formatCurrency } from '../../../lib/format';



/**
 * Live freight preview for the CUS create workspace.
 *
 * Renders only when enough fields are chosen (customer + route + size class
 * + transport date) and hides itself on fetch errors — pricing gaps must
 * never block creation. `isAdHoc` bypasses the engine entirely (docx §2-D:
 * ad-hoc runs outside the pricing engine).
 */
export function FreightPreviewCard({
  customerId, routeId, vehicleSizeClassCode, transportDate, isAdHoc, lotHasLiveTrips, projection,
}: {
  customerId?: number;
  routeId?: number;
  vehicleSizeClassCode?: string;
  transportDate?: string;
  isAdHoc?: boolean;
  /** SIL-1050 (K2.61) — existing-lot edit mode: false = the lot holds NO
   *  live trip (hủy phân xe / chưa phân xe). The billable "Tổng cước thu
   *  khách" must not present itself for work that is not running — the
   *  quote lines stay as reference, the total row reads trống with the
   *  reason. undefined = create flow, behaves exactly as before. */
  lotHasLiveTrips?: boolean;
  /** SIL-1089 (K2.24) — the SAVED lot's pricing projection (view/edit mode;
   *  undefined in create flow). While it reports the pricing terms are
   *  incomplete, the block reads "Chưa xác định" + the missing part instead
   *  of any computed quote — the lot saves fine but no money is presented as
   *  issuable to the customer. */
  projection?: ShipmentPricingProjection | null;
}) {
  const input: FreightPreviewInput | null =
    customerId && routeId && vehicleSizeClassCode && transportDate && !isAdHoc
      ? { customerId, routeId, vehicleSizeClassCode, transportDate }
      : null;
  const { data, isPending } = useFreightPreview(input);

  // SIL-1089 (K2.24): chưa đủ điều khoản tính cước → "Chưa xác định" + nêu
  // đúng phần thiếu, BEFORE the input/hidden checks — the gap disclosure is
  // the correct display even when the live preview has no data to show.
  if (projection && projection.readiness !== 'READY') {
    return (
      <div data-freight-preview="undefined"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 'var(--text-data-size)', color: 'var(--ink-2)' }}>
        <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Chưa xác định</div>
        {projection.missingInput ? (
          <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)' }}>Thiếu {projection.missingInput}</div>
        ) : null}
        <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)' }}>{projection.message}</div>
      </div>
    );
  }

  if (!input || isPending) return null;
  if (!data) return null;

  if (data.source === 'MANUAL') {
    return (
      <div data-freight-preview="manual"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 'var(--text-data-size)', color: 'var(--ink-2)' }}>
        {/* SIL-933 (KB K1.3) — the law names the gap 'Chưa có bảng giá': no
            invented number, the engine's formula line carries the reason. */}
        <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Chưa có bảng giá — cần nhập tay</div>
        {/* Owner density principle (11/10): the formula is a helper fact, not a
            message — caption size, one line. */}
        <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)' }}>{data.formula}</div>
      </div>
    );
  }

  return (
    <div data-freight-preview="auto"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 'var(--text-data-size)' }}>
      <div style={{ fontFamily: 'var(--font-data)', color: 'var(--ink-2)', marginBottom: 6 }}>{data.formula}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--ink-2)' }}>Cước gốc sau chia sẻ</span>
        <span style={{ fontFamily: 'var(--font-data)' }}>{formatCurrency(data.freight)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--ink-2)' }}>Phụ phí dầu chênh lệch</span>
        <span style={{ fontFamily: 'var(--font-data)' }}>{formatCurrency(data.surcharge)}</span>
      </div>
      {lotHasLiveTrips === false ? (
        // SIL-1050 (K2.61) — chân đã hủy không tính cước: no billable total
        // for a lot without a live trip (trống), only the reference quote.
        <div style={{ marginTop: 4, color: 'var(--ink-3)' }}>
          Lô không có chuyến đang chạy — cước chưa chốt, không tính tổng
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 4 }}>
          <span>Tổng cước thu khách</span>
          <span style={{ fontFamily: 'var(--font-data)' }}>{formatCurrency(data.total)}</span>
        </div>
      )}
    </div>
  );
}
