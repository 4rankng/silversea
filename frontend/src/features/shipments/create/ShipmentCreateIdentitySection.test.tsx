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

describe('SIL-710 — Nhận diện lô document group order (Booking → Tờ khai → Nhập/Xuất → Hãng tàu)', () => {
  it('reads Khách hàng → Số Bill/Booking → Hình thức XNK → Hãng tàu → Tuỳ chọn in DOM order for FCL', () => {
    renderSection({ tradeDirection: 'EXPORT', cargoMode: 'FCL' } as Partial<ShipmentCreateFormState>);
    // SIL-710: thứ tự chứng từ: 1. Số Booking → 2. Số tờ khai (LCL) → 3. Nhập/Xuất → 4. Hãng tàu
    const chain = [
      '[data-field-id="shipment-customer"]',
      '[data-field-id="shipment-booking-ref"]',
      '[data-field-id="shipment-trade-direction"]',
      '[data-field-id="shipment-shipping-line"]',
      '[data-field-id="shipment-deposit"]',
    ].map((selector) => document.querySelector(selector));
    for (const node of chain) expect(node, `missing ${node}`).toBeTruthy();
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(
        chain[i]!.compareDocumentPosition(chain[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
        `field ${i + 1} must precede field ${i + 2}`,
      ).toBeTruthy();
    }
  });

  it('reads Khách hàng → Số Bill/Booking → Số tờ khai → Hình thức XNK → Hãng tàu → Tuỳ chọn in DOM order for LCL', () => {
    renderSection({ tradeDirection: 'EXPORT', cargoMode: 'LCL' } as Partial<ShipmentCreateFormState>);
    // SIL-710: thứ tự chứng từ LCL: 1. Số Booking → 2. Số tờ khai → 3. Nhập/Xuất → 4. Hãng tàu
    const chain = [
      '[data-field-id="shipment-customer"]',
      '[data-field-id="shipment-booking-ref"]',
      '[data-field-id="shipment-lcl-declaration-number"]',
      '[data-field-id="shipment-trade-direction"]',
      '[data-field-id="shipment-shipping-line"]',
      '[data-field-id="shipment-deposit"]',
    ].map((selector) => document.querySelector(selector));
    for (const node of chain) expect(node, `missing ${node}`).toBeTruthy();
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
