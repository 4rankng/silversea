import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { workspaceMock, userRole } = vi.hoisted(() => ({
  workspaceMock: vi.fn(() => <div data-testid="view-workspace" />),
  userRole: { current: 'CUS' as string | undefined },
}));

vi.mock('../features/shipments/create/ShipmentCreateWorkspace', () => ({
  ShipmentCreateWorkspace: workspaceMock,
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: userRole.current == null ? null : { role: userRole.current } }),
}));

import ShipmentDetailPage from './ShipmentDetailPage';

function LocationProbe() {
  return <div data-testid="location" data-path={useLocation().pathname} />;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
        <Route path="/shipments" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ShipmentDetailPage — SIL-481 post-create review wrapper', () => {
  beforeEach(() => {
    workspaceMock.mockClear();
    userRole.current = 'CUS';
  });

  it('renders the create-form workspace in VIEW mode pinned to the route id', () => {
    renderAt('/shipments/9');
    expect(screen.getByTestId('view-workspace')).toBeTruthy();
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewTarget: { shipmentId: 9, canEditLot: true, canDeleteLot: true, canDeclareCost: false } }),
      undefined,
    );
  });

  it('an invalid id lands on the lô list instead of a broken form', () => {
    renderAt('/shipments/abc');
    expect(workspaceMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').getAttribute('data-path')).toBe('/shipments');
  });

  it('roles PUT /shipments/:id refuses (ACCOUNTANT) review without the edit gate', () => {
    userRole.current = 'ACCOUNTANT';
    renderAt('/shipments/3');
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewTarget: { shipmentId: 3, canEditLot: false, canDeleteLot: false, canDeclareCost: true } }),
      undefined,
    );
  });

  it('DISPATCHER has both edit and delete revoked (SIL-706)', () => {
    userRole.current = 'DISPATCHER';
    renderAt('/shipments/4');
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewTarget: { shipmentId: 4, canEditLot: false, canDeleteLot: false, canDeclareCost: false } }),
      undefined,
    );
  });

  it('MANAGER holds both authorities: edit + the SIL-453 cost entry trio', () => {
    // SIL-453: MANAGER is in BOTH authorities — SHIPMENT_INTAKE_MUTATION_ROLES
    // (edit) and requireExpenseFinance (Khai chi phí).
    userRole.current = 'MANAGER';
    renderAt('/shipments/6');
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewTarget: { shipmentId: 6, canEditLot: true, canDeleteLot: false, canDeclareCost: true } }),
      undefined,
    );
  });

  it('a signed-out view stays read-only', () => {
    userRole.current = undefined;
    renderAt('/shipments/5');
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewTarget: { shipmentId: 5, canEditLot: false, canDeleteLot: false, canDeclareCost: false } }),
      undefined,
    );
  });
});
