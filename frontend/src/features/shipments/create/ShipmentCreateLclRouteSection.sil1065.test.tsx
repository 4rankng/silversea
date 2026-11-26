// SIL-1065 — /shipments/:id (the post-create review view of the create
// workspace) at 390px: "Lưu ý tại nhà máy" printed the factory's full
// strictRules — a 946-char note owned ~20 lines and pushed "Thông tin hàng"
// below the fold. The note now clamps to ~3 lines behind a measured
// "Xem thêm" reveal, the same sanctioned pattern as SIL-983 (driver site
// rules) and SIL-1006 (dispatch card note). jsdom does no layout, so the
// reveal is simulated the way the driver pin does it: prototype spies on
// the clamped paragraph only.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OperationalSite } from '../../../api/shipmentClient';
import { EMPTY_SHIPMENT_CREATE_FORM } from './shipment-create-model';
import { ShipmentCreateLclRouteSection } from './ShipmentCreateLclRouteSection';

const LONG_RULE = 'Q'.repeat(946);
const CLAMPED_CLASS = 'csc-site-guidance__text--clamped';

function makeSite(strictRules: string | null): OperationalSite {
  return {
    id: 41,
    customerId: 7,
    code: 'NM01',
    name: 'Nhà máy Long Minh',
    siteType: 'FACTORY',
    routeId: null,
    address: 'Bình Dương',
    googleMapsUrl: null,
    contactName: null,
    contactPhone: null,
    warehouseContactInfo: null,
    liftInfo: null,
    dropInfo: null,
    cleaningInfo: null,
    liftFeeInvoiceName: null,
    liftFeeInvoiceAddress: null,
    liftFeeTaxCode: null,
    invoiceName: null,
    invoiceAddress: null,
    invoiceTaxCode: null,
    strictRules,
    version: 1,
  } as OperationalSite;
}

function renderSection(site: OperationalSite | null) {
  return render(
    <ShipmentCreateLclRouteSection
      form={EMPTY_SHIPMENT_CREATE_FORM}
      update={vi.fn()}
      routeOptions={[]}
      operationalSites={site ? [site] : []}
      warehouseSites={[]}
      warehouseSitesLoading={false}
      selectedOperationalSite={site}
      selectOperationalSite={vi.fn()}
      routeAddButtonRef={{ current: null }}
      setRouteDialogOpen={vi.fn()}
      openCreateSiteDialog={vi.fn()}
      setDetailSite={vi.fn()}
      saving={false}
      sitesLoading={false}
      issueByField={new Map()}
    />,
  );
}

function spyClampedBoxHeight(clampedClient: number, clampedScroll: number) {
  const clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return this.classList.contains(CLAMPED_CLASS) ? clampedClient : 0;
    });
  const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return this.classList.contains(CLAMPED_CLASS) ? clampedScroll : 0;
    });
  return () => {
    clientHeightSpy.mockRestore();
    scrollHeightSpy.mockRestore();
  };
}

describe('ShipmentCreateLclRouteSection — the factory note clamps behind a reveal (SIL-1065)', () => {
  it('clamps an overflowing note behind "Xem thêm", which restores the full text', () => {
    const restore = spyClampedBoxHeight(66, 425);
    try {
      renderSection(makeSite(LONG_RULE));

      expect(screen.getByText(LONG_RULE)).toBeTruthy();
      const reveal = screen.getByRole('button', { name: 'Xem thêm' });
      expect(reveal.getAttribute('aria-expanded')).toBe('false');
      expect(document.querySelector(`.${CLAMPED_CLASS}`)).toBeTruthy();

      fireEvent.click(reveal);
      const collapse = screen.getByRole('button', { name: 'Thu gọn' });
      expect(collapse.getAttribute('aria-expanded')).toBe('true');
      expect(document.querySelector(`.${CLAMPED_CLASS}`)).toBeNull();
      // Nothing is lost on collapse — the full text stays in the DOM.
      expect(screen.getByText(LONG_RULE)).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('renders no reveal control when the note fits the clamp', () => {
    const restore = spyClampedBoxHeight(66, 66);
    try {
      renderSection(makeSite('Gọi điện trước khi vào'));
      expect(screen.getByText('Gọi điện trước khi vào')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Thu gọn' })).toBeNull();
    } finally {
      restore();
    }
  });

  it('keeps the full text in the DOM under the clamp — the clamp hides, never cuts', () => {
    const restore = spyClampedBoxHeight(66, 425);
    try {
      renderSection(makeSite(LONG_RULE));
      // The clamped paragraph still carries the whole note: the reveal is
      // the way back (no-truncation doctrine — the DOM never loses content).
      expect(document.querySelector(`.${CLAMPED_CLASS}`)?.textContent).toBe(LONG_RULE);
    } finally {
      restore();
    }
  });
});
