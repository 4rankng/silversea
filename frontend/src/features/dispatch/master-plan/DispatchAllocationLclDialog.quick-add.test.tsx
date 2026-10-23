// FB-066 lần 3 (card 201026101600, QA R27) — the quick-add plate affordance
// INSIDE the "Phân bổ nhà xe" dialog. QA R27 verbatim: "dialog 'Phân bổ nhà xe'
// vẫn không có nút thêm nhanh biển số xe …; gõ biển số chưa đăng ký vào ô BKS
// cũng không có tuỳ chọn thêm". Both affordances now ride the BKS thực picker
// of the LCL field-set (the shell's only ô BKS):
//   1. "+ Thêm nhanh" beside the ô → nested "Thêm nhanh biển số xe" dialog,
//      the created plate selected back into the ô and the allocation dialog
//      NEVER closing (draft state survives);
//   2. a "Thêm mới: <số>" dropdown option when the typed plate is unknown —
//      it opens the same dialog seeded with that number.
// Registration target: the lot's planned nhà xe (OWN → POST /trucks, EXTERNAL
// → the Xe ngoài list); a carrier-less lot asks "Nhà xe" ("hãng/nhà xe nếu
// cần", owner scope).
import { render, screen, fireEvent, waitFor, configure } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { DispatchAllocationPopover } from './DispatchAllocationPopover';

// Full-suite red reported 21/10 on main d263149b ("lô CHƯA có nhà xe" asked no
// "Nhà xe"): every async hop here — the mocked bootstrap promise, React
// flushes, the react-aria portals — rides this budget under full-suite CPU
// contention. Card 211026144400 later proved the RESIDUAL flake was not this
// budget (a standing popover survived all 4s of retries): the Escape landed
// on the trigger button because jsdom focus into the listbox races the test —
// see the Escape site in the "lô CHƯA có nhà xe" test. Same assertions,
// wider wait — the pinned contract (card 201026101600) is untouched.
configure({ asyncUtilTimeout: 4_000 });

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
    items: [{ licensePlate: '30H-123.45' }],
  }),
  updateLclTruck: vi.fn().mockResolvedValue({ updatedShipmentIds: [2] }),
  createInternalTruck: vi.fn(),
  createCarrierFleetVehicle: vi.fn(),
}));

vi.mock('../../../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import {
  createCarrierFleetVehicle,
  createInternalTruck,
  updateLclTruck,
} from '../../../api/dispatchPlanningClient';

const lclShipment = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 2,
  shipmentCode: 'SS-000200',
  version: 4,
  customerName: 'Công ty ABC',
  blNumber: 'BL-2026-002',
  bookingRef: null,
  containerCount20: 0,
  containerCount40: 0,
  containerTypeSummary: '5 PALLET',
  allocationStatus: 'NOT_ALLOCATED',
  cargoMode: 'LCL',
  costVehicleClassCode: '5T',
  costVehicleClassName: 'Xe tải 5 tấn',
  actualTruckNo: '30H-123.45',
  billingTruckNo: null,
  carrierAllocationSummary: [
    { carrierType: 'EXTERNAL', externalCarrierId: 77, carrierLabel: 'HÀ AN', count20: 0, count40: 0 },
  ],
  ...overrides,
} as ShipmentListItem);

const bksField = (name: RegExp) => screen.getByRole('combobox', { name }) as HTMLInputElement;

beforeEach(() => {
  vi.mocked(createInternalTruck).mockReset();
  vi.mocked(createInternalTruck).mockImplementation(async ({ licensePlate }) => ({ id: 41, licensePlate } as never));
  vi.mocked(createCarrierFleetVehicle).mockReset();
  vi.mocked(createCarrierFleetVehicle).mockImplementation(async ({ carrierId, licensePlate }) => ({ id: 51, carrierId, licensePlate } as never));
});

