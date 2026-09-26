import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/shared/Toast';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { get: apiGet, post: vi.fn(), put: vi.fn() }, ApiError: class ApiError extends Error {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'CUS' } }) }));
vi.mock('../lib/csv', () => ({ downloadCSV: vi.fn() }));
import { useLocation } from 'react-router-dom';
import ShipmentsPage from './ShipmentsPage';

function UrlProbe() {
  const { search } = useLocation();
  return <div data-testid="url-probe" data-search={search} />;
}

describe('debug multi bucket', () => {
  afterEach(() => vi.restoreAllMocks());
  it('traces urls', async () => {
    apiGet.mockResolvedValue({ items: [], total: 0, totalPages: 0, pageSummary: { needsSchedule: 0, needsVehicle: 0, waitingAccounting: 0, readyToLock: 0, needsAttention: 0 } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}><ToastProvider><MemoryRouter initialEntries={['/shipments']}><Routes><Route path="/shipments" element={<><UrlProbe /><ShipmentsPage /></>} /></Routes></MemoryRouter></ToastProvider></QueryClientProvider>,
    );
    await screen.findByRole('button', { name: 'Chọn kế hoạch…' });
    fireEvent.click(screen.getByRole('button', { name: 'Chọn kế hoạch…' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Mới tạo' }));
    await waitFor(() => expect(String(apiGet.mock.lastCall?.[0])).toContain('bucket=NEW'));
    console.log('CALLS_AFTER_1:', apiGet.mock.calls.map((c) => c[0]).join(' || '));
    fireEvent.click(await screen.findByRole('option', { name: 'Đã khóa' }));
    await new Promise((r) => setTimeout(r, 800));
    const search = document.querySelector('[data-testid="url-probe"]')?.getAttribute('data-search') ?? 'NO PROBE';
    const fs = await import('node:fs');
    fs.writeFileSync('/tmp/debug-calls.txt', 'SEARCH=' + search + '\n' + apiGet.mock.calls.map((c) => c[0]).join('\n'));
    expect(true).toBe(true);
  });
});
