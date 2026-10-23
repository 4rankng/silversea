import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShipmentCreateIdentitySection } from './ShipmentCreateIdentitySection';
import type { ShipmentCreateFormState } from './shipment-create-model';

// Card 121026084523 (QA1-001): before a trade direction is picked the Bill field
// is disabled, but its placeholder read "Chọn Nhập hoặc Xuất" — wording that
// describes the trade-direction picker, not this field.
const baseForm = {
  customerId: '',
  tradeDirection: '',
  blNumber: '',
  bookingRef: '',
  cargoMode: 'FCL',
} as unknown as ShipmentCreateFormState;

function renderSection(form: Partial<ShipmentCreateFormState> = {}) {
  const merged = { ...baseForm, ...form } as ShipmentCreateFormState;
  return render(
    <ShipmentCreateIdentitySection
      form={merged}
      update={vi.fn()}
      selectCustomer={vi.fn()}
      customerOptions={[]}
      shippingLineOptions={[]}
      saving={false}
      issueByField={new Map()}
      customerAddButtonRef={createRef<HTMLButtonElement>()}
      shippingLineAddButtonRef={createRef<HTMLButtonElement>()}
      onOpenCustomerDialog={vi.fn()}
      onOpenShippingLineDialog={vi.fn()}
    />,
  );
}

describe('QA1-001 — Bill/Booking placeholder before a trade direction is picked', () => {
  it('names the field itself instead of the trade-direction picker', () => {
    renderSection();
    const billField = screen.getByLabelText(/Số Bill\/Booking/);
    expect(billField.getAttribute('placeholder')).not.toBe('Chọn Nhập hoặc Xuất');
    expect(billField.getAttribute('placeholder')).toBe('Nhập số Bill/Booking');
  });

  it('stays disabled and keeps the prerequisite hint', () => {
    renderSection();
    const billField = screen.getByLabelText(/Số Bill\/Booking/);
    expect(billField).toBeDisabled();
    expect(screen.getByText('Chọn Hình thức xuất nhập khẩu trước')).toBeTruthy();
  });

  it.each([
    ['IMPORT', 'Nhập số Bill (hàng Nhập)'],
    ['EXPORT', 'Nhập số Booking (hàng Xuất)'],
  ])('keeps the %s placeholder once a direction is picked', (direction, placeholder) => {
    renderSection({ tradeDirection: direction } as Partial<ShipmentCreateFormState>);
    expect(screen.getByLabelText(/Số Bill\/Booking/).getAttribute('placeholder')).toBe(placeholder);
  });
});

describe('Card 261023093200 (Tiệp Vũ FB 23/10) — Nhận diện lô field order', () => {
  it('reads Hình thức XNK → Số Bill/Booking → Hãng tàu → Tuỳ chọn → Số tờ khai (cuối) in DOM order', () => {
    renderSection({ tradeDirection: 'EXPORT' } as Partial<ShipmentCreateFormState>);
    // The owner picks the trade direction FIRST, so the picker rides beside
    // Khách hàng and the Bill/Booking field it gates sits directly below it;
    // the tờ khai strip is the LAST band of the section. Supersedes the A.3
    // order of card 181026200200 (Bill/Booking → tờ khai → Nhập/Xuất →
    // Hãng tàu; FB-113 set that same old order on the ledger popup).
    const chain = [
      '[data-field-id="shipment-customer"]',
      '[data-field-id="shipment-trade-direction"]',
      '[data-field-id="shipment-booking-ref"]',
      '[data-field-id="shipment-shipping-line"]',
      '[data-field-id="shipment-deposit"]',
      '[data-field-id="shipment-declarations"]',
    ].map((selector) => document.querySelector(selector));
    for (const node of chain) expect(node, `missing ${node}`).toBeTruthy();
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(
        chain[i]!.compareDocumentPosition(chain[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
        `field ${i + 1} must precede field ${i + 2}`,
      ).toBeTruthy();
    }
  });
});
