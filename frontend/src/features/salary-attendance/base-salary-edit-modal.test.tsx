import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const apiPut = vi.hoisted(() => vi.fn());
const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({
  api: { put: apiPut, get: apiGet },
}));

import { BaseSalaryEditModal } from './base-salary-edit-modal';

const DRIVER_UPDATED_AT = '2026-09-14T10:00:00.000Z';

function renderModal(overrides: Partial<Parameters<typeof BaseSalaryEditModal>[0]> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BaseSalaryEditModal
        isOpen
        onClose={() => {}}
        driverId={39}
        driverName="Trần Văn Lái"
        currentBaseSalary={8_000_000}
        year={2026}
        month={9}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

async function renderReady(overrides: Partial<Parameters<typeof BaseSalaryEditModal>[0]> = {}) {
  renderModal(overrides);
  // Wait for the version token to load — Lưu stays disabled until then.
  await waitFor(() => expect(screen.getByRole('button', { name: /Lưu/ })).toBeEnabled());
}

describe('BaseSalaryEditModal', () => {
  beforeEach(() => {
    apiPut.mockClear();
    apiGet.mockClear();
    apiPut.mockResolvedValue({});
    apiGet.mockResolvedValue({ id: 39, updatedAt: DRIVER_UPDATED_AT, baseSalary: '8000000' });
  });

  it('opens with the driver pre-selected and the current amount seeded', () => {
    renderModal();
    expect(screen.getByText(/Trần Văn Lái/)).toBeTruthy();
    const input = screen.getByDisplayValue('8000000');
    expect(input).toBeTruthy();
  });

  it('rejects empty and negative amounts — the Lưu button disables', async () => {
    await renderReady();
    const input = screen.getByDisplayValue('8000000');
    const save = screen.getByRole('button', { name: /Lưu/ });

    fireEvent.change(input, { target: { value: '-1000' } });
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: '' } });
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: '0' } });
    expect(save).toBeEnabled();
  });

  it('keeps Lưu disabled until the version token loads', async () => {
    apiGet.mockReturnValue(new Promise(() => {})); // fetch never settles
    renderModal();
    fireEvent.change(screen.getByDisplayValue('8000000'), { target: { value: '9500000' } });
    expect(screen.getByRole('button', { name: /Lưu/ })).toBeDisabled();
  });

  it('saves through the drivers catalog with the parsed amount and the loaded row token', async () => {
    const onClose = vi.fn();
    await renderReady({ onClose });
    fireEvent.change(screen.getByDisplayValue('8000000'), { target: { value: '9500000' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu/ }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/drivers/39', { baseSalary: 9_500_000 }, { expectedUpdatedAt: DRIVER_UPDATED_AT });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('on a 428 conflict, refreshes the token, keeps the amount, and explains', async () => {
    const onClose = vi.fn();
    apiPut.mockRejectedValueOnce({ status: 428, message: 'Precondition Required' });
    apiGet.mockResolvedValue({ id: 39, updatedAt: '2026-09-14T11:30:00.000Z', baseSalary: '9000000' });
    await renderReady({ onClose });
    fireEvent.change(screen.getByDisplayValue('8000000'), { target: { value: '9500000' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu/ }));

    await waitFor(() => expect(screen.getByText(/đã được cập nhật ở nơi khác/)).toBeTruthy());
    // The typed amount survives for the retry.
    expect(screen.getByDisplayValue('9500000')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    // Retry with the refreshed token goes through.
    fireEvent.click(screen.getByRole('button', { name: /Lưu/ }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(2));
    expect(apiPut).toHaveBeenLastCalledWith('/drivers/39', { baseSalary: 9_500_000 }, { expectedUpdatedAt: '2026-09-14T11:30:00.000Z' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('surfaces other save errors without closing', async () => {
    const onClose = vi.fn();
    apiPut.mockRejectedValue(new Error('Lỗi hệ thống'));
    await renderReady({ onClose });
    fireEvent.change(screen.getByDisplayValue('8000000'), { target: { value: '9500000' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu/ }));

    await waitFor(() => expect(screen.getByText(/Lỗi hệ thống/)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('explains the locked-period policy', () => {
    renderModal();
    expect(screen.getByText(/Kỳ đã khóa hoặc đã xác nhận/)).toBeTruthy();
  });
});
