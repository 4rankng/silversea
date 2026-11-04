import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShipmentCreateIdentitySection } from './ShipmentCreateIdentitySection';
import { ShippingLineAddDialog } from './ShippingLineAddDialog';
import type { ShipmentCreateFormState } from './shipment-create-model';

const pageCss = readFileSync(resolve(process.cwd(), 'src/pages/clerk/ClerkShipmentCreatePage.css'), 'utf8');

const baseForm = {
  customerId: '',
  tradeDirection: '',
  blNumber: '',
  bookingRef: '',
  cargoMode: 'FCL',
  shippingLineName: '',
} as unknown as ShipmentCreateFormState;

type Update = <K extends keyof ShipmentCreateFormState>(key: K, value: ShipmentCreateFormState[K]) => void;

/** Mirrors the workspace wiring under test: the pencil action opens the
 * naming dialog and its apply rides update('shippingLineName', …) into the
 * form — the lot-field half of ShipmentCreateWorkspace.applyShippingLine
 * (the catalog persist half is pinned in
 * ShipmentCreateWorkspace.shipping-line-persist.test.tsx). */
function AppendActionHarness({ onUpdate }: { onUpdate: Update }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ShipmentCreateFormState>(baseForm);
  const customerAddButtonRef = useRef<HTMLButtonElement>(null);
  const shippingLineAddButtonRef = useRef<HTMLButtonElement>(null);
  const update: Update = (key, value) => {
    onUpdate(key, value);
    setForm((current) => ({ ...current, [key]: value }));
  };
  return (
    <>
      <ShipmentCreateIdentitySection
        form={form}
        update={update}
        selectCustomer={vi.fn()}
        customerOptions={[]}
        shippingLineOptions={[{ value: 'MSC', label: 'MSC' }]}
        saving={false}
        issueByField={new Map()}
        customerAddButtonRef={customerAddButtonRef}
        shippingLineAddButtonRef={shippingLineAddButtonRef}
        onOpenCustomerDialog={() => {}}
        onOpenShippingLineDialog={() => setOpen(true)}
      />
      <ShippingLineAddDialog
        isOpen={open}
        currentName={form.shippingLineName}
        onClose={() => setOpen(false)}
        onApply={async (name) => { update('shippingLineName', name); setOpen(false); }}
      />
    </>
  );
}

function renderHarness(onUpdate: Update = () => {}) {
  return render(<AppendActionHarness onUpdate={onUpdate} />);
}

describe('SIL-681 trailing action — hit target geometry (stylesheet contract)', () => {
  it('declares the trailing action 40px wide and the input\'s OWN height token', () => {
    // jsdom computes no layout — getBoundingClientRect() here would measure
    // the environment, not the CSS. The geometry is pinned against the real
    // stylesheet, the same house pattern as the other styles contracts.
    const rule = pageCss.match(/\.csc-trailing-action\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule, 'trailing action rule').not.toBe('');
    // Brief floor: hit area 40px wide. Height inherits the input's own
    // geometry token (control-geometry.css sm band) — never a hardcoded px.
    expect(rule).toContain('width: 40px');
    expect(rule).toContain('height: var(--control-compact-h)');
    expect(rule).not.toMatch(/height:\s*\d+px/);
  });

  it('mirrors the control\'s touch band — height grows with the input at ≤768px/coarse', () => {
    expect(pageCss).toMatch(
      /@media \(pointer: coarse\), \(max-width: 768px\)\s*\{\s*\.csc-trailing-action\s*\{[^}]*height:\s*var\(--control-touch-h\);[^}]*\}\s*\}/,
    );
  });

  it('sits INSIDE the input — absolute, on the control row, above the input for clicks', () => {
    const rule = pageCss.match(/\.csc-trailing-action\s*\{([^}]*)\}/)?.[1] ?? '';
    // The owner 04/11 pattern: absolute overlay at the input's right end.
    expect(rule).toContain('position: absolute');
    // 24px = house label line 18px + the UUI field's real 6px gap (SIL-678
    // measurement) — the button lands on the control's row.
    expect(rule).toContain('top: 24px');
    // FB-114's click race stays dead: the button must out-rank the kit's
    // in-control layers (input z-10, clear × z-20) — token-derived, never a
    // raw integer (design-drift ban).
    expect(rule).toContain('z-index: var(--z-dropdown)');
    // A press registers visually.
    expect(pageCss).toMatch(/\.csc-trailing-action:not\(:disabled\):active\s*\{[^}]*background:\s*var\(--surface-3\);/);
  });

  it('reserves the input\'s right zone so text never runs under the icon or the clear ×', () => {
    // Base reservation: the trailing button zone.
    expect(pageCss).toMatch(/\.csc-field-with-trailing \.uui-combobox__input input\[role='combobox'\],\s*\n\.csc-field-with-trailing \.uui-combobox__input > span\[aria-hidden='true'\]\s*\{\s*padding-right: 44px;/);
    // When the combobox clear × shows (SIL-482 contract unchanged), the ×
    // shifts LEFT of the trailing action and the reservation covers both.
    expect(pageCss).toMatch(/\.csc-field-with-trailing \.uui-combobox:has\(button\[aria-label='Xoá'\]\)[\s\S]*?padding-right: 72px;/);
    expect(pageCss).toMatch(/\.csc-field-with-trailing \.uui-combobox button\[aria-label='Xoá'\]\s*\{\s*right: 44px;/);
  });

  it('retires the detached append pattern everywhere — no legacy class in CSS or DOM', () => {
    expect(pageCss).not.toContain('csc-append-button');
    expect(pageCss).not.toContain('csc-field-with-append');
    expect(pageCss).not.toContain('csc-identity-grid__action-slot');
    renderHarness();
    expect(document.querySelector('.csc-append-button')).toBeNull();
    expect(document.querySelector('.csc-identity-grid__action-slot')).toBeNull();
    expect(document.querySelectorAll('.csc-trailing-action')).toHaveLength(2);
  });
});

