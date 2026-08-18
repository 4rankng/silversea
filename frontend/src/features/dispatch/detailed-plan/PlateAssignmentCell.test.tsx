import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  docs: { billNumber: 'BL-2026-010', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '40HC', cargoWeightKg: null },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  lotFullyPlated: false,
  ...overrides,
} as DispatchDetailPlanRow);

function mutationProps() {
  return {
    onAssign: vi.fn().mockResolvedValue({ version: 4, assignedPlate: '51C-123.45', lotFullyPlated: false }),
    onAssignCarrier: vi.fn().mockResolvedValue({
      version: 4,
      carrierType: 'EXTERNAL',
      externalCarrierId: 77,
      carrierName: 'Nhà xe Việt',
      lotFullyPlated: false,
    }),
    onSaveEstimates: vi.fn().mockResolvedValue({
      version: 4,
      plannedRevenue: '2500000',
      plannedCarrierCost: '1900000',
    }),
  };
}

function mockFleet() {
  const fleetMock = listDispatchFleetResources as ReturnType<typeof vi.fn>;
  fleetMock.mockImplementation(async (resource: string, filters: { carrierId?: number | null; cursor?: string | null }) => {
    if (resource === 'EXTERNAL_CARRIER') {
      return {
        items: filters.cursor ? [{ id: 88, name: 'Nhà xe Miền Nam', isActive: true }] : [{ id: 77, name: 'Nhà xe Việt', isActive: true }],
        nextCursor: filters.cursor ? null : 'carrier-page-2',
        total: 2,
      };
    }
    if (resource === 'EXTERNAL_VEHICLE' && filters.carrierId === 77) {
      return { items: [{ id: 31, licensePlate: '51H-888.88' }], nextCursor: null, total: 1 };
    }
    return { items: [{ id: 9, licensePlate: '51C-123.45' }], nextCursor: null, total: 1 };
  });
}

