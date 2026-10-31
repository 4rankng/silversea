import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn(), listSharedWarehouseSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  listOperationalSites,
  listSharedWarehouseSites,
}));

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

function bulkBand() {
  return document.querySelector('.csc-bulk-appointment');
}

function bulkInputs() {
  return {
    date: document.querySelector<HTMLInputElement>('input[id$="-bulk-appointment-date"]'),
    time: document.querySelector<HTMLInputElement>('input[id$="-bulk-appointment-time"]'),
  };
}

function fillRowAppointment(index: number, date: string, time: string) {
  const dates = [...document.querySelectorAll<HTMLInputElement>('input[id$="-customer-appointment-date"]')];
  const times = [...document.querySelectorAll<HTMLInputElement>('input[id$="-customer-appointment-time"]')];
  fireEvent.change(dates[index]!, { target: { value: date } });
  fireEvent.change(times[index]!, { target: { value: time } });
}

describe('SIL-616/617/625 — the top mode band cluster', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
  });

  // SIL-617 (id 721): the copy-all band is the ONLY place that đặt giờ hẹn
  // cho tất cả cont at once. The old `emptyAppointmentCount >= 1` gate
  // unmounted it the moment every container row carried a schedule — on a
  // fully-filled form cuộn hết form cũng không thấy nó. The band must be in
  // the DOM in BOTH states; only its Copy target set changes.
  it('keeps the copy-all band rendered on the EMPTY form and after every cont has a schedule', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    // Empty form: band present with its two segment inputs.
    expect(bulkBand()).toBeTruthy();
    expect(bulkInputs().date).toBeTruthy();
    expect(bulkInputs().time).toBeTruthy();

    // Fill the single container row's appointment → emptyAppointmentCount
    // reaches 0 (the exact pre-fix unmount point).
    fillRowAppointment(0, '31/10/2026', '09:30');
    expect(bulkBand(), 'band survives a fully-scheduled form').toBeTruthy();
    expect(bulkInputs().date).toBeTruthy();
    expect(bulkInputs().time).toBeTruthy();

    // A second container doubles the gate's reach — both rows filled, the
    // band still stands.
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    fillRowAppointment(0, '31/10/2026', '09:30');
    fillRowAppointment(1, '01/11/2026', '15:00');
    expect(bulkBand(), 'band survives with every row scheduled').toBeTruthy();
  });

  // SIL-625 (id 729): the visible blue label "Ngày giờ đóng trả cho tất cả
  // cont" is retired — the two inputs + Copy affordance stay. The name
  // survives as the group's accessible label (screen readers keep it).
  it('removes the visible copy-all label while keeping inputs and the accessible name', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    const band = bulkBand();
    expect(band).toBeTruthy();
    // No visible label span inside the band.
    const labelSpan = band!.querySelector('.split-datetime__label');
    expect(labelSpan, 'the visible label span is gone').toBeNull();
    expect(screen.queryByText('Ngày giờ đóng trả cho tất cả cont')).toBeNull();
    // The group still carries the name for assistive tech.
    const group = band!.querySelector('[data-split-datetime][role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Ngày giờ đóng trả cho tất cả cont');
    // Both segment inputs render and accept typing.
    const { date, time } = bulkInputs();
    expect(date).toBeTruthy();
    expect(time).toBeTruthy();
    fireEvent.change(date!, { target: { value: '25/12/2026' } });
    fireEvent.change(time!, { target: { value: '14:30' } });
    // The Copy affordance (607 apply path) still appears on a complete value.
    expect(document.querySelector('.csc-bulk-appointment__copy')).toBeTruthy();
  });
});

describe('SIL-616 — band control height pins (styles)', () => {
  const PAGE_CSS = readFileSync(
    join(__dirname, '../../../pages/clerk/ClerkShipmentCreatePage.css'),
    'utf8',
  );

  it('the segmented option closes at the standard control height (30px shell)', () => {
    // The old 34px outlier made the whole cluster stand taller than the
    // Khách hàng control beside it. The shell's 2 border pixels ride on the
    // option box, so the interior is compact-h minus 2.
    expect(PAGE_CSS).toMatch(/\.csc-mode__option\s*\{[^}]*min-height:\s*calc\(var\(--control-compact-h\) - 2px\);/);
    expect(PAGE_CSS).not.toMatch(/\.csc-mode__option\s*\{[^}]*min-height:\s*34px;/);
    // The phone touch token is untouched.
    expect(PAGE_CSS).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-mode__option[^}]*min-height:\s*var\(--control-touch-h\);/);
  });

  it('band datetime groups close at exactly --uui-control-h (wrapper + segment padding zeroed)', () => {
    // The InputBase wrapper's py-1 stacked on the content-box segment input's
    // own padding-block 4px pushed the bordered group to a measured 38px
    // (8 over the standard box). Both vertical paddings are zeroed in the
    // band; the #root control-geometry rule keeps pinning the input height
    // from the same variable, so the phone's touch token still flows through.
    expect(PAGE_CSS).toMatch(/\.csc-mode-band__row \.date-seg-group\[data-uui-control\] \.date-seg-wrapper\s*\{\s*padding-block:\s*0;\s*\}/);
    expect(PAGE_CSS).toMatch(/:is\(#root, body\) \.csc-mode-band__row \.date-seg-group\[data-uui-control\] \.date-seg-wrapper \.date-seg\s*\{\s*padding-block:\s*0;\s*\}/);
  });
});
