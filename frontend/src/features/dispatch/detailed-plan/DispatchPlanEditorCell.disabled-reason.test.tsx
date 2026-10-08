/**
 * Card 20261008_1 sweep — the /dispatch-detail plan editor's action buttons
 * disabled silently (the trigger froze on completed rows, the dialog footer
 * went dark during saves with no word, "Phát lệnh" hid its plan-dirty
 * prerequisite behind a `title`). They now ride the aria-described +
 * aria-disabled pattern (components/shared/DisabledActionTip, landed by card
 * 081026093510).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  useDispatchTaskTags: () => ({
    tags: [{ id: 1, label: 'Đặt đầu' }, { id: 2, label: 'Đặt đuôi' }],
    isLoading: false,
    error: null,
  }),
  useCreateDispatchTaskTag: () => ({
    createTag: vi.fn(async (label: string) => ({ id: 99, label })),
    isCreating: false,
  }),
}));

import { listDispatchFleetResources } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentRequest, DispatchShipmentResponse } from '../../../api/shipmentClient';
import { DispatchPlanEditorCell, type AtomicPlanSaveResult } from './DispatchPlanEditorCell';

const listResourcesMock = vi.mocked(listDispatchFleetResources);
getTrailersMock.mockResolvedValue([]);

const PAIRED_TRUCK = {
  id: 154,
  licensePlate: '15H-052.82',
  status: 'ACTIVE',
  trailerType: '20FT',
  currentTrailerId: 2,
  currentTrailerPlate: '15R-182.06',
  capacityKg: '18000',
  assignedDriverId: 8,
  assignedDriverName: 'Phạm Văn Hùng',
};

function mockFleetResources() {
  listResourcesMock.mockImplementation((async (resource: string, filters: { q?: string; limit?: number } = {}) => {
    if (resource === 'EXTERNAL_CARRIER') {
      return { items: [{ id: 9, name: 'Carrier QA', isActive: true }], nextCursor: null, total: 1, limit: filters.limit ?? 50 };
    }
    if (resource === 'EXTERNAL_VEHICLE') {
      return { items: [], nextCursor: null, total: 0, limit: filters.limit ?? 50 };
    }
    if (filters.limit === 5 && filters.q) {
      return { items: [PAIRED_TRUCK], nextCursor: null, total: 1, limit: 5 };
    }
    return { items: [PAIRED_TRUCK], nextCursor: null, total: 1, limit: filters.limit ?? 50, suggestedItems: [] };
  }) as never);
}

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

type IssueOrderBody = Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>;

function renderCell(
  item: DispatchDetailPlanRow,
  handlers: {
    onAtomicSave?: (row: DispatchDetailPlanRow, body: Record<string, unknown>) => Promise<AtomicPlanSaveResult>;
    onIssueOrder?: (row: DispatchDetailPlanRow, body: IssueOrderBody) => Promise<DispatchShipmentResponse>;
    onCompleteExternalTrip?: (row: DispatchDetailPlanRow) => void;
  } = {},
) {
  return render(
    <DispatchPlanEditorCell
      row={item}
      onAtomicSave={handlers.onAtomicSave ?? vi.fn().mockResolvedValue({
        fulfillmentVersion: 4,
        shipmentVersion: 6,
        classification: 'SINGLE',
        isCombined: false,
        operationalNotes: null,
        dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82' },
        estimates: { plannedRevenue: null, plannedCarrierCost: null },
        lotFullyPlated: false,
      })}
      onOpenTripReassign={vi.fn()}
      onCompleteExternalTrip={handlers.onCompleteExternalTrip ?? vi.fn()}
      onIssueOrder={handlers.onIssueOrder ?? vi.fn().mockResolvedValue({})}
    />,
  );
}

function reasonOf(button: HTMLElement): string {
  const reasonId = button.getAttribute('aria-describedby');
  expect(reasonId).toBeTruthy();
  return document.getElementById(reasonId!)?.textContent ?? '';
}

function issueButton(): HTMLButtonElement {
  return [...screen.getAllByRole('button')]
    .find((b) => b.classList.contains('dispatch-assignment-dialog__issue-btn')) as HTMLButtonElement;
}

describe('DispatchPlanEditorCell disabled reasons (card 20261008_1 sweep)', () => {
  it('a completed row explains the frozen plan and the trigger stays inert', () => {
    mockFleetResources();
    renderCell(row({
      taskStatus: 'COMPLETED',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '15H-052.82', tripId: 77, tripStatus: 'COMPLETED' },
    } as Partial<DispatchDetailPlanRow>));

    const trigger = screen.getByRole('button', { name: 'Sửa ô điều phối MSCU1234567' });
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    expect(trigger).not.toBeDisabled();
    expect(reasonOf(trigger)).toBe('Chuyến đã hoàn thành — kế hoạch điều phối đã chốt.');
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an editable row keeps the trigger armed (no reason) and opens the editor', async () => {
    mockFleetResources();
    renderCell(row());
    const trigger = screen.getByRole('button', { name: 'Sửa ô điều phối MSCU1234567' });
    expect(trigger).not.toHaveAttribute('aria-disabled');
    expect(trigger).not.toHaveAttribute('aria-describedby');
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Chỉnh sửa điều phối · MSCU1234567' })).toBeTruthy();
  });

  it('while a save is in flight the footer cancel and save explain their busy disable', async () => {
    mockFleetResources();
    // Executor form on purpose: Promise.withResolvers is outside this
    // project's TS lib (TS2550).
    let resolveSave: (value: unknown) => void = () => {};
    const onAtomicSave = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; })) as never;
    renderCell(row(), { onAtomicSave });

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô điều phối MSCU1234567' }));
    await screen.findByRole('dialog', { name: 'Chỉnh sửa điều phối · MSCU1234567' });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));

    const cancel = screen.getByRole('button', { name: 'Hủy' });
    expect(cancel).toHaveAttribute('aria-disabled', 'true');
    expect(cancel).not.toBeDisabled();
    expect(reasonOf(cancel)).toBe('Đang lưu thay đổi — chưa hủy được.');
    fireEvent.click(cancel);
    expect(screen.getByRole('dialog')).toBeTruthy();

    const save = screen.getByRole('button', { name: 'Đang lưu…' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).not.toBeDisabled();
    expect(reasonOf(save)).toBe('Đang lưu thay đổi…');

    resolveSave({});
  });

  it('with unsaved edits "Phát lệnh" explains the save-first prerequisite and stays inert', async () => {
    mockFleetResources();
    const onIssueOrder = vi.fn().mockResolvedValue({});
    renderCell(row(), { onIssueOrder });

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô điều phối MSCU1234567' }));
    await screen.findByRole('dialog', { name: 'Chỉnh sửa điều phối · MSCU1234567' });
    fireEvent.change(screen.getByLabelText('Cước thu dự kiến'), { target: { value: '123' } });

    const issue = issueButton();
    expect(issue).toHaveAttribute('aria-disabled', 'true');
    expect(issue).not.toBeDisabled();
    expect(reasonOf(issue)).toBe('Lưu thay đổi điều phối trước khi phát lệnh.');
    fireEvent.click(issue);
    expect(onIssueOrder).not.toHaveBeenCalled();
  });

  it('with a clean plan "Phát lệnh" is armed (no reason) and releases the order', async () => {
    mockFleetResources();
    const onIssueOrder = vi.fn().mockResolvedValue({});
    renderCell(row(), { onIssueOrder });

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô điều phối MSCU1234567' }));
    await screen.findByRole('dialog', { name: 'Chỉnh sửa điều phối · MSCU1234567' });

    const issue = issueButton();
    expect(issue).not.toHaveAttribute('aria-disabled');
    expect(issue).not.toHaveAttribute('aria-describedby');
    fireEvent.click(issue);
    await waitFor(() => expect(onIssueOrder).toHaveBeenCalledTimes(1));
  });

  it('while a save is in flight the external-trip close explains its busy disable', async () => {
    mockFleetResources();
    // Executor form on purpose: Promise.withResolvers is outside this
    // project's TS lib (TS2550).
    let resolveSave: (value: unknown) => void = () => {};
    const onAtomicSave = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; })) as never;
    renderCell(row({
      taskStatus: 'DISPATCHED',
      dispatch: {
        carrierType: 'EXTERNAL',
        carrierName: 'Carrier QA',
        externalCarrierId: 9,
        externalCarrierVehicleId: 1,
        assignedPlate: 'E2E-QA1',
        tripId: 77,
        tripStatus: 'CANCELLED',
      },
    } as Partial<DispatchDetailPlanRow>), { onAtomicSave });

    fireEvent.click(screen.getByRole('button', { name: 'Sửa ô điều phối MSCU1234567' }));
    await screen.findByRole('dialog', { name: 'Chỉnh sửa điều phối · MSCU1234567' });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/ }));
    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledTimes(1));

    const complete = screen.getByRole('button', { name: 'Hoàn thành chuyến' });
    expect(complete).toHaveAttribute('aria-disabled', 'true');
    expect(complete).not.toBeDisabled();
    expect(reasonOf(complete)).toBe('Đang lưu thay đổi — chưa hoàn thành được.');

    resolveSave({});
  });
});