describe('SIL-681 trailing action — DOM placement and naming', () => {
  it('renders both actions inside their cell wrapper but OUTSIDE the combobox control subtree', () => {
    renderHarness();
    const customerButton = screen.getByRole('button', { name: 'Thêm khách hàng' });
    const lineButton = screen.getByRole('button', { name: 'Đặt tên hãng tàu cho lô này' });
    for (const button of [customerButton, lineButton]) {
      const wrapper = button.closest('.csc-field-with-trailing');
      expect(wrapper).toBeTruthy();
      // The overlay is positioned by CSS over the input — it must NOT nest
      // inside the combobox control subtree (no RAC press/combobox semantics
      // leak into the action).
      expect(button.closest('[data-uui-control]')).toBeNull();
      expect(button.className).toContain('csc-trailing-action');
    }
  });

  it('keeps the customer quick-create a plus, but names the shipping-line action honestly with a pencil', () => {
    renderHarness();
    const customerButton = screen.getByRole('button', { name: 'Thêm khách hàng' });
    expect(customerButton.querySelector('svg.lucide-plus')).toBeTruthy();
    const lineButton = screen.getByRole('button', { name: 'Đặt tên hãng tàu cho lô này' });
    // The pencil names the lot's field; it must not promise a catalog add.
    expect(lineButton.querySelector('svg.lucide-pencil')).toBeTruthy();
    expect(lineButton.querySelector('svg.lucide-plus')).toBeNull();
  });

  it('states where the dropdown catalog comes from and scopes the catalog add to the pencil', () => {
    renderHarness();
    // SIL-499: the 2-sentence usage hint is GONE (§8 lecturing-copy ban; it
    // wrapped to four lines at half-width columns). The honest naming lives
    // on the pencil affordance: lot-field naming, never a catalog promise.
    expect(screen.queryByText(/Danh mục hãng tàu lấy từ Nhà cung cấp/)).toBeNull();
    const lineButton = screen.getByRole('button', { name: 'Đặt tên hãng tàu cho lô này' });
    expect(lineButton.title).toContain('hãng tàu');
  });
});

describe('SIL-681 trailing action — click through the naming dialog', () => {
  it('opens the naming dialog on click and keeps the honest copy', async () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Đặt tên hãng tàu cho lô này' }));

    const dialog = await screen.findByRole('dialog', { name: 'Đặt tên hãng tàu cho lô này' });
    expect(within(dialog).getByText('Tên hãng tàu sẽ được lưu cùng lô hàng hiện tại.')).toBeTruthy();
  });

  it('applies the typed name to shippingLineName (trimmed) and the field holds it', async () => {
    const onUpdate = vi.fn();
    renderHarness(onUpdate);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt tên hãng tàu cho lô này' }));

    const dialog = await screen.findByRole('dialog', { name: 'Đặt tên hãng tàu cho lô này' });
    fireEvent.change(within(dialog).getByLabelText('Tên hãng tàu'), { target: { value: '  Ocean Network Express  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Áp dụng' }));

    expect(onUpdate).toHaveBeenCalledWith('shippingLineName', 'Ocean Network Express');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Đặt tên hãng tàu cho lô này' })).toBeNull());
    expect((screen.getByRole('combobox', { name: /^Hãng tàu/ }) as HTMLInputElement).value).toBe('Ocean Network Express');
  });
});
