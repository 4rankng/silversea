import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  getCusShipmentWorkspaceDetail: vi.fn().mockResolvedValue(null),
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

  it('keeps day context visible for a single-day lot (regression 2026-09-08: day context was hidden)', async () => {
    render(
      <DispatchAllocationPopover
        shipment={shipment({ expectedDeliveryDate: '2026-09-10' })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => screen.getByLabelText(/Nhà xe dòng 1/));

    // The day header row (weekday + per-day demand chip + allocation state)
    // always renders — even with one day. The original complaint was that a
    // single-day lot hid the day structure entirely.
    expect(screen.getByText(/10\/09\/2026/)).toBeTruthy();
    expect(screen.getByText(/Thứ Năm/)).toBeTruthy();
    // The per-day demand chip echoes the shipment demand.
    expect(screen.getAllByText(/Nhu cầu: 2×20' \+ 2×40'/).length).toBeGreaterThanOrEqual(1);
    // The date lives in the day header only — carrier rows no longer repeat
    // it in a dedicated column (2026-09-09 design fix: the NGÀY column
    // duplicated the day header and collapsed once the row grid broke).
    expect(screen.queryByText('10/09')).toBeNull();
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

    const summary = screen.getByRole('region', { name: 'Tổng phân bổ' });
    expect(summary).toBeTruthy();
    expect(within(summary).getByText('Loại')).toBeTruthy();
    expect(within(summary).getByText('Nhu cầu')).toBeTruthy();
    expect(within(summary).getByText('Đã phân')).toBeTruthy();
    expect(within(summary).getByText('Còn lại')).toBeTruthy();
    expect(within(summary).getByText("20'")).toBeTruthy();
    expect(within(summary).getByText("40'")).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Phân bổ theo nhà xe theo ngày' })).toBeTruthy();
    expect(screen.getByText("Container 20'")).toBeTruthy();
    expect(screen.getByText("Container 40'")).toBeTruthy();
    expect(screen.getByText(/Có thể lưu khi chưa phân đủ/)).toBeTruthy();

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

    // The entered 40' count must surface in the flow — the bottom note shows
    // the updated remaining counts ("Còn … container …"), proving the entered
    // OWN data was registered.
    expect(await screen.findByText(/Còn 2 container 20' và 1 container 40'/)).toBeTruthy();
    expect(screen.queryByTestId('carrier-allocation-empty-externals')).toBeNull();
    expect(screen.queryByText(/Chưa có nhà xe ngoài nào được cấu hình/)).toBeNull();
  });

  describe('TC-DV-DISPATCH-043: Multi-day allocation', () => {
    const multiDayShipment = () => shipment({
      containerCount20: 2,
      containerCount40: 2,
      appointmentGroups: [
        {
          at: '2026-09-10T08:00:00.000Z',
          localDate: '2026-09-10',
          factoryName: 'Nhà máy May 10',
          factoryShortName: 'May 10',
          factoryFullName: 'Nhà máy May 10',
          containerSummary: '1 x 40HC',
        },
        {
          at: '2026-09-11T08:00:00.000Z',
          localDate: '2026-09-11',
          factoryName: 'Nhà máy May 10',
          factoryShortName: 'May 10',
          factoryFullName: 'Nhà máy May 10',
          containerSummary: '1 x 40HC + 2 x 20DC',
        },
      ],
    });

    it('renders separate sections for each distinct appointment date with demands', async () => {
      render(<DispatchAllocationPopover shipment={multiDayShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

      await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).not.toBeDisabled());

      // Should render headers for both days. The date strings repeat inside
      // row labels and add-buttons, so query each day's region by its
      // accessible name and assert the header within it.
      const day1 = screen.getByRole('rowgroup', { name: 'Phân bổ ngày 10/09/2026' });
      const day2 = screen.getByRole('rowgroup', { name: 'Phân bổ ngày 11/09/2026' });
      expect(within(day1).getByText(/10\/09\/2026/)).toBeInTheDocument();
      expect(within(day2).getByText(/11\/09\/2026/)).toBeInTheDocument();

      // Day 1 has row 1, Day 2 has row 2
      expect(screen.getByLabelText(/Nhà xe dòng 1/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Nhà xe dòng 2/)).toBeInTheDocument();
    });

    it('allows assigning the same carrier on different days without duplicate collision', async () => {
      const onSaved = vi.fn();
      vi.mocked(saveShipmentCarrierAllocations).mockResolvedValue({
        shipment: { id: 1, version: 5 },
        assignments: [],
      } as never);

      render(<DispatchAllocationPopover shipment={multiDayShipment()} onClose={vi.fn()} onSaved={onSaved} />);

      await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).not.toBeDisabled());

      // Day 1 (demand: 1x40): assign 1x40 to SilverSea (OWN)
      fireEvent.change(screen.getByLabelText("Số container 40' dòng 1"), { target: { value: '1' } });

      // Day 2 (demand: 1x40, 2x20): assign 1x40 to SilverSea (OWN) in row 2
      fireEvent.change(screen.getByLabelText("Số container 40' dòng 2"), { target: { value: '1' } });

      // No duplicate error even though both row 1 and row 2 are OWN
      expect(screen.queryByText(/bị lặp/i)).toBeNull();

      // Save button is enabled
      const saveBtn = screen.getByRole('button', { name: 'Lưu phân bổ' }) as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(false);
      fireEvent.click(saveBtn);

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(saveShipmentCarrierAllocations).toHaveBeenCalledWith(1, expect.objectContaining({
        carrierAllocations: expect.arrayContaining([
          expect.objectContaining({
            carrierType: 'OWN',
            appointmentDate: '2026-09-10',
            count40: 1,
          }),
          expect.objectContaining({
            carrierType: 'OWN',
            appointmentDate: '2026-09-11',
            count40: 1,
          }),
        ]),
      }), undefined, 'partial');
    });

    it('breaks the overall summary down per day for multi-day lots', async () => {
      render(<DispatchAllocationPopover shipment={multiDayShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

      await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).not.toBeDisabled());

      const byDay = screen.getByRole('list', { name: 'Tổng phân bổ theo ngày' });
      const dayLines = within(byDay).getAllByRole('listitem');
      expect(dayLines).toHaveLength(2);

      // Day 1 untouched: full demand outstanding, partial chip.
      expect(within(dayLines[0]!).getByText(/Ngày 10\/09/)).toBeTruthy();
      expect(within(dayLines[0]!).getByText(/Nhu cầu 1×40'/)).toBeTruthy();
      expect(within(dayLines[0]!).getByText(/Đã phân 0 · Còn 1×40'/)).toBeTruthy();
      expect(dayLines[0]!.textContent).toContain('Chưa phân đủ');

      // Assigning day 1's 40' flips its line to complete while day 2 stays partial.
      fireEvent.change(screen.getByLabelText("Số container 40' dòng 1"), { target: { value: '1' } });
      expect(within(dayLines[0]!).getByText(/Đã phân 1×40' · Còn 0/)).toBeTruthy();
      expect(dayLines[0]!.textContent).toContain('Đã phân đủ');
      expect(within(dayLines[1]!).getByText(/Đã phân 0 · Còn 2×20' \+ 1×40'/)).toBeTruthy();
    });

    it('flags duplicate carrier when repeated on the SAME day', async () => {
      render(<DispatchAllocationPopover shipment={multiDayShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

      await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).not.toBeDisabled());

      // Add another carrier row to Day 1
      const addButtons = screen.getAllByRole('button', { name: /Thêm nhà xe/ });
      // First button belongs to Day 1
      fireEvent.click(addButtons[0]!);

      // Now we should have an extra row in Day 1. Let's find rows
      await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 2/)).toBeInTheDocument());

      // Change the newly added row to OWN (colliding with row 1 on Day 1)
      fireEvent.click(screen.getByLabelText(/Nhà xe dòng 2/));
      fireEvent.click(screen.getByRole('option', { name: 'Đội xe nội bộ SilverSea' }));

      // Give counts
      fireEvent.change(screen.getByLabelText("Số container 40' dòng 1"), { target: { value: '1' } });
      fireEvent.change(screen.getByLabelText("Số container 40' dòng 2"), { target: { value: '1' } });

      // The duplicate surfaces in several places at once (per-row carrier
      // hints on both colliding rows + the consolidated day-error list), so
      // collect all matches instead of asserting on a single node.
      const duplicateNotices = await screen.findAllByText(/bị lặp/i);
      expect(duplicateNotices.length).toBeGreaterThan(0);
      expect((screen.getByRole('button', { name: 'Lưu phân bổ' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('blocks save when an individual day is over-allocated', async () => {
      render(<DispatchAllocationPopover shipment={multiDayShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

      await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).not.toBeDisabled());

      // Day 1 demand is 1x40. Try to assign 2x40 to row 1
      fireEvent.change(screen.getByLabelText("Số container 40' dòng 1"), { target: { value: '2' } });

      expect(await screen.findByText(/vượt số lượng/i)).toBeInTheDocument();
      expect((screen.getByRole('button', { name: 'Lưu phân bổ' }) as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
