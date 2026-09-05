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
import { tripClient } from '../../../api/tripClient';

const bootstrap = {
  externalCarriers: [
    { id: 77, name: 'HÀ AN', isActive: true },
    { id: 88, name: 'Nam Phong', isActive: true },
  ],
};

const shipment = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  version: 4,
  customerName: 'Công ty ABC',
  blNumber: 'BL-2026-001',
  bookingRef: null,
  containerCount20: 2,
  containerCount40: 2,
  containerTypeSummary: '2 x 40HC + 2 x 20DC',
  totalCargoWeightKg: null,
  allocationStatus: 'NOT_ALLOCATED',
  carrierAllocationSummary: [],
  ...overrides,
} as ShipmentListItem);

beforeEach(() => {
  vi.mocked(saveShipmentCarrierAllocations).mockReset();
  vi.mocked(tripClient.getBootstrap).mockReset();
  vi.mocked(tripClient.getBootstrap).mockResolvedValue(bootstrap as never);
});

describe('DispatchAllocationPopover', () => {
  it('does not flag an untouched 0/0 row as an error', async () => {
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => screen.getByLabelText(/Nhà xe dòng 1/));

    // A row nobody has filled in yet (e.g. the default own-fleet row when the
    // whole shipment ends up going to an external carrier) isn't an error —
    // it just isn't participating in the allocation (regression: this used
    // to hard-block "Thêm nhà xe" flows with a misleading own-fleet message).
    expect(screen.queryByText(/phải có ít nhất một số lượng/)).toBeNull();
    expect(screen.getByLabelText("Số container 20' dòng 1")).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText("Số container 40' dòng 1")).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('saves an external-only allocation, leaving the default own-fleet row untouched (regression)', async () => {
    const onSaved = vi.fn();
    vi.mocked(saveShipmentCarrierAllocations).mockResolvedValue({
      shipment: { id: 1, version: 5 },
      assignments: [],
    } as never);
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={onSaved} />);

    await waitFor(() => screen.getByLabelText(/Nhà xe dòng 1/));
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhà xe/ }));
    await waitFor(() => screen.getByLabelText(/Nhà xe dòng 2/));
    fireEvent.change(screen.getByLabelText("Số container 20' dòng 2"), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText("Số container 40' dòng 2"), { target: { value: '2' } });

    expect((screen.getByRole('button', { name: 'Lưu phân bổ' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân bổ' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // The untouched OWN row must not be sent — the backend rejects a carrier
    // with zero containers.
    expect(saveShipmentCarrierAllocations).toHaveBeenCalledWith(1, expect.objectContaining({
      carrierAllocations: [expect.objectContaining({ carrierType: 'EXTERNAL', externalCarrierId: 77, count20: 2, count40: 2 })],
    }), undefined, 'partial');
  });

  it('blocks save on over-allocation (MAX mode)', async () => {
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => screen.getByLabelText(/Nhà xe dòng 1/));

    fireEvent.change(screen.getByLabelText("Số container 20' dòng 1"), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText("Số container 40' dòng 1"), { target: { value: '3' } });

    expect(await screen.findByText(/Container 20' vượt số lượng/)).toBeTruthy();
    expect(screen.getByText("Tổng đang vượt 1 container 20'.")).toBeTruthy();
    expect(screen.getByText("Tổng đang vượt 1 container 40'.")).toBeTruthy();
    expect(screen.getByLabelText("Số container 20' dòng 1")).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText("Số container 40' dòng 1")).toHaveAttribute('aria-invalid', 'true');
    expect((screen.getByRole('button', { name: 'Lưu phân bổ' }) as HTMLButtonElement).disabled).toBe(true);
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
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân bổ' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân bổ' }));

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
    fireEvent.click(screen.getByLabelText(/Nhà xe dòng 2/));
    fireEvent.click(screen.getByRole('option', { name: 'Đội xe nội bộ SilverSea' }));
    fireEvent.change(screen.getByLabelText("Số container 20' dòng 1"), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText("Số container 40' dòng 2"), { target: { value: '1' } });

    expect(await screen.findByText(/bị lặp/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu phân bổ' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('labels every decision field and distinguishes a valid partial allocation from an error', async () => {
    const { container } = render(
      <DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).not.toBeDisabled());

    expect(screen.getByText('Nhu cầu')).toBeTruthy();
    expect(screen.getByText('Đã phân')).toBeTruthy();
    expect(screen.getByText('Phân bổ theo nhà xe')).toBeTruthy();
    expect(screen.getByText("Container 20'")).toBeTruthy();
    expect(screen.getByText("Container 40'")).toBeTruthy();
    expect(screen.getByText(/Có thể lưu khi chưa phân đủ/)).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Tổng số container đã phân bổ' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Số container 20' dòng 1"), { target: { value: '1' } });

    expect(await screen.findByText(/Có thể lưu phân bổ hiện tại và bổ sung sau/)).toBeTruthy();
    expect(container.querySelector('.dispatch-allocation-popover__summary.is-partial')).toBeTruthy();
    expect(container.querySelector('.dispatch-allocation-popover__summary.is-error')).toBeNull();
    expect((screen.getByRole('button', { name: 'Lưu phân bổ' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('moves focus into a newly added carrier row', async () => {
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhà xe/ }));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Nhà xe dòng 2/)));
  });

  it('makes carrier-loading failure explicit and allows retry', async () => {
    vi.mocked(tripClient.getBootstrap).mockRejectedValueOnce(new Error('bootstrap unavailable'));
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(await screen.findByText(/Không tải được danh sách nhà xe ngoài/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));

    await waitFor(() => expect(screen.queryByText(/Không tải được danh sách nhà xe ngoài/)).toBeNull());
    fireEvent.click(screen.getByLabelText(/Nhà xe dòng 1/));
    expect(screen.getByRole('option', { name: 'HÀ AN' })).toBeTruthy();
  });

  it('lists every active external carrier alongside OWN so the user can pick any vendor', async () => {
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).not.toBeDisabled());
    fireEvent.click(screen.getByLabelText(/Nhà xe dòng 1/));

    expect(screen.getByRole('option', { name: 'Đội xe nội bộ SilverSea' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'HÀ AN' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Nam Phong' })).toBeTruthy();
    // No warning when external carriers exist — the empty-state copy must not
    // surface alongside a healthy catalog.
    expect(screen.queryByText(/Chưa có nhà xe ngoài nào được cấu hình/)).toBeNull();
  });

  it('adds a second row pre-populated with an external carrier and lets the user pick it', async () => {
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).not.toBeDisabled());
    // Before adding a row, "Thêm nhà xe" must be enabled — proves at least one
    // external carrier was available to be picked as a fresh row.
    expect((screen.getByRole('button', { name: /Thêm nhà xe/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhà xe/ }));

    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 2/)).toBeInTheDocument());
    // Row 2 auto-picks the first unused active option, which is EXTERNAL:77 (HÀ AN).
    fireEvent.click(screen.getByLabelText(/Nhà xe dòng 2/));
    await waitFor(() => expect(screen.getByRole('option', { name: 'HÀ AN' })).toBeInTheDocument());
  });

  it('warns the user when bootstrap returns zero external carriers so it is not mistaken for a bug', async () => {
    vi.mocked(tripClient.getBootstrap).mockResolvedValue({ externalCarriers: [] } as never);
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).not.toBeDisabled());
    // Empty-state notice surfaces without opening the dropdown so we can still
    // assert the "Thêm nhà xe" button state in the same view.
    expect(screen.getByTestId('carrier-allocation-empty-externals')).toBeTruthy();
    expect(screen.getByText(/Chưa có nhà xe ngoài nào được cấu hình/)).toBeTruthy();
    expect(screen.getByText(/Quản trị viên/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Thêm nhà xe/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(/Nhà xe dòng 1/));
    expect(screen.getByRole('option', { name: 'Đội xe nội bộ SilverSea' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'HÀ AN' })).toBeNull();
  });

  it('hides the empty-externals notice once the dispatcher enters a valid OWN allocation (regression 2026-09-05)', async () => {
    vi.mocked(tripClient.getBootstrap).mockResolvedValue({ externalCarriers: [] } as never);
    render(<DispatchAllocationPopover shipment={shipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).not.toBeDisabled());
    // Pre-condition: notice is visible before any data is entered.
    expect(screen.getByTestId('carrier-allocation-empty-externals')).toBeTruthy();

    // Dispatcher enters a valid OWN allocation (1x40' container) — the summary
    // table should reflect it and the misleading "no external carriers
    // configured" notice must disappear so the dispatcher knows the entered
    // OWN data is recognised by the system.
    fireEvent.change(screen.getByLabelText("Số container 40' dòng 1"), { target: { value: '1' } });

    // The 40' row's "Đã phân" cell should now read 1 — proving the entered
    // OWN data was registered in the summary table.
    const rows = screen.getAllByRole('row');
    const fortyRow = rows.find((row) => row.textContent?.includes("40'"));
    expect(fortyRow?.textContent).toMatch(/1/);
    expect(screen.queryByTestId('carrier-allocation-empty-externals')).toBeNull();
    expect(screen.queryByText(/Chưa có nhà xe ngoài nào được cấu hình/)).toBeNull();
  });
});
