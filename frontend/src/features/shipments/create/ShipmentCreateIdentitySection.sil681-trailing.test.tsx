import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShipmentCreateIdentitySection } from './ShipmentCreateIdentitySection';
import type { ShipmentCreateFormState } from './shipment-create-model';

/**
 * SIL-681 (owner 04/11, kèm ảnh) — the identity section's two quick-create
 * actions live INSIDE their inputs as trailing actions (same height as the
 * input), and the detached "control + gap 8 + action slot 36" pattern of
 * SIL-641 (id 745) is retired: no real-button slot, no hidden placeholder —
 * every cell renders its control full width, so the shared-right-edge law
 * holds by construction.
 *
 * jsdom runs no layout engine, so this pins the DOM contract (which the CSS
 * pins in ShipmentCreateAppendAction.test.tsx +
 * ShipmentCreateIdentitySection.styles.test.ts complete); the rendered
 * geometry is proved by qa/2026-11-04-lcl-trailing-actions/ browser drives.
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

function Harness({ cargoMode = 'FCL' }: { cargoMode?: 'FCL' | 'LCL' }) {
  const [, setTick] = useState(0);
  const update: Update = () => setTick((n) => n + 1);
  const customerAddButtonRef = useRef<HTMLButtonElement>(null);
  const shippingLineAddButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <ShipmentCreateIdentitySection
      form={{ ...baseForm, cargoMode }}
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

function cell(fieldId: string) {
  const el = document.querySelector(`[data-field-id="${fieldId}"]`);
  expect(el, `cell ${fieldId} renders`).toBeTruthy();
  return el as HTMLElement;
}

describe('SIL-681: the two quick-create actions are in-input trailing actions', () => {
  it('renders exactly one trailing action button per action cell, wired to the refs', () => {
    render(<Harness />);
    const customer = cell('shipment-customer');
    const shipping = cell('shipment-shipping-line');
    for (const c of [customer, shipping]) {
      expect(c.className, 'cell joins the trailing pattern').toContain('csc-field-with-trailing');
      expect(c.className).not.toContain('csc-field-with-append');
      expect(c.querySelectorAll('.csc-trailing-action'), 'exactly one trailing action').toHaveLength(1);
      // The overlay is CSS-positioned over the input; it never nests inside
      // the combobox control subtree.
      const button = c.querySelector('.csc-trailing-action') as HTMLButtonElement;
      expect(button.tagName).toBe('BUTTON');
      expect(button.closest('[data-uui-control]')).toBeNull();
    }
    // Refs still land on the real buttons (dialog-return focus contract).
    const customerButton = screen.getByRole('button', { name: 'Thêm khách hàng' });
    const lineButton = screen.getByRole('button', { name: 'Đặt tên hãng tàu cho lô này' });
    expect(customerButton.className).toContain('csc-trailing-action');
    expect(lineButton.className).toContain('csc-trailing-action');
  });

  it('the button-less cells carry NO slot and NO placeholder — controls go full width', () => {
    render(<Harness />);
    for (const id of ['shipment-trade-direction', 'shipment-booking-ref']) {
      const c = cell(id);
      expect(c.className).not.toContain('csc-field-with-append');
      expect(c.querySelector('.csc-identity-grid__action-slot'), `${id} slot gone`).toBeNull();
      expect(c.querySelector('.csc-identity-grid__action-slot--placeholder'), `${id} placeholder gone`).toBeNull();
    }
  });

  it('the identity grid keeps its column classes (the equal 6/6 placement is untouched)', () => {
    render(<Harness />);
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

  // SIL-641 residual (id 745, QA fail 03/11): QA's yardstick is the INNER
  // typing box of each field. The identity comboboxes render WITHOUT the
  // decorative glyph — a DOM absence, not a CSS hide.
  it('the identity comboboxes render WITHOUT the decorative search icon (equal inner typing boxes)', () => {
    render(<Harness />);
    for (const id of ['shipment-customer', 'shipment-shipping-line']) {
      expect(cell(id).querySelector('[data-combobox-search]'), `${id} search glyph absent`).toBeNull();
    }
  });
});

describe('SIL-681 r2 (QA fail comment 3885): the hàng-lẻ tab keeps the carrier entry', () => {
  it('LCL renders Khách hàng trailing, the declaration cell, AND the hãng tàu trailing cell (full-width)', () => {
    render(<Harness cargoMode="LCL" />);
    const customer = cell('shipment-customer');
    expect(customer.querySelector('.csc-trailing-action')).toBeTruthy();
    const declaration = cell('shipment-lcl-declaration-number');
    expect(declaration.querySelector('.csc-trailing-action')).toBeNull();
    expect(declaration.querySelector('.csc-identity-grid__action-slot')).toBeNull();
    // SIL-681 r2: hãng tàu exists on LCL — same trailing '✎' as FCL, on its
    // own full-width row (the refs band's right half is Số tờ khai's).
    const shipping = cell('shipment-shipping-line');
    expect(shipping).not.toBeNull();
    expect(shipping.classList.contains('csc-identity-grid__shipping-line--lcl')).toBe(true);
    const pencil = shipping.querySelector('button.csc-trailing-action');
    expect(pencil).not.toBeNull();
    expect(pencil!.getAttribute('aria-label')).toBe('Đặt tên hãng tàu cho lô này');
    expect(shipping.querySelector('input')).not.toBeNull();
  });
});
