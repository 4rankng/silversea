import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForwarderTripsPage from './ForwarderTripsPage';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: { get: apiGet, post: vi.fn() },
}));

describe('ForwarderTripsPage operations inbox', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({
      asOf: new Date().toISOString(),
      timezone: 'Asia/Ho_Chi_Minh',
      counts: { action: 0, waiting: 0, done: 0 },
      page: 1,
      limit: 100,
      total: 0,
      totalPages: 0,
      items: [],
    });
  });

  it('uses the role-scoped work inbox without mounting the legacy list', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ForwarderTripsPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Lệnh giao nhận' })).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/forwarder/me/work-inbox?view=ACTION&page=1&limit=100');
    expect(screen.queryByText('Tìm Bill, Booking hoặc tờ khai...')).toBeNull();
  });

  it('spells the inbox subtitle with the correct "hồ sơ" copy', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ForwarderTripsPage /></MemoryRouter></QueryClientProvider>);
    const subtitle = await screen.findByText(/hồ sơ chuyến vẫn là nơi xử lý chi tiết/);
    expect(subtitle.textContent).toContain('hồ sơ');
    expect(screen.queryByText(/hỗ sơ/)).toBeNull();
  });
});
