/**
 * Penalties write feedback (case 2026-10-11-R14-06 / card 101026163020 —
 * round-14 FB-051): every penalties write fires its success feedback at
 * commit time — before any cache refresh — matching the `useCRUD` contract
 * pinned by card 101026163020's round-13 fix. The mutations hook is the
 * defect-class owner so feedback travels with the write, not per caller.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/shared/Toast';
import { useCreatePenalty, useCancelPenalty } from './usePenaltyMutations';

const apiPost = vi.fn();
vi.mock('../../../lib/api', () => ({
  api: { post: (...args: unknown[]) => apiPost(...(args as [string, unknown])) },
}));

function Probe() {
  const create = useCreatePenalty();
  const cancel = useCancelPenalty();
  return (
    <>
      <button onClick={() => create.mutate({ driverId: 2, reasonId: 3, amount: 500_000, date: '2026-10-11' })}>
        save-penalty
      </button>
      <button onClick={() => cancel.mutate({ id: 9, reason: 'nhập nhầm' })}>cancel-penalty</button>
    </>
  );
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Probe />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({ id: 9 });
});

describe('penalties write feedback at commit (case 2026-10-11-R14-06)', () => {
  it('fires the create success toast when the write commits', async () => {
    renderProbe();
    fireEvent.click(screen.getByText('save-penalty'));
    expect(await screen.findByText('Đã lập biên bản kỷ luật.')).toBeTruthy();
    expect(apiPost).toHaveBeenCalledWith('/penalties', expect.objectContaining({ driverId: 2 }));
  });

  it('fires the cancel success toast when the write commits', async () => {
    renderProbe();
    fireEvent.click(screen.getByText('cancel-penalty'));
    expect(await screen.findByText('Đã hủy biên bản kỷ luật.')).toBeTruthy();
  });
});
