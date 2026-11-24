// SIL-941 (CUS-07, §7.2.1 K7.7, QA staging 3e9a28fa): the factory 'Xem chi
// tiết' dialog must open the site's INVOICE identity — MST, tên xuất hóa đơn,
// địa chỉ xuất hóa đơn — not only the address + warehouse rules QA found. The
// lift-fee invoice unit (ĐV nâng hạ) is a different entity and keeps its own
// scoped labels; an unconfigured factory names the gap (K2.98) instead of
// hiding the section.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OperationalSite } from '../../api/shipmentClient';
import { OperationalSiteDetailsDialog } from './OperationalSiteDetailsDialog';

function site(overrides: Partial<OperationalSite> = {}): OperationalSite {
  return {
    id: 1,
    customerId: 4,
    code: 'ASKEY-1',
    name: 'CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM',
    shortName: 'ASKEY-XƯỞNG 1',
    siteType: 'FACTORY',
    routeId: 7,
    address: 'Lô C7-2, KCN Quế Võ, Phường Nam Sơn, Tỉnh Bắc Ninh',
    googleMapsUrl: null,
    contactName: null,
    contactPhone: '0912345678',
    warehouseContactInfo: null,
    liftInfo: null,
    dropInfo: null,
    cleaningInfo: null,
    liftFeeInvoiceName: null,
    liftFeeInvoiceAddress: null,
    liftFeeTaxCode: null,
    invoiceName: 'CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM',
    invoiceAddress: 'Lô C7-2, KCN Quế Võ, Phường Nam Sơn, Tỉnh Bắc Ninh',
    invoiceTaxCode: '2301231325',
    strictRules: null,
    version: 1,
    ...overrides,
  };
}

function renderDialog(value: OperationalSite) {
  return render(<OperationalSiteDetailsDialog site={value} isOpen onClose={vi.fn()} />);
}

describe('SIL-941 — the factory dialog opens the invoice identity (CUS-07)', () => {
  it('shows MST, tên xuất hóa đơn and địa chỉ xuất hóa đơn of the factory', () => {
    renderDialog(site());
    expect(screen.getByText('Thông tin xuất hóa đơn')).toBeTruthy();
    expect(screen.getByText('2301231325')).toBeTruthy();
    // The factory's legal name/address legitimately repeat across the
    // Tên đầy đủ/Địa chỉ rows and the invoice rows (the QA factory's real
    // data) — both copies must be on screen.
    expect(screen.getAllByText('CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM')).toHaveLength(2);
    expect(screen.getAllByText('Lô C7-2, KCN Quế Võ, Phường Nam Sơn, Tỉnh Bắc Ninh')).toHaveLength(2);
    expect(screen.getByText('Tên xuất hóa đơn')).toBeTruthy();
  });

  it('names the gap when the factory has no invoice info configured (K2.98)', () => {
    renderDialog(site({ invoiceName: null, invoiceAddress: null, invoiceTaxCode: null }));
    expect(screen.getByText('Thông tin xuất hóa đơn')).toBeTruthy();
    expect(screen.getByText('Nhà máy chưa cấu hình thông tin xuất hóa đơn.')).toBeTruthy();
  });

  it('keeps the lift-fee invoice unit on its own scoped labels — one address row per entity', () => {
    renderDialog(site({
      liftFeeInvoiceName: 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH',
      liftFeeInvoiceAddress: 'Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh',
      liftFeeTaxCode: '2300540419',
    }));
    // The factory's own invoice address keeps the plain label — exactly once.
    expect(screen.getAllByText('Địa chỉ xuất hóa đơn')).toHaveLength(1);
    expect(screen.getByText('Địa chỉ ĐV nâng hạ')).toBeTruthy();
    expect(screen.getByText('Mã số thuế ĐV nâng hạ')).toBeTruthy();
    expect(screen.getByText('2300540419')).toBeTruthy();
    expect(screen.getByText('CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH')).toBeTruthy();
  });
});
