import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20261004_338 (law book §4 no-truncation doctrine, card 20260922_37) —
// residual clip instances from the card 336 §5 sweep: ellipsis clipping on
// data values WITHOUT a tooltip. `text-overflow: ellipsis` on a data value is
// banned outright; these values are WRAPPING text (or long unbroken tokens
// that use the house emergency break) and must display in full at every
// width. One pin per instance (B1-B6).

const fleet = readFileSync(resolve(process.cwd(), 'src/pages/FleetPage.css'), 'utf8');
const shipment = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDetailPage.css'), 'utf8');
const billing = readFileSync(resolve(process.cwd(), 'src/components/billing/BillingDocumentsPanel.css'), 'utf8');
const tires = readFileSync(resolve(process.cwd(), 'src/pages/TruckTiresPage.css'), 'utf8');
const finance = readFileSync(resolve(process.cwd(), 'src/pages/FinancePage.css'), 'utf8');

const rule = (source: string, selector: string): string => {
  const found = source.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`))?.[1];
  expect(found, `${selector} rule exists`).toBeTruthy();
  return found!;
};

const CLIP = /text-overflow:\s*ellipsis/;
const CLIP_HIDDEN = /overflow:\s*hidden/;
const CLAMP = /-webkit-line-clamp/;

const expectWrapsInFull = (source: string, selector: string) => {
  const body = rule(source, selector);
  expect(body, `${selector} has no ellipsis`).not.toMatch(CLIP);
  expect(body, `${selector} has no overflow: hidden clip`).not.toMatch(CLIP_HIDDEN);
  expect(body, `${selector} has no line clamp`).not.toMatch(CLAMP);
  expect(body, `${selector} has no nowrap`).not.toMatch(/white-space:\s*nowrap/);
  expect(body, `${selector} wraps`).toMatch(/white-space:\s*normal/);
  expect(body, `${selector} has the house emergency break`).toMatch(/overflow-wrap:\s*anywhere/);
};

describe('residual clip instances wrap in full (card 20261004_338)', () => {
  it('B1 .fleet-tire-detail__serial shows the full tire serial', () => {
    expectWrapsInFull(fleet, '.fleet-tire-detail__serial');
  });

  it('B2 .fleet-tire-detail__position shows the full tire position', () => {
    expectWrapsInFull(fleet, '.fleet-tire-detail__position');
  });

  it('B3 .shipment-detail__doc-key shows the full storage key', () => {
    expectWrapsInFull(shipment, '.shipment-detail__doc-key');
    const body = rule(shipment, '.shipment-detail__doc-key');
    // Still the shrinkable middle column of the doc row.
    expect(body).toMatch(/flex:\s*1/);
    expect(body).toMatch(/min-width:\s*0/);
  });

  it('B4 .billing-panel__doc span shows the full date range / due-date line', () => {
    expectWrapsInFull(billing, '.billing-panel__doc span');
  });

  it('B5 .ttp-position-name span shows the full position name', () => {
    expectWrapsInFull(tires, '.ttp-position-name span');
    // The responsive `white-space: normal` override is dead once the base rule
    // wraps unconditionally — clean cutover, no leftover.
    expect(tires.split('.ttp-position-name span').length - 1).toBe(1);
  });

  it('B6 .truck-maintenance-item__main small shows the full vehicle/supplier/note line', () => {
    expectWrapsInFull(finance, '.truck-maintenance-item__main small');
  });
});
