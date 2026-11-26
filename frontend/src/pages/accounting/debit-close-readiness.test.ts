import { describe, expect, it } from 'vitest';
import { deriveDebitCloseReadiness, hasMissingCost } from './debit-close-readiness';
import { ShipmentDocumentSetStatus } from '@tingting/shared';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import type { ShipmentDetail } from '../../api/shipmentClient';

/**
 * SIL-1096 (KB §3.1.3, K3.5 / K2.69) — the four debit-note readiness
 * conditions (hàng hóa · giá · chứng từ · điều kiện kỳ) with a per-condition
 * reason + cách bổ sung. QA: the chot-debit rows carried only a bare
 * "Thiếu chi phí" dot — no reason, no guidance.
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

describe('deriveDebitCloseReadiness — the four conditions (SIL-1096)', () => {
  it('K3.5: ALWAYS lists exactly the four KB conditions, even when everything is fine', () => {
    const items = deriveDebitCloseReadiness(row(), detail());
    expect(items.map((item) => item.label)).toEqual(['Hàng hóa', 'Giá', 'Chứng từ', 'Điều kiện kỳ']);
    expect(items.every((item) => item.ok)).toBe(true);
  });

  it('a lot missing goods + pricing + terms names exactly those with reasons + how to complete', () => {
    const items = deriveDebitCloseReadiness(
      row({ containers: [], routeName: null, thu: { ...thu, cuocThu: null } }),
      detail({
        documentSet: {
          status: ShipmentDocumentSetStatus.MISSING, label: 'Còn thiếu', missingDocuments: ['Bill gốc'],
          receiverName: null, receivedOn: null, changedAt: null, changedByName: null, editable: false,
        },
        freightRate: { latest: null, snapshotCount: 0 },
      }),
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
      detail({
        documentSet: {
          status: ShipmentDocumentSetStatus.MISSING, label: 'Còn thiếu', missingDocuments: [],
          receiverName: null, receivedOn: null, changedAt: null, changedByName: null, editable: false,
        },
      }),
    );
    const chungTu = items.find((item) => item.label === 'Chứng từ');
    expect(chungTu?.ok).toBe(false);
    expect(chungTu?.reason).toContain('Chưa ghi nhận danh mục');
  });

  it('unconfirmed e-POD counts into the documents condition', () => {
    const base = detail();
    const items = deriveDebitCloseReadiness(
      row(),
      detail({
        ...base,
        podReviews: [{
          fulfillmentId: 1, fulfillmentVersion: 1, shipmentId: 1, fulfillmentType: 'FCL_CONTAINER',
          cargoMode: 'FCL', shipmentContainerId: null, containerNumber: null, canceledAt: null,
          cancellationDisposition: null, replacementFulfillmentId: null, notRequiredReason: null,
          required: true, tripId: 1, tripCode: 'T-1', tripStatus: 'COMPLETED', tripVersion: 1,
          driverName: null, currentSubmission: null, history: [],
        }],
      } as Partial<ShipmentDetail>),
    );
    const chungTu = items.find((item) => item.label === 'Chứng từ');
    expect(chungTu?.ok).toBe(false);
    expect(chungTu?.reason).toContain('e-POD chưa xác nhận');
  });

  it('a fuel period priced in satisfies điều kiện kỳ', () => {
    const items = deriveDebitCloseReadiness(row(), detail());
    const ky = items.find((item) => item.label === 'Điều kiện kỳ');
    expect(ky?.ok).toBe(true);
  });

  it('hasMissingCost keeps the KT8 predicate after the move (the dot law)', () => {
    expect(hasMissingCost(row())).toBe(false);
    expect(hasMissingCost(row({ tra: { ...tra, tong1: null } }))).toBe(true);
  });
});
