import { useFreightPreview } from '../../../hooks/usePricingQueries';
import { isFreightPreviewMissing, type FreightPreviewInput } from '../../../api/pricingClient';
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

  // SIL-1089 (K2.24) — chưa đủ điều khoản tính cước → "Chưa xác định" + nêu
  // đúng phần thiếu, BEFORE the input/hidden checks: the saved lot's
  // projection outranks any live preview answer. SIL-1147 — the LIVE preview
  // itself now answers the same contract (a missing pricing term is a 200
  // MISSING_INPUT body, never the NaN 400), so both sources render the
  // identical gap block with no computed money anywhere in it.
  const gapBlock = (gap: { message: string; missingInput?: string | null }) => (
    <div data-freight-preview="undefined"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 'var(--text-data-size)', color: 'var(--ink-2)' }}>
      <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Chưa xác định</div>
      {gap.missingInput ? (
        <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)' }}>Thiếu {gap.missingInput}</div>
      ) : null}
      <div style={{ fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)' }}>{gap.message}</div>
    </div>
  );
  if (projection && projection.readiness !== 'READY') {
    return gapBlock(projection);
  }
  if (data && isFreightPreviewMissing(data)) {
    return gapBlock(data);
  }

  if (!input) {
    // SIL-1145 (KB Ch.10 §10.6.6 — "Thiếu đầu vào: thông báo ghi rõ thiếu ở
    // giá gốc / ngày / độ trễ giá dầu / ngưỡng / kỳ giá; ô cước không hiện
    // 0"): an incomplete form renders the gap notice IN the cước slot (grid
    // row 3, giữa 'Nhận diện lô' và 'Thông tin hàng') — naming each missing
    // input, never a blank strip and never a computed 0. The pricing-TERM
    // gaps (giá gốc / độ trễ giá dầu / ngưỡng / kỳ giá) are named by the
    // MISSING_INPUT bodies above; the missing FORM grounds are named here.
    // Lệnh chạy ngoài keeps its no-engine contract (docx §2-D: cước nhập tay
    // theo giá khách báo) — the card stays hidden for ad-hoc.
    if (isAdHoc) return null;
    const missingInputs = [
      customerId ? null : 'Khách hàng',
      routeId ? null : 'Tuyến đường',
      vehicleSizeClassCode ? null : 'Loại xe tính cước',
      transportDate ? null : 'Ngày vận chuyển',
    ].filter((item): item is string => item != null);
    return gapBlock({ message: `Thiếu đầu vào: ${missingInputs.join(', ')}.` });
  }
  if (isPending) return null;
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
      {/* SIL-1303 — công thức nội bộ (trace '… × (1 + 2.00%) = … + MAX(0,…)
          → làm tròn 4 số = …') KHÔNG được lộ ra giao diện: chỉ số tiền kết
          quả với nhãn giải thích bằng lời ('Cước gốc sau chia sẻ', 'Phụ phí
          dầu chênh lệch'). (Dòng formula của MANUAL giữ nguyên — đó là lý do
          bằng lời, không phải công thức.) */}
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
