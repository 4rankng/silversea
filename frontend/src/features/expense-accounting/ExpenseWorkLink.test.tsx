import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { ExpenseAccountingEntry } from '@tingting/shared';
const api = vi.hoisted(() => ({ work: vi.fn(), update: vi.fn() }));
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: api }));
import { ExpenseWorkLink } from './ExpenseWorkLink';

it('links a confirmed pre-dispatch source to selected real work without changing money', async () => {
  api.work.mockResolvedValue({ items: [{ id: 'trip:10', tripId: 10, shipmentCode: 'BL7', containerNumber: 'CONT7', scheduledAt: null, vehiclePlate: '15C-123', driverName: 'An' }], total: 1 });
  api.update.mockResolvedValue({});
  const onLinked = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const entry = { sourceKind: 'OPS', sourceId: 7, version: 2, shipmentId: 1, tripId: null, confirmedAt: '2026-09-16', locked: true } as ExpenseAccountingEntry;
  render(<QueryClientProvider client={client}><ExpenseWorkLink entry={entry} onLinked={onLinked} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Liên kết công việc' }));
  fireEvent.click(await screen.findByRole('button', { name: /Công việc thực tế/ }));
  fireEvent.click(await screen.findByRole('option', { name: /CONT7/ }));
  fireEvent.change(screen.getByLabelText(/Lý do liên kết/), { target: { value: 'Đã xác định chuyến' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu liên kết' }));
  await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
  expect(api.update.mock.calls[0][1]).toEqual({ expectedVersion: 2, tripId: 10, reason: 'Đã xác định chuyến' });
  expect(onLinked).toHaveBeenCalled();
});
