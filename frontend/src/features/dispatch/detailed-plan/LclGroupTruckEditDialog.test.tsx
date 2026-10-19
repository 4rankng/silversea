/**
 * Card 191026100010 (DV-B1-03) — "Đổi BKS nhóm": dialog đổi cặp BKS thực/ảo
 * của một COST group sau khi đã "Gán xe nhóm", gọi đúng API đã có
 * updateLclTruck (FB-093). Luật seed/auto-copy bám AssignTruckGroupDialog:
 * BKS ảo copy BKS thực cho tới khi operator sửa tay; BKS ảo đã lưu khi reopen
 * không bị nuốt. Submit rỗng BKS thực bị chặn tại client.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateLclTruckMock = vi.fn();
const fleetMock = vi.fn();
vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/dispatchPlanningClient')>();
  return {
    ...actual,
    updateLclTruck: (input: unknown) => updateLclTruckMock(input),
    listDispatchFleetResources: (resource: string, filters: unknown) => fleetMock(resource, filters),
  };
});
const toastMock = vi.fn();
vi.mock('../../../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

import { LclGroupTruckEditDialog } from './LclGroupTruckEditDialog';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

const row = (group: { actualTruckNo: string | null; billingTruckNo: string | null }): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000300',
  fulfillmentType: 'LCL_SHIPMENT',
  cargoMode: 'LCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-10-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty Lẻ', factoryName: null, deliveryPoint: 'Kho Q.7', routeName: null },
  docs: { billNumber: 'BL-2026-011', tradeDirection: 'IMPORT', declarationNumbers: [] },
  container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: '1922.00' },
  lcl: {
    packageCount: 5,
    packageType: 'PALLET',
    cargoVolumeCbm: '4.000',
    group: {
      groupId: 'grp-9',
      order: 2,
      memberCount: 3,
      vehicleClassCode: '5T',
      vehicleClassName: 'Xe 5 tấn',
      ...group,
    },
  },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Hải Vân', externalCarrierId: 41, externalCarrierVehicleId: null, assignedPlate: '29C-111.11' },
  ports: { pickupPortId: null, pickupPortName: null, pickupPortShortName: null, dropoffPortId: null, dropoffPortName: null, dropoffPortShortName: null },
  isCombined: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  lotFullyPlated: false,
  plannedEndAt: null,
  classification: 'LCL' as DispatchDetailPlanRow['classification'],
} as DispatchDetailPlanRow);

function renderDialog(r: DispatchDetailPlanRow) {
  return render(<LclGroupTruckEditDialog row={r} onClose={vi.fn()} onSaved={vi.fn()} />);
}

function setField(label: RegExp, value: string) {
  fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Lưu BKS nhóm' }));
}

describe('Card 191026100010 — LclGroupTruckEditDialog (DV-B1-03)', () => {
  beforeEach(() => {
    updateLclTruckMock.mockReset();
    updateLclTruckMock.mockResolvedValue({ updatedShipmentIds: [11, 12, 13] });
    fleetMock.mockReset();
    fleetMock.mockResolvedValue({ items: [{ id: 77, licensePlate: '29C-111.11' }], nextCursor: null, total: 1, limit: 50 });
    toastMock.mockReset();
  });

  it('seeds both BKS from the stored group and submits them via updateLclTruck', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <LclGroupTruckEditDialog
        row={row({ actualTruckNo: '29C-111.11', billingTruckNo: '29C-999.99' })}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    expect((screen.getByRole('combobox', { name: /BKS thực/ }) as HTMLInputElement).value).toBe('29C-111.11');
    // Stored ảo BKS is seeded too (reopen never clobbers it with the actual).
    expect((screen.getByRole('combobox', { name: /BKS báo khách/ }) as HTMLInputElement).value).toBe('29C-999.99');

    setField(/BKS thực/, '30C-222.22');
    submit();
    await waitFor(() => expect(updateLclTruckMock).toHaveBeenCalledTimes(1));
    expect(updateLclTruckMock.mock.calls[0]![0]).toEqual({
      shipmentId: 11,
      actualTruckNo: '30C-222.22',
      billingTruckNo: '29C-999.99',
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'success',
      message: expect.stringContaining('Đã đổi BKS nhóm 3 lô'),
    }));
  });

  it('auto-copies the billing BKS from the actual one until the operator edits it', async () => {
    renderDialog(row({ actualTruckNo: '29C-111.11', billingTruckNo: null }));
    const billing = screen.getByRole('combobox', { name: /BKS báo khách/ }) as HTMLInputElement;
    // No stored ảo BKS ⇒ it mirrors the actual plate…
    await waitFor(() => expect(billing.value).toBe('29C-111.11'));
    setField(/BKS thực/, '30C-222.22');
    // …and keeps following it until touched.
    await waitFor(() => expect(billing.value).toBe('30C-222.22'));

    // Touch the ảo field: it stops following.
    setField(/BKS báo khách/, '30C-888.88');
    setField(/BKS thực/, '30C-333.33');
    await waitFor(() => expect(billing.value).toBe('30C-888.88'));

    submit();
    await waitFor(() => expect(updateLclTruckMock).toHaveBeenCalledTimes(1));
    expect(updateLclTruckMock.mock.calls[0]![0]).toEqual({
      shipmentId: 11,
      actualTruckNo: '30C-333.33',
      billingTruckNo: '30C-888.88',
    });
  });

  it('omits billingTruckNo from the wire when it equals the actual plate', async () => {
    renderDialog(row({ actualTruckNo: '29C-111.11', billingTruckNo: null }));
    setField(/BKS thực/, '30C-222.22');
    submit();
    await waitFor(() => expect(updateLclTruckMock).toHaveBeenCalledTimes(1));
    // Billing mirrors actual (autocopy, untouched) ⇒ server default applies.
    expect(updateLclTruckMock.mock.calls[0]![0]).toEqual({ shipmentId: 11, actualTruckNo: '30C-222.22' });
  });

  it('refuses an empty BKS thực at the client — no wire, no close', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <LclGroupTruckEditDialog
        row={row({ actualTruckNo: '29C-111.11', billingTruckNo: null })}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    setField(/BKS thực/, '');
    submit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Nhập BKS thực'));
    expect(updateLclTruckMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces the backend failure (e.g. 409 chốt kế toán) and keeps the dialog open', async () => {
    updateLclTruckMock.mockRejectedValue(new Error('Nhóm ghép đã chốt kế toán — không thể đổi BKS.'));
    const onSaved = vi.fn();
    render(
      <LclGroupTruckEditDialog
        row={row({ actualTruckNo: '29C-111.11', billingTruckNo: null })}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    setField(/BKS thực/, '30C-222.22');
    submit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Nhóm ghép đã chốt kế toán'));
    expect(onSaved).not.toHaveBeenCalled();
  });

  // FB-066 — the "BKS thực" picker carries the "+ Thêm nhanh" quick-add
  // affordance (the lot already has a nhà xe), so a dispatcher registers a
  // brand-new plate without leaving the Đổi BKS nhóm flow (chungtu-dieuvan
  // B.1, lclspec) — the same affordance the Gán xe nhóm dialog owns.
  it('FB-066: "BKS thực" shows the + Thêm nhanh quick-add for the lot nha xe', () => {
    renderDialog(row({ actualTruckNo: '29C-111.11', billingTruckNo: null }));
    expect(screen.getByRole('button', { name: /Thêm nhanh/ })).toBeTruthy();
  });
});
