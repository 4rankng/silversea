import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FreightPreviewCard } from './FreightPreviewCard';

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
    expect(container.textContent).toContain('5.071.744 đ');
  });

  it('renders MANUAL state text', () => {
    mockHook.mockReturnValue({ data: { ...autoResult, source: 'MANUAL' }, isPending: false } as never);
    const { container } = renderCard({ customerId: 1, routeId: 2, vehicleSizeClassCode: 'CONT40', transportDate: '2026-09-10' });
    expect(container.querySelector('[data-freight-preview="manual"]')).not.toBeNull();
    expect(container.textContent).toContain('Thiếu giá gốc — nhập tay');
  });
});
