// Card 191026181942 (DV3) — "Phân bổ nhà xe" opens ONE shell whose field-set
// follows the lot's cargoMode. The cont body (20'/40' counts per carrier per
// day, demand progress) is the FCL contract; an LCL lot must never see it —
// a hàng lẻ owns no container, so those numbers can only lie. The LCL body is
// the lclspec field-set: loại xe / nhà xe facts plus the BKS pair a
// dispatcher may rewrite from a single lot (updateLclTruck).
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { DispatchAllocationPopover } from './DispatchAllocationPopover';

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

vi.mock('../../../api/dispatchPlanningClient', () => ({
  listDispatchFleetResources: vi.fn().mockResolvedValue({
    items: [{ licensePlate: '30H-123.45' }, { licensePlate: '30H-999.99' }],
  }),
  updateLclTruck: vi.fn(),
}));

vi.mock('../../../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { updateLclTruck } from '../../../api/dispatchPlanningClient';

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
  totalCargoWeightKg: null,
  allocationStatus: 'NOT_ALLOCATED',
  carrierAllocationSummary: [],
  ...overrides,
} as ShipmentListItem);

/** An LCL lot: no containers, its stored cost-group identity, and (post card
 * fix) the planned nhà xe riding the carrier summary with zero counts. */
const lclShipment = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  ...fclShipment(),
  id: 2,
  cargoMode: 'LCL',
  containerCount20: 0,
  containerCount40: 0,
  containerTypeSummary: '5 PALLET',
  costVehicleClassCode: '5T',
  costVehicleClassName: 'Xe tải 5 tấn',
  actualTruckNo: '30H-123.45',
  billingTruckNo: null,
  carrierAllocationSummary: [
    { carrierType: 'EXTERNAL', externalCarrierId: 77, carrierLabel: 'HÀ AN', count20: 0, count40: 0 },
  ],
  ...overrides,
} as ShipmentListItem);

/** The house searchable field renders as a RAC combobox named by its label. */
const bksField = (name: RegExp) => screen.getByRole('combobox', { name }) as HTMLInputElement;

beforeEach(() => {
  vi.mocked(updateLclTruck).mockReset();
  vi.mocked(updateLclTruck).mockResolvedValue({ updatedShipmentIds: [2] });
});

describe('DispatchAllocationPopover — field-set theo cargoMode (card 191026181942)', () => {
  it('LCL lot: shows the lclspec field-set and NO container fields', async () => {
    render(<DispatchAllocationPopover shipment={lclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(await screen.findByText('Phân bổ nhà xe')).toBeTruthy();
    // The lclspec facts, labels reused from the Gán xe nhóm contract.
    expect(screen.getByText('Loại xe tính cước trả ĐV')).toBeTruthy();
    expect(screen.getByText('Xe tải 5 tấn · 5T')).toBeTruthy();
    expect(screen.getByText('Nhà xe')).toBeTruthy();
    expect(screen.getByText('HÀ AN')).toBeTruthy();
    // The BKS fact the dispatcher may rewrite from a single lot. GP-03 sweep
    // (audit £100, 2026-10-24): NO BKS báo khách editor on the ĐV side
    // (spec 23/10 §1 — CUS output only).
    expect(bksField(/BKS thực/)).toHaveValue('30H-123.45');
    expect(screen.queryByRole('combobox', { name: /BKS báo khách/ })).toBeNull();
    // The cont contract is gone: no demand progress, no 20'/40' columns, no
    // per-carrier count inputs, no "Thêm nhà xe".
    expect(screen.queryByText(/container 20'/i)).toBeNull();
    expect(screen.queryByText(/container 40'/i)).toBeNull();
    expect(screen.queryByRole('table', { name: 'Phân bổ theo nhà xe theo ngày' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Thêm nhà xe/ })).toBeNull();
  });

  it('LCL lot: BKS thực typed by hand saves through updateLclTruck — payload chỉ có BKS thực', async () => {
    render(<DispatchAllocationPopover shipment={lclShipment({ actualTruckNo: null })} onClose={vi.fn()} onSaved={vi.fn()} />);

    const actual = await screen.findByRole('combobox', { name: /BKS thực/ }) as HTMLInputElement;
    fireEvent.change(actual, { target: { value: '30H-777.88' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân bổ' }));

    // GP-03: the ĐV write names ONLY the BKS thực fact — no billingTruckNo
    // of any shape (a CUS-set ảo value stays untouched server-side).
    await waitFor(() => expect(updateLclTruck).toHaveBeenCalledWith({
      shipmentId: 2,
      actualTruckNo: '30H-777.88',
    }));
    const payload = vi.mocked(updateLclTruck).mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('billingTruckNo');
  });

  it('LCL lot: the dialog reports a backend refusal (khóa sổ) and stays open', async () => {
    vi.mocked(updateLclTruck).mockRejectedValue(new Error('Nhóm ghép đã chốt kế toán — Lô BL-2026-001 đang khóa sổ, không sửa BKS thực của nhóm được'));
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<DispatchAllocationPopover shipment={lclShipment()} onClose={onClose} onSaved={onSaved} />);

    const actual = await screen.findByRole('combobox', { name: /BKS thực/ }) as HTMLInputElement;
    fireEvent.change(actual, { target: { value: '30H-666.66' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân bổ' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nhóm ghép đã chốt kế toán');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('FCL lot: the cont field-set stays exactly as before — no LCL fields leak in', async () => {
    render(<DispatchAllocationPopover shipment={fclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await screen.findByLabelText(/Nhà xe dòng 1/);
    expect(screen.getByRole('table', { name: 'Phân bổ theo nhà xe theo ngày' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Thêm nhà xe/ })).toBeTruthy();
    expect(screen.queryByText('Loại xe tính cước trả ĐV')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /BKS thực/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /BKS báo khách/ })).toBeNull();
  });

  it('switching mode re-seeds: an LCL render after an FCL one starts from the lot, not the previous draft', async () => {
    // The page unmounts the shell between opens, so each mount is fresh; this
    // pins the registry's reset law — the FCL cont draft (counts) never
    // survives into an LCL body and the LCL BKS draft never survives into FCL.
    const { unmount } = render(<DispatchAllocationPopover shipment={fclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByLabelText(/Nhà xe dòng 1/);
    fireEvent.change(screen.getByLabelText("Số container 20' dòng 1"), { target: { value: '2' } });
    unmount();

    render(<DispatchAllocationPopover shipment={lclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);
    const actual = await screen.findByRole('combobox', { name: /BKS thực/ }) as HTMLInputElement;
    expect(actual).toHaveValue('30H-123.45');
    expect(screen.queryByLabelText("Số container 20' dòng 1")).toBeNull();
  });
});
