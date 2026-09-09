import { useFreightPreview } from '../../../hooks/usePricingQueries';
import type { FreightPreviewInput } from '../../../api/pricingClient';

const vnd = (n: number) => n.toLocaleString('vi-VN');

/**
 * Live freight preview for the CUS create workspace.
 *
 * Renders only when enough fields are chosen (customer + route + size class
 * + transport date) and hides itself on fetch errors — pricing gaps must
 * never block creation. `isAdHoc` bypasses the engine entirely (docx §2-D:
 * ad-hoc runs outside the pricing engine).
 */
export function FreightPreviewCard({
  customerId, routeId, vehicleSizeClassCode, transportDate, isAdHoc,
}: {
  customerId?: number;
  routeId?: number;
  vehicleSizeClassCode?: string;
  transportDate?: string;
  isAdHoc?: boolean;
}) {
  const input: FreightPreviewInput | null =
    customerId && routeId && vehicleSizeClassCode && transportDate && !isAdHoc
      ? { customerId, routeId, vehicleSizeClassCode, transportDate }
      : null;
  const { data, isPending } = useFreightPreview(input);

  if (!input || isPending) return null;
  if (!data) return null;

  if (data.source === 'MANUAL') {
    return (
      <div data-freight-preview="manual"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--ink-2)' }}>
        Thiếu giá gốc — nhập tay
      </div>
    );
  }

  return (
    <div data-freight-preview="auto"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
      <div style={{ fontFamily: 'var(--font-data)', color: 'var(--ink-2)', marginBottom: 6 }}>{data.formula}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--ink-2)' }}>Cước gốc sau chia sẻ</span>
        <span style={{ fontFamily: 'var(--font-data)' }}>{vnd(data.freight)} đ</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--ink-2)' }}>Phụ phí dầu chênh lệch</span>
        <span style={{ fontFamily: 'var(--font-data)' }}>{vnd(data.surcharge)} đ</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 4 }}>
        <span>Tổng cước thu khách</span>
        <span style={{ fontFamily: 'var(--font-data)' }}>{vnd(data.total)} đ</span>
      </div>
    </div>
  );
}
