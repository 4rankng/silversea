import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCenterPage from './AdminCenterPage';

const getMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ api: { get: getMock } }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminCenterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminCenterPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue({
      asOf: new Date().toISOString(), timezone: 'Asia/Ho_Chi_Minh',
      counts: { action: 0, waiting: 0, done: 5 }, page: 1, limit: 100, total: 1, totalPages: 1,
      items: [{
        id: 'health:database', entityType: 'system_health', entityId: 'database',
        title: 'Nguồn dữ liệu PostgreSQL', subtitle: 'Sẵn sàng', state: 'DONE', priority: 10,
        dueAt: null, freshnessAt: new Date().toISOString(), blockers: [], advisories: [],
        nextAction: null, targetRoute: null, healthState: 'HEALTHY', source: 'database',
      }],
    });
  });

  it('renders the health workspace from the admin-health endpoint', async () => {
    renderPage();
    expect(getMock).toHaveBeenCalledWith('/system/admin-health?page=1&limit=100');
    expect(await screen.findByText('Sức khỏe và mức độ sẵn sàng')).toBeTruthy();
    expect(await screen.findByText('Nguồn dữ liệu PostgreSQL')).toBeTruthy();
    expect(screen.getByText('Các nguồn đang ổn định')).toBeTruthy();
  });
});
