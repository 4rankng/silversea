import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentCusContainerFlatResponse } from '@tingting/shared';
import { formatVietnamDateInput } from '../lib/shipment-operations';

vi.setConfig({ testTimeout: 15000 });

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  useToastOptional: () => ({ toast: vi.fn() }),
}));
vi.mock('../lib/api', () => ({
  api: { get: apiGet, post: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

import ShipmentContainersPage from './ShipmentContainersPage';

const today = formatVietnamDateInput(new Date());
const response = { page: 1, limit: 20, total: 0, totalPages: 1, filterOptions: { customers: [] }, items: [] } as unknown as ShipmentCusContainerFlatResponse;

const plus3 = new Date(Date.now() + 3 * 86_400_000);
const plus3Iso = formatVietnamDateInput(plus3);
const plus3Text = `${plus3Iso.slice(8, 10)}/${plus3Iso.slice(5, 7)}/${plus3Iso.slice(0, 4)}`;

describe('scratch SIL-434', () => {
  beforeEach(() => { apiGet.mockReset(); });

  it('observes the From-first flow', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());

    const from = screen.getByLabelText('Từ ngày') as HTMLInputElement;
    const to = screen.getByLabelText('Đến ngày') as HTMLInputElement;
    console.log('TODAY', today, 'PLUS3', plus3Iso);
    console.log('from.max =', JSON.stringify(from.max), 'to.min =', JSON.stringify(to.min));
    console.log('from.value =', JSON.stringify(from.value), 'to.value =', JSON.stringify(to.value));

    const calls: string[] = [];
    apiGet.mockImplementation((url: string) => { calls.push(url); return Promise.resolve(response); });

    await act(async () => { fireEvent.change(from, { target: { value: plus3Text } }); });
    console.log('AFTER FROM EDIT:', calls[calls.length - 1]);
    console.log('from.value now =', JSON.stringify(from.value), 'error text =', document.querySelector('.ds-uui-date-hint--error')?.textContent);

    await act(async () => { fireEvent.change(to, { target: { value: plus3Text } }); });
    console.log('AFTER TO EDIT:', calls[calls.length - 1]);
    console.log('from.value now =', JSON.stringify(from.value), 'to.value now =', JSON.stringify(to.value));
  });

  it('observes the To-first flow', async () => {
    apiGet.mockResolvedValue(response);
    render(<MemoryRouter><ShipmentContainersPage /></MemoryRouter>);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());

    const from = screen.getByLabelText('Từ ngày') as HTMLInputElement;
    const to = screen.getByLabelText('Đến ngày') as HTMLInputElement;
    const calls: string[] = [];
    apiGet.mockImplementation((url: string) => { calls.push(url); return Promise.resolve(response); });

    await act(async () => { fireEvent.change(to, { target: { value: plus3Text } }); });
    console.log('TO-FIRST after To edit:', calls[calls.length - 1]);
    await act(async () => { fireEvent.change(from, { target: { value: plus3Text } }); });
    console.log('TO-FIRST after From edit:', calls[calls.length - 1]);
  });
});
