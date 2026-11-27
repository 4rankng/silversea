import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickAssignCarrierModal } from './QuickAssignCarrierModal';
import { listDispatchFleetResources, type DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

// HOT-04 (CR-011.2) — the modal's own contract pins: the carrier catalog is
// SilverSea (Xe nhà) + the EXTERNAL_CARRIER list, a plate is OPTIONAL on both
// sides (an external save with a blank plate rides plateNumber null; an OWN
// save with no truck rides truckId null — 'Chờ chọn xe'), and a typed plate
// uppercases before it rides the wire.

vi.mock('../../../api/dispatchPlanningClient', () => ({
  listDispatchFleetResources: vi.fn(),
}));

const fleetResources = vi.mocked(listDispatchFleetResources);

/** A minimal CursorPaginatedResponse body — the client's catalog contract. */
function catalogPage<T>(items: T[]) {
  return { items, total: items.length, limit: items.length || 1, nextCursor: null };
}

const twoRows = [{}, {}] as DispatchDetailPlanRow[];

function renderModal() {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(<QuickAssignCarrierModal open rows={twoRows} saving={false} onClose={vi.fn()} onConfirm={onConfirm} />);
  return { onConfirm };
}

async function pickCarrier(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Chọn SilverSea hoặc nhà thầu ngoài' }));
  fireEvent.click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // The catalog union is strict; the modal only reads items' id/name/plate —
  // a loose stub cast to the client's signature is the honest mock here.
  fleetResources.mockImplementation(((resource: string) => {
    if (resource === 'EXTERNAL_CARRIER') return Promise.resolve(catalogPage([{ id: 77, name: 'KHÁCH TỰ VC' }]));
    if (resource === 'TRUCK') return Promise.resolve(catalogPage([{ id: 51, licensePlate: '51H-123.45' }]));
    return Promise.resolve(catalogPage([]));
  }) as unknown as typeof listDispatchFleetResources);
});

describe('QuickAssignCarrierModal — HOT-04 modal contract', () => {
  it('renders the SilverSea + external carrier catalog', async () => {
    renderModal();
    fireEvent.click(await screen.findByRole('button', { name: 'Chọn SilverSea hoặc nhà thầu ngoài' }));
    expect(await screen.findByRole('option', { name: 'SilverSea (Xe nhà)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'KHÁCH TỰ VC' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await screen.findByRole('button', { name: 'Lưu gán xe' });
  });

  it('saves an external carrier with a BLANK plate as plateNumber null', async () => {
    const { onConfirm } = renderModal();
    await pickCarrier('KHÁCH TỰ VC');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu gán xe' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toEqual({
      carrierType: 'EXTERNAL',
      externalCarrierId: 77,
      truckId: null,
      plateNumber: null,
    });
  });

  it('saves SilverSea with no truck as the carrier-only allocation (Chờ chọn xe)', async () => {
    const { onConfirm } = renderModal();
    await pickCarrier('SilverSea (Xe nhà)');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu gán xe' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toEqual({
      carrierType: 'OWN',
      externalCarrierId: null,
      truckId: null,
      plateNumber: null,
    });
  });

  it('uppercases a typed external plate before it rides the wire', async () => {
    const { onConfirm } = renderModal();
    await pickCarrier('KHÁCH TỰ VC');
    const plate = screen.getByPlaceholderText('Để trống nếu chỉ gán nhà xe trước');
    fireEvent.change(plate, { target: { value: '51a-123.45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu gán xe' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ carrierType: 'EXTERNAL', externalCarrierId: 77, plateNumber: '51A-123.45' });
  });
});
