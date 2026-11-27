import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FreightPreviewCard } from './FreightPreviewCard';
import type { ShipmentPricingProjection } from '../../../api/shipmentClient';

vi.mock('../../../hooks/usePricingQueries', () => ({
  useFreightPreview: vi.fn(),
}));

import { useFreightPreview } from '../../../hooks/usePricingQueries';

const mockHook = vi.mocked(useFreightPreview);

const autoResult = {
  source: 'AUTO' as const, freight: 5000000, surcharge: 71744, total: 5071744,
  billedKm: 310, liters: 102.3, sharePct: 2, fuelDelta: 9817.4074,
  formula: 'K = I×(1+2%) + max(0,(G−F)×liters)',
};

type CardProps = Parameters<typeof FreightPreviewCard>[0];

function renderCard(props: Partial<CardProps> = {}) {
  return render(<FreightPreviewCard {...props} />);
}

beforeEach(() => mockHook.mockReset());

describe('FreightPreviewCard', () => {
  it('hides when inputs incomplete', () => {
    mockHook.mockReturnValue({ data: undefined, isPending: false } as never);
    const { container } = renderCard({ customerId: 1 });
    expect(container.querySelector('[data-freight-preview]')).toBeNull();
    expect(mockHook).toHaveBeenCalledWith(null);
  });

  it('hides for ad-hoc shipments (engine bypass)', () => {
    mockHook.mockReturnValue({ data: undefined, isPending: false } as never);
    const { container } = renderCard({ customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10', isAdHoc: true });
    expect(container.querySelector('[data-freight-preview]')).toBeNull();
    expect(mockHook).toHaveBeenCalledWith(null);
  });

  it('renders AUTO formula trace + total', () => {
    mockHook.mockReturnValue({ data: autoResult, isPending: false } as never);
    const { container } = renderCard({ customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10' });
    expect(mockHook).toHaveBeenCalledWith(expect.objectContaining({ customerId: 1, transportDate: '2026-09-10' }));
    expect(container.querySelector('[data-freight-preview="auto"]')).not.toBeNull();
    expect(container.textContent).toContain('Tổng cước thu khách');
    expect(container.textContent).toContain('5.071.744 ₫');
  });

  it('renders the engine reason for a missing base price (15T) — never the old hardcoded line', () => {
    mockHook.mockReturnValue({
      data: { ...autoResult, source: 'MANUAL', freight: 0, surcharge: 0, total: 0, formula: 'Thiếu căn cứ tính cước: thiếu giá gốc theo khối lượng 15T — nhập tay.' },
      isPending: false,
    } as never);
    const { container } = renderCard({ customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10' });
    expect(container.querySelector('[data-freight-preview="manual"]')).not.toBeNull();
    // SIL-933 (KB K1.3) — the gap is named 'Chưa có bảng giá', never a number.
    expect(container.textContent).toContain('Chưa có bảng giá — cần nhập tay');
    expect(container.textContent).toContain('thiếu giá gốc theo khối lượng 15T');
    expect(container.textContent).not.toContain('Thiếu giá gốc — nhập tay');
  });

  it('renders the engine reason for an unconfirmed fuel lag (ASKEY case)', () => {
    mockHook.mockReturnValue({
      data: { ...autoResult, source: 'MANUAL', freight: 0, surcharge: 0, total: 0, formula: 'Thiếu căn cứ phụ phí dầu: độ trễ giá dầu chưa được xác nhận — cần người có thẩm quyền chốt.' },
      isPending: false,
    } as never);
    const { container } = renderCard({ customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10' });
    expect(container.textContent).toContain('độ trễ giá dầu chưa được xác nhận');
    expect(container.textContent).not.toContain('Thiếu giá gốc — nhập tay');
  });

  it('renders the engine reason for an unconfirmed fuel threshold (SUNRISE + SJ case)', () => {
    mockHook.mockReturnValue({
      data: { ...autoResult, source: 'MANUAL', freight: 0, surcharge: 0, total: 0, formula: 'Thiếu căn cứ phụ phí dầu: ngưỡng biến động giá dầu chưa được khách chốt; độ trễ giá dầu chưa được xác nhận — cần người có thẩm quyền chốt.' },
      isPending: false,
    } as never);
    const { container } = renderCard({ customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10' });
    expect(container.textContent).toContain('ngưỡng biến động giá dầu chưa được khách chốt');
    expect(container.textContent).not.toContain('Thiếu giá gốc — nhập tay');
  });

  it('never renders a 0 đ amount in the MANUAL state (PRD CuocPhiPhuPhiDau §5, §11.1)', () => {
    mockHook.mockReturnValue({
      data: { ...autoResult, source: 'MANUAL', freight: 0, surcharge: 0, total: 0, formula: 'Thiếu căn cứ tính cước: thiếu giá gốc theo khối lượng 15T — nhập tay.' },
      isPending: false,
    } as never);
    const { container } = renderCard({ customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10' });
    expect(container.querySelector('[data-freight-preview="manual"]')?.textContent).not.toMatch(/0 đ/);
  });

  it('SIL-1050 (K2.61) — lô hết chuyến sống: không render tổng billable, chỉ dòng lý do trống', () => {
    mockHook.mockReturnValue({ data: autoResult, isPending: false } as never);
    const { container } = renderCard({
      customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10',
      lotHasLiveTrips: false,
    });
    expect(container.textContent).not.toContain('Tổng cước thu khách');
    expect(container.textContent).not.toContain('5.071.744 ₫');
    expect(container.textContent).toContain('Lô không có chuyến đang chạy');
    // The reference quote lines stay (formula + cước gốc), not the whole card.
    expect(container.textContent).toContain('Cước gốc sau chia sẻ');
  });

  it('SIL-1050 — create flow (prop undefined) giữ nguyên tổng billable', () => {
    mockHook.mockReturnValue({ data: autoResult, isPending: false } as never);
    const { container } = renderCard({ customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10' });
    expect(container.textContent).toContain('Tổng cước thu khách');
  });

  // SIL-1089 (K2.24) — chưa đủ điều khoản tính cước: mục cước hiển thị
  // "Chưa xác định" và nêu đúng phần thiếu; con số báo giá không được hiện
  // như số tiền sẵn sàng phát hành cho khách.
  const projection = (overrides: Partial<ShipmentPricingProjection>): ShipmentPricingProjection => ({
    readiness: 'READY',
    message: '',
    missingInput: null,
    freightPrice: null,
    freightSource: null,
    freightFormula: null,
    expectedFuelSurcharge: null,
    expectedFuelLiters: null,
    estimationDate: null,
    breakdown: [],
    ...overrides,
  });

  it('SIL-1089 (K2.24) — projection MISSING_INPUT: "Chưa xác định" + Thiếu loại hàng, KHÔNG hiện con số', () => {
    mockHook.mockReturnValue({ data: autoResult, isPending: false } as never);
    const { container } = renderCard({
      customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10',
      projection: projection({
        readiness: 'MISSING_INPUT',
        message: 'Chọn loại hàng để xem cước LCL dự kiến.',
        missingInput: 'loại hàng',
      }),
    });
    expect(container.querySelector('[data-freight-preview="undefined"]')).not.toBeNull();
    expect(container.textContent).toContain('Chưa xác định');
    expect(container.textContent).toContain('Thiếu loại hàng');
    expect(container.textContent).toContain('Chọn loại hàng để xem cước LCL dự kiến.');
    expect(container.textContent).not.toContain('Cước gốc sau chia sẻ');
    expect(container.textContent).not.toContain('Tổng cước thu khách');
    expect(container.textContent).not.toContain('5.071.744');
  });

  it('SIL-1089 (K2.24) — projection MISSING_AUTHORITY nêu đúng phần thiếu (giá gốc)', () => {
    mockHook.mockReturnValue({ data: autoResult, isPending: false } as never);
    const { container } = renderCard({
      customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10',
      projection: projection({
        readiness: 'MISSING_AUTHORITY',
        message: 'Chưa có bảng giá theo trọng lượng cho tuyến và loại hàng này.',
        missingInput: 'giá gốc',
      }),
    });
    expect(container.textContent).toContain('Chưa xác định');
    expect(container.textContent).toContain('Thiếu giá gốc');
    expect(container.textContent).not.toContain('Cước gốc sau chia sẻ');
  });

  it('SIL-1089 (K2.24) — projection READY (hoặc không có projection) giữ nguyên báo giá', () => {
    mockHook.mockReturnValue({ data: autoResult, isPending: false } as never);
    const { container } = renderCard({
      customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10',
      projection: projection({ message: 'Cước dự kiến được tính theo cấu hình hiện hành.' }),
    });
    expect(container.querySelector('[data-freight-preview="auto"]')).not.toBeNull();
    expect(container.textContent).toContain('Cước gốc sau chia sẻ');
    expect(container.textContent).toContain('5.071.744 ₫');
    expect(container.textContent).not.toContain('Chưa xác định');
  });

  // SIL-1147 — live preview thiếu điều khoản: endpoint trả 200 MISSING_INPUT
  // (hết 400 NaN), card hiển thị đúng block "Chưa xác định" của K2.24.
  it('SIL-1147 — preview MISSING_INPUT (khách hàng): "Chưa xác định" + Thiếu khách hàng, không có số', () => {
    mockHook.mockReturnValue({
      data: { readiness: 'MISSING_INPUT', message: 'Thiếu khách hàng để xem cước dự kiến.', missingInput: 'khách hàng' },
      isPending: false,
    } as never);
    const { container } = renderCard({
      customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10',
    });
    expect(container.querySelector('[data-freight-preview="undefined"]')).not.toBeNull();
    expect(container.textContent).toContain('Chưa xác định');
    expect(container.textContent).toContain('Thiếu khách hàng');
    expect(container.textContent).toContain('Thiếu khách hàng để xem cước dự kiến.');
    expect(container.textContent).not.toContain('Cước gốc sau chia sẻ');
    expect(container.textContent).not.toContain('5.071.744');
  });

  it('SIL-1147 — projection READY khi preview MISSING_INPUT: projection thắng, giữ block thiếu', () => {
    mockHook.mockReturnValue({
      data: { readiness: 'MISSING_INPUT', message: 'Thiếu tuyến đường để xem cước dự kiến.', missingInput: 'tuyến đường' },
      isPending: false,
    } as never);
    const { container } = renderCard({
      customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10',
      projection: projection({
        readiness: 'MISSING_INPUT',
        message: 'Chọn loại hàng để xem cước LCL dự kiến.',
        missingInput: 'loại hàng',
      }),
    });
    expect(container.textContent).toContain('Thiếu loại hàng');
    expect(container.textContent).toContain('Chọn loại hàng để xem cước LCL dự kiến.');
    expect(container.textContent).not.toContain('Thiếu tuyến đường');
  });
});
