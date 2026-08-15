import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../api/dispatchPlanningClient')>();
  return {
    ...original,
    listDispatchFleetResources: vi.fn(),
  };
});

import { listDispatchFleetResources } from '../../../api/dispatchPlanningClient';
import { PlateAssignmentCell } from './PlateAssignmentCell';

const ownRow = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-08-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: null, deliveryPoint: null },
  docs: { billNumber: null, tradeDirection: null, declarationNumbers: [] },
  container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: null },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  lotFullyPlated: false,
  ...overrides,
} as DispatchDetailPlanRow);

function mockFleet(items: Array<{ id: number; licensePlate: string }>, nextCursor: string | null = null) {
  return (listDispatchFleetResources as ReturnType<typeof vi.fn>).mockResolvedValue({
    items,
    nextCursor,
    total: items.length,
  });
}

describe('PlateAssignmentCell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function useDesktopViewport() {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  }

  it('loads the own-fleet TRUCK population for OWN rows', async () => {
    useDesktopViewport();
    mockFleet([{ id: 9, licensePlate: '51C-123.45' }, { id: 10, licensePlate: '51C-678.90' }]);
    render(<PlateAssignmentCell row={ownRow()} onAssign={vi.fn()} />);

    await waitFor(() => {
      expect(listDispatchFleetResources).toHaveBeenCalledWith('TRUCK', expect.objectContaining({ limit: 50 }));
    });
    // Options live in the popover — open the trigger first.
    screen.getByRole('button', { name: /chọn biển số xe/i }).click();
    expect(await screen.findByText('51C-123.45')).toBeTruthy();
  });

  it('loads the vendor vehicle population for EXTERNAL rows with carrierId', async () => {
    useDesktopViewport();
    mockFleet([{ id: 31, licensePlate: '51H-888.88' }]);
    render(
      <PlateAssignmentCell
        row={ownRow({
          dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Việt', externalCarrierId: 77, externalCarrierVehicleId: null, assignedPlate: null },
        })}
        onAssign={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(listDispatchFleetResources).toHaveBeenCalledWith('EXTERNAL_VEHICLE', expect.objectContaining({ carrierId: 77 }));
    });
    screen.getByRole('button', { name: /chọn hoặc nhập biển số/i }).click();
    expect(await screen.findByText('51H-888.88')).toBeTruthy();
  });

  it('assigns the picked truck via onAssign', async () => {
    useDesktopViewport();
    mockFleet([{ id: 9, licensePlate: '51C-123.45' }]);
    const onAssign = vi.fn().mockResolvedValue({});
    render(<PlateAssignmentCell row={ownRow()} onAssign={onAssign} />);

    screen.getByRole('button', { name: /chọn biển số xe/i }).click();
    const option = await screen.findByText('51C-123.45');
    (option as HTMLElement).click();
    await waitFor(() => {
      expect(onAssign).toHaveBeenCalledWith(
        expect.objectContaining({ fulfillmentId: 101 }),
        { truckId: 9 },
      );
    });
  });

  it('shows the vendor-empty hint "CUS sẽ bổ sung"', () => {
    useDesktopViewport();
    mockFleet([]);
    render(
      <PlateAssignmentCell
        row={ownRow({
          dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Việt', externalCarrierId: 77, externalCarrierVehicleId: null, assignedPlate: null },
        })}
        onAssign={vi.fn()}
      />,
    );
    expect(screen.getByText('CUS sẽ bổ sung')).toBeTruthy();
  });
});
