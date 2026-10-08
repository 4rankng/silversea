import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({ api: { get } }));

import { FundBookSection } from './FundBookSection';

/** Card 20260928_168 — the Sổ quỹ reads one fund source over a from/to period
 *  (carried opening, windowed thu/chi) and carries the Tài khoản OPS entry:
 *  the same canonical outstanding the 169 reimbursement report shows. The row
 *  action lands on the report pre-scoped to the SAME period and staff, where
 *  the existing direction-correct phiếu actions live. */
const book = {
  source: 'COMPANY',
  period: { from: '2026-09-01', to: '2026-09-30' },
  accounts: [{
    accountId: 3, code: 'ACB-OPS', name: 'TK công ty ACB', currency: 'VND',
    openingBalance: 2000000, openingBalanceDate: null, cutoverAt: null,
    totalIn: 300000, totalOut: 1000000, bookBalance: 1300000, movements: [],
  }],
  totals: { openingBalance: 2000000, totalIn: 300000, totalOut: 1000000, bookBalance: 1300000 },
  unassignedAccounts: 1,
  opsAdvance: {
    totalOutstanding: 500000,
    items: [{ staffId: 5, staffName: 'NV A', outstanding: 500000 }],
  },
};

function section(initialEntry = '/expense-accounting?fundFrom=2026-09-01&fundTo=2026-09-30') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FundBookSection />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  get.mockReset().mockResolvedValue(book);
});

describe('FundBookSection — sổ quỹ theo kỳ (card 20260928_168)', () => {
  it('fetches the book for the seeded period and renders the carried opening + closing columns', async () => {
    section();
    expect(await screen.findByText('TK công ty ACB')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/expense-accounting/fund-book?source=COMPANY&from=2026-09-01&to=2026-09-30');
    const row = screen.getByText('TK công ty ACB').closest('tr') as HTMLElement;
    expect(within(row).getByText('2.000.000 ₫')).toBeTruthy(); // Đầu kỳ — carried
    expect(within(row).getByText('1.000.000 ₫')).toBeTruthy(); // Chi trong kỳ
    expect(within(row).getByText('1.300.000 ₫')).toBeTruthy(); // Tồn cuối kỳ
    expect(screen.getByText('Đầu kỳ là số dư lũy kế đến ngày bắt đầu; thu, chi và dòng sổ chỉ nằm trong kỳ. Tài khoản OPS ghi số tạm ứng OPS còn giữ — cùng một công thức với số "Còn phải hoàn ứng" của báo cáo hoàn ứng.')).toBeTruthy();
    expect(screen.getByText(/1 tài khoản đang dùng chưa phân nguồn quỹ/)).toBeTruthy();
  });

  it('renders the Tài khoản OPS rows and the converged total', async () => {
    section();
    await screen.findByText('NV A');
    expect(screen.getByText('Tài khoản OPS · còn phải hoàn ứng')).toBeTruthy();
    const opsRow = screen.getByText('NV A').closest('tr') as HTMLElement;
    expect(within(opsRow).getByText('500.000 ₫')).toBeTruthy();
  });

  it('links each staff row to the 169 report with the SAME period and staff (AC4)', async () => {
    section();
    await screen.findByText('NV A');
    const link = screen.getByRole('link', { name: 'Lập phiếu' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/accounting/hoan-ung?opsUserId=5&from=2026-09-01&to=2026-09-30');
  });

  it('switching the source refetches the other book', async () => {
    section();
    await screen.findByText('TK công ty ACB');
    fireEvent.click(screen.getByRole('button', { name: /Nguồn quỹ$/ }));
    const option = await screen.findByRole('option', { name: 'Quỹ tiền mặt' });
    fireEvent.click(option);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/expense-accounting/fund-book?source=TM&from=2026-09-01&to=2026-09-30'));
  });

  it('an empty OPS section states it plainly; no rows, no action', async () => {
    get.mockResolvedValue({ ...book, opsAdvance: { totalOutstanding: 0, items: [] } });
    section();
    await screen.findByText('TK công ty ACB');
    expect(screen.getByText('Không còn tạm ứng chưa hoàn của nhân viên OPS.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Lập phiếu' })).not.toBeInTheDocument();
  });

  it('a reversed period refuses before any fetch', async () => {
    section('/expense-accounting?fundFrom=2026-09-30&fundTo=2026-09-01');
    expect(await screen.findByText('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it('surfaces a failed load with a retry', async () => {
    get.mockRejectedValue(new Error('loi mang'));
    section();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Không tải được sổ quỹ');
    get.mockResolvedValue(book);
    fireEvent.click(within(alert).getByRole('button', { name: 'Thử lại' }));
    await screen.findByText('TK công ty ACB');
  });
});
