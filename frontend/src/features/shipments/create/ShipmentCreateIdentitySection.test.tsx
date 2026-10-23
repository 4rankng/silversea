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

describe('FB-127 (TIEPVU-21, Tiệp Vũ 23/10 — MỚI NHẤT, thắng card 261023093200) — Nhận diện lô field order', () => {
  it('reads 2 cụm "Chứng từ & định danh" → "Phân loại nghiệp vụ"; Số Bill/Booking TRƯỚC Hình thức XNK', () => {
    renderSection({ tradeDirection: 'EXPORT' } as Partial<ShipmentCreateFormState>);
    // FB-127 rule (docs/prd/TaoMoiLoHang.md): thứ tự field chốt theo luồng
    // chứng từ giấy — Cụm 1 Chứng từ & định danh (Khách hàng · Số
    // Bill/Booking · Hãng tàu · Số tờ khai cuối cụm), Cụm 2 Phân loại nghiệp
    // vụ (Hình thức XNK · Tuỳ chọn). The Bill/Booking gate (blNumber XOR
    // bookingRef theo hướng, FB-113) is unchanged — only the layout moved.
    expect(screen.getByText('Chứng từ & định danh')).toBeTruthy();
    expect(screen.getByText('Phân loại nghiệp vụ')).toBeTruthy();
    const chain = [
      '[data-field-id="shipment-customer"]',
      '[data-field-id="shipment-booking-ref"]',
      '[data-field-id="shipment-shipping-line"]',
      '[data-field-id="shipment-declarations"]',
      '[data-field-id="shipment-trade-direction"]',
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

  it('cluster divider: 2 cụm là adjacent siblings (CSS "+" selector gắn divider)', () => {
    // jsdom không load page CSS, nên pin cấu trúc mà rule
    // `.csc-identity-cluster + .csc-identity-cluster { border-top… }` cần:
    // hai cụm kề nhau trong cùng cha — divider chắc chắn áp cho cụm 2.
    const { container } = renderSection({} as Partial<ShipmentCreateFormState>);
    const clusters = container.querySelectorAll(':scope > .csc-section-body > .csc-identity-cluster, .csc-identity-cluster');
    expect(clusters.length).toBe(2);
    expect(clusters[1]!.previousElementSibling).toBe(clusters[0]!);
    expect(clusters[1]!.querySelector('[data-field-id="shipment-trade-direction"]')).toBeTruthy();
    expect(clusters[0]!.querySelector('[data-field-id="shipment-booking-ref"]')).toBeTruthy();
  });
});
