import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn(), listSharedWarehouseSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  listOperationalSites,
  listSharedWarehouseSites,
}));

import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

/**
 * SIL-597 (ticket 697) — the per-container "Ngày giờ đóng trả" cell in the
 * "Thông tin hàng" table rests like every sibling cell: label + value text
 * (placeholder "Chọn ngày giờ" when empty). The old `alwaysVisible` mode
 * pinned the two datetime input frames (HH:mm and DD/MM/YYYY) on screen
 * inside the cell — the frames must appear only while editing.
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

function addContainer() {
  fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
}

/** The first container row's appointment cell (`data-field-id` carries the
 *  generated row key, so match the suffix). */
function appointmentCell(): HTMLElement {
  const cell = document.querySelector<HTMLElement>('[data-field-id$="-customer-appointment"]');
  if (!cell) throw new Error('Không tìm thấy ô Ngày giờ đóng trả');
  return cell;
}

function fillAppointment(date: string, time: string) {
  const dates = [...document.querySelectorAll<HTMLInputElement>('input[id$="-customer-appointment-date"]')];
  const times = [...document.querySelectorAll<HTMLInputElement>('input[id$="-customer-appointment-time"]')];
  fireEvent.change(dates[0]!, { target: { value: date } });
  fireEvent.change(times[0]!, { target: { value: time } });
}

describe('SIL-597 appointment cell is value-first — no input frame at rest', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
      containerTypes: [{ id: 3, code: '20DC', name: '20DC' }],
    });
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
  });

  it('C1: rests on label + placeholder text — never the forced input-frame mode', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    const cell = appointmentCell();
    expect(cell.getAttribute('data-label')).toBe('Ngày giờ đóng trả *');
    // The forced-frame mode is gone — the resting surface is the display lane.
    expect(cell.classList.contains('csc-container-cell--persistent')).toBe(false);
    const display = cell.querySelector('.csc-container-cell__display');
    expect(display?.textContent).toBe('Chọn ngày giờ');
  });

  it('C2: activating the cell reveals the editor (focus lands in the datetime inputs)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    const cell = appointmentCell();
    fireEvent.click(cell);
    // The shared activate path focuses the cell's first control — the editor
    // (segmented datetime input) is what takes focus on edit activation.
    const active = document.activeElement;
    expect(active?.tagName).toBe('INPUT');
    expect(cell.contains(active)).toBe(true);
  });

  it('C3: the committed value reads in the display lane after editing', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    fillAppointment('20/09/2026', '09:00');
    await waitFor(() => {
      const display = appointmentCell().querySelector('.csc-container-cell__display');
      expect(display?.textContent).toBe('20/09/2026 09:00');
    });
  });

  it('C4: style contract — editors rest hidden and reveal on focus; no forced-frame rule left', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/shipments/create/ShipmentContainerCell.css'), 'utf8');
    // The ex-`alwaysVisible` forced-frame mode must not return via CSS.
    expect(css).not.toContain('csc-container-cell--persistent');
    // The value-first reveal contract: the editor is hidden at rest…
    expect(css).toMatch(/\.csc-container-cell__editor > \* \{[^}]*opacity: 0/);
    // …and fades in while the cell is being edited.
    expect(css).toMatch(/:focus-within \.csc-container-cell__editor > \*/,);
  });
});
