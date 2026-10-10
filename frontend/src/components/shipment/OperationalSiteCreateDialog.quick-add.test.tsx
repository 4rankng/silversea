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

  // Verify-fail 091026225600 (round 11): the dialog was still grouped —
  // "ĐIỂM VẬN HÀNH" eyebrow + section (with the customer picker) and
  // "TÊN & ĐỊA CHỈ" section. The user asked for it to be as minimal as the
  // port quick-add ("Thêm cảng / bãi" / PortCreateDialog): a FLAT field
  // stack — no eyebrow, no group headers, no context picker (the intake only
  // opens this dialog with the customer already chosen).
  it('renders flat like the port quick-add — no group headers, no context picker', () => {
    render(<OperationalSiteCreateDialog {...baseProps} isOpen quickAdd />);

    expect(screen.queryByText('Điểm vận hành')).not.toBeInTheDocument();
    expect(screen.queryByText(/Tên & địa chỉ/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Khách hàng/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Tên đầy đủ/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tên ngắn/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Địa chỉ/)).toBeInTheDocument();
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

// Card 20261009_10 (owner ruling 10/10): "Thêm nhà máy" from the intake opened
// the full ĐVVH form, heavier than the warehouse quick-add that shipped
// alongside it. But a factory is NOT the warehouse case — dispatch needs the
// route, so mirroring the 3-field warehouse quick-add verbatim would have been
// wrong. The owner ruled a purposeful SIX fields: full name, short name,
// address, ROUTE, contact name, contact phone. Code stays derived; the
// site-type picker and Google Maps stay on the master-data form.
describe('OperationalSiteCreateDialog factory quick-add (card 20261009_10)', () => {
  const factoryProps = { ...baseProps, defaultSiteType: 'FACTORY' as const };

  it('renders exactly the six purposeful fields for a factory quick-add', () => {
    render(<OperationalSiteCreateDialog {...factoryProps} isOpen quickAdd />);

    expect(screen.getByLabelText(/Tên đầy đủ/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tên ngắn/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Địa chỉ/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tuyến đường/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tên liên hệ/)).toBeInTheDocument();
    expect(screen.getByLabelText(/SĐT liên hệ/)).toBeInTheDocument();

    // The ĐVVH-only inputs stay on the master-data form.
    expect(screen.queryByLabelText(/Mã điểm vận hành/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Loại điểm/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Google Maps/i)).not.toBeInTheDocument();
  });

  it('refuses to create a factory without a route — dispatch needs it', () => {
    render(<OperationalSiteCreateDialog {...factoryProps} isOpen quickAdd />);

    fireEvent.change(screen.getByLabelText(/Tên đầy đủ/), { target: { value: 'Nhà máy ABC' } });
    fireEvent.change(screen.getByLabelText(/Địa chỉ/), { target: { value: 'Số 1, Đường Lớn' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhà máy/ }));

    expect(createOperationalSite).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/tuyến đường/i);
  });

  it('creates the factory with a derived code, the chosen route and the contact', async () => {
    render(<OperationalSiteCreateDialog {...factoryProps} isOpen quickAdd routes={[{ id: 12, name: 'HCM → Hà Nội' }]} />);

    fireEvent.change(screen.getByLabelText(/Tên đầy đủ/), { target: { value: 'Nhà máy ABC' } });
    fireEvent.change(screen.getByLabelText(/Địa chỉ/), { target: { value: 'Số 1, Đường Lớn' } });
    // The route picker is a react-aria combobox, so drive it the way a user
    // does: open the trigger, then press the option. fireEvent.change cannot
    // reach it and would leave the route empty — a false green.
    fireEvent.click(screen.getByRole('button', { name: /Tuyến đường/ }));
    const listbox = await screen.findByRole('listbox');
    const option = Array.from(listbox.querySelectorAll('[role="option"], [data-key]'))
      .find((node) => node.textContent?.includes('HCM'));
    if (!option) throw new Error('route option not found');
    fireEvent.click(option);
    fireEvent.change(screen.getByLabelText(/Tên liên hệ/), { target: { value: 'Chị Lan' } });
    fireEvent.change(screen.getByLabelText(/SĐT liên hệ/), { target: { value: '0900000001' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhà máy/ }));

    await waitFor(() => expect(createOperationalSite).toHaveBeenCalled());
    expect(vi.mocked(createOperationalSite).mock.calls[0]![0]).toMatchObject({
      siteType: 'FACTORY',
      routeId: 12,
      contactName: 'Chị Lan',
      contactPhone: '0900000001',
      name: 'Nhà máy ABC',
      // Mã tự sinh from the name — the intake user never types a code.
      code: 'NHA-MAY-ABC',
    });
    // SEAM PIN (card 20261009_10 rework): the backend treats a DEFINED
    // contacts array as authoritative and rewrites the flat pair from its
    // default entry — an empty array nulls BOTH. Quick-add collects only the
    // flat pair, so its wire payload must omit the key and ride the
    // flat-client branch. Asserted on the serialized body, because
    // JSON.stringify drops undefined keys and that is what reaches the wire.
    const wire = JSON.parse(JSON.stringify(vi.mocked(createOperationalSite).mock.calls[0]![0]));
    expect(wire).not.toHaveProperty('contacts');
  });
});
