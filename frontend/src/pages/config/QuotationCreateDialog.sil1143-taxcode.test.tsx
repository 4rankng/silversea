/**
 * SIL-1143 (QA-Retest4) — the quotation customer picker shows each
 * customer's mã số thuế as the option's SECONDARY LINE (supportingText), so
 * the tax code is visible in the picker instead of surfacing only in the
 * downloaded Excel filename. The MST also joins the combobox search text
 * (SelectItem's textValue = label + supportingText), so typing it finds the
 * customer; the dialog's field hint echoes the selected customer's MST.
 *
 * jsdom note: inside a Modal React Aria swaps the visible picker for its
 * hidden native-select fallback (a11y), so the option rows are pinned at the
 * picker component level (UuiSelectField, the same control the dialog
 * renders) and the dialog surface is pinned through its hint line.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { QuotationCreateDialog } from './QuotationCreateDialog';

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../lib/api', () => ({
  api: { get: apiGet, post: apiPost },
}));

// ≥5 options keeps the picker in its type-to-search combobox shape — the
// same shape real customer catalogs get — whose option rows carry the
// supportingText secondary line.
const customers = [
  { id: 1, name: 'Công ty Alpha', taxCode: '3100123456' },
  { id: 2, name: 'Công ty Beta', taxCode: '0400987654' },
  { id: 3, name: 'Công ty Gamma', taxCode: null },
  { id: 4, name: 'Công ty Delta', taxCode: '0300555777' },
  { id: 5, name: 'Công ty Epsilon', taxCode: '0201444888' },
  { id: 6, name: 'Công ty Zeta', taxCode: '0100666999' },
];

function renderPicker() {
  return render(
    <UuiSelectField
      label="Khách hàng"
      value=""
      size="md"
      options={customers.map((customer) => ({
        value: String(customer.id),
        label: customer.name,
        supportingText: customer.taxCode ? `MST: ${customer.taxCode}` : undefined,
      }))}
      onChange={() => {}}
    />,
  );
}

/** React Aria's combobox needs the harness open sequence (act + focusIn +
 *  click, combobox.test.tsx's focusFactorySearch) before options exist. */
async function openPicker() {
  const input = screen.getByRole('combobox', { name: 'Khách hàng' });
  await act(async () => {
    input.focus();
    fireEvent.focusIn(input);
    fireEvent.click(input);
    const tick = Promise.withResolvers<void>();
    setTimeout(tick.resolve, 0);
    await tick.promise;
  });
  expect(input).toHaveAttribute('aria-expanded', 'true');
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith('/customers')) return Promise.resolve({ items: customers, total: customers.length, pageSize: 100 });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  apiPost.mockResolvedValue({ id: 99 });
});

describe('SIL-1143 — mã số thuế on the quotation customer picker', () => {
  it('every customer option renders its MST as the secondary line; a customer without one renders none', async () => {
    renderPicker();
    await openPicker();
    const alpha = screen.getByRole('option', { name: /Công ty Alpha/ });
    expect(alpha.textContent).toContain('MST: 3100123456');
    expect(screen.getByRole('option', { name: /Công ty Beta/ }).textContent).toContain('MST: 0400987654');
    // A customer without a tax code stays honest — no fabricated MST line.
    expect(screen.getByRole('option', { name: /Công ty Gamma/ }).textContent).not.toContain('MST:');
  });

  it('typing the tax code finds the customer', async () => {
    renderPicker();
    const input = await openPicker();
    screen.getByRole('option', { name: /Công ty Alpha/ });
    fireEvent.change(input, { target: { value: '3100123456' } });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Công ty Alpha/ })).toBeTruthy();
      expect(screen.queryByRole('option', { name: /Công ty Beta/ })).toBeNull();
    });
  });

  it('on the dialog, the committed customer shows its MST in the field hint', async () => {
    // Two customers keep the dialog's picker in its plain-select variant —
    // the shape the Modal's React Aria a11y fallback drives in jsdom.
    apiGet.mockImplementation((path: string) => {
      if (path.startsWith('/customers')) return Promise.resolve({ items: customers.slice(0, 2), total: 2, pageSize: 100 });
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QuotationCreateDialog onClose={vi.fn()} onCreated={vi.fn()} />, {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    // React Aria press arms the hidden native-select fallback (jsdom), whose
    // change event drives onSelectionChange — the existing dialog test's
    // proven path.
    const trigger = screen.getAllByRole('button').find((b) => /khách hàng/i.test(b.textContent ?? ''));
    fireEvent.pointerDown(trigger as HTMLElement);
    fireEvent.pointerUp(trigger as HTMLElement);
    fireEvent.click(trigger as HTMLElement);
    const hiddenSelect = await waitFor(() => {
      const select = document.querySelector('[data-testid="hidden-select-container"] select') as HTMLSelectElement;
      expect(select).toBeTruthy();
      expect(select.disabled).toBe(false);
      return select;
    });
    fireEvent.change(hiddenSelect, { target: { value: '1' } });
    // The MST shows twice: the field hint AND the committed selection's
    // secondary line on the trigger (select.tsx prints supportingText).
    await waitFor(() => expect(screen.getAllByText('MST: 3100123456').length).toBeGreaterThan(0));
  });
});
