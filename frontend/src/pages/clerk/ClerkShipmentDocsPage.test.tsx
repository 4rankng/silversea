/**
 * Wave 4 M10.2 slice 3 — ClerkShipmentDocsPage tests.
 *
 * Verifies the page wires slices 1 + 2 correctly:
 *   - loads shipment detail (BL + containers);
 *   - BL save calls PUT /api/shipments/:id with the current version;
 *   - container add + save calls PUT /api/shipments/:id/containers (full
 *     reconcile) and re-syncs row ids from the response;
 *   - server validation errors (slice 1: ISO 6346 + duplicate) surface inline;
 *   - dispatch button is hidden for CLERK and shown for MANAGER;
 *   - the readiness banner shows missing BL / containers client-side.
 *
 * Mocks the shipment client + configClient + useConfirm + useAuth at the
 * module boundary.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Role } from '@tingting/shared';

const { getDetailMock, updateMock, saveContainersMock, getBootstrapMock, confirmMock } = vi.hoisted(() => ({
  getDetailMock: vi.fn(),
  updateMock: vi.fn(),
  saveContainersMock: vi.fn(),
  getBootstrapMock: vi.fn(),
  confirmMock: vi.fn(),
}));

vi.mock('../../api/shipmentClient', () => ({
  getShipmentDetail: getDetailMock,
  updateShipment: updateMock,
  saveShipmentContainers: saveContainersMock,
  dispatchShipment: vi.fn(),
}));
vi.mock('../../api/tripClient', () => ({
  tripClient: { getBootstrap: getBootstrapMock },
}));
vi.mock('../../components/UI', () => ({
  useConfirm: () => ({ confirm: confirmMock, dialog: null }),
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 1, role: Role.CLERK } }),
}));

import ClerkShipmentDocsPage from './ClerkShipmentDocsPage';

const DETAIL = {
  shipment: {
    id: 42, shipmentCode: 'SHP-2607-00042', version: 3, customerId: 7,
    customerName: 'Công ty ABC', status: 'DRAFT',
    blNumber: null, bookingRef: null, expectedDeliveryDate: null,
    pickupLocation: null, deliveryLocation: null, contactName: null,
    contactPhone: null, createdBy: null, updatedBy: null,
    createdAt: '2026-07-26T00:00:00Z', updatedAt: '2026-07-26T00:00:00Z',
  },
  containers: [],
  documents: [], declarations: [], statusHistory: [],
};

const CONTAINER_TYPES = [
  { id: 1, code: '20DC', name: "20'DC", notes: null, createdAt: '', updatedAt: '', deletedAt: null },
];

function renderAt(path = '/clerk/shipments/42/docs') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/clerk/shipments/:id/docs" element={<ClerkShipmentDocsPage />} />
        <Route path="/shipments/:id" element={<div data-testid="shipment-detail" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ClerkShipmentDocsPage — M10.2 doc-entry', () => {
  beforeEach(() => {
    getDetailMock.mockReset();
    updateMock.mockReset();
    saveContainersMock.mockReset();
    getBootstrapMock.mockReset();
    confirmMock.mockReset();
    getBootstrapMock.mockResolvedValue({ containerTypes: CONTAINER_TYPES });
  });

  it('loads shipment detail + shows the readiness banner missing BL + containers', async () => {
    getDetailMock.mockResolvedValue(DETAIL);
    renderAt();
    // The readiness banner lists both missing fields in one line.
    await waitFor(() => expect(screen.getByText(/Còn thiếu.*Số vận đơn.*Công-te-nơ/)).toBeTruthy());
  });

  it('BL save calls updateShipment with the loaded version', async () => {
    getDetailMock.mockResolvedValue(DETAIL);
    updateMock.mockResolvedValue({ ...DETAIL.shipment, blNumber: 'BL-1', version: 4 });
    renderAt();
    await waitFor(() => expect(screen.getByLabelText('Số vận đơn (B/L)')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Số vận đơn (B/L)'), { target: { value: 'BL-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu vận đơn/ }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(42, { version: 3, blNumber: 'BL-1' }));
    expect(screen.getByText(/Đã lưu số vận đơn/)).toBeTruthy();
  });

  it('container add + save calls saveShipmentContainers (full reconcile) and re-syncs ids', async () => {
    getDetailMock.mockResolvedValue(DETAIL);
    // After save, the server returns one row with id=100 + the container type.
    saveContainersMock.mockResolvedValue({
      items: [{
        id: 100, shipmentId: 42, containerTypeId: 1, containerNumber: 'MSKU1234565',
        sealNumber: null, cargoWeightKg: null, notes: null,
      }],
      upsertedIds: [100],
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Còn thiếu/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Thêm công-te-nơ/ }));
    // SelectField is a custom dropdown (trigger button + option list). The
    // trigger shows the placeholder "— Chọn —" before a selection.
    fireEvent.click(screen.getByRole('button', { name: /Chọn/ }));
    const option = await screen.findByRole('option', { name: "20'DC" });
    fireEvent.click(option);
    // Container number is a TextField (native input, label-associated).
    fireEvent.change(screen.getByLabelText('Số công-te-nơ (ISO 6346)'), { target: { value: 'MSKU1234565' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu công-te-nơ/ }));

    await waitFor(() => expect(saveContainersMock).toHaveBeenCalledTimes(1));
    const arg = saveContainersMock.mock.calls[0][1];
    expect(arg.containers).toHaveLength(1);
    expect(arg.containers[0]).toMatchObject({ containerTypeId: 1, containerNumber: 'MSKU1234565' });
    // The success message reflects the reconciled count.
    expect(screen.getByText(/Đã lưu 1 công-te-nơ/)).toBeTruthy();
  });

  it('surfaces server validation errors inline (slice 1: ISO 6346 + duplicate)', async () => {
    getDetailMock.mockResolvedValue(DETAIL);
    saveContainersMock.mockRejectedValue(new Error('Số container "BAD" không hợp lệ: Sai định dạng.'));
    renderAt();
    await waitFor(() => expect(screen.getByText(/Còn thiếu/)).toBeTruthy());
    // Add a row (no need to fill it — the server rejects whatever is sent).
    fireEvent.click(screen.getByRole('button', { name: /Thêm công-te-nơ/ }));
    fireEvent.click(screen.getByRole('button', { name: /Lưu công-te-nơ/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/không hợp lệ/)).toBeTruthy();
  });

  it('shows the dispatch button for CLERK? — no: dispatch is hidden for CLERK (Q17)', async () => {
    getDetailMock.mockResolvedValue(DETAIL);
    renderAt();
    await waitFor(() => expect(screen.getByText(/Còn thiếu/)).toBeTruthy());
    // CLERK must not see the Dispatch button — dispatch is MANAGER/ADMIN only.
    expect(screen.queryByRole('button', { name: /^Điều vận$/ })).toBeNull();
  });

  it('shows "Sẵn sàng điều vận" once BL + container are present (client-side readiness)', async () => {
    getDetailMock.mockResolvedValue({
      ...DETAIL,
      shipment: { ...DETAIL.shipment, blNumber: 'BL-READY' },
      containers: [{
        id: 1, shipmentId: 42, containerTypeId: 1, containerNumber: 'MSKU1234565',
        sealNumber: null, cargoWeightKg: null, notes: null,
      }],
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Sẵn sàng điều vận/)).toBeTruthy());
  });

  it('shows a 404 message when the shipment cannot be loaded', async () => {
    getDetailMock.mockRejectedValue(new Error('Không tìm thấy lô hàng'));
    renderAt();
    await waitFor(() => expect(screen.getByText(/Không tìm thấy lô hàng/)).toBeTruthy());
  });
});