describe('PlateAssignmentCell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function useDesktopViewport() {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  }

  it('uses one full-cell trigger and opens one dialog containing all four values', async () => {
    useDesktopViewport();
    mockFleet();
    const { container } = render(<PlateAssignmentCell row={ownRow()} {...mutationProps()} />);

    expect(container.querySelectorAll('button')).toHaveLength(1);
    const trigger = screen.getByRole('button', { name: 'Sửa ô điều phối MSCU1234567' });
    expect(trigger).toHaveClass('dispatch-assignment-cell__trigger');
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Chỉnh sửa điều phối' });
    expect(within(dialog).getByLabelText('Nhà xe')).toBeTruthy();
    expect(within(dialog).getByLabelText('Xe / biển số')).toBeTruthy();
    expect(within(dialog).getByLabelText('Cước thu dự kiến')).toBeTruthy();
    expect(within(dialog).getByLabelText('Cước trả dự kiến')).toBeTruthy();
    await waitFor(() => expect(listDispatchFleetResources).toHaveBeenCalledWith('TRUCK', expect.objectContaining({ limit: 50 })));
  });

  it('keeps all four changes as a draft, then saves them in version order', async () => {
    useDesktopViewport();
    mockFleet();
    const props = mutationProps();
    props.onAssign.mockResolvedValue({ version: 5, assignedPlate: '51H-888.88', lotFullyPlated: false });
    props.onSaveEstimates.mockResolvedValue({ version: 6, plannedRevenue: '2500000', plannedCarrierCost: '1900000' });
    render(<PlateAssignmentCell row={ownRow()} {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /sửa ô điều phối/i }));
    fireEvent.click(screen.getByLabelText('Nhà xe'));
    fireEvent.click(await screen.findByRole('option', { name: 'Nhà xe Việt' }));
    await waitFor(() => expect(listDispatchFleetResources).toHaveBeenCalledWith(
      'EXTERNAL_VEHICLE',
      expect.objectContaining({ carrierId: 77 }),
    ));
    fireEvent.click(screen.getByLabelText('Xe / biển số'));
    fireEvent.click(await screen.findByRole('option', { name: '51H-888.88' }));
    fireEvent.change(screen.getByLabelText('Cước thu dự kiến'), { target: { value: '2500000' } });
    fireEvent.change(screen.getByLabelText('Cước trả dự kiến'), { target: { value: '1900000' } });

    expect(props.onAssignCarrier).not.toHaveBeenCalled();
    expect(props.onAssign).not.toHaveBeenCalled();
    expect(props.onSaveEstimates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(props.onSaveEstimates).toHaveBeenCalledOnce());
    expect(props.onAssignCarrier).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillmentId: 101, version: 3 }),
      { carrierType: 'EXTERNAL', externalCarrierId: 77 },
    );
    expect(props.onAssign).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillmentId: 101, version: 4 }),
      { externalCarrierVehicleId: 31 },
    );
    expect(props.onSaveEstimates).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillmentId: 101, version: 5 }),
      { plannedRevenue: 2500000, plannedCarrierCost: 1900000 },
    );
  });

  it('saves fee-only edits without rewriting carrier or vehicle assignment', async () => {
    useDesktopViewport();
    mockFleet();
    const props = mutationProps();
    render(<PlateAssignmentCell row={ownRow()} {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /sửa ô điều phối/i }));
    fireEvent.change(screen.getByLabelText('Cước thu dự kiến'), { target: { value: '2500000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(props.onSaveEstimates).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillmentId: 101, version: 3 }),
      { plannedRevenue: 2500000, plannedCarrierCost: null },
    ));
    expect(props.onAssignCarrier).not.toHaveBeenCalled();
    expect(props.onAssign).not.toHaveBeenCalled();
  });

  it('retains a historical external carrier and plate when live catalogs are empty', async () => {
    useDesktopViewport();
    (listDispatchFleetResources as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    render(<PlateAssignmentCell row={ownRow({
      dispatch: {
        carrierType: 'EXTERNAL',
        carrierName: 'Nhà xe đã khóa',
        externalCarrierId: 77,
        externalCarrierVehicleId: null,
        assignedPlate: '51H-123.45',
      },
    })} {...mutationProps()} />);

    expect(screen.getByText('Nhà xe đã khóa')).toBeTruthy();
    expect(screen.getByText('51H-123.45')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /sửa ô điều phối/i }));
    expect(screen.getByLabelText('Nhà xe')).toHaveTextContent('Nhà xe đã khóa');
    expect(screen.getByLabelText('Xe / biển số')).toHaveTextContent('51H-123.45');
  });

  it('restores focus to the full-cell trigger after Escape closes the dialog', async () => {
    useDesktopViewport();
    mockFleet();
    render(<PlateAssignmentCell row={ownRow()} {...mutationProps()} />);
    const trigger = screen.getByRole('button', { name: /sửa ô điều phối/i });
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Chỉnh sửa điều phối' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa điều phối' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('rejects invalid fee drafts without issuing any mutation', async () => {
    useDesktopViewport();
    mockFleet();
    const props = mutationProps();
    render(<PlateAssignmentCell row={ownRow()} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /sửa ô điều phối/i }));

    fireEvent.change(screen.getByLabelText('Cước thu dự kiến'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cước dự kiến phải là số nguyên không âm.');
    expect(props.onAssignCarrier).not.toHaveBeenCalled();
    expect(props.onAssign).not.toHaveBeenCalled();
    expect(props.onSaveEstimates).not.toHaveBeenCalled();
  });

  it('loads the next carrier page from inside the dialog', async () => {
    useDesktopViewport();
    mockFleet();
    render(<PlateAssignmentCell row={ownRow()} {...mutationProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /sửa ô điều phối/i }));
    fireEvent.click(screen.getByLabelText('Nhà xe'));

    fireEvent.click(await screen.findByRole('button', { name: 'Tải thêm kết quả' }));
    expect(await screen.findByRole('option', { name: 'Nhà xe Miền Nam' })).toBeTruthy();
  });
});
