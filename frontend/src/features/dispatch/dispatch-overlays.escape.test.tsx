// SIL-577 — Escape phải đóng shell của cả 3 overlay dispatch (container drawer,
// Phân xe lại, Phân bổ nhà xe) từ bất kỳ đâu bên trong; Escape trên inline edit
// input của drawer chỉ revert edit (không đóng shell). Fixtures/mocks theo
// đúng recipe của DispatchAllocationLclDialog.quick-add.test.tsx.
import { render, screen, fireEvent, waitFor, configure } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ShipmentListItem } from '../../api/shipmentClient';
import type * as ApiModule from '../../lib/api';

configure({ asyncUtilTimeout: 4_000 });

vi.mock('../../api/tripClient', () => ({
  tripClient: {
    getBootstrap: vi.fn().mockResolvedValue({
      externalCarriers: [{ id: 77, name: 'HÀ AN', isActive: true }],
    }),
  },
}));

vi.mock('../../api/shipmentClient', () => ({
  saveShipmentCarrierAllocations: vi.fn(),
  getCusShipmentWorkspaceDetail: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../api/dispatchPlanningClient', () => ({
  listDispatchFleetResources: vi.fn().mockResolvedValue({
    items: [{ licensePlate: '30H-123.45' }],
  }),
  updateLclTruck: vi.fn().mockResolvedValue({ updatedShipmentIds: [2] }),
  assignLclCostGroup: vi.fn(),
  createInternalTruck: vi.fn(),
  createCarrierFleetVehicle: vi.fn(),
}));

vi.mock('../../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  // SIL-555/629: drawer mount calls useToastOptional() — same mock recipe the
  // MasterPlanPage* / DispatchContainerDetailDrawer test fixes adopted.
  useToastOptional: () => ({ toast: vi.fn() }),
}));

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof ApiModule>(),
  api: {
    get: apiGet,
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    upload: vi.fn().mockResolvedValue({}),
  },
}));

import { DispatchContainerDetailDrawer } from './master-plan/DispatchContainerDetailDrawer';
import { DispatchAllocationLclDialog } from './master-plan/DispatchAllocationLclDialog';
import { AssignTruckGroupDialog, type LclGroupDialogRow } from './detailed-plan/AssignTruckGroupDialog';
import { registerOverlayToken, unregisterOverlayToken } from '../../hooks/useAnimatedOverlay';
import { Modal } from '../../design-system/Modal';

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

const lclRows: LclGroupDialogRow[] = [{
  shipmentId: 2,
  reference: 'BL-2026-002',
  customerName: 'Công ty ABC',
  cargoWeightKg: null,
  cargoVolumeCbm: null,
  group: null,
  carrierType: null,
  externalCarrierId: null,
}];

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      {ui}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockImplementation(() => Promise.resolve({ items: [] }));
});

// Simulates the live SIL-577 class: a page-level layer sitting ABOVE the
// dialog in the overlay token stack. The window-level Escape path yields to
// it — the shell must still close through its own root handler.
function PageLayerToken() {
  useEffect(() => {
    const token = registerOverlayToken();
    return () => unregisterOverlayToken(token);
  }, []);
  return null;
}

function EditModalHarness({ onClose }: { onClose: () => void }) {
  return (
    <Modal isOpen onClose={onClose} title="Soạn nội dung">
      <input
        aria-label="Ô soạn"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
    </Modal>
  );
}

describe('dispatch overlays — shell Escape (SIL-577)', () => {
  it('Phân bổ nhà xe: Escape closes the dialog and hands focus back to the opener', async () => {
    const onClose = vi.fn();
    renderWithClient(<DispatchAllocationLclDialog shipment={lclShipment()} onClose={onClose} onSaved={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Phân bổ nhà xe' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Phân xe lại: Escape closes the dialog', async () => {
    const onClose = vi.fn();
    renderWithClient(<AssignTruckGroupDialog rows={lclRows} onClose={onClose} onAssigned={vi.fn()} />);
    await screen.findByRole('dialog', { name: /Gán xe nhóm/ });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('container drawer: Escape closes the drawer shell', async () => {
    const onClose = vi.fn();
    renderWithClient(<DispatchContainerDetailDrawer shipment={lclShipment()} onClose={onClose} />);
    await screen.findByRole('dialog', { name: 'Chi tiết container' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('closes via the shell root even when a page layer owns the top overlay token', async () => {
    const onClose = vi.fn();
    const dialog = <DispatchAllocationLclDialog shipment={lclShipment()} onClose={onClose} onSaved={vi.fn()} />;
    const { rerender } = renderWithClient(dialog);
    await screen.findByRole('dialog', { name: 'Phân bổ nhà xe' });
    rerender(<>{dialog}<PageLayerToken /></>);
    const shell = screen.getByRole('dialog', { name: 'Phân bổ nhà xe' });
    const target = shell.querySelector<HTMLElement>('button');
    expect(target).toBeTruthy();
    fireEvent.keyDown(target as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('inner-edit Escape reverts the edit only — the shell stays open until a later Escape', async () => {
    const onClose = vi.fn();
    renderWithClient(<EditModalHarness onClose={onClose} />);
    const input = screen.getByLabelText('Ô soạn');
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Soạn nội dung' }), { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Escape hands focus back to the opener button (SIL-577 focus clause)', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Phân bổ';
    document.body.appendChild(opener);
    const openerRef = { current: opener as HTMLElement | null };
    function Harness() {
      const [open, setOpen] = useState(true);
      return open
        ? <DispatchAllocationLclDialog shipment={lclShipment()} openerRef={openerRef} onClose={() => setOpen(false)} onSaved={vi.fn()} />
        : null;
    }
    renderWithClient(<Harness />);
    await screen.findByRole('dialog', { name: 'Phân bổ nhà xe' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });
});
