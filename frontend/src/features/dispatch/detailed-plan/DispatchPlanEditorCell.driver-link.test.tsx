// QA 28/11 F-E — "show link status before a dispatcher selects five orders":
// the Điều phối cell prints the "Tài xế chưa liên kết" warning chip when the
// row's fleet driver has no login account (drivers.userId null → the read
// service sends dispatch.driverLinked = false). That is exactly the setup the
// batch issue refuses 5/5 with the Quản trị người dùng message — the chip
// surfaces the wall BEFORE the dispatcher commits the selection. A linked
// driver (true) or a row with no fleet driver in play (null — external
// contacts own no account) never prints it.
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import type * as DispatchPlanningClientModule from '../../../api/dispatchPlanningClient';

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof DispatchPlanningClientModule>();
  return {
    ...actual,
    listDispatchFleetResources: vi.fn(),
    createCarrierFleetVehicle: vi.fn(),
  };
});

const getTrailersMock = vi.hoisted(() => vi.fn());
vi.mock('../../../api/configClient', () => ({
  configClient: { getTrailers: (...args: Array<unknown>) => getTrailersMock(...args) },
}));

vi.mock('./useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({ tags: [], isLoading: false, error: null }),
  useCreateDispatchTaskTag: () => ({ createTag: vi.fn(), isCreating: false }),
}));

vi.mock('../../../hooks/usePricingQueries', () => ({
  useFreightPreview: () => ({ data: undefined }),
  useCarrierPricePreview: () => ({ data: undefined }),
}));

import { DispatchPlanEditorCell } from './DispatchPlanEditorCell';

const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-08-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: null, deliveryPoint: 'Kho Bình Dương', routeName: null },
  docs: { billNumber: 'BL-2026-010', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '20DC', cargoWeightKg: '21500.00' },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: {
    carrierType: 'OWN',
    carrierName: 'SilverSea',
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    assignedPlate: '15H-052.82',
    assignedDriverName: 'Trần Văn QAPAY',
    driverLinked: true,
  },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  classification: 'SINGLE' as DispatchDetailPlanRow['classification'],
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  lotFullyPlated: false,
  plannedEndAt: null,
  ...overrides,
} as DispatchDetailPlanRow);

function renderCell(item: DispatchDetailPlanRow) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DispatchPlanEditorCell
        row={item}
        onAtomicSave={vi.fn()}
        onCompleteExternalTrip={vi.fn()}
        onIssueOrder={vi.fn().mockResolvedValue({})}
      />
    </QueryClientProvider>,
  );
}

describe('DispatchPlanEditorCell — the Tài xế chưa liên kết chip (QA 28/11 F-E)', () => {
  it('prints the warning chip with the Quản trị người dùng fix in its title when the driver is unlinked', () => {
    renderCell(row({ dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82', assignedDriverName: 'Trần Văn QAPAY', driverLinked: false } as DispatchDetailPlanRow['dispatch'] }));

    const chip = screen.getByText('Tài xế chưa liên kết');
    expect(chip.getAttribute('title')).toContain('Quản trị người dùng');
    // The driver name still reads beside the chip.
    expect(screen.getByText('Trần Văn QAPAY')).toBeTruthy();
  });

  it('stays hidden when the driver holds an account (driverLinked true)', () => {
    renderCell(row());
    expect(screen.queryByText('Tài xế chưa liên kết')).toBeNull();
  });

  it('stays hidden when no fleet driver stands behind the row (driverLinked null)', () => {
    renderCell(row({
      dispatch: {
        carrierType: 'EXTERNAL',
        carrierName: 'Nhà thầu ngoài',
        externalCarrierId: 5,
        externalCarrierVehicleId: null,
        assignedPlate: null,
        assignedDriverName: null,
        driverLinked: null,
      } as DispatchDetailPlanRow['dispatch'],
    }));
    expect(screen.queryByText('Tài xế chưa liên kết')).toBeNull();
  });
});
