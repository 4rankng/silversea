import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/shared/Toast';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
const { apiGet, downloadCSV } = vi.hoisted(() => ({ apiGet: vi.fn(), downloadCSV: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { get: apiGet, post: vi.fn(), put: vi.fn() }, ApiError: class ApiError extends Error {} }));
vi.mock('../lib/csv', () => ({ downloadCSV }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'CUS' } }) }));
vi.mock('@tingting/shared', async (importOriginal) => ({ ...(await importOriginal<typeof import('@tingting/shared')>()) }));
import ShipmentsPage from './ShipmentsPage';
describe('debug export bisect', () => {
  it('clicks XLSX without toolbar', async () => {
    apiGet.mockResolvedValue({ page: 1, limit: 20, total: 0, totalPages: 0, pageSummary: { needsSchedule: 0, needsVehicle: 0, waitingAccounting: 0, readyToLock: 0, needsAttention: 0 }, items: [] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter initialEntries={['/shipments']}><Routes><Route path="/shipments" element={<ShipmentsPage />} /></Routes></MemoryRouter></ToastProvider></QueryClientProvider>);
    await screen.findByRole('button', { name: 'Tải XLSX' });
    fireEvent.click(screen.getByRole('button', { name: 'Tải XLSX' }));
    await new Promise((r) => setTimeout(r, 400));
    process.stdout.write(`calls=${downloadCSV.mock.calls.length}\n`);
    expect(true).toBe(true);
  });
});
