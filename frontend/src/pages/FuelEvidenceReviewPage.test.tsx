import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import FuelEvidenceReviewPage from './FuelEvidenceReviewPage';

vi.mock('../api/fuelEvidenceClient', () => ({
  fuelEvidenceClient: {
    list: vi.fn().mockResolvedValue({ items: [{
      id: 1, tripId: 9, tripCode: 'OCR-TEST', ownerName: 'Tài xế',
      photoUrl: '/api/photos/pump.jpg', capturedAt: '2026-09-15T00:00:00Z',
      reviewStatus: 'PENDING', reviewRequired: true, ocrOutcome: 'ANOMALY',
      litres: '20', unitPrice: '25000', totalAmount: '600000', computedTotal: '500000',
      anomalyReason: 'Tổng tiền không khớp',
    }], total: 1, page: 1, limit: 20 }),
  },
}));

describe('fuel OCR evidence without approval', () => {
  it('keeps saved evidence and uncertainty visible without a decision action', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><FuelEvidenceReviewPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('OCR-TEST')).toBeTruthy();
    expect(screen.getByAltText('Ảnh nhiên liệu OCR-TEST')).toBeTruthy();
    expect(screen.getByText(/Số liệu OCR chưa xác minh/)).toBeTruthy();
    expect(screen.getByText(/Tổng tiền không khớp/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Xác nhận|Từ chối|Duyệt/ })).toBeNull();
    expect(screen.queryByText(/Kế toán phải/)).toBeNull();
    client.clear();
  });
});
