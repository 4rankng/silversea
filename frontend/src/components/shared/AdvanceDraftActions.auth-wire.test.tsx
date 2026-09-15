import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../../hooks/useAuth';
import { api } from '../../lib/api';
import { qk } from '../../api/keys';
import ForwarderAdvancesPage from '../../pages/ForwarderAdvancesPage';

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
  useListAnimations: () => ({ rootRef: { current: null } }),
  useCounterAnimation: () => ({ animateCounters: vi.fn() }),
}));
const token = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDB9.signature';
// Real auth wire shape from auth.routes + userService.USER_FIELDS: id, not userId.
const profile = { id: 7, username: 'giaonhan', fullName: 'Nhân viên Ops', email: null, phone: null, role: 'OPS', capabilities: [] };
const row = { id: 105, version: 3, requesterId: 7, amount: '321000', reason: 'QA FINAL DRAFT OPS RECORD', status: 'DRAFT', createdAt: '2026-09-15T01:00:00.000Z', approvedBy: null, approvedAt: null };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
function Page() {
  const { user, login, loading } = useAuth();
  if (loading) return null;
  if (!user) return <button onClick={() => void login('giaonhan', 'test-only')}>Đăng nhập thử</button>;
  return <><output data-testid="canonical-user">{user.userId}</output><ForwarderAdvancesPage /></>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><AuthProvider><Page /></AuthProvider></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() });
  api.clearToken();
  vi.stubGlobal('fetch', vi.fn(async (input: string | Request | URL) => {
    const url = String(input);
    if (url.includes('/auth/login')) return json({ token, user: profile });
    if (url.includes('/auth/me')) return json(profile);
    if (url.includes('/forwarder/me/advance-requests')) return json({ items: [row], page: 1, limit: 25, pageSize: 25, total: 1, totalPages: 1, statusCounts: { DRAFT: 1 }, statusAmounts: { DRAFT: 321000 }, counts: { DRAFT: 1 } });
    if (url.includes('/forwarder/me/advance-balance')) return json({ outstanding: '0' });
    if (url.includes('/forwarder/me/advance-settlements')) return json({ items: [] });
    throw new Error(`Unexpected request: ${url}`);
  }));
});
afterEach(() => { api.clearToken(); vi.unstubAllGlobals(); });

describe('actual OPS auth and advance list wire contract', () => {
  it('normalizes id-only /me and renders owner actions using the real requesterId/version shape', async () => {
    api.setToken(token); const client = mount();
    expect(await screen.findByText(row.reason)).toBeInTheDocument();
    expect(screen.getByTestId('canonical-user')).toHaveTextContent('7');
    expect(client.getQueryData(qk.auth.me)).toMatchObject({ id: 7, userId: 7, role: 'OPS' });
    fireEvent.click(screen.getByRole('button', { name: /^Ghi sổ$/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    for (const label of ['Số tiền (₫) *', 'Nội dung tạm ứng *', 'Lý do xử lý *']) expect(screen.getByLabelText(label)).toHaveClass('input');
    fireEvent.change(screen.getByLabelText('Số tiền (₫) *'), { target: { value: '-1' } });
    expect(screen.getByText('Nhập số tiền nguyên dương hợp lệ.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi sổ tạm ứng' })).toBeDisabled();
  });
  it('normalizes id-only login before populating the auth cache and loading own drafts', async () => {
    const client = mount(); fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập thử' }));
    await waitFor(() => expect(client.getQueryData(qk.auth.me)).toMatchObject({ id: 7, userId: 7 }));
    expect(await screen.findByRole('button', { name: /^Ghi sổ$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hủy tạm ứng' })).toBeInTheDocument();
    expect(screen.queryByText('Ghi nhận tạm ứng tạm ứng')).not.toBeInTheDocument();
  });
});
