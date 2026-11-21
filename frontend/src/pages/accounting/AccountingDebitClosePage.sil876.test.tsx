// SIL-876 (hotfix CR-009.1, QA fail build 32e22c12) — Ch.10 §10.7.4: the
// /accounting/chot-debit LÔ column ALWAYS renders its four lines
// (Ngày vận chuyển / Tên rút gọn KH / Nhà máy / Tuyến đường); a missing
// fact renders its own '—' line and never collapses the stack. QA repro:
// lot K5K5346365 (Nhà máy + Tuyến đường trống) showed only 3 lines —
// 02/11/2026 / Long Minh / KCN QUẾ VÕ, BẮC NINH — with the '—' fallback
// line owed and absent.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, listRounds } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  confirmRateAdjustments: vi.fn(),
  withdrawRateAdjustments: vi.fn(),
  listSettlementRounds: listRounds,
  createSettlementRound: vi.fn(),
  setDebitExternalCost: vi.fn(),
  setDebitRateOverrides: vi.fn(),
  reconcileAndHideDebitLots: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));

import { ToastProvider } from '../../components/shared/Toast';
import AccountingDebitClosePage from './AccountingDebitClosePage';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

const THU = {
  cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000',
};
const TRA = { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '480000', phiRu: '150000' };

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SHP-26-0001',
  customerName: 'Long Minh',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-11-02',
  billOrBooking: 'K5K5346365',
  containers: ['MNBU0006614 · 40HC'],
  phanXe: ['VĂN LAN'],
  truckPlates: ['51C-059.58'],
  factoryName: null,
  routeName: null,
  thu: { ...THU },
  tra: { ...TRA },
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: '1160000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
  ...over,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/chot-debit']}>
      <ToastProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <AccountingDebitClosePage />
        </QueryClientProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

function lotCellOf(ref: string): Promise<HTMLElement> {
  return screen.findByText(ref).then((refEl) => refEl.closest('tr')!.querySelector('td.debit-col--lot .record-cell-stack') as HTMLElement);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listRounds.mockResolvedValue({ items: [] });
  window.matchMedia = (media): MediaQueryList => ({
    media, matches: false, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
});

describe('SIL-876 — the Lô cell always renders the four §10.7.4 lines', () => {
  it('QA repro K5K5346365: factory present, route missing → the route line renders —', async () => {
    listBoard.mockResolvedValue({
      items: [row({ factoryName: 'KCN QUẾ VÕ, BẮC NINH', routeName: null })],
      total: 1,
    });
    renderPage();
    const lotCell = await lotCellOf('K5K5346365');
    // The four lines, in order: ngày / KH / nhà máy / tuyến ('—').
    const lines = Array.from(lotCell.children);
    expect(lines).toHaveLength(4);
    expect(lotCell.querySelector('.debit-lot-date')?.textContent).toBe('02/11/2026');
    expect(lotCell.querySelector('.name-cell')?.textContent).toBe('Long Minh');
    expect(lotCell.querySelector('.debit-lot-site')?.textContent).toBe('KCN QUẾ VÕ, BẮC NINH');
    expect(lotCell.querySelector('.debit-lot-route')?.textContent).toBe('—');
  });

  it('neither nhà máy nor tuyến → both lines render — (no collapse)', async () => {
    listBoard.mockResolvedValue({ items: [row()], total: 1 });
    renderPage();
    const lotCell = await lotCellOf('K5K5346365');
    expect(lotCell.querySelector('.debit-lot-site')?.textContent).toBe('—');
    expect(lotCell.querySelector('.debit-lot-route')?.textContent).toBe('—');
  });

  it('no customer fact → the KH line renders — and the stack stays four lines', async () => {
    listBoard.mockResolvedValue({
      items: [row({ customerName: null, factoryName: 'ASKEY', routeName: 'Bình Dương – Cát Lái' })],
      total: 1,
    });
    renderPage();
    const lotCell = await lotCellOf('K5K5346365');
    expect(lotCell.querySelector('.name-cell')).toBeNull();
    expect(lotCell.querySelector('small')?.textContent).toBe('—');
    expect(lotCell.querySelector('.debit-lot-site')?.textContent).toBe('ASKEY');
    expect(lotCell.querySelector('.debit-lot-route')?.textContent).toBe('Bình Dương – Cát Lái');
  });
});
