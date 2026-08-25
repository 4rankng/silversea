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
    render(<MemoryRouter><ForwarderTripsPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Lệnh giao nhận' })).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/forwarder/me/work-inbox?view=ACTION&page=1&limit=100');
    expect(screen.queryByText('Tìm Bill, Booking hoặc tờ khai...')).toBeNull();
  });
});
