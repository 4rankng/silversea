import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  deriveDebitCloseReadiness,
  hasMissingCost,
  type DebitReadinessItem,
} from './debit-close-readiness';
import { DebitReadinessPopover } from './DebitReadinessPopover';
import { ShipmentDocumentSetStatus } from '@tingting/shared';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import type { ShipmentDetail } from '../../api/shipmentClient';

const getShipmentDetail = vi.fn();

vi.mock('../../api/shipmentClient', () => ({
  getShipmentDetail: (...args: unknown[]) => getShipmentDetail(...args),
}));

/**
 * SIL-1096 (KB §3.1.3, K3.5 / K2.69) — the four debit-note readiness
 * conditions (hàng hóa · giá · chứng từ · điều kiện kỳ) with a per-condition
 * reason + cách bổ sung. QA: the chot-debit rows carried only a bare
 * "Thiếu chi phí" dot — no reason, no guidance.
 *
 * SIL-1096 (same ticket, loading law) — while the lot's detail wire is still
 * loading (or failed), a detail-derived condition may NOT claim a missing
 * reason: "chưa có dữ liệu" ≠ "thiếu điều kiện" (the same law SIL-1095's
 * lot-status block keeps). The board row's own reasons stay definite.
 */

const thu = { cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000' };
const tra = { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', phiRu: '150000', tong1: '480000' };

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-11-25',
  billOrBooking: 'BL-1',
  routeName: ' Tuyến A ',
  containers: ['ABCZ1234567 · 40HC'],
  phanXe: ['Nhà xe A'],
  thu: { ...thu },
  tra: { ...tra },
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: '1160000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
  ...over,
});

const detail = (over: Partial<ShipmentDetail> = {}): ShipmentDetail => ({
  shipment: {} as ShipmentDetail['shipment'],
  containers: [],
  documents: [],
  declarations: [],
  statusHistory: [],
  pendingChangeRequests: [],
  podReviews: [],
  carrierAssignments: [],
  hasLiveTrips: false,
  accountingLock: null,
  documentSet: {
    status: 'COMPLETE',
    label: 'Đã đủ',
    missingDocuments: [],
    receiverName: null,
    receivedOn: null,
    changedAt: null,
    changedByName: null,
    editable: false,
  },
  freightRate: {
    latest: {
      id: 1, shipmentId: 1, tripId: null, source: 'AUTO', freightAmount: 1, surchargeAmount: 0,
      totalAmount: 1, billedKm: 1, liters: 1, fuelDelta: 0, sharePct: 0, formula: '',
      computedAt: '2026-11-25T00:00:00Z', rateTermsId: 7, pricingTableId: 5, fuelNormId: 3, fuelPricePeriodId: 9,
      override: null,
    },
    snapshotCount: 1,
  },
  ...over,
}) as ShipmentDetail;

/** The detail wire answered — the state the four conditions are derived in
 *  when the lot's payload has landed. */
const ready = (payload: ShipmentDetail) => ({ status: 'ready' as const, detail: payload });

/** The one condition of the four the caller asks about — the panel's four
 *  lines are read by label, so the lookup stays in one place. */
const condition = (items: DebitReadinessItem[], label: string): DebitReadinessItem | undefined =>
  items.find((entry) => entry.label === label);