describe('DispatchAllocationLclDialog — quick-add BKS trong dialog Phân bổ nhà xe (FB-066 lần 3)', () => {
  it('hiện nút "+ Thêm nhanh" cạnh ô BKS thực — cả lô có nhà xe lẫn lô chưa có', () => {
    const { unmount } = render(<DispatchAllocationPopover shipment={lclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Thêm nhanh/ })).toBeTruthy();
    unmount();

    render(<DispatchAllocationPopover shipment={lclShipment({ carrierAllocationSummary: [] })} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Thêm nhanh/ })).toBeTruthy();
  });

  it('bấm nút → dialog "Thêm nhanh biển số xe" mở chồng, tạo BKS Xe ngoài và chọn ngay vào ô, KHÔNG đóng dialog phân bổ', { timeout: 20_000 }, async () => {
    render(<DispatchAllocationPopover shipment={lclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Thêm nhanh/ }));
    expect(await screen.findByText('Thêm nhanh biển số xe')).toBeTruthy();
    // Both dialogs stand: the allocation draft never leaves.
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(screen.getByText('Phân bổ nhà xe')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Biển số xe'), { target: { value: '29C-066.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    // The planned nhà xe is EXTERNAL (HÀ AN, id 77) → the Xe ngoài API.
    await waitFor(() => expect(createCarrierFleetVehicle).toHaveBeenCalledWith({
      carrierId: 77,
      licensePlate: '29C-066.99',
    }));
    expect(createInternalTruck).not.toHaveBeenCalled();
    // Created plate selected into ô BKS thực; the allocation dialog stands.
    await waitFor(() => expect(bksField(/BKS thực/)).toHaveValue('29C-066.99'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Thêm nhanh biển số xe' })).toBeNull());
    expect(screen.getByText('Phân bổ nhà xe')).toBeTruthy();
  });

  it('gõ BKS lạ → option "Thêm mới: <số>" trong dropdown; chọn nó mở dialog quick-add ĐẦY SỐ ĐÃ GÕ và chọn kết quả vào ô', { timeout: 20_000 }, async () => {
    render(<DispatchAllocationPopover shipment={lclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(bksField(/BKS thực/));
    fireEvent.change(bksField(/BKS thực/), { target: { value: '29C-066.77' } });
    const addOption = await screen.findByRole('option', { name: /Thêm mới: 29C-066\.77/ });
    fireEvent.click(addOption);

    // Seeded with the typed number — the operator confirms, not retypes.
    const seeded = await screen.findByLabelText('Biển số xe') as HTMLInputElement;
    expect(seeded.value).toBe('29C-066.77');
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    await waitFor(() => expect(createCarrierFleetVehicle).toHaveBeenCalledWith({
      carrierId: 77,
      licensePlate: '29C-066.77',
    }));
    await waitFor(() => expect(bksField(/BKS thực/)).toHaveValue('29C-066.77'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Thêm nhanh biển số xe' })).toBeNull());
  });

  it('lô CHƯA có nhà xe: dialog hỏi "Nhà xe" (hãng/nhà xe nếu cần) — mặc định đội xe nội bộ, đổi sang nhà xe ngoài được', { timeout: 20_000 }, async () => {
    render(<DispatchAllocationPopover
      shipment={lclShipment({ carrierAllocationSummary: [], actualTruckNo: null })}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: /Thêm nhanh/ }));
    fireEvent.click(await screen.findByLabelText('Nhà xe'));
    // The picker offers the house carrier set — own fleet + every nhà xe ngoài.
    const ownFleetOption = await screen.findByRole('option', { name: 'Đội xe nội bộ SilverSea' });
    expect(screen.getByRole('option', { name: 'HÀ AN' })).toBeTruthy();
    // Card 211026144400 — Escape must originate INSIDE the popover. The
    // react-aria Escape handler sits on the portalled popover itself
    // (useOverlay keyboardProps); DOM focus into the listbox is async in
    // jsdom, so keying off `document.activeElement` here sometimes still hit
    // the trigger button — whose keymap has no Escape — and the popover never
    // closed (probe: trigger target → popover stands past the whole 4s
    // budget; option target → closes synchronously). Firing at the awaited
    // option takes the same bubble path (option → listbox → popover) as a
    // real keyboard Escape with the menu open.
    fireEvent.keyDown(ownFleetOption, { key: 'Escape' });
    // The popover's close (and its aria-hide-outside removal) settles
    // asynchronously — while it stands, react-aria hides the rest of the
    // surface, so wait it out before touching the dialog again.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nhà xe' })).toBeNull());

    // Default = đội xe nội bộ → the truck-catalog create.
    fireEvent.change(screen.getByLabelText('Biển số xe'), { target: { value: '29C-066.01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(createInternalTruck).toHaveBeenCalledWith({ licensePlate: '29C-066.01' }));
    await waitFor(() => expect(bksField(/BKS thực/)).toHaveValue('29C-066.01'));

    // Pick HÀ AN → the Xe ngoài API of that nhà xe.
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhanh/ }));
    fireEvent.click(await screen.findByLabelText('Nhà xe'));
    fireEvent.click(await screen.findByRole('option', { name: 'HÀ AN' }));
    // Same settle law: the pick must land (popover closed) before the next
    // query, or the still-open popover keeps "Áp dụng" aria-hidden.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nhà xe' })).toBeNull());
    fireEvent.change(screen.getByLabelText('Biển số xe'), { target: { value: '29C-066.02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(createCarrierFleetVehicle).toHaveBeenCalledWith({
      carrierId: 77,
      licensePlate: '29C-066.02',
    }));
  });

  it('draft BKS THỰC sống sót trọn vẹn qua vòng quick-add (dialog phân bổ không đóng)', { timeout: 20_000 }, async () => {
    render(<DispatchAllocationPopover shipment={lclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(bksField(/BKS thực/), { target: { value: '29C-066.55' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhanh/ }));
    fireEvent.change(await screen.findByLabelText('Biển số xe'), { target: { value: '29C-066.55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    // The typed draft survives the nested quick-add round-trip untouched.
    await waitFor(() => expect(bksField(/BKS thực/)).toHaveValue('29C-066.55'));
    expect(screen.getByText('Phân bổ nhà xe')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lưu phân bổ' })).toBeTruthy();
  });

  // GP-03 sweep (audit £100, 2026-10-24) — spec 23/10 §1: the ĐV allocation
  // dialog carries NO BKS báo khách (ảo) editor (same absence law as the
  // "Gán xe nhóm" popup, AssignTruckGroupDialog.test.tsx) and its save writes
  // ONLY the BKS thực fact (a stored ảo value belongs to the CUS).
  it('không còn BKS báo khách trong allocation dialog ĐV — payload chỉ có BKS thực', async () => {
    render(<DispatchAllocationPopover
      shipment={lclShipment({ billingTruckNo: '30C-999.99' })}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />);
    // No ảo editor — not as a field, not as a per-lot cluster, not in prose.
    expect(screen.queryByRole('combobox', { name: /BKS báo khách/ })).toBeNull();
    expect(screen.queryByLabelText(/BKS báo khách/)).toBeNull();
    expect(screen.queryByText(/Debit Note .* sẽ in BKS này/)).toBeNull();
    expect(screen.getByRole('combobox', { name: /BKS thực/ })).toBeTruthy();

    fireEvent.change(bksField(/BKS thực/), { target: { value: '29C-066.88' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân bổ' }));
    await waitFor(() => expect(vi.mocked(updateLclTruck)).toHaveBeenCalledWith({
      shipmentId: 2,
      actualTruckNo: '29C-066.88',
    }));
    // The ĐV write NEVER carries a billingTruckNo of any shape.
    const payload = vi.mocked(updateLclTruck).mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('billingTruckNo');
    expect(payload).not.toHaveProperty('billingTruckNos');
  });
});
