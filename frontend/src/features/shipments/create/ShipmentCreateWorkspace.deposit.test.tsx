import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, quickCreateShipment } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  quickCreateShipment: vi.fn(),
}));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../../../api/shipmentClient', () => ({
  quickCreateShipment,
  getShipmentDetail: vi.fn(),
  createShipmentDeclaration: vi.fn(),
  updateShipment: vi.fn(),
  updateShipmentDeclaration: vi.fn(),
  saveShipmentContainers: vi.fn(),
  submitShipmentForDispatch: vi.fn(),
}));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));

import { ToastProvider } from '../../../components/shared/Toast';
import {
  EMPTY_SHIPMENT_CREATE_FORM,
  buildShipmentRootPayload,
  formatVnMoney,
} from './shipment-create-model';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/shipments/new']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentCreateWorkspace />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('formatVnMoney (card 20260922_6)', () => {
  it('dots thousands and strips non-digits', () => {
    expect(formatVnMoney('5000000')).toBe('5.000.000');
    expect(formatVnMoney('5.000.000')).toBe('5.000.000');
    expect(formatVnMoney('abc')).toBe('');
    expect(formatVnMoney('0')).toBe('0');
  });
});

describe('buildShipmentRootPayload deposit fields (card 20260922_6)', () => {
  it('ticked with amount sends hasDeposit true + coerced amount', () => {
    const form = { ...EMPTY_SHIPMENT_CREATE_FORM, hasDeposit: true, depositAmount: '5.000.000' };
    const payload = buildShipmentRootPayload(form, [], []);
    expect(payload.hasDeposit).toBe(true);
    expect(payload.depositAmount).toBe(5000000);
  });

  it('unticked sends hasDeposit false and null amount', () => {
    const payload = buildShipmentRootPayload({ ...EMPTY_SHIPMENT_CREATE_FORM }, [], []);
    expect(payload.hasDeposit).toBe(false);
    expect(payload.depositAmount).toBeNull();
  });

  it('ticked without amount sends null amount', () => {
    const form = { ...EMPTY_SHIPMENT_CREATE_FORM, hasDeposit: true };
    const payload = buildShipmentRootPayload(form, [], []);
    expect(payload.hasDeposit).toBe(true);
    expect(payload.depositAmount).toBeNull();
  });
});

describe('deposit toggle (render, card 20260922_6)', () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getBootstrap.mockResolvedValue({ customers: [{ id: 1, name: 'KH A' }], routes: [] });
  });

  it('ticking shows the expected-amount field; unticking hides it', async () => {
    renderWorkspace();
    const toggle = await screen.findByText('Có cược container');
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByLabelText('Tiền cược dự kiến')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Có cược container'));
    await waitFor(() => {
      expect(screen.queryByLabelText('Tiền cược dự kiến')).toBeNull();
    });
  });
});
