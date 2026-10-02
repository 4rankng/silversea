import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ get: vi.fn(), confirm: vi.fn() }));
vi.mock('../../api/phoiPhieuClient', () => ({ getPhoiPhieuTienDuong: api.get, confirmPhoiPhieuTienDuong: api.confirm }));
import { PhoiPhieuTienDuongDialog } from './PhoiPhieuTienDuongDialog';
const row = { sourceId: 7, version: 4, costType: 'OTHER', feeName: 'Phụ cấp cấu hình', driverEnteredAmount: 73000, amount: 75000, confirmed: false, driverName: 'Lái xe kiểm thử', occurredAt: '2026-09-22' };
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

// Inside the 640px modal the tt-table's fixed layout equal-shares 7 columns
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
  it('the modal shell budgets the 7-column table — no 640px equal-share squeeze', async () => {
    mount();
    await screen.findByRole('columnheader', { name: 'Thực chi hiện tại (đ)' });
    const content = screen.getByRole('dialog', { name: 'Chi tiết tiền đường' }).querySelector('.modal__content');
    expect(content).not.toBeNull();
    expect((content as HTMLElement).style.getPropertyValue('--modal-max-w')).toBe('1240px');
    const table = screen.getByRole('columnheader', { name: 'Thực chi hiện tại (đ)' }).closest('table')!;
    expect(table).toHaveClass('record-table');
    expect(table.parentElement).toHaveClass('record-table-wrap');
    expect([...table.querySelectorAll('tbody td')].map(cell => (cell as HTMLElement).dataset.label)).toEqual(['STT', 'Khoản lái xe nhập', 'Ngày', 'Lái xe', 'Lái xe nhập ban đầu (đ)', 'Thực chi hiện tại (đ)', 'Kế toán duyệt']);
    expect(table.closest('.table-scroll')).toBeNull();
  });
});
