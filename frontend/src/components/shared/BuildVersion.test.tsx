import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildVersion } from './BuildVersion';
const get = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({ api: { get } }));
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BuildVersion /></QueryClientProvider>); }
describe('current server support version', () => {
  beforeEach(() => get.mockReset());
  it('shows the exact backend build identifier', async () => {
    get.mockResolvedValue({ buildHash: 'd4d736603987' });
    show();
    expect(await screen.findByText('d4d736603987')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/health');
  });
  it('offers retry without inventing a version when health is unavailable', async () => {
    get.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({ buildHash: 'recovered-build' });
    show();
    expect(await screen.findByText('Chưa đọc được')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('recovered-build')).toBeTruthy();
  });
});
