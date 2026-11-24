import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn(), listSharedWarehouseSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  listOperationalSites,
  listSharedWarehouseSites,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

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

function volumeTriggers() {
  return [...screen.getAllByRole('button', { name: /Chỉnh sửa thể tích — dòng \d+/ })];
}

/** SIL-552 pattern: the volume line is a ghost trigger — open its floating
 *  editor, type, Enter commits into the row draft and closes the panel. */
function fillVolume(index: number, value: string) {
  fireEvent.click(volumeTriggers()[index]!);
  const input = screen.getByLabelText(`Thể tích (CBM) — dòng ${index + 1}`) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

/** Opens row `index`'s volume panel and returns the seeded input value. */
function volumeValue(index: number): string {
  fireEvent.click(volumeTriggers()[index]!);
  return (screen.getByLabelText(`Thể tích (CBM) — dòng ${index + 1}`) as HTMLInputElement).value;
}

/**
 * SIL-917 (KB §3.2.5, audit 24/11): the container row gains the THỂ TÍCH
 * (CBM) ghost line beside SỐ / LOẠI / TRỌNG LƯỢNG — optional (no *), unit
 * CBM, committing into the row draft exactly like the weight line, and
 * inherited by the adjacent row on "Thêm container" (the SIL-180 copy law
 * rides the whole-row clone).
 */
describe('Container row Thể tích (CBM) line (SIL-917)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('renders the empty THỂ TÍCH line per container row', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    // The worksheet starts with one bare container row — its THỂ TÍCH line
    // reads the "Nhập CBM" hint and carries no required mark (KB §7.3/§3.2.4:
    // CBM is optional).
    expect(volumeTriggers().map((b) => b.getAttribute('aria-label'))).toEqual(['Chỉnh sửa thể tích — dòng 1']);
    expect(screen.getByText('Thể tích')).toBeTruthy();
    fireEvent.click(volumeTriggers()[0]!);
    const input = screen.getByLabelText('Thể tích (CBM) — dòng 1') as HTMLInputElement;
    expect(input.value).toBe('');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(volumeTriggers()[0]!.getAttribute('aria-expanded')).toBe('false'));
  });

  it('commits a typed CBM into the row draft and closes the editor on Enter', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });

    fillVolume(0, '28.75');
    // The floating card stays MOUNTED at rest (opacity 0 — the value-first
    // law); "closed" reads off the trigger's expanded state.
    await waitFor(() => expect(volumeTriggers()[0]!.getAttribute('aria-expanded')).toBe('false'));
    // Reopening seeds the committed value: the draft row holds it.
    expect(volumeValue(0)).toBe('28.75');

    // An emptied draft is a real clear (same law as the weight line).
    fillVolume(0, '');
    await waitFor(() => expect(volumeTriggers()[0]!.getAttribute('aria-expanded')).toBe('false'));
    expect(volumeValue(0)).toBe('');
  });

  it('inherits the previous row CBM when adding a container (SIL-180 copy law)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fillVolume(0, '4.5');

    addContainer();
    expect(volumeTriggers()).toHaveLength(2);
    expect(volumeValue(1)).toBe('4.5');
  });
});