describe('deriveDebitCloseReadiness — the four conditions (SIL-1096)', () => {
  it('K3.5: ALWAYS lists exactly the four KB conditions, even when everything is fine', () => {
    const items = deriveDebitCloseReadiness(row(), ready(detail()));
    expect(items.map((item) => item.label)).toEqual(['Hàng hóa', 'Giá', 'Chứng từ', 'Điều kiện kỳ']);
    expect(items.every((item) => item.ok)).toBe(true);
  });

  it('a lot missing goods + pricing + terms names exactly those with reasons + how to complete', () => {
    const items = deriveDebitCloseReadiness(
      row({ containers: [], routeName: null, thu: { ...thu, cuocThu: null } }),
      ready(detail({
        documentSet: {
          status: ShipmentDocumentSetStatus.MISSING, label: 'Còn thiếu', missingDocuments: ['Bill gốc'],
          receiverName: null, receivedOn: null, changedAt: null, changedByName: null, editable: false,
        },
        freightRate: { latest: null, snapshotCount: 0 },
      })),
    );
    const failing = items.filter((item) => !item.ok);
    // freightRate.latest = null also means no priced fuel period → kỳ fails too.
    expect(failing.map((item) => item.label)).toEqual(['Hàng hóa', 'Giá', 'Chứng từ', 'Điều kiện kỳ']);

    const gia = items.find((item) => item.label === 'Giá');
    expect(gia?.reason).toContain('Chưa có tuyến');
    expect(gia?.reason).toContain('Thiếu điều khoản cước / bảng giá');
    expect(gia?.howTo).toContain('chọn tuyến trên chi tiết lô');

    const chungTu = items.find((item) => item.label === 'Chứng từ');
    expect(chungTu?.reason).toContain('Bill gốc');

    // Điều kiện kỳ: no frozen snapshot → the fuel-period reason, with WHO fixes it.
    const ky = items.find((item) => item.label === 'Điều kiện kỳ');
    expect(ky?.reason).toContain('Không tìm thấy kỳ giá dầu hiệu lực');
    expect(ky?.howTo).toContain('Kế toán/Admin');
  });

  it('a fact with no named category never invents a document name', () => {
    const items = deriveDebitCloseReadiness(
      row(),
      ready(detail({
        documentSet: {
          status: ShipmentDocumentSetStatus.MISSING, label: 'Còn thiếu', missingDocuments: [],
          receiverName: null, receivedOn: null, changedAt: null, changedByName: null, editable: false,
        },
      })),
    );
    const chungTu = items.find((item) => item.label === 'Chứng từ');
    expect(chungTu?.ok).toBe(false);
    expect(chungTu?.reason).toContain('Chưa ghi nhận danh mục');
  });

  it('unconfirmed e-POD counts into the documents condition', () => {
    const base = detail();
    const items = deriveDebitCloseReadiness(
      row(),
      ready(detail({
        ...base,
        podReviews: [{
          fulfillmentId: 1, fulfillmentVersion: 1, shipmentId: 1, fulfillmentType: 'FCL_CONTAINER',
          cargoMode: 'FCL', shipmentContainerId: null, containerNumber: null, canceledAt: null,
          cancellationDisposition: null, replacementFulfillmentId: null, notRequiredReason: null,
          required: true, tripId: 1, tripCode: 'T-1', tripStatus: 'COMPLETED', tripVersion: 1,
          driverName: null, currentSubmission: null, history: [],
        }],
      } as Partial<ShipmentDetail>)),
    );
    const chungTu = items.find((item) => item.label === 'Chứng từ');
    expect(chungTu?.ok).toBe(false);
    expect(chungTu?.reason).toContain('e-POD chưa xác nhận');
  });

  it('a fuel period priced in satisfies điều kiện kỳ', () => {
    const items = deriveDebitCloseReadiness(row(), ready(detail()));
    const ky = items.find((item) => item.label === 'Điều kiện kỳ');
    expect(ky?.ok).toBe(true);
  });

  it('hasMissingCost keeps the KT8 predicate after the move (the dot law)', () => {
    expect(hasMissingCost(row())).toBe(false);
    expect(hasMissingCost(row({ tra: { ...tra, tong1: null } }))).toBe(true);
  });
});

