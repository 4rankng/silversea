import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DebitReadinessPopover } from './DebitReadinessPopover';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

const getShipmentDetail = vi.fn();

vi.mock('../../api/shipmentClient', () => ({
  getShipmentDetail: (...args: unknown[]) => getShipmentDetail(...args),
}));

/**
 * SIL-1096 (K3.5) — the chot-debit row's readiness popover: the trigger
 * replaces the bare "Thiếu chi phí" dot, and opening it lists the FOUR
 * readiness conditions with a reason + cách bổ sung each (never silence).
 */

const thu = { cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000' };
const tra = { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', phiRu: '150000', tong1: null };

const row: AccountingDebitBoardRow = {
  shipmentId: 167,
  code: 'SHP-26-0167',
  customerName: 'KH A',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-11-25',
  billOrBooking: 'BL-167',
  routeName: 'Hà Nội — Hải Phòng',
  containers: ['ABCZ1234567 · 40HC'],
  phanXe: ['Nhà xe A'],
  thu: { ...thu },
  tra: { ...tra },
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: null,
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

function renderPopover() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DebitReadinessPopover row={row} />
    </QueryClientProvider>,
  );
}

describe('DebitReadinessPopover — "còn thiếu gì" trên dòng chot-debit (SIL-1096)', () => {
  it('the trigger keeps the "Thiếu chi phí" dot voice and opens the panel', () => {
    getShipmentDetail.mockReturnValue(new Promise(() => {}));
    renderPopover();
    const dot = screen.getByRole('img', { name: 'Thiếu chi phí' });
    expect(dot.getAttribute('title')).toBe('Thiếu chi phí');
    const trigger = screen.getByRole('button', { name: /Xem điều kiện lập bảng kê của BL-167/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // The panel (role=dialog, labelled by the lot) mounts portaled; jsdom has
    // no layout so the house popover hook keeps it visibility:hidden until it
    // measures the trigger — query the DOM, not the a11y tree.
    expect(document.querySelector('.debit-readiness[role="dialog"]')).toBeTruthy();
  });

  it('lists all four conditions with per-item reason + cách bổ sung for a failing lot', async () => {
    getShipmentDetail.mockResolvedValue({
      shipment: {}, containers: [], documents: [], declarations: [], statusHistory: [],
      pendingChangeRequests: [], podReviews: [], carrierAssignments: [], hasLiveTrips: false,
      accountingLock: null,
      documentSet: {
        status: 'MISSING', label: 'Còn thiếu', missingDocuments: ['Bill gốc'],
        receiverName: null, receivedOn: null, changedAt: null, changedByName: null, editable: false,
      },
      freightRate: { latest: null, snapshotCount: 0 },
    });
    renderPopover();
    fireEvent.click(screen.getByRole('button', { name: /Xem điều kiện lập bảng kê/ }));
    const dialog = await vi.waitFor(() => {
      const panel = document.querySelector('.debit-readiness[role="dialog"]') as HTMLElement;
      expect(panel).toBeTruthy();
      return panel;
    });
    // ALL FOUR conditions render; a failing one never answers with silence.
    for (const label of ['Hàng hóa', 'Giá', 'Chứng từ', 'Điều kiện kỳ']) {
      expect(dialog.textContent).toContain(label);
    }
    await vi.waitFor(() => {
      expect(dialog.textContent).toContain('Bill gốc');
      expect(dialog.textContent).toContain('Không tìm thấy kỳ giá dầu hiệu lực');
      expect(dialog.textContent).toContain('Cách bổ sung');
    });
    // The satisfied hàng hóa condition still ticks (Đủ), it does not vanish.
    expect(dialog.querySelector('[aria-label="Đủ"]')).toBeTruthy();
  });

  it('Escape closes the panel and returns focus to the trigger', () => {
    getShipmentDetail.mockReturnValue(new Promise(() => {}));
    renderPopover();
    const trigger = screen.getByRole('button', { name: /Xem điều kiện lập bảng kê/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(document.querySelector('.debit-readiness[role="dialog"]')).toBeNull();
  });
});
