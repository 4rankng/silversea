import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-624 (id 728, owner 31/10) — the per-cont "Ngày giờ đóng trả" cluster
 * in the create-form container sheet measures the STANDARD control height.
 * The retired 051026230627 override pinned the cluster to --control-max-h
 * (40px fine pointer) and the InputBase wrapper's py-1 stacked 8px on top —
 * measured 48px against the 30px standard (the ticket's "cao gấp đôi").
 * ≥769 the generic sheet rule owns the compact token; touch factors keep
 * the SIL-583 r2 touch token; the interior py is zeroed (the SIL-616 twin).
 */
const CSS = readFileSync(
  join(__dirname, '../../../pages/clerk/ClerkShipmentCreatePage.css'),
  'utf8',
);

const APPT = '.csc-container-row > .csc-container-cell--appointment .date-seg-group[data-uui-control]';

describe('SIL-624 appointment cluster standard height', () => {
  it('no fine-pointer height override left on the appointment cluster', () => {
    // The --control-max-h pin is retired: ≥769 the generic
    // `.csc-container-table .csc-container-cell [data-uui-control]` compact
    // rule must be the highest --uui-control-h authority for this cell.
    expect(CSS).not.toMatch(
      new RegExp(`${APPT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^}]*--control-max-h`),
    );
  });

  it('touch form factors keep the SIL-583 r2 touch token', () => {
    const touchBlock = CSS.match(
      /@media \(pointer: coarse\), \(max-width: 768px\) \{\s*\.csc-container-row > \.csc-container-cell--appointment \.date-seg-group\[data-uui-control\],\s*\.csc-container-row > \.csc-container-cell--appointment \.date-seg-group\[data-uui-control\] \[data-uui-control\] \{\s*--uui-control-h: var\(--control-touch-h\);\s*\}/,
    );
    expect(touchBlock, 'touch token block survives').not.toBeNull();
  });

  it('interior segment py is zeroed so the group closes at exactly its token', () => {
    expect(CSS).toContain(`${APPT} .date-seg-wrapper {\n  padding-block: 0;\n}`);
    expect(CSS).toContain(
      `:is(#root, body) ${APPT} .date-seg-wrapper .date-seg {\n  padding-block: 0;\n}`,
    );
  });

  it('the generic ≥769 sheet rule still pins the compact token (the height authority)', () => {
    expect(CSS).toContain(
      '.csc-container-table .csc-container-cell [data-uui-control] { --uui-control-h: var(--control-compact-h); }',
    );
  });
});
