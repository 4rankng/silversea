import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const apiPut = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({
  api: { put: apiPut },
}));

import { BaseSalaryEditModal } from './base-salary-edit-modal';

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

describe('BaseSalaryEditModal', () => {
  beforeEach(() => {
    apiPut.mockClear();
    apiPut.mockResolvedValue({});
  });

  it('opens with the driver pre-selected and the current amount seeded', () => {
    renderModal();
    expect(screen.getByText(/Trần Văn Lái/)).toBeTruthy();
    const input = screen.getByDisplayValue('8000000');
    expect(input).toBeTruthy();
  });

  it('rejects empty and negative amounts — the Lưu button disables', () => {
    renderModal();
    const input = screen.getByDisplayValue('8000000');
    const save = screen.getByRole('button', { name: /Lưu/ });

    fireEvent.change(input, { target: { value: '-1000' } });
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: '' } });
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: '0' } });
    expect(save).toBeEnabled();
  });

  it('saves through the drivers catalog with the parsed amount and invalidates the salary query', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const input = screen.getByDisplayValue('8000000');
    fireEvent.change(input, { target: { value: '9500000' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu/ }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/drivers/39', { baseSalary: 9_500_000 });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('explains the locked-period policy', () => {
    renderModal();
    expect(screen.getByText(/Kỳ đã khóa hoặc đã xác nhận/)).toBeTruthy();
  });
});
