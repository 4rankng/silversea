import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ get: vi.fn(), confirm: vi.fn(), remove: vi.fn() }));
vi.mock('../../api/phoiPhieuClient', () => ({ getPhoiPhieuTienDuong: api.get, confirmPhoiPhieuTienDuong: api.confirm, voidPhoiPhieuRow: api.remove }));
import { PhoiPhieuTienDuongDialog } from './PhoiPhieuTienDuongDialog';
const row = { sourceId: 7, version: 4, costType: 'OTHER', feeName: 'Phụ cấp cấu hình', driverEnteredAmount: 73000, amount: 75000, confirmed: false, driverName: 'Lái xe kiểm thử', payerName: 'Kế toán kiểm thử', occurredAt: '2026-09-22' };
const detail = { tripId: 8, tripCode: 'TRP-TEST', rows: [row], totals: { total: 75000, confirmed: 0 } };
const saved = vi.fn();
function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PhoiPhieuTienDuongDialog tripId={8} onClose={vi.fn()} onSaved={saved} /></QueryClientProvider>); }
describe('driver cost confirmation uses current source version', () => {
  beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(detail); api.confirm.mockResolvedValue({}); });
  it('PHOI07 excludes signed negative costs from gross and approved draft totals without hiding rows', async () => {
    api.get.mockResolvedValue({ ...detail, rows: [{ ...row, confirmed: true }, { ...row, sourceId: 9, amount: -10000, confirmed: true }, { ...row, sourceId: 10, amount: -20000 }] });
    mount(); await screen.findByDisplayValue('-20.000');
    const totals = () => [...screen.getByRole('region', { name: 'Tổng cộng' }).querySelectorAll('dd')].map(cell => cell.textContent);
    expect(screen.getByLabelText('Thực chi dòng 2')).toHaveValue('-10.000');
    expect(totals()).toEqual(['75.000₫', '75.000₫']);
    fireEvent.change(screen.getByLabelText('Thực chi dòng 1'), { target: { value: '-1' } });
    expect(totals()).toEqual(['0₫', '0₫']);
    fireEvent.change(screen.getByLabelText('Thực chi dòng 1'), { target: { value: '75000' } });
    expect(totals()).toEqual(['75.000₫', '75.000₫']);
    expect(api.confirm).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  });
  it('submits the current source version and refreshes after confirmation', async () => {
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Tích duyệt' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.confirm).toHaveBeenCalledWith(8, 7, 4);
  });
  it('keeps rejection visible and reloads the current version before retry', async () => {
    api.get.mockResolvedValueOnce(detail).mockResolvedValue({ ...detail, rows: [{ ...row, version: 5 }] });
    api.confirm.mockRejectedValueOnce(new Error('Khoản chi đã thay đổi. Vui lòng tải lại.'));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Tích duyệt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('đã thay đổi'); expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại khoản chi' })); await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Tích duyệt' })); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.confirm.mock.calls[1]).toEqual([8, 7, 5]);
  });
  it('shows the current amount and configured label alongside the original value', async () => {
    mount(); await screen.findByText('Phụ cấp cấu hình');
    // The "Lái xe nhập ban đầu" cell is read-only, formatted currency.
    expect(screen.getByText('73.000')).toHaveClass('money__num');
    // "Thực chi hiện tại" became an EDITABLE input in 18db820e so the accountant
    // can adjust the amount inline; NumberField renders grouped vi-VN digits
    // (card 20260930_224), so the control's display value carries separators.
    const current = screen.getByLabelText('Thực chi dòng 1');
    expect(current).toHaveValue('75.000');
    expect(screen.getByRole('columnheader', { name: 'Thực chi hiện tại (đ)' })).toBeInTheDocument();
  });
  it('does not duplicate a pending confirmation', async () => {
    api.confirm.mockReturnValue(new Promise(() => {})); mount(); const button = await screen.findByRole('button', { name: 'Tích duyệt' });
    fireEvent.click(button); fireEvent.click(button); expect(api.confirm).toHaveBeenCalledOnce(); expect(button).toBeDisabled();
  });
});

