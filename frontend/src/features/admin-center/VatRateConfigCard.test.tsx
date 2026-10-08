import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VatRateConfigCard } from './VatRateConfigCard';

const getMock = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({
  api: { get: getMock, put: putMock },
}));

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VatRateConfigCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VatRateConfigCard', () => {
  beforeEach(() => {
    getMock.mockReset();
    putMock.mockReset();
    getMock.mockResolvedValue(null);
    putMock.mockResolvedValue({ id: 1, vatRate: 0.08, createdAt: '', updatedAt: new Date().toISOString() });
  });

  it('offers the shared 8% default when unconfigured', async () => {
    renderCard();
    const trigger = await screen.findByRole('button', { name: /Thuế suất VAT/ });
    await waitFor(() => expect(trigger.textContent).toContain('8%'));
    expect(await screen.findByText(/Chưa cấu hình — mặc định/)).toBeTruthy();
  });

  it('shows only the policy-whitelist rates 0/5/8/10', async () => {
    renderCard();
    const trigger = await screen.findByRole('button', { name: /Thuế suất VAT/ });
    fireEvent.click(trigger);
    const listbox = await screen.findByRole('listbox');
    const options = Array.from(listbox.querySelectorAll('[role="option"], [data-key]'))
      .map((option) => option.textContent?.trim() ?? '');
    expect(options).toEqual(expect.arrayContaining([
      expect.stringContaining('0%'),
      expect.stringContaining('5%'),
      expect.stringContaining('8%'),
      expect.stringContaining('10%'),
    ]));
  });

  it('saves a chosen rate with the optimistic-lock token', async () => {
    getMock.mockResolvedValueOnce({ id: 1, vatRate: 0.05, createdAt: '', updatedAt: '2026-10-08T00:00:00.000Z' });
    getMock.mockResolvedValue({ id: 1, vatRate: 0.08, createdAt: '', updatedAt: '2026-10-08T00:01:00.000Z' });
    renderCard();
    const trigger = await screen.findByRole('button', { name: /Thuế suất VAT/ });
    await waitFor(() => expect(trigger.textContent).toContain('5%'));
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: '8%' }));
    const button = await screen.findByRole('button', { name: 'Lưu thuế suất' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(putMock).toHaveBeenCalledWith(
      '/vat-config',
      { vatRate: 0.08 },
      { expectedUpdatedAt: '2026-10-08T00:00:00.000Z' },
    ));
    expect(await screen.findByText('Đã lưu')).toBeTruthy();
  });
});
