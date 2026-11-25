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
// SIL-1034: the host mounts the PHÂN XE strip beside the workspace; it is
// unit-pinned in ShipmentExternalPlateSection.test.tsx — here it stays out
// of the wrapper contract's way.
vi.mock('../features/shipments/detail/ShipmentExternalPlateSection', () => ({
  ShipmentExternalPlateSection: () => null,
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
    // SIL-961 (K5.29): the default role here is CUS — it now carries the
    // lot-scope cost entry (canDeclareCost) alongside edit + delete + tờ khai.
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewTarget: { shipmentId: 9, canEditLot: true, canDeleteLot: true, canDeclareCost: true, canEditDeclaration: true } }),
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
      expect.objectContaining({ viewTarget: { shipmentId: 3, canEditLot: false, canDeleteLot: false, canDeclareCost: true, canEditDeclaration: false } }),
      undefined,
    );
  });

  it('DISPATCHER has both edit and delete revoked (SIL-706)', () => {
    userRole.current = 'DISPATCHER';
    renderAt('/shipments/4');
    // SIL-720 (id 840): the per-container tờ khai write follows the SIL-551
    // writer law (ADMIN/MANAGER/CUS/DISPATCHER) — the Điều vận may set the
    // declaration even though SIL-706 revoked its lot edit/delete.
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewTarget: { shipmentId: 4, canEditLot: false, canDeleteLot: false, canDeclareCost: false, canEditDeclaration: true } }),
      undefined,
    );
  });

  it('MANAGER holds both authorities: edit + the SIL-453 cost entry trio', () => {
    // SIL-453: MANAGER is in BOTH authorities — SHIPMENT_INTAKE_MUTATION_ROLES
    // (edit) and requireExpenseFinance (Khai chi phí).
    userRole.current = 'MANAGER';
    renderAt('/shipments/6');
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewTarget: { shipmentId: 6, canEditLot: true, canDeleteLot: false, canDeclareCost: true, canEditDeclaration: true } }),
      undefined,
    );
  });

  it('CUS sees [Khai chi phí] on the lot detail (SIL-961, K5.29 + memo 24/11 Mục 08)', () => {
    // The QA fail: tiepvv (Chứng từ) opened /shipments/1191 and the action bar
    // had Quay lại / Sửa / Tạo mới / Xóa lô — no Khai chi phí. The BE lot-scope
    // create lane admits CUS (expense-accounting-create gate), so the host
    // gate must too; ACCOUNTANT keeps the trio seat untouched.
    userRole.current = 'CUS';
    renderAt('/shipments/1191');
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewTarget: { shipmentId: 1191, canEditLot: true, canDeleteLot: true, canDeclareCost: true, canEditDeclaration: true } }),
      undefined,
    );
  });

  it('a signed-out view stays read-only', () => {
    userRole.current = undefined;
    renderAt('/shipments/5');
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewTarget: { shipmentId: 5, canEditLot: false, canDeleteLot: false, canDeclareCost: false, canEditDeclaration: false } }),
      undefined,
    );
  });

  it.each(['OPS', 'DRIVER', 'ACCOUNTANT'])('role %s gets no declaration affordance (SIL-551 writer law)', (role) => {
    // SIL-720 (id 840): the per-container tờ khai write is ADMIN/MANAGER/CUS/
    // ĐIỀU VẬN. Everyone else reads static text (the server would 403).
    userRole.current = role;
    renderAt('/shipments/7');
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ viewTarget: { shipmentId: 7, canEditLot: false, canDeleteLot: false, canDeclareCost: role === 'ACCOUNTANT', canEditDeclaration: false } }),
      undefined,
    );
  });
});
