/**
 * SIL-714 — TripExternalPlateDialog (Cập nhật biển số xe ngoài, Spec I.4e).
 * Pins the consumer-visible contract shared by the /dispatch-detail row menu
 * (Điều vận) and the /shipments-detail PHÂN XE cell (Chứng từ): self-load,
 * seed, mandatory plate, version-locked save, inline 409.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ShipmentClientModule from '../../api/shipmentClient';

const { getContextMock, updatePlateMock } = vi.hoisted(() => ({
  getContextMock: vi.fn(),
  updatePlateMock: vi.fn(),
}));
vi.mock('../../api/shipmentClient', async (importOriginal) => {
  const actual = await importOriginal<typeof ShipmentClientModule>();
  return {
    ...actual,
    getExternalTripPlateContext: getContextMock,
    updateExternalTripPlate: updatePlateMock,
  };
});

import { TripExternalPlateDialog } from './TripExternalPlateDialog';

const context = (overrides: {
  tripId?: number;
  tripCode?: string | null;
  status?: string | null;
  carrierType?: 'OWN' | 'EXTERNAL';
  version?: number;
  externalPlateNumber?: string | null;
} = {}) => ({
  tripId: 356,
  tripCode: 'TRP-356',
  status: 'CREATED',
  carrierType: 'EXTERNAL' as const,
  version: 7,
  externalPlateNumber: null,
  ...overrides,
});

function renderDialog(tripId: number | null = 356, onSaved = vi.fn()) {
  const onClose = vi.fn();
  render(<TripExternalPlateDialog tripId={tripId} carrierName="ĐĂNG QUÂN" onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}

beforeEach(() => {
  getContextMock.mockReset();
  updatePlateMock.mockReset();
});

describe('TripExternalPlateDialog — SIL-714', () => {
  it('loads the trip context on open and seeds the plate input', async () => {
    getContextMock.mockResolvedValue(context());
    renderDialog();
    await waitFor(() => expect(getContextMock).toHaveBeenCalledWith(356));
    const plate = await screen.findByLabelText('Biển số xe *') as HTMLInputElement;
    expect(plate.value).toBe('');
    expect(screen.getByText(/TRP-356 · ĐĂNG QUÂN/)).toBeTruthy();
  });

  it('validates on submit — an empty plate shows the inline error and never calls the client', async () => {
    getContextMock.mockResolvedValue(context());
    renderDialog();
    await screen.findByLabelText('Biển số xe *');
    const save = screen.getByRole('button', { name: /Lưu biển số/ });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Biển số xe là bắt buộc');
    expect(screen.getByLabelText('Biển số xe *')).toHaveAttribute('aria-invalid', 'true');
    expect(updatePlateMock).not.toHaveBeenCalled();
  });

  it('saves the trimmed plate with the served version and reports back', async () => {
    getContextMock.mockResolvedValue(context());
    updatePlateMock.mockResolvedValue(context({ externalPlateNumber: '60H-222.22', version: 8 }));
    const { onClose, onSaved } = renderDialog();
    const plate = await screen.findByLabelText('Biển số xe *');
    fireEvent.change(plate, { target: { value: ' 60h-222.22 ' } });
    // Inline normalization uppercases (never mid-typing trims); the payload trims.
    expect((plate as HTMLInputElement).value).toBe(' 60H-222.22 ');
    fireEvent.click(screen.getByRole('button', { name: /Lưu biển số/ }));
    await waitFor(() => expect(updatePlateMock).toHaveBeenCalledWith(356, {
      externalPlateNumber: '60H-222.22',
      expectedVersion: 7,
    }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ version: 8 })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('seeds the existing plate so a correction is a no-op until edited', async () => {
    getContextMock.mockResolvedValue(context({ externalPlateNumber: '60H-111.11' }));
    renderDialog();
    const plate = await screen.findByLabelText('Biển số xe *') as HTMLInputElement;
    expect(plate.value).toBe('60H-111.11');
  });

  it('surfaces the server 409 verbatim and keeps the dialog open', async () => {
    getContextMock.mockResolvedValue(context());
    updatePlateMock.mockRejectedValue(new Error('Chuyến đi đã bị thay đổi. Vui lòng tải lại.'));
    renderDialog();
    const plate = await screen.findByLabelText('Biển số xe *');
    fireEvent.change(plate, { target: { value: '60H-222.22' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu biển số/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Chuyến đi đã bị thay đổi. Vui lòng tải lại.');
    expect(screen.queryByRole('dialog', { hidden: true })).toBeTruthy();
  });

  it('a failed context load shows the error instead of the form', async () => {
    getContextMock.mockRejectedValue(new Error('Không tìm thấy chuyến đi.'));
    renderDialog();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Không tìm thấy chuyến đi.');
    expect(screen.queryByLabelText('Biển số xe *')).toBeNull();
  });
});
