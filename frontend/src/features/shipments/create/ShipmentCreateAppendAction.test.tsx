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
 * form — exactly what ShipmentCreateWorkspace.applyShippingLine does. */
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
        onApply={(name) => { update('shippingLineName', name); setOpen(false); }}
      />
    </>
  );
}

function renderHarness(onUpdate: Update = () => {}) {
  return render(<AppendActionHarness onUpdate={onUpdate} />);
}

describe('shipment-create append action — hit target geometry', () => {
  it('declares a ≥32px square hit target for the trailing append button', () => {
    // jsdom computes no layout — getBoundingClientRect() here would measure
    // the environment, not the CSS. The geometry is pinned against the real
    // stylesheet, the same house pattern as the other styles contracts.
    const rule = pageCss.match(/\.csc-append-button\s*\{([^}]*)\}/)?.[1] ?? '';
    const width = Number(rule.match(/width:\s*(\d+)px/)?.[1] ?? 0);
    const height = Number(rule.match(/height:\s*(\d+)px/)?.[1] ?? 0);
    expect(width).toBeGreaterThanOrEqual(32);
    expect(height).toBeGreaterThanOrEqual(32);
  });

  it('owns its box beside the field — no absolute overlay racing the input', () => {
    const rule = pageCss.match(/\.csc-append-button\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).not.toContain('position: absolute');
    expect(pageCss).not.toMatch(/\.csc-field-with-append\s*\{[^}]*position:\s*relative;/);
    // The input no longer reserves padding for an overlay that is not there.
    expect(pageCss).not.toMatch(/\.csc-field-with-append > :first-child input\s*\{/);
    // A press registers visually.
    expect(pageCss).toMatch(/\.csc-append-button:not\(:disabled\):active\s*\{[^}]*transform:\s*translateY\(1px\);/);
  });
});

describe('shipment-create append action — DOM placement and naming', () => {
  it('renders both append buttons as flex siblings outside the field controls', () => {
    renderHarness();
    const customerButton = screen.getByRole('button', { name: 'Thêm khách hàng' });
    const lineButton = screen.getByRole('button', { name: 'Đặt tên hãng tàu cho lô này' });
    for (const button of [customerButton, lineButton]) {
      const wrapper = button.closest('.csc-field-with-append');
      expect(wrapper).toBeTruthy();
      // Sibling of the field adapter, never nested inside its control —
      // nesting it back would resurrect the overlay click race.
      expect(button.closest('.csc-uui-field')).toBeNull();
      expect(wrapper?.lastElementChild).toBe(button);
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

  it('states where the dropdown catalog comes from and that a typed name is per-lot', () => {
    renderHarness();
    expect(screen.getByText("Danh mục hãng tàu lấy từ Nhà cung cấp loại 'Hãng tàu'. Tên nhập ở đây chỉ lưu cùng lô hàng này.")).toBeTruthy();
  });
});

describe('shipment-create append action — click through the naming dialog', () => {
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