describe('deriveDebitCloseReadiness — the detail wire is not ready yet (SIL-1096)', () => {
  it('while loading, no detail-derived condition claims a missing reason', () => {
    const items = deriveDebitCloseReadiness(row(), { status: 'loading' });

    // Giá: the price facts (điều khoản cước / bảng giá) are UNKNOWN — not
    // "Thiếu điều khoản cước / bảng giá".
    const gia = condition(items, 'Giá');
    expect(gia?.ok).toBe(false);
    expect(gia?.loading).toBe(true);
    expect(gia?.reason).toBe('Đang tải dữ liệu giá của lô…');
    expect(gia?.reason).not.toContain('Thiếu điều khoản cước');
    expect(gia?.howTo).toBeNull();

    // Điều kiện kỳ: the fuel period is UNKNOWN — not "không tìm thấy kỳ giá
    // dầu hiệu lực".
    const ky = condition(items, 'Điều kiện kỳ');
    expect(ky?.ok).toBe(false);
    expect(ky?.loading).toBe(true);
    expect(ky?.reason).toBe('Đang tải dữ liệu điều kiện kỳ của lô…');
    expect(ky?.reason).not.toContain('Không tìm thấy kỳ giá dầu hiệu lực');

    // Chứng từ keeps its loading sentence.
    const chungTu = condition(items, 'Chứng từ');
    expect(chungTu?.ok).toBe(false);
    expect(chungTu?.loading).toBe(true);
    expect(chungTu?.reason).toBe('Đang tải dữ liệu chứng từ của lô…');
  });

  it('while loading, the board-row condition never waits for the wire', () => {
    const items = deriveDebitCloseReadiness(row(), { status: 'loading' });
    const hangHoa = condition(items, 'Hàng hóa');
    expect(hangHoa?.ok).toBe(true);
    expect(hangHoa?.loading).toBeUndefined();
  });

  it('while loading, a definite board-row reason still answers (chưa có tuyến survives)', () => {
    const items = deriveDebitCloseReadiness(row({ routeName: null }), { status: 'loading' });
    const gia = condition(items, 'Giá');
    expect(gia?.ok).toBe(false);
    expect(gia?.loading).toBe(true);
    expect(gia?.reason).toContain('Chưa có tuyến');
    expect(gia?.reason).not.toContain('Thiếu điều khoản cước');
    expect(gia?.howTo).toContain('chọn tuyến trên chi tiết lô');
  });

  it('while loading, an un-chốt money row still names its open fields', () => {
    const items = deriveDebitCloseReadiness(
      row({ tra: { ...tra, tong1: null } }),
      { status: 'loading' },
    );
    const gia = condition(items, 'Giá');
    expect(gia?.loading).toBe(true);
    expect(gia?.reason).toContain('Chưa chốt: tổng 1');
    expect(gia?.reason).not.toContain('Thiếu điều khoản cước');
  });

  it('when the wire fails, the detail-derived conditions say so and are not loading', () => {
    const items = deriveDebitCloseReadiness(row(), { status: 'error' });

    const gia = condition(items, 'Giá');
    expect(gia?.ok).toBe(false);
    expect(gia?.loading).toBe(false);
    expect(gia?.reason).toBe('Không tải được dữ liệu giá của lô — thử lại sau.');
    expect(gia?.reason).not.toContain('Thiếu điều khoản cước');

    const chungTu = condition(items, 'Chứng từ');
    expect(chungTu?.ok).toBe(false);
    expect(chungTu?.loading).toBe(false);
    expect(chungTu?.reason).toBe('Không tải được dữ liệu chứng từ của lô — thử lại sau.');

    const ky = condition(items, 'Điều kiện kỳ');
    expect(ky?.ok).toBe(false);
    expect(ky?.loading).toBe(false);
    expect(ky?.reason).toBe('Không tải được dữ liệu điều kiện kỳ của lô — thử lại sau.');
    expect(ky?.reason).not.toContain('Không tìm thấy kỳ giá dầu hiệu lực');
  });

  it('when the wire fails, the definite board-row reason still answers', () => {
    const items = deriveDebitCloseReadiness(row({ routeName: null }), { status: 'error' });
    const gia = condition(items, 'Giá');
    expect(gia?.loading).toBe(false);
    expect(gia?.reason).toContain('Chưa có tuyến');
    expect(gia?.reason).toContain('Không tải được dữ liệu giá của lô — thử lại sau.');
    expect(gia?.reason).not.toContain('Thiếu điều khoản cước');
  });

  it('the ready wire keeps its exact reasons (the loading law never changes a known answer)', () => {
    const items = deriveDebitCloseReadiness(row(), ready(detail()));
    for (const entry of items) {
      expect(entry.loading).toBeUndefined();
    }
    const gia = condition(items, 'Giá');
    expect(gia?.ok).toBe(true);
    expect(gia?.reason).toBeNull();
  });
});

describe('DebitReadinessPopover — the panel while the detail wire loads (SIL-1096)', () => {
  it('shows no false tick and no false missing reason while the wire is in flight', () => {
    // The lot's detail never lands — the panel must say "verdict unknown",
    // not "thiếu điều khoản cước" and not a green tick either.
    const { promise } = Promise.withResolvers<ShipmentDetail>();
    getShipmentDetail.mockReturnValue(promise);
    render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(DebitReadinessPopover, { row: row() }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Điều kiện lập bảng kê/ }));
    const panel = document.querySelector('.debit-readiness[role="dialog"]') as HTMLElement;
    expect(panel).toBeTruthy();

    // Only the board-row condition (hàng hóa) is KNOWN — it ticks. The three
    // detail-derived conditions are unknown: no tick, no red failure line.
    expect(panel.querySelectorAll('[aria-label="Đủ"]')).toHaveLength(1);
    expect(panel.querySelectorAll('.debit-readiness__item--loading')).toHaveLength(3);
    expect(panel.querySelector('.debit-readiness__item--missing')).toBeNull();
    expect(panel.textContent).not.toContain('Thiếu điều khoản cước');
    expect(panel.textContent).not.toContain('Không tìm thấy kỳ giá dầu hiệu lực');
  });
});
