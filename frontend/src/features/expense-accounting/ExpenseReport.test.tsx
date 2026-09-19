import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ExpenseAccountingEntry } from '@tingting/shared';
const api = vi.hoisted(() => ({ report: vi.fn(), exportReport: vi.fn() }));
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: api }));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, title, footer }: { children: ReactNode; title: string; footer: ReactNode }) => <section role="dialog" aria-label={title}>{children}{footer}</section> }));
import { ExpenseReport } from './ExpenseReport';
const source = { sourceKind: 'OPS', sourceId: 3, shipmentId: 2, shipmentCode: 'BL-2', feeName: 'Nâng container', expenseDate: '2026-09-16', costGroup: 'INVOICED_LIFT', amount: 500000, customerChargeAmount: 300000, receivedAmount: 100000, outstandingReceivable: 200000 } as ExpenseAccountingEntry;
function Location() { return <output aria-label="URL">{useLocation().search}</output>; }
beforeEach(() => { api.report.mockReset().mockResolvedValue({ items: [{ entityType: 'CUSTOMER', entityId: 1, entityName: 'Khách A', carrierCode: null, lift: 300000, drop: 0, other: 0, total: 300000, settled: 100000, outstanding: 200000, entries: [source] }], unknownCount: 0, totals: { total: 300000, settled: 100000, outstanding: 200000 } }); });
function show(url = '/expense-accounting?reportDirection=IN&reportAsOf=2026-09-15') {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[url]}><Location /><ExpenseReport filters={{ page: 1, limit: 25 }} /></MemoryRouter></QueryClientProvider>);
}
it('FIX-WS-13: clicked report money opens the exact source contribution at the selected cutoff', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Đã thanh toán · Khách A' }));
  expect(screen.getByRole('dialog', { name: 'Đã thanh toán · Khách A' })).toHaveTextContent('100.000');
  expect(screen.getByRole('dialog')).toHaveTextContent('Giao nhận—');
  expect(screen.getByRole('dialog')).toHaveTextContent('Nâng container');
  expect(screen.getByRole('dialog')).toHaveTextContent('16/9/2026');
  expect(screen.getByRole('link', { name: 'BL-2' })).toHaveAttribute('href', '/shipments/2');
  expect(api.report).toHaveBeenCalledWith(expect.objectContaining({ direction: 'IN', asOfDate: '2026-09-15' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('FIX-WS-STATE: reopening a report route uses persisted direction and cutoff', async () => {
  show('/expense-accounting?view=reports&reportDirection=OUT&reportAsOf=2026-09-10');
  await screen.findByRole('button', { name: 'Tổng · Khách A' });
  expect(api.report).toHaveBeenCalledWith(expect.objectContaining({ direction: 'OUT', asOfDate: '2026-09-10' }));
  expect(screen.getByLabelText('URL')).toHaveTextContent('reportDirection=OUT&reportAsOf=2026-09-10');
});

it('FIX-WS-CUTOFF-DRAFT: clear and type a date without today replacing the input', async () => {
  show();
  await screen.findByRole('button', { name: 'Tổng · Khách A' });
  const date = screen.getByLabelText('Thanh toán tính đến *');
  fireEvent.change(date, { target: { value: '' } });
  expect(date).toHaveValue('');
  expect(screen.getByLabelText('URL')).toHaveTextContent('reportAsOf=2026-09-15');
  fireEvent.change(date, { target: { value: '10/09/' } });
  expect(date).toHaveValue('10/09/');
  fireEvent.change(date, { target: { value: '10/09/2026' } });
  expect(screen.getByLabelText('URL')).toHaveTextContent('reportAsOf=2026-09-10');
  expect(api.report).toHaveBeenLastCalledWith(expect.objectContaining({ asOfDate: '2026-09-10' }));
});
