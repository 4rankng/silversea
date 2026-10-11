import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = existsSync(resolve(process.cwd(), 'src')) ? process.cwd() : resolve(process.cwd(), 'frontend');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const csc = read('src/pages/clerk/ClerkShipmentCreatePage.css');
const freight = read('src/features/shipments/create/FreightPreviewCard.tsx');
const siteDetails = read('src/components/shipment/OperationalSiteDetailsDialog.tsx');

/* Owner reports 11/10 (cards 111026173000 / 111026173010): the appointment
 * segments rendered at a 16px control font against the 11-12px house scale
 * ("bloated, oversize"), and the create-flow dialogs read as messages, not
 * dense data. These pins hold the density laws the fixes established:
 *
 * 1. The appointment cluster keeps its TOUCH-HEIGHT cure (card 051026230627)
 *    but reads the same field font as every other input on the page — never
 *    a hardcoded pixel size.
 * 2. Dialog helper prose (shipping-line / route / customer create dialogs)
 *    stays at caption size — a helper line, not a message block.
 * 3. The freight MANUAL formula rides caption size, muted.
 * 4. The site details dialog is a fact grid, not an airy stack: dense row
 *    rhythm and the maps link inline beside the name, never a lone block.
 */

describe('create-page density contract (cards 111026173000 / 111026173010)', () => {
  /* The appointment cluster geometry (field-font token, touch height, 200px
   * column floor) is owned by ClerkShipmentCreatePage.styles.test.ts — one
   * law, one suite; this file owns the dialog/density surfaces below. */

  it.each([
    ['shipping-line', /\.csc-shipping-line-dialog > p \{[^}]*font-size:\s*var\(--text-caption-size\);[^}]*\}/],
    ['route', /\.csc-route-dialog > p \{[^}]*font-size:\s*var\(--text-caption-size\);[^}]*\}/],
    ['customer', /\.csc-customer-dialog > p \{[^}]*font-size:\s*var\(--text-caption-size\);[^}]*\}/],
  ])('%s dialog helper prose stays caption-size', (_name, re) => {
    expect(csc.match(re)?.[0] ?? '', `${_name} helper rule`).not.toBe('');
  });

  it('freight MANUAL formula is a caption helper', () => {
    const manual = freight.match(/data\.source === 'MANUAL'[\s\S]*?\n\s*\}/)?.[0] ?? '';
    expect(manual, 'MANUAL branch exists').not.toBe('');
    expect(manual).toMatch(/fontSize:\s*'var\(--text-caption-size\)'/);
  });

  it('site details dialog is a dense fact grid', () => {
    // Tight grid rhythm (was an 18px-gap one-per-row stack).
    expect(siteDetails).toMatch(/gridTemplateColumns:\s*'repeat\(auto-fit, minmax\(150px, 1fr\)\)'/);
    expect(siteDetails).toMatch(/gap:\s*'8px 14px'/);
    expect(siteDetails).not.toMatch(/gap:\s*18/);
    // The maps link sits IN the grid beside the name (columns 2..-1, bottom
    // aligned with the name row) — never a lone block above the grid.
    expect(siteDetails).toMatch(/alignItems:\s*'flex-end',\s*gridColumn:\s*'2 \/ -1'[\s\S]{0,480}?Mở vị trí trên Google Maps/);
    // Values at the data scale.
    expect(siteDetails).toMatch(/fontSize:\s*'var\(--text-data-size\)'/);
  });
});
