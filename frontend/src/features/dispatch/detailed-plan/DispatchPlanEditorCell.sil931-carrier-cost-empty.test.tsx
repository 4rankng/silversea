// SIL-931 (KB §2.4.1 K2.98, QA staging 3e9a28fa): the "Chỉnh sửa điều phối"
// dialog must NOT read "Cước trả dự kiến = 0" while the row has no nhà-xe
// price. The stored value is null (or a legacy fake 0 — SIL-796 r21) and the
// honest field shows the house no-value glyph '—' plus the help text naming
// the gap — never a fabricated number. Root cause: NumberField's default
// '0' placeholder re-printed "0 đ" on the empty field the r21 fix left.
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof DispatchPlanningClientModule>();
  return {
    ...actual,
    listDispatchFleetResources: vi.fn(async () => ({ items: [], nextCursor: null, total: 0, limit: 50, suggestedItems: [] })),
    createCarrierFleetVehicle: vi.fn(),
    createInternalTruck: vi.fn(),
    updateLclTruck: vi.fn(),
  };
});

const getTrailersMock = vi.fn(async () => []);
vi.mock('../../../api/configClient', () => ({
  configClient: { getTrailers: () => getTrailersMock() },
}));
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: [] }),
}));

const carrierPriceMock = vi.fn<(input: unknown) => { data?: { price: number; matched: 'SUPPLIER' | 'GENERIC' | null } }>(() => ({ data: undefined }));
vi.mock('../../../hooks/usePricingQueries', () => ({
  useFreightPreview: () => ({ data: undefined }),
  useCarrierPricePreview: (input: unknown) => carrierPriceMock(input),
}));
vi.mock('./useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({ tags: [], isLoading: false, error: null }),
  useCreateDispatchTaskTag: () => ({ createTag: vi.fn(async (label: string) => ({ id: 99, label })), isCreating: false }),
}));

import type * as DispatchPlanningClientModule from '../../../api/dispatchPlanningClient';
import { DispatchPlanEditorCell, type AtomicPlanSaveResult } from './DispatchPlanEditorCell';
import { detailRowKey } from './DispatchPlanCellValues';

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
  },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  classification: 'SINGLE' as DispatchDetailPlanRow['classification'],
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  lotFullyPlated: false,
  plannedEndAt: null,
  ...overrides,
} as DispatchDetailPlanRow);

const atomicSaveMock = vi.fn(async () => ({} as AtomicPlanSaveResult));
const issueOrderMock = vi.fn();
const completeExternalTripMock = vi.fn();

function renderEditor(item: DispatchDetailPlanRow) {
  return render(
    <DispatchPlanEditorCell
      row={item}
      onAtomicSave={atomicSaveMock as never}
      onIssueOrder={issueOrderMock as never}
      onCompleteExternalTrip={completeExternalTripMock as never}
      openRequest={{ key: detailRowKey(item), nonce: 1 }}
      onOpenRequestConsumed={vi.fn()}
    />,
  );
}

const costInput = () => screen.getByLabelText('Cước trả dự kiến') as HTMLInputElement;

describe("SIL-931 — 'Cước trả dự kiến' never displays a fabricated 0 (KB §2.4.1 K2.98)", () => {
  it("with no nhà-xe price the field reads '—', not '0 đ', and the help text names the gap", async () => {
    carrierPriceMock.mockReturnValue({ data: { price: 0, matched: null } });
    renderEditor(row());
    await waitFor(() => expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy());
    const input = costInput();
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('—');
    expect(input.placeholder).not.toBe('0');
    expect(screen.getByText('Chưa có giá ký nhà xe — nhập tay hoặc để trống, không ghi 0.')).toBeTruthy();
  });

  it('a legacy stored fake-0 estimate renders empty with the same honest glyph', async () => {
    carrierPriceMock.mockReturnValue({ data: { price: 0, matched: null } });
    renderEditor(row({ estimates: { plannedRevenue: null, plannedCarrierCost: '0' } }));
    await waitFor(() => expect(screen.getByText(/Chỉnh sửa điều phối/)).toBeTruthy());
    const input = costInput();
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('—');
  });
});
