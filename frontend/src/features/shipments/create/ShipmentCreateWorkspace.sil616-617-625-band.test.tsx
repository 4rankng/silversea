import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function lclBand() {
  return document.querySelector('.csc-lcl-delivery');
}

describe('SIL-616/617/625/637 — the top mode band cluster', { timeout: 20000 }, () => {
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

  // SIL-642 (id 746, owner 31/10): the FCL band datetime is RETIRED — the
  // old SIL-598 bulk field (always visible per SIL-617, label retired per
  // SIL-625, apply path per QA ticket 710) duplicated the container table's
  // required NGÀY GIỜ ĐÓNG TRẢ column. The band carries ONLY "Loại hàng" +
  // the segmented control in FCL; the schedule lives in the container rows.
  it('SIL-642: the FCL band carries no datetime — Loại hàng + segmented only', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    // No bulk band, no bulk segment inputs, on the empty form…
    expect(document.querySelector('.csc-bulk-appointment')).toBeNull();
    expect(document.querySelector('input[id$="-bulk-appointment-date"]')).toBeNull();
    expect(document.querySelector('input[id$="-bulk-appointment-time"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy giờ hẹn đóng trả/ })).toBeNull();
    // …after rows are scheduled (the exact SIL-617 gate states)…
    const dates = [...document.querySelectorAll<HTMLInputElement>('input[id$="-customer-appointment-date"]')];
    const times = [...document.querySelectorAll<HTMLInputElement>('input[id$="-customer-appointment-time"]')];
    fireEvent.change(dates[0]!, { target: { value: '31/10/2026' } });
    fireEvent.change(times[0]!, { target: { value: '09:30' } });
    expect(document.querySelector('.csc-bulk-appointment')).toBeNull();
    // …and with a second row (the fully-scheduled shape the old pin kept).
    fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
    expect(document.querySelector('.csc-bulk-appointment')).toBeNull();
    // The band still leads with the mode decision set (Loại hàng *).
    expect(screen.getByRole('radio', { name: 'Hàng FCL' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Hàng lẻ' })).toBeTruthy();
  });

  // SIL-637 (id 741) retired the visible LCL band label; SIL-639 (id 743,
  // owner 31/10) supersedes that and restores it INLINE — "Ngày giờ đóng
  // trả *" on the SAME row as the two segment inputs (label trái, control
  // phải), the same pattern as the "Loại hàng *" fieldset. The group's
  // aria-label, the segment labels and the required validation stay.
  it('SIL-639: the LCL band label renders visible-inline again; inputs and aria unchanged', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));

    const band = await waitFor(() => {
      const el = document.querySelector('.csc-lcl-delivery');
      expect(el).toBeTruthy();
      return el!;
    });
    // The visible label is BACK, carrying the required mark — same row law
    // as "Loại hàng *" (pinned in the page styles suite, .csc-lcl-delivery).
    const label = band.querySelector('.split-datetime__label');
    expect(label, 'the visible inline label is restored').toBeTruthy();
    expect(label!.textContent).toContain('Ngày giờ đóng trả');
    expect(label!.textContent).toContain('*');
    // The label is a flex SIBLING of the field group (inline row), not a
    // nested span inside it.
    expect(label!.closest('[data-split-datetime]')).toBeNull();
    // The group still carries the name for assistive tech.
    const group = band.querySelector('[data-split-datetime][role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Ngày giờ đóng trả');
    // Both segment inputs render and accept typing — the field itself is
    // untouched.
    const segments = band.querySelectorAll<HTMLInputElement>('[data-split-datetime] input[data-seg]');
    expect(segments.length).toBeGreaterThanOrEqual(5);
    fireEvent.change(band.querySelector<HTMLInputElement>('input[data-seg="hh"]')!, { target: { value: '09' } });
    expect(band.querySelector<HTMLInputElement>('input[data-seg="hh"]')!.value).toBe('09');
  });
});

describe('SIL-616 — band control height pins (styles)', () => {
  const PAGE_CSS = readFileSync(
    join(__dirname, '../../../pages/clerk/ClerkShipmentCreatePage.css'),
    'utf8',
  );
  const WORKSPACE = readFileSync(
    join(__dirname, './ShipmentCreateWorkspace.tsx'),
    'utf8',
  );

  it('the segmented shell carries the shared boundary hooks (height lives in the geometry layer)', () => {
    // SIL-616 re-land: the shell is the control boundary and its height is
    // owned by control-geometry.css's [data-uui-control] base law (30px
    // compact via size sm; touch tokens at ≤768/coarse) — the page
    // stylesheet holds no height for the segmented control at all.
    expect(WORKSPACE).toMatch(/<div data-uui-control="segments" data-control-size="sm">/);
    const geometry = readFileSync(
      join(__dirname, '../../../components/untitled-ui/base/control-geometry.css'),
      'utf8',
    );
    expect(geometry).toMatch(/\[data-uui-control\]\s*\{[^}]*min-height:\s*var\(--uui-control-h\);/);
    expect(geometry).toMatch(/\[data-uui-control\]\[data-control-size='sm'\]\s*\{[^}]*--uui-control-h:\s*var\(--control-compact-h\)/);
    expect(geometry).toMatch(/@media \(max-width: 768px\)[\s\S]*?\[data-uui-control\],\s*\[data-uui-control\]\[data-control-size\]\s*\{[^}]*--uui-control-h:\s*var\(--control-touch-h\)/);
  });

  it('the segmented option carries NO height in the page layer — the shared boundary law owns it', () => {
    // SIL-616 re-land per the control-density house law: control dimensions
    // live in the shared geometry layer (control-geometry.css), never in
    // page or feature stylesheets. The shell carries the boundary hooks; the
    // base [data-uui-control] law gives it 30px compact and the touch tokens
    // at ≤768/coarse. The page rule keeps only the option's paint.
    expect(PAGE_CSS).toMatch(/\.csc-mode__option\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;/);
    expect(PAGE_CSS).not.toMatch(/\.csc-mode__option\s*\{[^}]*min-height:/);
    expect(PAGE_CSS).not.toMatch(/\.csc-mode__option, [^{]*\{[^}]*min-height:/);
    // The old 34px pin stays dead.
    expect(PAGE_CSS).not.toMatch(/\.csc-mode__option\s*\{[^}]*min-height:\s*34px;/);
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

  it('SIL-639: the LCL band label rides INLINE — label trái, control phải, one row', () => {
    // The band is a wrapping flex row (label a flex SIBLING of the field
    // group), bottom-aligned so the label shares the control baseline — the
    // "Loại hàng *" pattern — and never a stacked label-over-control grid.
    expect(PAGE_CSS).toMatch(/\.csc-lcl-delivery \{ display: flex; flex-wrap: wrap; align-items: flex-end; gap: 6px 12px; min-width: 0; \}/);
    // The label wears the same compact tokens as the "Loại hàng" legend.
    expect(PAGE_CSS).toMatch(/\.csc-lcl-delivery \.split-datetime__label \{ font-size: var\(--control-compact-font-size\); font-weight: 700; line-height: var\(--control-compact-line-height\); color: var\(--fg-1\); white-space: nowrap; \}/);
    // Phones keep the shared touch tokens when the label wraps above the pair.
    expect(PAGE_CSS).toMatch(/@media \(max-width: 640px\) \{\s*\.csc-lcl-delivery \.split-datetime__label \{ font-size: var\(--control-compact-touch-font-size\); line-height: var\(--control-compact-touch-line-height\); \}/);
    // The grid stack (label on top) must not return.
    expect(PAGE_CSS).not.toMatch(/\.csc-lcl-delivery \{ display: grid;/);
  });
});
