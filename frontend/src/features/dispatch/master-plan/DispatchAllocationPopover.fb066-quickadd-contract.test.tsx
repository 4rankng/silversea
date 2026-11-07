import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { DispatchAllocationPopover } from './DispatchAllocationPopover';

/**
 * SIL-390 (id 423) — FB-066, the "+ Thêm nhanh biển số xe" quick-add.
 *
 * The affordance belongs to every surface that OWNS a plate:
 *  - the dispatch detail editor ("Xe / biển số" — card 20261004_357),
 *  - the Gán xe nhóm / Đổi BKS nhóm dialogs,
 *  - /trips/new (Xe đầu kéo),
 *  - the LCL field-set of "Phân bổ nhà xe" (FB-066 lần 3, card
 *    201026101600 — one lô lẻ = one truck run, so the lot owns its BKS thực).
 *
 * The FCL field-set does NOT own a plate: its contract is the carrier + the
 * container counts per day (a carrier row can cover several containers, so
 * one plate cannot sit there), and a cont lot's plate is set in Kế hoạch Chi
 * tiết — the dispatch editor above, which carries the quick-add. That is the
 * ruling the FB-066 lần 3 record already states ("FCL cont field-set: NOT
 * APPLICABLE (không có ô BKS)"), and this pin keeps the field-set honest so
 * the next sweep does not report it as a missing button again.
 */
vi.mock('../../../api/tripClient', () => ({
  tripClient: {
    getBootstrap: vi.fn().mockResolvedValue({
      externalCarriers: [{ id: 77, name: 'HÀ AN', isActive: true }],
    }),
  },
}));

vi.mock('../../../api/shipmentClient', () => ({
  saveShipmentCarrierAllocations: vi.fn(),
  getCusShipmentWorkspaceDetail: vi.fn().mockResolvedValue(null),
}));

const fclShipment = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  version: 4,
  customerName: 'Công ty ABC',
  blNumber: 'BL-2026-001',
  bookingRef: null,
  containerCount20: 2,
  containerCount40: 2,
  containerTypeSummary: '2 x 40HC + 2 x 20DC',
  allocationStatus: 'NOT_ALLOCATED',
  cargoMode: 'FCL',
  carrierAllocationSummary: [],
  ...overrides,
} as ShipmentListItem);

describe('DispatchAllocationPopover — the FCL field-set contract (SIL-390)', () => {
  it('allocates a carrier + the container counts per day', async () => {
    render(<DispatchAllocationPopover shipment={fclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).toBeTruthy());
    expect(screen.getByLabelText(/Số container 20' dòng 1/)).toBeTruthy();
    expect(screen.getByLabelText(/Số container 40' dòng 1/)).toBeTruthy();
  });

  it('carries NO plate field — the cont plate belongs to the container, in Kế hoạch Chi tiết', async () => {
    render(<DispatchAllocationPopover shipment={fclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).toBeTruthy());
    // The FCL field-set has no ô BKS (FB-066 lần 3: NOT APPLICABLE) — so it
    // has no quick-add button either; the plate of a cont lot is set per
    // container in the dispatch editor ("Xe / biển số"), which owns it.
    expect(screen.queryByText('Thêm nhanh')).toBeNull();
    expect(screen.queryByLabelText(/Biển số/)).toBeNull();
  });
});