// Inside the 640px modal the tt-table's fixed layout equal-shares 8 columns
// and thead th pins nowrap, so "LÁI XE NHẬP BAN ĐẦU (Đ)" and "THỰC CHI HIỆN
// (Đ)" clip mid-token (case QA-2026-09-24-01). Design law §4: table text wraps
// at spaces or the column expands — it never clips. Mirrors the board's pinned
// thead contract (PhoiPhieuControlPage.styles.test.ts, card 20260922_54).
describe('modal table headers never clip (case QA-2026-09-24-01; design law §4)', () => {
  beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(detail); api.confirm.mockResolvedValue({}); });
  it('long money headers wrap at spaces instead of clipping', async () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/accounting/phoi-phieu-dialogs.css'), 'utf8');
    const headings = css.match(/\.phoi-detail-matrix thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(headings).toContain('white-space: normal');
    expect(headings).toContain('word-break: keep-all');
    expect(headings).toContain('overflow-wrap: normal');
    expect(css).toMatch(/\.phoi-detail-matrix\s*\{[^}]*table-layout:\s*auto/);
    mount();
    await screen.findByRole('columnheader', { name: 'STT' });
    for (const name of ['Lái xe nhập ban đầu (đ)', 'Thực chi hiện tại (đ)', 'Kế toán duyệt']) {
      expect(screen.getByRole('columnheader', { name }).closest('table')).toHaveClass('phoi-detail-matrix');
    }
  });
  it('the modal shell budgets the 8-column table — no 640px equal-share squeeze', async () => {
    mount();
    await screen.findByRole('columnheader', { name: 'Thực chi hiện tại (đ)' });
    const content = screen.getByRole('dialog', { name: 'Chi tiết tiền đường' }).querySelector('.modal__content');
    expect(content).not.toBeNull();
    expect((content as HTMLElement).style.getPropertyValue('--modal-max-w')).toBe('1240px');
    const table = screen.getByRole('columnheader', { name: 'Thực chi hiện tại (đ)' }).closest('table')!;
    expect(table).toHaveClass('record-table');
    expect(table.parentElement).toHaveClass('record-table-wrap');
    expect([...table.querySelectorAll('tbody td')].map(cell => (cell as HTMLElement).dataset.label)).toEqual(['STT', 'Khoản lái xe nhập', 'Ngày', 'Lái xe', 'Lái xe nhập ban đầu (đ)', 'Thực chi hiện tại (đ)', 'Người thanh toán', 'Kế toán duyệt']);
    expect(table.closest('.table-scroll')).toBeNull();
  });
});

// Card 20261005_373: the tiền-đường grid gained the "Người thanh toán" column the
// chi-hộ grid already had. Same cell contract as chi-hộ — `data-label` for the
// responsive phone layout, the shared `phoi-detail-col--identity` width class,
// and `—` for a row nobody has attributed.
describe('the tiền-đường grid names the payer like the chi-hộ grid (card 20261005_373)', () => {
  beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(detail); api.confirm.mockResolvedValue({}); });
  it('shows the payer name, and `—` for a row the backend leaves unattributed', async () => {
    api.get.mockResolvedValue({ ...detail, rows: [row, { ...row, sourceId: 9, payerName: null }] });
    mount();
    await screen.findByText('Kế toán kiểm thử');
    const payerCells = screen.getAllByText('Kế toán kiểm thử');
    expect(payerCells).toHaveLength(1);
    expect(payerCells[0].tagName).toBe('TD');
    expect(payerCells[0]).toHaveAttribute('data-label', 'Người thanh toán');
    expect(payerCells[0]).toHaveClass('phoi-detail-col--identity');
    const rowWithoutPayer = screen.getByLabelText('Thực chi dòng 2').closest('tr')!;
    const emptyPayer = rowWithoutPayer.querySelector('td[data-label="Người thanh toán"]')!;
    expect(emptyPayer).toHaveTextContent('—');
    expect(screen.getByRole('columnheader', { name: 'Người thanh toán' }).closest('table')).toHaveClass('phoi-detail-matrix');
  });
});

