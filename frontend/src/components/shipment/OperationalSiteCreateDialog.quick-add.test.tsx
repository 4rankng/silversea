import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { OperationalSite } from '../../api/shipmentClient';

vi.mock('../../api/shipmentClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/shipmentClient')>('../../api/shipmentClient');
  return {
    ...actual,
    createOperationalSite: vi.fn(async () => ({ id: 501, name: 'Kho Sóng Thần' }) as OperationalSite),
  };
});

import { OperationalSiteCreateDialog } from './OperationalSiteCreateDialog';
import { createOperationalSite } from '../../api/shipmentClient';

const baseProps = {
  customerId: 7,
  defaultSiteType: 'WAREHOUSE' as const,
  routes: [],
  onClose: vi.fn(),
  onCreated: vi.fn(),
};

beforeEach(() => {
  vi.mocked(createOperationalSite).mockClear();
  baseProps.onCreated.mockClear();
  baseProps.onClose.mockClear();
});

// FB-077 (card 091026180600): the CUS intake "Thêm kho lấy hàng" modal is a
// QUICK-ADD — three basic fields only, code derived, everything ĐVVH-heavy
// (mã, loại điểm, tuyến, liên hệ, Google Maps) stays on the master-data form.
describe('OperationalSiteCreateDialog quick-add mode', () => {
  it('renders only the three basic fields for a warehouse quick-add', () => {
    render(<OperationalSiteCreateDialog {...baseProps} isOpen quickAdd />);

    expect(screen.getByLabelText(/Tên đầy đủ/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tên ngắn/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Địa chỉ/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Mã điểm vận hành/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Loại điểm/)).not.toBeInTheDocument();
    expect(screen.queryByText('Liên hệ')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Google Maps/)).not.toBeInTheDocument();
  });

  it('creates the site with a derived code and short-name fallback', async () => {
    render(<OperationalSiteCreateDialog {...baseProps} isOpen quickAdd />);
    fireEvent.change(screen.getByLabelText(/Tên đầy đủ/), { target: { value: 'Kho Sóng Thần' } });
    fireEvent.change(screen.getByLabelText(/Địa chỉ/), { target: { value: '27 Nguyễn Ái Quốc, Dĩ An' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm kho' }));

    await waitFor(() => expect(createOperationalSite).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createOperationalSite).mock.calls[0][0];
    // Code derives from the folded, uppercased name — the user never types one.
    expect(payload.code).toBe('KHO-SONG-THAN');
    // Blank short-name falls back to the full name (BE takes it optional).
    expect(payload.shortName).toBe('Kho Sóng Thần');
    expect(payload.siteType).toBe('WAREHOUSE');
    expect(payload.address).toBe('27 Nguyễn Ái Quốc, Dĩ An');
    await waitFor(() => expect(baseProps.onCreated).toHaveBeenCalled());
  });

  it('keeps the full operational-site form for the master-data caller (no quickAdd)', () => {
    render(<OperationalSiteCreateDialog {...baseProps} isOpen />);
    expect(screen.getByLabelText(/Mã điểm vận hành/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Loại điểm/)).toBeInTheDocument();
    expect(screen.getByText('Liên hệ')).toBeInTheDocument();
  });
});
