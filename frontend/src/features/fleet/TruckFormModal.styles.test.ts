import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/features/fleet/TruckFormModal.tsx'), 'utf8');
const styles = readFileSync(resolve(process.cwd(), 'src/pages/FleetPage.css'), 'utf8');
const operationalStyles = readFileSync(resolve(process.cwd(), 'src/styles/operational-density.css'), 'utf8');

describe('TruckFormModal desktop density', () => {
  it('uses a wide desktop dialog and a three-field reminder row', () => {
    expect(source).toMatch(/maxWidth=\{920\}/);
    expect(styles).toMatch(/\.truck-alert-fields\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(styles).toMatch(/\.truck-alert-field--oil-calculator\s*\{[\s\S]*?grid-column:\s*1 \/ -1/);
  });

  it('uses the shared compact control contract and a stable desktop grid', () => {
    expect(styles).toMatch(/\.fleet-form__grid--truck\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(styles).toMatch(/\.fleet-form__field--wide\s*\{[\s\S]*?grid-column:\s*span 2/);
    expect(styles).toContain('--fleet-form-row-gap: 24px');
    expect(styles).toContain('min-height: var(--control-compact-h)');
    expect(styles).toContain('font-size: var(--control-compact-font-size)');
    expect(operationalStyles).toContain('calc(var(--control-compact-h) - 2px)');
    expect(operationalStyles).toContain('.ds-uui-select--operational .ds-uui-select__control > button');
    expect(source).toContain('btn btn--secondary btn--sm');
  });

  it('keeps the reminder matrix single-column on narrow canvases', () => {
    expect(styles).toMatch(/@media \(max-width: 760px\)\s*\{[\s\S]*?\.truck-alert-fields\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
    expect(styles).toContain('min-height: var(--control-touch-h)');
    expect(styles).toContain('.modal__body .fleet-form .field .input');
  });

  it('uses the field labels once, with the select control labelled for assistive technology', () => {
    expect(source).toMatch(/id="trailer-select"[\s\S]*?hideLabel/);
    expect(source).toMatch(/id="truck-status"[\s\S]*?hideLabel/);
    expect(source).not.toMatch(/id="trailer-select"[\s\S]*?wrapperClassName="input"/);
    expect(source).not.toMatch(/id="truck-status"[\s\S]*?wrapperClassName="input"/);
  });
});
