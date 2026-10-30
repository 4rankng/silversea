import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  listOperationalSites: vi.fn(),
  listSharedWarehouseSites: vi.fn(),
}));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  listOperationalSites,
  listSharedWarehouseSites,
}));

import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

/**
 * SIL-552 (QA fail 29/10, build 28c3a120) — the create form's SỐ CONTAINER
 * group must run the owner's floating-editor decision: the LOẠI / TRỌNG
 * LƯỢNG lines are ghost lines (label + value trigger, no editor chrome in
 * the cell), and activating a line opens the floating editor card
 * (role="dialog", anchored to the line) that commits on Enter/Lưu —
 * the same contract the drawer's cell already runs. In-cell editing of
 * those lines ("thiết kế cũ") is the bug this pins shut.
 */
function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/shipments/new']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentCreateWorkspace />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function weightTrigger(row = 0) {
  return screen.getAllByRole('button', { name: /Chỉnh sửa trọng lượng — dòng \d+/ })[row]!;
}

function typeTrigger(row = 0) {
  return screen.getAllByRole('button', { name: /Chỉnh sửa loại container — dòng \d+/ })[row]!;
}

describe('SIL-552 (id 626): SỐ CONTAINER group lines open the floating editor', () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
      containerTypes: [{ id: 20, code: '20DC', name: "20'DC" }, { id: 31, code: '40HC', name: 'Container 40 feet cao' }],
    });
  });

  it('the LOẠI combobox stays reachable at rest (the constraint walk meets LOẠI before the factory)', { timeout: 10000 }, async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    // The regression pin: with the editor mounted invisibly in the line, the
    // combobox remains the row's first container control. Unmounting it made
    // react-aria's validation focus leap to the factory field, whose
    // focus-trigger menu leaked an `ariaHideOutside` over the whole page.
    expect(screen.getAllByRole('combobox', { name: 'Loại container' }).length).toBeGreaterThanOrEqual(1);
  });

  it('clicking the TRỌNG LƯỢNG line opens the floating editor and Enter commits into the draft row', { timeout: 10000 }, async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(weightTrigger());
    const panel = await screen.findByRole('dialog', { name: 'Chỉnh sửa trọng lượng — dòng 1' });
    expect(panel).toHaveClass('is-open');
    // The trigger declares the panel it opens (the drawer's S4 law).
    expect(weightTrigger()).toHaveAttribute('aria-expanded', 'true');
    expect(weightTrigger()).toHaveAttribute('aria-controls', panel.id);

    const input = within(panel).getByLabelText('Trọng lượng (kg) — dòng 1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12000' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The commit lands in the draft row and the card closes; the ghost line
    // shows the localized value.
    await waitFor(() => expect(panel).not.toHaveClass('is-open'));
    expect(screen.getAllByRole('button', { name: /Chỉnh sửa trọng lượng — dòng \d+/ })[0]!.textContent).toContain('12.000');
    expect(document.activeElement).toBe(weightTrigger());
  });

  it('Escape cancels the weight draft and restores the trigger focus', { timeout: 10000 }, async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(weightTrigger());
    const panel = await screen.findByRole('dialog', { name: 'Chỉnh sửa trọng lượng — dòng 1' });
    const input = within(panel).getByLabelText('Trọng lượng (kg) — dòng 1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(panel).not.toHaveClass('is-open'));
    // The draft was discarded: the ghost line shows no value.
    expect(weightTrigger().textContent).not.toContain('999');
    expect(document.activeElement).toBe(weightTrigger());
  });

  it('the Lưu button shares the Enter guard: an unchanged draft saves nothing', { timeout: 10000 }, async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fireEvent.click(weightTrigger());
    const panel = await screen.findByRole('dialog', { name: 'Chỉnh sửa trọng lượng — dòng 1' });
    const save = within(panel).getByRole('button', { name: 'Lưu' });
    // The seeded draft equals the persisted (empty) value: nothing to save —
    // the button and Enter agree on the same guard (the drawer's S1 law).
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(weightTrigger().textContent).not.toContain('0');
    fireEvent.keyDown(within(panel).getByLabelText('Trọng lượng (kg) — dòng 1'), { key: 'Escape' });
    await waitFor(() => expect(panel).not.toHaveClass('is-open'));
  });

  it('clicking the LOẠI line floats the combobox AND opens its menu — no bare caret (SIL-608 remainder)', { timeout: 10000 }, async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // The line's own click is a deliberate activation: the editor floats AND
    // the suggestion menu opens in the same gesture (the 272 hand-off
    // channel; qa/2026-10-30_sil608_picker_ui-01 proved the old bare-caret
    // flow). Bare focus alone still never opens — pinned below.
    fireEvent.click(typeTrigger());
    const panel = await screen.findByRole('dialog', { name: 'Chỉnh sửa loại container — dòng 1' });
    expect(panel).toHaveClass('is-open');
    const combo = within(panel).getByRole('combobox', { name: 'Loại container' });
    await waitFor(() => expect(combo).toHaveAttribute('aria-expanded', 'true'));
    expect(await screen.findByRole('option', { name: '20DC' })).toBeTruthy();

    // The create affordance rides inside the floating card's menu options
    // (TC-CUS-CREATE-020) — the reason the drawer's plain-listbox swap is
    // NOT portable here.
    expect(await screen.findByRole('option', { name: '+ Thêm' })).toBeTruthy();
  });

  it('Tab leaving the SỐ container field opens the LOẠI editor with its menu (the 272 hand-off)', { timeout: 10000 }, async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    const number = screen.getByLabelText('Số container') as HTMLInputElement;
    fireEvent.focus(number);
    fireEvent.keyDown(number, { key: 'Tab', shiftKey: false });

    const panel = await screen.findByRole('dialog', { name: 'Chỉnh sửa loại container — dòng 1' });
    await waitFor(() => expect(panel).toHaveClass('is-open'));
    // The hand-off opens the combobox menu exactly once (the 272 contract).
    await waitFor(() => expect(within(panel).getByRole('combobox', { name: 'Loại container' })).toHaveAttribute('aria-expanded', 'true'));
  });
});
