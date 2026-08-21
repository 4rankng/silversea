import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerFormModal } from './CustomersPage';
import { RouteFormModal } from './config/route-form-modal';
import { OperationalSiteCreateDialog } from '../components/shipment/OperationalSiteCreateDialog';

const { createOperationalSite } = vi.hoisted(() => ({ createOperationalSite: vi.fn() }));

vi.mock('../api/shipmentClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/shipmentClient')>();
  return { ...original, createOperationalSite };
});

describe('master-data full and short name forms', () => {
  beforeEach(() => {
    createOperationalSite.mockReset();
  });

  it('submits both customer names', () => {
    const onsave = vi.fn();
    render(<CustomerFormModal isOpen saving={false} suppliers={[]} onsave={onsave} oncancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/^Tên đầy đủ/), { target: { value: 'Công ty Cổ phần Biển Bạc Việt Nam' } });
    fireEvent.change(screen.getByLabelText(/^Tên ngắn/), { target: { value: 'Biển Bạc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm khách hàng' }));

    expect(onsave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Công ty Cổ phần Biển Bạc Việt Nam',
      shortName: 'Biển Bạc',
    }));
  });

  it('submits both route names', () => {
    const onsave = vi.fn();
    render(<RouteFormModal isOpen saving={false} onsave={onsave} oncancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/^Tên đầy đủ/), { target: { value: 'Cảng Hải Phòng - Nhà máy Biển Bạc tại Bắc Ninh' } });
    fireEvent.change(screen.getByLabelText(/^Tên ngắn/), { target: { value: 'HP - Biển Bạc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm tuyến' }));

    expect(onsave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Cảng Hải Phòng - Nhà máy Biển Bạc tại Bắc Ninh',
      shortName: 'HP - Biển Bạc',
    }));
  });

  it('submits both factory names', async () => {
    createOperationalSite.mockResolvedValue({
      id: 1,
      customerId: 7,
      code: 'BB-BN',
      name: 'Nhà máy Công ty Cổ phần Biển Bạc tại Bắc Ninh',
      shortName: 'Biển Bạc BN',
      siteType: 'FACTORY',
      routeId: 11,
      address: 'Bắc Ninh',
      googleMapsUrl: null,
      contactName: null,
      contactPhone: null,
      liftFeeInvoiceName: null,
      liftFeeInvoiceAddress: null,
      liftFeeTaxCode: null,
      strictRules: null,
      version: 1,
    });
    render(<OperationalSiteCreateDialog isOpen customerId={7} routes={[{ id: 11, name: 'Cảng Hải Phòng - Biển Bạc Bắc Ninh' }]} onClose={vi.fn()} onCreated={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Thêm nhà máy' });

    fireEvent.change(within(dialog).getByLabelText('Mã điểm vận hành'), { target: { value: 'BB-BN' } });
    fireEvent.change(within(dialog).getByLabelText('Tên đầy đủ'), { target: { value: 'Nhà máy Công ty Cổ phần Biển Bạc tại Bắc Ninh' } });
    fireEvent.change(within(dialog).getByLabelText('Tên ngắn'), { target: { value: 'Biển Bạc BN' } });
    fireEvent.change(within(dialog).getByLabelText('Địa chỉ'), { target: { value: 'Bắc Ninh' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Tuyến đường/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Cảng Hải Phòng - Biển Bạc Bắc Ninh' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm nhà máy' }));

    await waitFor(() => expect(createOperationalSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Nhà máy Công ty Cổ phần Biển Bạc tại Bắc Ninh',
      shortName: 'Biển Bạc BN',
      routeId: 11,
    })));
  });
});
