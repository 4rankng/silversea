/**
 * Wave 4 M10.1 slice 2 — ClerkShipmentCreatePage tests.
 *
 * Verifies the M10-01-03 + Q23 contract from the UI side:
 *   - submit calls `POST /api/shipments/quick` with a client-generated
 *     `Idempotency-Key` header (UUID v4 shape);
 *   - on 201 the page navigates to the shipment detail;
 *   - on a server error the Vietnamese message is shown inline and the
 *     form values are preserved so the user can retry;
 *   - customerId is required — submit is blocked with a Vietnamese hint
 *     when no customer is selected.
 *
 * Mocks the shipment + customer API clients at the module boundary so the
 * test exercises the page's own orchestration, not the transport layer.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// vi.hoisted keeps the mock fns visible inside vi.mock factories (which
// Vitest hoists above all top-level declarations).
const { quickCreateMock, getBootstrapMock } = vi.hoisted(() => ({
  quickCreateMock: vi.fn(),
  getBootstrapMock: vi.fn(),
}));

vi.mock('../../api/shipmentClient', () => ({
  quickCreateShipment: quickCreateMock,
}));
vi.mock('../../api/tripClient', () => ({
  tripClient: { getBootstrap: getBootstrapMock },
}));

import ClerkShipmentCreatePage from './ClerkShipmentCreatePage';

const CUSTOMERS = [
  { id: 7, name: 'Công ty CP Vận tải ABC', deletedAt: null },
  { id: 9, name: 'Công ty TNHH XYZ', deletedAt: null },
];

function renderAt(path = '/clerk/shipments/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/clerk/shipments/new" element={<ClerkShipmentCreatePage />} />
        {/* Navigated-to destination on success — a sentinel that lets the
            test assert the redirect without mounting the real detail page. */}
        <Route path="/shipments/:id" element={<div data-testid="detail-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function waitForFormReady() {
  // SelectField renders a custom <button> trigger (not a native select), so
  // query by its visible label text instead of getByLabelText.
  await waitFor(() => expect(screen.getByText('Khách hàng')).toBeTruthy());
}

/**
 * SelectField is a custom dropdown (trigger button + option list), not a
 * native <select>. Drive it the way a user does: click the trigger, then
 * click the option. The trigger is the only button with `aria-haspopup=
 * "listbox"`; the placeholder text also appears in the hidden native
 * `<option>`, so a text query would be ambiguous.
 */
async function selectCustomer(label: string) {
  fireEvent.click(screen.getByRole('button', { name: /Chọn khách hàng/ }));
  const option = await screen.findByRole('option', { name: label });
  fireEvent.click(option);
}

describe('ClerkShipmentCreatePage — M10.1 quick-create', () => {
  beforeEach(() => {
    quickCreateMock.mockReset();
    getBootstrapMock.mockReset();
    getBootstrapMock.mockResolvedValue({ customers: CUSTOMERS });
  });

  it('loads customers into the dropdown', async () => {
    renderAt();
    await waitForFormReady();
    // Open the custom SelectField trigger (the aria-haspopup="listbox"
    // button); options appear in a listbox.
    fireEvent.click(screen.getByRole('button', { name: /Chọn khách hàng/ }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Công ty CP Vận tải ABC' })).toBeTruthy());
    expect(screen.getByRole('option', { name: 'Công ty TNHH XYZ' })).toBeTruthy();
  });

  it('blocks submit and shows a Vietnamese hint when no customer is selected', async () => {
    renderAt();
    await waitForFormReady();
    fireEvent.click(screen.getByRole('button', { name: /Tạo lô hàng/ }));
    expect(screen.getByText(/Vui lòng chọn khách hàng/)).toBeTruthy();
    expect(quickCreateMock).not.toHaveBeenCalled();
  });

  it('POSTs /api/shipments/quick with an Idempotency-Key header (UUID v4) on submit', async () => {
    quickCreateMock.mockResolvedValue({ id: 42, shipmentCode: 'SHP-2607-00042' });
    renderAt();
    await waitForFormReady();

    // Select a customer via the custom dropdown.
    await selectCustomer('Công ty CP Vận tải ABC');
    // Fill an optional field to assert it round-trips.
    fireEvent.change(screen.getByLabelText('Số booking'), { target: { value: 'BK-TEST-1' } });

    fireEvent.click(screen.getByRole('button', { name: /Tạo lô hàng/ }));

    await waitFor(() => expect(quickCreateMock).toHaveBeenCalledTimes(1));
    const [body, idempotencyKey] = quickCreateMock.mock.calls[0];
    expect(body).toMatchObject({ customerId: 7, bookingRef: 'BK-TEST-1' });
    // PRD M10-01-03 + Q23: client-generated UUID v4 dedupe token.
    expect(idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('navigates to the shipment detail on success (201 created)', async () => {
    quickCreateMock.mockResolvedValue({ id: 42, shipmentCode: 'SHP-2607-00042' });
    renderAt();
    await waitForFormReady();
    await selectCustomer('Công ty CP Vận tải ABC');
    fireEvent.click(screen.getByRole('button', { name: /Tạo lô hàng/ }));

    await waitFor(() => expect(screen.getByTestId('detail-page')).toBeTruthy());
  });

  it('navigates to the shipment detail on idempotent replay (200)', async () => {
    // The server returns the original shipment with 200 on a replay. The UI
    // treats both 201 and 200 as success — the api wrapper resolves either.
    quickCreateMock.mockResolvedValue({ id: 55, shipmentCode: 'SHP-2607-00055' });
    renderAt();
    await waitForFormReady();
    await selectCustomer('Công ty TNHH XYZ');
    fireEvent.click(screen.getByRole('button', { name: /Tạo lô hàng/ }));

    await waitFor(() => expect(screen.getByTestId('detail-page')).toBeTruthy());
  });

  it('shows the server error inline and preserves form values on failure', async () => {
    const err = new Error('Khóa giao dịch trùng nhưng nội dung khác — vui lòng dùng mã giao dịch mới.');
    quickCreateMock.mockRejectedValue(err);
    renderAt();
    await waitForFormReady();
    await selectCustomer('Công ty CP Vận tải ABC');
    fireEvent.change(screen.getByLabelText('Số vận đơn (B/L)'), { target: { value: 'MAEU-KEEP' } });
    fireEvent.click(screen.getByRole('button', { name: /Tạo lô hàng/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/Khóa giao dịch trùng/)).toBeTruthy();
    // The form retains what the user typed so they can adjust + retry.
    expect((screen.getByLabelText('Số vận đơn (B/L)') as HTMLInputElement).value).toBe('MAEU-KEEP');
  });

  it('falls back to a generic Vietnamese error when the API throws without a message', async () => {
    quickCreateMock.mockRejectedValue(new Error());
    renderAt();
    await waitForFormReady();
    await selectCustomer('Công ty CP Vận tải ABC');
    fireEvent.click(screen.getByRole('button', { name: /Tạo lô hàng/ }));

    await waitFor(() => expect(screen.getByText(/Không thể tạo lô hàng/)).toBeTruthy());
  });

  it('shows a Vietnamese error when the customer list fails to load', async () => {
    getBootstrapMock.mockRejectedValue(new Error('network down'));
    renderAt();
    await waitFor(() => expect(screen.getByText(/Không thể tải danh sách khách hàng/)).toBeTruthy());
    // The form is not rendered when customers can't load, so the quick-create
    // call is impossible.
    expect(quickCreateMock).not.toHaveBeenCalled();
  });
});
