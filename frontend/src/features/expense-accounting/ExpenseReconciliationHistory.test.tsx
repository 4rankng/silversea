import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ExpenseReconciliation } from '@tingting/shared';
const api = vi.hoisted(() => ({ reconciliations: vi.fn(), get: vi.fn(), releaseReconciliation: vi.fn() }));
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: api }));
vi.mock('../../components/UI', () => ({ Drawer: ({ children, footer, title }: { children: ReactNode; footer?: ReactNode; title: string }) => <section role="dialog" aria-label={title}>{children}{footer}</section> }));
import { ExpenseReconciliationHistory, filterReconciliations } from './ExpenseReconciliationHistory';
import { ReleaseReconciliationDrawer } from './ReleaseReconciliationDrawer';
const batch: ExpenseReconciliation = { id: 1, code: 'HU-1', opsUserId: 8, from: '2026-09-01', to: '2026-09-15', amount: 500000, advanceAmount: 100000, initialDifference: 400000, paidAmount: 0, refundedAmount: 0, remainingDifference: 400000, createdAt: '2026-09-15T00:00:00Z', note: 'Kiểm hóa', entries: [{ sourceKind: 'OPS', sourceId: 2, expectedVersion: 3 }] };
function show(children: ReactNode) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{children}</QueryClientProvider>); }
beforeEach(() => { api.reconciliations.mockReset().mockResolvedValue({ items: [batch] }); api.get.mockReset().mockResolvedValue({ feeName: 'Kiểm hóa', shipmentCode: 'BL-1', amount: 500000 }); api.releaseReconciliation.mockReset(); });
it('filters the displayed/exported batches by period and person without changing recorded amounts', () => {
  const names = new Map([[8, 'Nguyễn Văn A']]);
  expect(filterReconciliations([batch], 'văn a', '2026-09-15', '2026-09-20', names)).toEqual([batch]);
  expect(filterReconciliations([batch], '', '2026-09-16', '', names)).toEqual([]);
  expect(filterReconciliations([batch], 'not present', '', '', names)).toEqual([]);
});
it('lets an OPS reader inspect source details but exposes no release or cash action', async () => {
  show(<ExpenseReconciliationHistory />);
  fireEvent.click(await screen.findByRole('button', { name: 'HU-1' }));
  await screen.findByText('Thực chi hiện tại: 500.000 ₫');
  expect(screen.getByRole('dialog')).toHaveTextContent('Nguồn OPS · phiên bản 3');
  expect(screen.queryByRole('button', { name: 'Hoàn tác đối chiếu' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Trả phần chênh lệch' })).not.toBeInTheDocument();
});
it('preserves released history without actionable cash or a second release', async () => {
  api.reconciliations.mockResolvedValue({ items: [{ ...batch, voidedAt: '2026-09-17T00:00:00Z', remainingDifference: 0 }] });
  show(<ExpenseReconciliationHistory canRelease onPay={vi.fn()} />);
  await screen.findByText(/Đã hoàn tác/);
  expect(screen.getByRole('button', { name: 'HU-1' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hoàn tác đối chiếu' })).not.toBeInTheDocument();
});
it('keeps reason and the same idempotency key after a failed release', async () => {
  api.releaseReconciliation.mockRejectedValueOnce(new Error('Cần đảo phiếu tiền')).mockResolvedValueOnce({});
  const onClose = vi.fn(); show(<ReleaseReconciliationDrawer item={batch} onClose={onClose} />);
  expect(screen.getByRole('button', { name: 'Hoàn tác đối chiếu' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Lý do hoàn tác/), { target: { value: 'Điều chỉnh chứng từ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác đối chiếu' }));
  await screen.findByText('Cần đảo phiếu tiền');
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác đối chiếu' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(api.releaseReconciliation.mock.calls[1]).toEqual(api.releaseReconciliation.mock.calls[0]);
});
