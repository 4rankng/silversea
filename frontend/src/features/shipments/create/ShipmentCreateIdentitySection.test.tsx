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

describe('SIL-168 (owner ruling B 24/10, khách yêu cầu lần 3) — Nhận diện lô field order', () => {
  it('reads Khách hàng → Hình thức XNK → Số Bill/Booking → Hãng tàu → Tuỳ chọn → Số tờ khai (cuối) in DOM order', () => {
    renderSection({ tradeDirection: 'EXPORT' } as Partial<ShipmentCreateFormState>);
    // SIL-168 ruling B (owner 24/10 "why not handled yet"): Hình thức XNK
    // đứng TRƯỚC Số Bill/Booking — supersedes the FB-127 reading (9f174360:
    // Bill trước XNK, 2 cụm divider) and restores the 2425726d band order
    // the customer quoted verbatim on 23+24/10. Older history: 2425726d
    // superseded the A.3 order of card 181026200200. The Bill/Booking gate
    // (blNumber XOR bookingRef theo hướng, FB-113) is unchanged — only the
    // layout moved.
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

  it('Số tờ khai là band CUỐI của section; cụm divider "Chứng tự/Phân loại" của FB-127 đã bỏ', () => {
    // SIL-168: strip giữ vị trí cuối section (từ 2425726d). Conflict
    // warnings chỉ render khi có conflict — form sạch thì strip là element
    // cuối cùng của <section>. Cluster headings của 9f174360 phải biến mất.
    const { container } = renderSection({} as Partial<ShipmentCreateFormState>);
    expect(screen.queryByText('Chứng từ & định danh')).toBeNull();
    expect(screen.queryByText('Phân loại nghiệp vụ')).toBeNull();
    const section = container.querySelector('section.csc-section');
    expect(section).toBeTruthy();
    const strip = section!.querySelector('[data-field-id="shipment-declarations"]');
    expect(strip).toBeTruthy();
    expect(strip!.parentElement).toBe(section);
    expect(section!.lastElementChild).toBe(strip);
  });
});