// Card 20261005_373 (the rejection half): the tiền-đường grid offered the
// accountant "Tích duyệt" and nothing else, so a driver-entered cost the
// accountant rejects could only be left sitting on the phơi phiếu. The
// rejection now states its grounds through the ONE house reason prompt
// (components/reason-prompt — the same surface the chi-hộ remove uses) and
// voids the row. A row already confirmed offers no rejection, because the
// backend refuses a confirmed row.
describe('tiền-đường rejects a driver-entered cost with a stated reason (card 20261005_373)', () => {
  beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(detail); api.confirm.mockResolvedValue({}); api.remove.mockResolvedValue({ ok: true }); });

  it('offers "Từ chối" on an unconfirmed row only — a confirmed row keeps its existing state', async () => {
    api.get.mockResolvedValue({ ...detail, rows: [{ ...row, confirmed: false }, { ...row, sourceId: 9, feeName: 'Phụ cấp cầu đường', confirmed: true }] });
    mount();
    const unconfirmed = (await screen.findByText('Phụ cấp cấu hình')).closest('tr')!;
    const confirmed = screen.getByText('Phụ cấp cầu đường').closest('tr')!;
    expect(within(unconfirmed).getByRole('button', { name: 'Tích duyệt' })).toBeEnabled();
    expect(within(unconfirmed).getByRole('button', { name: 'Từ chối' })).toBeEnabled();
    expect(within(confirmed).queryByRole('button', { name: 'Từ chối' })).not.toBeInTheDocument();
    expect(within(confirmed).getByText('Đã duyệt')).toBeInTheDocument();
  });

  it('keeps the rejection unavailable until a non-empty reason is typed', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }));
    const prompt = within(await screen.findByRole('dialog', { name: 'Nhập lý do' }));
    const field = prompt.getByLabelText('Lý do từ chối (bắt buộc)');
    expect(prompt.getByRole('button', { name: 'Từ chối' })).toBeDisabled();
    fireEvent.change(field, { target: { value: '   ' } });
    expect(prompt.getByRole('button', { name: 'Từ chối' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Lái xe ghi sai số tiền' } });
    expect(prompt.getByRole('button', { name: 'Từ chối' })).toBeEnabled();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('sends the typed reason and refetches, so the rejected row leaves the grid', async () => {
    let authoritative = [row];
    api.get.mockImplementation(() => Promise.resolve({ ...detail, rows: authoritative }));
    api.remove.mockImplementation(async (_tripId: number, sourceId: number) => {
      authoritative = authoritative.filter((candidate) => candidate.sourceId !== sourceId);
      return { ok: true as const };
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }));
    const prompt = within(await screen.findByRole('dialog', { name: 'Nhập lý do' }));
    fireEvent.change(prompt.getByLabelText('Lý do từ chối (bắt buộc)'), { target: { value: '  Lái xe nhập trùng phí cầu đường  ' } });
    fireEvent.click(prompt.getByRole('button', { name: 'Từ chối' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(8, 7, 'Lái xe nhập trùng phí cầu đường'));
    // The grid refetches after the void, so the rejected row is gone.
    await waitFor(() => expect(screen.queryByText('Phụ cấp cấu hình')).not.toBeInTheDocument());
    expect(api.get.mock.calls.length).toBeGreaterThan(1);
    expect(saved).toHaveBeenCalled();
  });

  it('cancelling the reason prompt sends no void at all', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }));
    const prompt = within(await screen.findByRole('dialog', { name: 'Nhập lý do' }));
    fireEvent.click(prompt.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nhập lý do' })).not.toBeInTheDocument());
    expect(api.remove).not.toHaveBeenCalled();
    expect(screen.getByText('Phụ cấp cấu hình')).toBeInTheDocument();
  });

  it('surfaces the backend refusal in the dialog alert and keeps the row', async () => {
    api.remove.mockRejectedValueOnce(new Error('Xe ngoài không từ chối chi do tài xế nhập — kế toán nhập và sửa chi phí trực tiếp.'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }));
    const prompt = within(await screen.findByRole('dialog', { name: 'Nhập lý do' }));
    fireEvent.change(prompt.getByLabelText('Lý do từ chối (bắt buộc)'), { target: { value: 'Không thuộc chi phí của lái xe' } });
    fireEvent.click(prompt.getByRole('button', { name: 'Từ chối' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Xe ngoài không từ chối chi do tài xế nhập');
    expect(screen.getByText('Phụ cấp cấu hình')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledOnce();
  });
});
