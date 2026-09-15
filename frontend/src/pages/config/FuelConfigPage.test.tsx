import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FuelConfigPage from './FuelConfigPage';

const { query, save, history } = vi.hoisted(() => ({ query: { data: null as null | Record<string, string>, isLoading: false, isError: false, refetch: vi.fn() }, save: vi.fn(), history: vi.fn() }));
vi.mock('../../hooks/useCatalogQueries', () => ({ useFuelConfig: () => query, useSaveFuelConfig: () => ({ mutateAsync: save }) }));
vi.mock('../../api/configClient', () => ({ configClient: { getFuelPriceHistory: history } }));
vi.mock('../../hooks/animations', () => ({ usePageAnimations: () => ({ rootRef: { current: null } }) }));

function screenTree() {
  return <QueryClientProvider client={new QueryClient()}><MemoryRouter><FuelConfigPage /></MemoryRouter></QueryClientProvider>;
}
function fillRequired() {
  fireEvent.change(screen.getByLabelText('Định mức có tải (lít/100km)'), { target: { value: '35' } });
  fireEvent.change(screen.getByLabelText('Định mức xe không (lít/100km)'), { target: { value: '22' } });
  fireEvent.change(screen.getByLabelText('Đơn giá nhiên liệu hiện hành (đ/lít)'), { target: { value: '23000' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  query.data = null; query.isLoading = false; query.isError = false;
  history.mockResolvedValue([]);
});

describe('initial and conflicting fuel configuration', () => {
  it('saves a genuine initial configuration without a missing-version token', async () => {
    save.mockResolvedValue({});
    render(screenTree());
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).not.toHaveProperty('expectedUpdatedAt');
    expect(save.mock.calls[0][0]).toMatchObject({ loadedNorm: 35, emptyNorm: 22, unitPrice: 23000 });
  });

  it('keeps the edited draft when the authoritative version refreshes after conflict', async () => {
    query.data = { loadedNorm: '30', emptyNorm: '20', unitPrice: '20000', updatedAt: '2026-09-01T00:00:00Z' };
    save.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));
    const ui = render(screenTree());
    fireEvent.change(screen.getByLabelText('Định mức có tải (lít/100km)'), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await screen.findByText(/Giữ nguyên các giá trị bạn nhập/);
    query.data = { ...query.data, loadedNorm: '40', updatedAt: '2026-09-02T00:00:00Z' };
    ui.rerender(screenTree());
    expect((screen.getByLabelText('Định mức có tải (lít/100km)') as HTMLInputElement).value).toBe('35');
    expect(save.mock.calls[0][0].expectedUpdatedAt).toBe('2026-09-01T00:00:00Z');
    save.mockResolvedValue({});
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toMatchObject({ loadedNorm: 35, expectedUpdatedAt: '2026-09-02T00:00:00Z' });
  });

  it('does not turn a failed config read into an empty first-save form', () => {
    query.isError = true;
    render(screenTree());
    expect(screen.getByRole('button', { name: 'Lưu cấu hình' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tải lại cấu hình' })).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});
