import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagerDecisionInbox } from './ManagerDecisionInbox';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api', () => ({ api: { get: getMock, post: postMock } }));

function renderInbox(enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><ManagerDecisionInbox enabled={enabled} /></MemoryRouter></QueryClientProvider>);
}

describe('ManagerDecisionInbox', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    postMock.mockResolvedValue({ responseId: 12, resolution: 'Đã liên hệ và thống nhất', replayed: false });
    getMock.mockResolvedValue({
      asOf: new Date().toISOString(), timezone: 'Asia/Ho_Chi_Minh',
      counts: { action: 1, waiting: 0, done: 0 }, page: 1, limit: 100, total: 1, totalPages: 1,
      items: [{
        id: 'paper-handoff:8', entityType: 'trip', entityId: 8,
        title: 'TRP-008 quá hạn bàn giao lệnh gốc', subtitle: 'Tài xế chưa nhận lệnh gốc',
        state: 'ACTION', priority: 96, dueAt: null, freshnessAt: new Date().toISOString(),
        blockers: [], advisories: [], nextAction: { label: 'Mở hồ sơ chuyến', targetRoute: '/trips/8' }, targetRoute: '/trips/8',
        owner: { code: 'OPS', label: 'Bàn giao lệnh gốc', ownerRole: 'OPS', ownerLabel: 'Vận hành' },
        ageHours: 27, impact: 'Tài xế có thể không đủ chứng từ để tiếp tục hành trình.',
      }],
    });
  });

  it('names the owner, age, impact, and direct action before KPIs', async () => {
    renderInbox();
    expect(await screen.findByText('TRP-008 quá hạn bàn giao lệnh gốc')).toBeTruthy();
    expect(screen.getByText('Vận hành')).toBeTruthy();
    expect(screen.getByText('1 ngày')).toBeTruthy();
    expect(screen.getByText('Tài xế có thể không đủ chứng từ để tiếp tục hành trình.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mở hồ sơ chuyến' }).getAttribute('href')).toBe('/trips/8');
  });

  it('does not create the manager queue for other roles', () => {
    renderInbox(false);
    expect(screen.queryByRole('heading', { name: 'Ngoại lệ cần xử lý trước' })).toBeNull();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('paginates through every server page', async () => {
    getMock.mockResolvedValue({
      asOf: new Date().toISOString(), timezone: 'Asia/Ho_Chi_Minh',
      counts: { action: 101, waiting: 0, done: 0 }, page: 1, limit: 100, total: 101, totalPages: 2,
      items: [{
        id: 'paper-handoff:8', entityType: 'trip', entityId: 8, title: 'TRP-008 quá hạn', subtitle: 'Cần bàn giao',
        state: 'ACTION', priority: 96, dueAt: null, freshnessAt: new Date().toISOString(), blockers: [], advisories: [],
        nextAction: { label: 'Mở hồ sơ', targetRoute: '/trips/8' }, targetRoute: '/trips/8',
        owner: { code: 'OPS', label: 'Bàn giao', ownerRole: 'OPS', ownerLabel: 'Vận hành' }, ageHours: 1, impact: 'Trễ hành trình.',
      }],
    });
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining('page=2&limit=100')));
  });

  it('records a manager resolution for a customer delivery dispute', async () => {
    getMock.mockResolvedValue({
      asOf: new Date().toISOString(), timezone: 'Asia/Ho_Chi_Minh', counts: { action: 1, waiting: 0, done: 0 },
      page: 1, limit: 100, total: 1, totalPages: 1,
      items: [{
        id: 'delivery-dispute:12', entityType: 'delivery_response', entityId: 12, title: 'Sai lệch giao hàng', subtitle: 'Thiếu một kiện',
        state: 'ACTION', priority: 100, dueAt: null, freshnessAt: new Date().toISOString(), blockers: [], advisories: [],
        nextAction: { label: 'Xử lý phản hồi', targetRoute: '/dashboard?disputeId=12' }, targetRoute: '/dashboard?disputeId=12',
        owner: { code: 'MANAGER', label: 'Cần quyết định', ownerRole: 'MANAGER', ownerLabel: 'Quản lý' }, ageHours: 2, impact: 'Quan hệ khách hàng.',
      }],
    });
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: 'Xử lý phản hồi' }));
    fireEvent.change(screen.getByLabelText('Kết quả xử lý'), { target: { value: 'Đã liên hệ và thống nhất bổ sung chứng từ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận đã xử lý' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(
      '/dashboard/delivery-disputes/12/resolve',
      { resolution: 'Đã liên hệ và thống nhất bổ sung chứng từ' },
    ));
  });

  it('keeps resolution drafts isolated when switching between disputes', async () => {
    getMock.mockResolvedValue({
      asOf: new Date().toISOString(), timezone: 'Asia/Ho_Chi_Minh', counts: { action: 2, waiting: 0, done: 0 },
      page: 1, limit: 100, total: 2, totalPages: 1,
      items: [12, 13].map((id) => ({
        id: `delivery-dispute:${id}`, entityType: 'delivery_response', entityId: id, title: `Sai lệch ${id}`, subtitle: `Lý do ${id}`,
        state: 'ACTION', priority: 100, dueAt: null, freshnessAt: new Date().toISOString(), blockers: [], advisories: [],
        nextAction: { label: `Xử lý phản hồi ${id}`, targetRoute: `/dashboard?disputeId=${id}` }, targetRoute: `/dashboard?disputeId=${id}`,
        owner: { code: 'MANAGER', label: 'Cần quyết định', ownerRole: 'MANAGER', ownerLabel: 'Quản lý' }, ageHours: 2, impact: 'Quan hệ khách hàng.',
      })),
    });
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: 'Xử lý phản hồi 12' }));
    fireEvent.change(screen.getByLabelText('Kết quả xử lý'), { target: { value: 'Bản nháp của phản hồi 12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xử lý phản hồi 13' }));
    expect((screen.getByLabelText('Kết quả xử lý') as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Kết quả xử lý'), { target: { value: 'Bản nháp của phản hồi 13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xử lý phản hồi 12' }));
    expect((screen.getByLabelText('Kết quả xử lý') as HTMLTextAreaElement).value).toBe('Bản nháp của phản hồi 12');
  });

  it('clears only the submitted draft when another dispute is selected in flight', async () => {
    let finishRequest!: (value: unknown) => void;
    postMock.mockImplementation(() => new Promise((resolve) => { finishRequest = resolve; }));
    getMock.mockResolvedValue({
      asOf: new Date().toISOString(), timezone: 'Asia/Ho_Chi_Minh', counts: { action: 2, waiting: 0, done: 0 },
      page: 1, limit: 100, total: 2, totalPages: 1,
      items: [12, 13].map((id) => ({
        id: `delivery-dispute:${id}`, entityType: 'delivery_response', entityId: id, title: `Sai lệch ${id}`, subtitle: `Lý do ${id}`,
        state: 'ACTION', priority: 100, dueAt: null, freshnessAt: new Date().toISOString(), blockers: [], advisories: [],
        nextAction: { label: `Xử lý phản hồi ${id}`, targetRoute: `/dashboard?disputeId=${id}` }, targetRoute: `/dashboard?disputeId=${id}`,
        owner: { code: 'MANAGER', label: 'Cần quyết định', ownerRole: 'MANAGER', ownerLabel: 'Quản lý' }, ageHours: 2, impact: 'Quan hệ khách hàng.',
      })),
    });
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: 'Xử lý phản hồi 12' }));
    fireEvent.change(screen.getByLabelText('Kết quả xử lý'), { target: { value: 'Đã xử lý phản hồi 12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận đã xử lý' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(
      '/dashboard/delivery-disputes/12/resolve',
      { resolution: 'Đã xử lý phản hồi 12' },
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Xử lý phản hồi 13' }));
    fireEvent.change(screen.getByLabelText('Kết quả xử lý'), { target: { value: 'Bản nháp đang viết cho 13' } });
    finishRequest({ responseId: 12, replayed: false });
    await waitFor(() => expect((screen.getByLabelText('Kết quả xử lý') as HTMLTextAreaElement).value).toBe('Bản nháp đang viết cho 13'));
  });
});
