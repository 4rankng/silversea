import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = existsSync(resolve(process.cwd(), 'src')) ? process.cwd() : resolve(process.cwd(), 'frontend');
const tokens = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8');
const responsive = readFileSync(resolve(root, 'src/styles/responsive.css'), 'utf8');
const shell = readFileSync(resolve(root, 'src/components/layout/app-shell.css'), 'utf8');
const dispatch = readFileSync(resolve(root, 'src/pages/DispatchPlanPage.css'), 'utf8');
const shipmentCreate = readFileSync(resolve(root, 'src/pages/clerk/ClerkShipmentCreatePage.css'), 'utf8');
const shipmentDetail = readFileSync(resolve(root, 'src/pages/ShipmentContainersPage.css'), 'utf8');

describe('mobile gutter contract', () => {
  it('gives every authenticated screen one safe outer gutter token', () => {
    expect(tokens).toMatch(/--app-body-pad-x:\s*24px;/);
    expect(responsive).toMatch(/@media \(max-width: 640px\)[\s\S]*?--app-body-pad-x:\s*8px;/);
    expect(shell).toMatch(/padding:\s*var\(--app-body-pad-t, 24px\) var\(--app-body-pad-x\) 32px;/);
    expect(shell).toMatch(/padding-inline:\s*max\(var\(--app-body-pad-x\), env\(safe-area-inset-left, 0px\)\) max\(var\(--app-body-pad-x\), env\(safe-area-inset-right, 0px\)\);/);
  });

  it('does not compound the shell gutter on full-width operational workflows', () => {
    expect(dispatch).toMatch(/@media \(max-width: 1100px\)[\s\S]*?\.dispatch-plan-page--wide\s*\{[\s\S]*?padding-inline:\s*0;/);
    expect(shipmentCreate).toMatch(/@media \(max-width: 1100px\)\s*\{[\s\S]*?\.csc-page\s*\{[\s\S]*?padding-inline:\s*0;/);
    expect(shipmentDetail).toMatch(/\.shipments-detail-workspace__header\s*\{[^}]*padding:\s*8px 0 0;/);
    expect(shipmentDetail).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.shipments-detail-workspace__header\s*\{[^}]*padding:\s*0;/);
    expect(shipmentDetail).toMatch(/\.shipments-detail-workspace \.summary-rail\s*\{[^}]*margin-inline:\s*0;/);
  });

  /* Card 20261004_327's rung moved to styles/mobile-viewport-fill-contract
     (its owning contract): the copy here pinned a `min-height: 100dvh` phone
     fill on .shipments-page — a viewport-locked height on a child of the
     main.app-body scrollport, which overshoots the scrollport and opens a
     scrollable void below the last card. The gutter contract stays a gutter
     contract. */
});
