import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShipmentCreateIdentitySection } from './ShipmentCreateIdentitySection';
import type { ShipmentCreateFormState } from './shipment-create-model';

/**
 * SIL-641 (id 745) — CTO design ruling 02/11: the ONE "control + gap 8 +
 * action slot 36" pattern for every cell of section Nhận diện lô.
 *
 * The grid tracks were always 6/6; the defect was INSIDE the cells — only the
 * two quick-add cells reserved the button's 44px, so the four rendered control
 * boxes measured 551 / 595 / 595 / 551 @1307 ("one long one short"). Both
 * button-less cells now carry a hidden placeholder slot of the same size, and
 * the real buttons share the very same rule class.
 *
 * jsdom runs no layout engine, so this pins the DOM contract (which the CSS
 * pin in ShipmentCreateIdentitySection.styles.test.ts completes); the rendered
 * widths are proved by qa/2026-11-02_sil641/ browser measurements.
 */
const baseForm = {
  customerId: '',
  tradeDirection: '',
  blNumber: '',
  bookingRef: '',
  cargoMode: 'FCL',
  shippingLineName: '',
} as unknown as ShipmentCreateFormState;

type Update = <K extends keyof ShipmentCreateFormState>(key: K, value: ShipmentCreateFormState[K]) => void;

function Harness() {
  const [, setTick] = useState(0);
  const update: Update = () => setTick((n) => n + 1);
  const customerAddButtonRef = useRef<HTMLButtonElement>(null);
  const shippingLineAddButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <ShipmentCreateIdentitySection
      form={baseForm}
      update={update}
      selectCustomer={vi.fn()}
      customerOptions={[{ value: '1', label: 'KH A' }]}
      shippingLineOptions={[{ value: 'MSC', label: 'MSC' }]}
      saving={false}
      issueByField={new Map()}
      customerAddButtonRef={customerAddButtonRef}
      shippingLineAddButtonRef={shippingLineAddButtonRef}
      onOpenCustomerDialog={() => {}}
      onOpenShippingLineDialog={() => {}}
    />
  );
}

const SLOT = 'csc-identity-grid__action-slot';
const PLACEHOLDER = 'csc-identity-grid__action-slot--placeholder';

function cell(fieldId: string) {
  const el = document.querySelector(`[data-field-id="${fieldId}"]`);
  expect(el, `cell ${fieldId} renders`).toBeTruthy();
  return el as HTMLElement;
}

describe('SIL-641 (id 745): identity cells share ONE action slot', () => {
  it('renders exactly one action slot in each of the four identity cells', () => {
    render(<Harness />);
    for (const id of ['shipment-customer', 'shipment-trade-direction', 'shipment-booking-ref', 'shipment-shipping-line']) {
      const slots = cell(id).querySelectorAll(`.${SLOT}`);
      expect(slots, `${id} must carry exactly one slot`).toHaveLength(1);
    }
  });

  it('the two button-less cells reuse .csc-field-with-append and hold a hidden placeholder', () => {
    render(<Harness />);
    for (const id of ['shipment-trade-direction', 'shipment-booking-ref']) {
      const c = cell(id);
      expect(c.className, `${id} joins the shared append pattern`).toContain('csc-field-with-append');

      const placeholder = c.querySelector(`.${PLACEHOLDER}`);
      expect(placeholder, `${id} placeholder slot`).toBeTruthy();
      expect(placeholder!.tagName).toBe('SPAN');
      // Out of the accessibility tree and untouchable — but still in layout,
      // which is the whole point of the slot.
      expect(placeholder!.getAttribute('aria-hidden')).toBe('true');
      expect(placeholder!.className).toContain(SLOT);
      // Not a control: never focusable.
      expect(placeholder!.hasAttribute('tabindex')).toBe(false);
      // No real button may hide behind the placeholder class.
      expect(c.querySelector(`button.${PLACEHOLDER}`)).toBeNull();
    }
  });

  it('the two quick-add cells keep their REAL button as the slot (FB-114 sibling, never an overlay)', () => {
    render(<Harness />);
    const customer = cell('shipment-customer');
    const shipping = cell('shipment-shipping-line');

    for (const c of [customer, shipping]) {
      const slot = c.querySelector(`.${SLOT}`) as HTMLButtonElement;
      expect(slot.tagName, 'the slot is the real button').toBe('BUTTON');
      expect(slot.className).toContain('csc-append-button');
      // FB-114: a flex SIBLING of the field — never nested inside the control,
      // never absolutely positioned over the input.
      expect(slot.closest('.csc-uui-field')).toBeNull();
      expect(getComputedStyle(slot).position).not.toBe('absolute');
      expect(c.querySelectorAll(`.${PLACEHOLDER}`)).toHaveLength(0);
    }

    expect(screen.getByRole('button', { name: 'Thêm khách hàng' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đặt tên hãng tàu cho lô này' })).toBeTruthy();
  });

  it('the identity grid keeps its column classes (the equal 6/6 placement is untouched)', () => {
    render(<Harness />);
    // The slot equalises the CONTROL inside the cell; the cell itself must not
    // be re-spanned or renamed to do it — span 6 / span 6 stays the placement
    // authority (pinned in ShipmentCreateIdentitySection.styles.test.ts).
    const columns: Record<string, string> = {
      'shipment-customer': 'csc-identity-grid__customer',
      'shipment-trade-direction': 'csc-identity-grid__trade-direction',
      'shipment-booking-ref': 'csc-identity-grid__booking',
      'shipment-shipping-line': 'csc-identity-grid__shipping-line',
    };
    for (const [id, columnClass] of Object.entries(columns)) {
      expect(cell(id).className, id).toContain(columnClass);
    }
  });
});
