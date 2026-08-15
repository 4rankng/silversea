import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { DispatchAllocationPopover } from './DispatchAllocationPopover';

vi.mock('../../../api/tripClient', () => ({
  tripClient: {
    getBootstrap: vi.fn().mockResolvedValue({
      externalCarriers: [
        { id: 77, name: 'HÀ AN', isActive: true },
        { id: 88, name: 'Nam Phong', isActive: true },
      ],
    }),
  },
}));

vi.mock('../../../api/shipmentClient', () => ({
  saveShipmentCarrierAllocations: vi.fn(),
}));

import { saveShipmentCarrierAllocations } from '../../../api/shipmentClient';

const shipment = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  version: 4,
  customerName: 'Công ty ABC',
  blNumber: 'BL-2026-001',
  bookingRef: null,
  containerCount20: 2,
  containerCount40: 2,
  containerTypeSummary: '2 * 40HC + 2 * 20DC',
  totalCargoWeightKg: null,
  allocationStatus: 'NOT_ALLOCATED',
  carrierAllocationSummary: [],
  ...overrides,
} as ShipmentListItem);

beforeEach(() => {
  vi.mocked(saveShipmentCarrierAllocations).mockReset();
});

describe('DispatchAllocationPopover', () => {
  it('blocks save on over-allocation (MAX mode)', async () => {
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => screen.getByLabelText(/Nhà xe dòng 1/));

    fireEvent.change(screen.getByLabelText("Số container 20' dòng 1"), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText("Số container 40' dòng 1"), { target: { value: '3' } });

    expect(await screen.findByText(/Container 20' vượt số lượng/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(true);
    expect(saveShipmentCarrierAllocations).not.toHaveBeenCalled();
  });

  it('saves a partial allocation and reports the derived row', async () => {
    const onSaved = vi.fn();
    vi.mocked(saveShipmentCarrierAllocations).mockResolvedValue({
      shipment: { id: 1, version: 5 },
      assignments: [],
    } as never);
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={onSaved} />);

    await waitFor(() => screen.getByLabelText(/Nhà xe dòng 1/));

    fireEvent.change(screen.getByLabelText("Số container 20' dòng 1"), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(saveShipmentCarrierAllocations).toHaveBeenCalledWith(1, expect.objectContaining({
      expectedVersion: 4,
      carrierAllocations: [expect.objectContaining({ carrierType: 'OWN', count20: 1, count40: 0 })],
    }), undefined, 'partial');
    expect(onSaved.mock.calls[0][0].allocationStatus).toBe('PARTIALLY_ALLOCATED');
    // Server's fresh version is propagated so an immediate re-edit doesn't 409.
    expect(onSaved.mock.calls[0][0].version).toBe(5);
  });

  it('reports a retry message on 409 conflict', async () => {
    vi.mocked(saveShipmentCarrierAllocations).mockRejectedValue({ status: 409 });
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => screen.getByLabelText(/Nhà xe dòng 1/));

    fireEvent.change(screen.getByLabelText("Số container 20' dòng 1"), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText("Số container 40' dòng 1"), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByText(/Vui lòng đóng và mở lại/i)).toBeTruthy();
  });

  it('pre-fills rows from existing allocations', async () => {
    render(
      <DispatchAllocationPopover
        shipment={shipment({
          allocationStatus: 'PARTIALLY_ALLOCATED',
          carrierAllocationSummary: [
            { carrierType: 'OWN', externalCarrierId: null, carrierLabel: 'SilverSea', count20: 1, count40: 1 },
          ],
        })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => screen.getByLabelText(/Nhà xe dòng 1/));
    expect((screen.getByLabelText("Số container 20' dòng 1") as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText("Số container 40' dòng 1") as HTMLInputElement).value).toBe('1');
  });

  it('focuses its close control then restores focus to the allocation trigger', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    const rendered = render(
      <DispatchAllocationPopover
        shipment={shipment()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        returnFocusTarget={trigger}
      />,
    );

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Đóng' })));
    rendered.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('flags duplicate vendor rows', async () => {
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => screen.getByLabelText(/Nhà xe dòng 1/));
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhà xe/ }));
    // Second row auto-picks the first unused option (EXTERNAL:77); force it to
    // OWN so it collides with row 1.
    fireEvent.change(screen.getByLabelText(/Nhà xe dòng 2/), { target: { value: 'OWN' } });
    fireEvent.change(screen.getByLabelText("Số container 20' dòng 1"), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText("Số container 40' dòng 2"), { target: { value: '1' } });

    expect(await screen.findByText(/bị lặp/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
