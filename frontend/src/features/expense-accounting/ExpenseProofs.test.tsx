import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ExpenseAccountingEntry } from '@tingting/shared';
const { uploadProof } = vi.hoisted(() => ({ uploadProof: vi.fn() }));
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: { uploadProof } }));
import { ExpenseProofs } from './ExpenseProofs';
const entry = { sourceKind: 'DRIVER', sourceId: 5, version: 1, status: 'RECORDED', photoStorageKeys: [] } as unknown as ExpenseAccountingEntry;
function proofs() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ExpenseProofs entry={entry} canUpload /></QueryClientProvider>); }
beforeEach(() => uploadProof.mockReset());
it('SIL-1035: an offline fetch TypeError on upload shows the Vietnamese sentence, never engine English', async () => {
  uploadProof.mockRejectedValueOnce(new TypeError('NetworkError when attempting to fetch resource.'));
  proofs();
  fireEvent.change(screen.getByLabelText('Bổ sung ảnh chứng từ'), { target: { files: [new File(['proof'], 'receipt.png', { type: 'image/png' })] } });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Mất kết nối. Vui lòng thử lại.');
  expect(alert.textContent).not.toContain('NetworkError');
  expect(screen.getByRole('button', { name: 'Thử tải lại ảnh' })).toBeInTheDocument();
});
it('a non-Error throw keeps the existing fallback sentence and the retry affordance', async () => {
  uploadProof.mockRejectedValueOnce('disk went away');
  proofs();
  fireEvent.change(screen.getByLabelText('Bổ sung ảnh chứng từ'), { target: { files: [new File(['proof'], 'receipt.png', { type: 'image/png' })] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Ảnh chưa tải thành công. File vẫn được giữ để thử lại.');
  expect(screen.getByRole('button', { name: 'Thử tải lại ảnh' })).toBeInTheDocument();
});
