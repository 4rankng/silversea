import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ZoneTruckPresenceItem } from '../../../api/dispatchPlanningClient';

import { ZoneTruckPresencePanel } from './ZoneTruckPresencePanel';

const item = (overrides: Partial<ZoneTruckPresenceItem> = {}): ZoneTruckPresenceItem => ({
  truckId: 7,
  plateNumber: '51C-123.45',
  evidence: [
    { reason: 'D-1_DROP', date: '2026-08-19', containerNumber: 'MSCU1234567', portName: 'TC - HICT' },
    { reason: 'D+1_PICKUP', date: '2026-08-21', containerNumber: null, portName: 'TIL - HTIT' },
  ],
  ...overrides,
});

describe('ZoneTruckPresencePanel', () => {
  it('renders nothing without evidence (advisory panel never adds noise)', () => {
    const { container } = render(
      <ZoneTruckPresencePanel items={[]} zoneLabel="Lạch Huyện" date="2026-08-20" onSelectPlate={vi.fn()} />,
    );
    expect(container.querySelector('.zone-presence-panel')).toBeNull();
  });

  it('renders the DB zone label, date, chips with reason tags, and evidence tooltip', () => {
    render(
      <ZoneTruckPresencePanel items={[item()]} zoneLabel="Lạch Huyện" date="2026-08-20" onSelectPlate={vi.fn()} />,
    );

    expect(screen.getByText('Xe tại Lạch Huyện')).toBeTruthy();
    // The advisory date is a user-facing date cell, so it rides the canonical
    // DD/MM/YYYY table-date contract (lib/format formatDate) instead of the raw
    // ISO the API sends — the panel used to print 'quanh ngày 2026-08-20'.
    expect(screen.getByText('quanh ngày 20/08/2026')).toBeTruthy();
    expect(screen.queryByText(/2026-08-20/)).toBeNull();
    expect(screen.getByText('51C-123.45')).toBeTruthy();
    expect(screen.getByText('Hạ D-1')).toBeTruthy();
    expect(screen.getByText('Lấy D+1')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy(); // evidence count

    const chip = screen.getByRole('listitem');
    expect(chip.getAttribute('title')).toContain('TC - HICT');
    expect(chip.getAttribute('title')).toContain('MSCU1234567');
  });

  it('clicking a chip narrows the grid search to that plate', () => {
    const onSelectPlate = vi.fn();
    render(
      <ZoneTruckPresencePanel items={[item()]} zoneLabel="Cảng Hải Phòng" date={null} onSelectPlate={onSelectPlate} />,
    );

    fireEvent.click(screen.getByRole('listitem'));
    expect(onSelectPlate).toHaveBeenCalledWith('51C-123.45');
  });

  // SIL-1261 (đợt quét UX-B 28/11, /dispatch + /dispatch-detail) — dải chip
  // phải đọc được trọn vẹn ở 390/360px: cạnh tiêu đề nó bị bó còn 105px so
  // với strip 158px và phần cắt không cuộn tới được. Ở ≤640px strip lấy
  // NGUYÊN dòng của mình dưới dòng tiêu đề; strip dài vẫn cuộn trên rail.
  it('phone band: the chip strip takes its own full-width line under the head (never squeezed beside the title)', () => {
    const css = readFileSync(resolve(import.meta.dirname, './ZoneTruckPresencePanel.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const band = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(band, 'phone band exists').toBeTruthy();
    expect(band).toMatch(/\.zone-presence-panel \{[^}]*flex-wrap: wrap;/);
    expect(band).toMatch(/\.zone-presence-panel__chips \{[^}]*flex: 1 1 100%;/);
    // The rail keeps its scroll fallback for strips wider than the row.
    expect(band).toMatch(/\.zone-presence-panel__chips \{[^}]*overflow-x: auto;/);
  });
});
