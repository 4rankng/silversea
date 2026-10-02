import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import type { ExpenseReconciliation } from '@tingting/shared';
vi.mock('../../components/UI', () => ({ Drawer: ({ children }: { children: ReactNode }) => <section role="dialog">{children}</section> }));
import { ExpenseHistoryDetail } from './ExpenseHistoryDetail';
const batch: ExpenseReconciliation = { id: 1, code: 'HU-1', opsUserId: 8, from: '2026-09-01', to: '2026-09-15', amount: 500000, advanceAmount: 300000, initialDifference: 200000, paidAmount: 0, refundedAmount: 0, remainingDifference: 200000, createdAt: '2026-09-15T00:00:00Z', note: null, entries: [] };
function show(item: ExpenseReconciliation) {
  render(<QueryClientProvider client={new QueryClient()}><ExpenseHistoryDetail item={item} onClose={vi.fn()} /></QueryClientProvider>);
}
it('shows advance allocations, amounts and reasons in released history without leaking ids', () => {
  show({ ...batch, voidedAt: '2026-09-17T00:00:00Z', advances: [{ advanceRequestId: 4, amount: 100000, reason: 'Đợt một' }, { advanceRequestId: 8, amount: 200000, reason: 'Đợt hai' }] });
  const detail = screen.getByRole('region', { name: 'Các khoản ứng đã phân bổ' });
  expect(detail).toHaveTextContent('100.000 ₫'); expect(detail).toHaveTextContent('Đợt một');
  expect(detail).toHaveTextContent('200.000 ₫'); expect(detail).toHaveTextContent('Đợt hai');
  expect(detail.textContent).not.toMatch(/#\d/);
  expect(screen.getByRole('dialog')).toHaveTextContent('Đã hoàn tác ngày');
});
it('does not invent per-advance allocations when historical detail is missing', () => {
  show(batch);
  expect(screen.getByRole('region', { name: 'Các khoản ứng đã phân bổ' })).toHaveTextContent('Chưa có phân bổ ứng chi tiết trong lịch sử');
});
