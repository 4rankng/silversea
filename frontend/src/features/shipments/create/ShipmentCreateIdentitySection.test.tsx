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

describe('SIL-788 — Nhận diện lô band map (Khách hàng·XNK → Bill·Hãng tàu; LCL tờ khai cạnh Bill)', () => {
  it('reads Khách hàng → Hình thức XNK → Số Bill/Booking → Hãng tàu → Tuỳ chọn in DOM order for FCL', () => {
    renderSection({ tradeDirection: 'EXPORT', cargoMode: 'FCL' } as Partial<ShipmentCreateFormState>);
    // SIL-788 band map (KB Ch3 §3.2.1, 24/10 re-asserted): band 1 = Khách
    // hàng · Hình thức XNK; band 2 = Số Bill/Booking · Hãng tàu; band 3 = Tuỳ chọn.
    const chain = [
      '[data-field-id="shipment-customer"]',
      '[data-field-id="shipment-trade-direction"]',
      '[data-field-id="shipment-booking-ref"]',
      '[data-field-id="shipment-shipping-line"]',
      '[data-field-id="shipment-deposit"]',
    ].map((selector) => document.querySelector(selector));
    for (const [i, node] of chain.entries()) expect(node, `missing ${chain[i]}`).toBeTruthy();
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(
        chain[i]!.compareDocumentPosition(chain[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
        `field ${i + 1} must precede field ${i + 2}`,
      ).toBeTruthy();
    }
  });

  it('reads Khách hàng → Hình thức XNK → Số Bill/Booking → Số tờ khai (cạnh Bill, phải) → Hãng tàu → Tuỳ chọn in DOM order for LCL', () => {
    renderSection({ tradeDirection: 'EXPORT', cargoMode: 'LCL' } as Partial<ShipmentCreateFormState>);
    // SIL-788 band map + luật 06/11: band 2 giữ Số Bill/Booking · Số tờ khai
    // cùng hàng (tờ khai bên phải); Hãng tàu dòng dưới trong cùng band.
    const chain = [
      '[data-field-id="shipment-customer"]',
      '[data-field-id="shipment-trade-direction"]',
      '[data-field-id="shipment-booking-ref"]',
      '[data-field-id="shipment-lcl-declaration-number"]',
      '[data-field-id="shipment-shipping-line"]',
      '[data-field-id="shipment-deposit"]',
    ].map((selector) => document.querySelector(selector));
    for (const [i, node] of chain.entries()) expect(node, `missing ${chain[i]}`).toBeTruthy();
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(
        chain[i]!.compareDocumentPosition(chain[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
        `field ${i + 1} must precede field ${i + 2}`,
      ).toBeTruthy();
    }
  });

  it('SIL-521: form tạo/sửa lô KHÔNG còn chỗ nhập Số tờ khai cấp lô', () => {
    // Owner 26/10: tờ khai chỉ nhập/sửa ở cấp cont (Tổng quan / drawer).
    // Cụm divider "Chứng từ/Phân loại" của FB-127 vẫn phải biến mất.
    const { container } = renderSection({} as Partial<ShipmentCreateFormState>);
    expect(screen.queryByText('Chứng từ & định danh')).toBeNull();
    expect(screen.queryByText('Phân loại nghiệp vụ')).toBeNull();
    expect(screen.queryByText('Số tờ khai')).toBeNull();
    expect(container.querySelector('[data-field-id="shipment-declarations"]')).toBeNull();
    expect(container.querySelector('.csc-declaration-strip')).toBeNull();
  });
});
