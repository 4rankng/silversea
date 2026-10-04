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

  it('card 20261004_327: paints html and app-body with var(--bg) and guarantees safe-area clearance without white bottom gap', () => {
    const base = readFileSync(resolve(root, 'src/styles/base.css'), 'utf8');
    const shipments = readFileSync(resolve(root, 'src/pages/ShipmentsPage.css'), 'utf8');
    expect(base).toMatch(/html\s*\{[^}]*background:\s*var\(--bg\);/);
    expect(shell).toMatch(/\.app\s*\{[\s\S]*?background:\s*var\(--bg\);/);
    expect(shell).toMatch(/\.app-body,[\s\S]*?background:\s*var\(--bg\);/);
    expect(shipments).toMatch(/\.shipments-page\s*\{[\s\S]*?min-height:\s*100%;[\s\S]*?padding-bottom:\s*calc\(40px \+ env\(safe-area-inset-bottom, 0px\)\);/);
    expect(shipments).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.shipments-page\s*\{[\s\S]*?min-height:\s*100dvh;[\s\S]*?padding-bottom:\s*calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  });
});
