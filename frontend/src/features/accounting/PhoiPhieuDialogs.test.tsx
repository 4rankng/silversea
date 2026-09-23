import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { PhoiPhieuChiHoDialog } from './PhoiPhieuChiHoDialog';
import { PhoiPhieuTienDuongDialog } from './PhoiPhieuTienDuongDialog';

vi.mock('../../api/phoiPhieuClient', () => ({
  correctPhoiPhieuRow: vi.fn(),
  getPhoiPhieuChiHo: vi.fn().mockResolvedValue({
    tripCode: 'ST-2609-0001',
    ngayLayPhoi: null,
    trangThaiLay: null,
    rows: [
      {
        entryId: 1, sourceId: 11, feeName: 'Phí nâng hạ', invoiceNumber: null,
        amountThu: 1_350_000, amountTra: 1_350_000, payerName: 'Khách', confirmed: false, version: 3,
      },
    ],
  }),
  getPhoiPhieuTienDuong: vi.fn().mockResolvedValue({
    tripCode: 'ST-2609-0001',
    totals: { total: 2_000_000, confirmed: 500_000 },
    rows: [
      {
        sourceId: 21, version: 1, costType: 'FUEL', feeName: 'Xăng đường',
        occurredAt: '2026-09-22', driverName: 'Tuấn', driverEnteredAmount: 900_000,
        amount: 1_000_000, confirmed: false,
      },
    ],
  }),
  updatePhoiPhieuMeta: vi.fn(),
  updatePhoiPhieuRowAmounts: vi.fn(),
  voidPhoiPhieuRow: vi.fn(),
}));

vi.mock('../../api/expenseAccountingClient', () => ({
  expenseAccountingClient: { catalog: vi.fn().mockResolvedValue({ feeCategories: [], employees: [] }) },
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  document.body.style.overflow = '';
});

describe('phôi phiếu detail dialogs render in the house modal shell (card 20260922_67)', () => {
  it('Chi hộ dialog portals into document.body inside the fixed backdrop — not the page flow', async () => {
    render(<PhoiPhieuChiHoDialog tripId={7} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' });
    // Portal proof: the backdrop div is a DIRECT child of document.body, so
    // the dialog's on-screen position can never inherit the 100+-row board's
    // scroll offset (the 21,588px defect).
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass('ops-modal-backdrop');
    await waitFor(() => expect(screen.getByText('Chi tiết chi hộ ST-2609-0001')).toBeInTheDocument());
  });

  it('Chi hộ dialog: ✕ and Escape both dismiss; body scroll locks while open and restores after', async () => {
    const onClose = vi.fn();
    const { unmount } = render(<PhoiPhieuChiHoDialog tripId={7} onClose={onClose} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' });
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Chi tiết chi hộ' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('Chi hộ dialog: focus returns to the opener after unmount', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<PhoiPhieuChiHoDialog tripId={7} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' });
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('Tiền đường dialog portals into document.body and ✕ dismisses', async () => {
    const onClose = vi.fn();
    render(<PhoiPhieuTienDuongDialog tripId={7} onClose={onClose} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết tiền đường' });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass('ops-modal-backdrop');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('both dialog sources import the shared modal stylesheet (card acceptance 3)', () => {
    for (const file of ['PhoiPhieuChiHoDialog.tsx', 'PhoiPhieuTienDuongDialog.tsx']) {
      const source = readFileSync(resolve(process.cwd(), `src/features/accounting/${file}`), 'utf8');
      expect(source).toContain("import '../ops/ops-modal.css';");
      expect(source).toContain('OpsModalBackdrop');
    }
  });
});
