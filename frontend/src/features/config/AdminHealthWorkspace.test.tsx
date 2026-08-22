import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminHealthWorkspace } from './AdminHealthWorkspace';

const getMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({ api: { get: getMock } }));

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><AdminHealthWorkspace /></MemoryRouter></QueryClientProvider>);
}

function item(healthState: 'HEALTHY' | 'FAILED' | 'UNAVAILABLE', source: string, title: string) {
  return {
    id: `health:${source}`, entityType: 'system_health', entityId: source, title,
    subtitle: healthState === 'UNAVAILABLE' ? 'Nguồn dữ liệu không khả dụng' : 'Dữ liệu máy chủ',
    state: healthState === 'HEALTHY' ? 'DONE' : 'ACTION', priority: 10, dueAt: null,
    freshnessAt: new Date().toISOString(), blockers: [], advisories: [],
    nextAction: { label: 'Mở chi tiết', targetRoute: '/users' }, targetRoute: '/users', healthState, source,
  };
}

describe('AdminHealthWorkspace', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue({
      asOf: new Date().toISOString(), timezone: 'Asia/Ho_Chi_Minh',
      counts: { action: 2, waiting: 0, done: 1 }, page: 1, limit: 100, total: 3, totalPages: 1,
      items: [
        item('HEALTHY', 'users_permissions', 'Người dùng và phân quyền'),
        item('FAILED', 'durable_effect_jobs', 'Tác vụ thông báo thất bại'),
        item('UNAVAILABLE', 'audit', 'Hoạt động kiểm toán gần đây'),
      ],
    });
  });

  it('keeps unavailable distinct from healthy and exposes real action routes', async () => {
    renderWorkspace();
    expect(await screen.findByText('Người dùng và phân quyền')).toBeTruthy();
    expect(screen.getByText('Ổn định')).toBeTruthy();
    expect(screen.getByText('Cần xử lý')).toBeTruthy();
    expect(screen.getByText('Không khả dụng')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Mở chi tiết' })[0].getAttribute('href')).toBe('/users');
  });

  it('renders an unavailable source when the health endpoint itself fails', async () => {
    getMock.mockRejectedValue(new Error('health source unavailable'));
    renderWorkspace();
    expect((await screen.findByRole('alert')).textContent).toContain('Nguồn sức khỏe hệ thống không khả dụng');
    expect(screen.queryByText('Các nguồn đang ổn định')).toBeNull();
  });
});
