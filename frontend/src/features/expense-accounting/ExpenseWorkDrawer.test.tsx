import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ExpenseAccountingEntry, ExpenseWorkRow } from '@tingting/shared';
const confirm = vi.hoisted(() => vi.fn());
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { confirm } }));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => <section>{children}{footer}</section> }));
import { ExpenseWorkDrawer } from './ExpenseWorkDrawer';
const entry = { sourceKind: 'DRIVER', sourceId: 7, version: 3, status: 'RECORDED', feeName: 'Vé cầu đường', amount: 80000, costGroup: 'DRIVER_ROAD', shipmentCode: 'BL7', locked: false } as ExpenseAccountingEntry;
const work = { id: 'trip:10', tripId: 10, shipmentId: 1, shipmentCode: 'BL7', containerNumber: 'CONT7', vehiclePlate: '15C-123', entries: [entry] } as ExpenseWorkRow;
function show() {
  const onClose = vi.fn(); const onCreate = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><ExpenseWorkDrawer work={work} group="road" onClose={onClose} onEdit={vi.fn()} onCreate={onCreate} onVoucher={vi.fn()} /></QueryClientProvider>);
  return { onClose, onCreate };
}
beforeEach(() => { confirm.mockReset().mockResolvedValue({ items: [] }); });
it('confirms the selected receipt source and its version before closing', async () => {
  const { onClose } = show();
  fireEvent.click(screen.getByRole('checkbox', { name: /Vé cầu đường/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu chi phí' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(confirm).toHaveBeenCalledWith([{ sourceKind: 'DRIVER', sourceId: 7, expectedVersion: 3 }]);
});
it('retains the selected receipt after a stale-source failure and preserves the road add context', async () => {
  confirm.mockRejectedValue(new Error('Khoản chi đã thay đổi'));
  const { onClose, onCreate } = show();
  fireEvent.click(screen.getByRole('checkbox', { name: /Vé cầu đường/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu chi phí' }));
  await screen.findByText('Khoản chi đã thay đổi');
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm khoản chi' }));
  expect(onCreate).toHaveBeenCalledWith(work, 'road');
});
