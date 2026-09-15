import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';
import { AdvanceDraftActions } from './AdvanceDraftActions';

const mocks = vi.hoisted(() => ({ user: { userId: 7, role: 'OPS' }, post: vi.fn(), get: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../lib/api', () => ({ api: { post: (...args: unknown[]) => mocks.post(...args), get: (...args: unknown[]) => mocks.get(...args) } }));
const request = { id: 18, requesterId: 7, version: 4, status: 'DRAFT', amount: '100', reason: 'Nội dung cũ' };
function mount(row = request) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><AdvanceDraftActions request={row} /></QueryClientProvider>);
  return invalidate;
}
function enterResolution(value = 'Đối chiếu chứng từ cũ') { fireEvent.change(screen.getByLabelText('Lý do xử lý *'), { target: { value } }); }
beforeEach(() => { mocks.user = { userId: 7, role: Role.OPS }; mocks.post.mockReset(); mocks.get.mockReset(); });

describe('AdvanceDraftActions legacy recovery', () => {
  it('only renders for an authorized owner or office actor and never for terminal records', () => {
    mocks.user = { userId: 8, role: Role.OPS }; mount(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it.each(['RECORDED', 'VOIDED'])('hides commands for %s', status => { mount({ ...request, status }); expect(screen.queryByRole('button')).not.toBeInTheDocument(); });
  it('keeps invalid amounts and missing reason visibly editable without enabling record', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: /^Ghi sổ$/ }));
    const save = screen.getByRole('button', { name: 'Ghi sổ tạm ứng' }); expect(save).toBeDisabled();
    enterResolution(); fireEvent.change(screen.getByLabelText('Số tiền (₫) *'), { target: { value: '0' } }); expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Số tiền (₫) *'), { target: { value: '-1' } }); expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Số tiền (₫) *'), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText('Nội dung tạm ứng *'), { target: { value: ' ' } }); expect(save).toBeDisabled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('saves via owner alias with current version, refreshes balances and retains retry identity', async () => {
    mocks.post.mockRejectedValueOnce(new Error('Mạng tạm gián đoạn')).mockResolvedValueOnce({ status: 'RECORDED' });
    const invalidate = mount(); fireEvent.click(screen.getByRole('button', { name: /^Ghi sổ$/ })); enterResolution();
    fireEvent.change(screen.getByLabelText('Số tiền (₫) *'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ghi sổ tạm ứng' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mạng tạm gián đoạn');
    expect(screen.getByLabelText('Số tiền (₫) *')).toHaveValue(250);
    fireEvent.click(screen.getByRole('button', { name: 'Ghi sổ tạm ứng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[0][0]).toBe('/forwarder/me/advance-requests/18/record');
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ expectedVersion: 4, amount: 250, reason: 'Nội dung cũ' });
    expect(mocks.post.mock.calls[1][2]).toEqual(mocks.post.mock.calls[0][2]);
    expect(invalidate).toHaveBeenCalledTimes(5);
  });
  it('office void confirms a reason, cancel has no effect and rapid click sends once', async () => {
    mocks.user = { userId: 1, role: Role.ADMIN };
    let finish!: () => void; mocks.post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Hủy tạm ứng' }));
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: /^Đóng$/ })[0]); expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy tạm ứng' })); enterResolution('Không còn phát sinh');
    const confirm = screen.getByRole('button', { name: 'Xác nhận hủy' }); fireEvent.click(confirm); fireEvent.click(confirm);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0][0]).toBe('/advance-requests/18/void');
    expect(mocks.post.mock.calls[0][1]).toEqual({ expectedVersion: 4, resolutionReason: 'Không còn phát sinh' });
    finish(); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('requests recorded advances for settlement eligibility', async () => {
    const { forwarderClient } = await import('../../api/forwarderClient'); mocks.get.mockResolvedValue({ items: [] });
    await forwarderClient.getEligibleAdvanceRequests();
    expect(mocks.get).toHaveBeenCalledWith(expect.stringContaining('status=RECORDED'));
  });
});
