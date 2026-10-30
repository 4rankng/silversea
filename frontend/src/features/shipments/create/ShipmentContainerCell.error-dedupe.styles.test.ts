import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cellCss = readFileSync(resolve(process.cwd(), 'src/features/shipments/create/ShipmentContainerCell.css'), 'utf8');

/**
 * SIL-607 (ticket 607): the "Ngày giờ đóng trả" column rendered the missing-
 * schedule message TWICE — the cell's own `.csc-container-cell__error` line
 * plus the split-datetime host's `<small class="split-datetime__error">`
 * (the 687 batch) as soon as the editor revealed: submit-fail focus lands the
 * cell in `:focus-within`, and the ≤620px phone record shows editors
 * continuously.
 *
 * Contract: inside a container cell the CELL owns the single visible error
 * line; the inner field's message copy is display:none — the same law the
 * `[data-uui-control] ~ span` hide already runs for UUI fields. The error
 * PROP keeps flowing (aria-invalid, segment red paint, aria-describedby), so
 * this is a paint dedupe, not a validation change.
 */
describe('container cell error dedupe (SIL-607)', () => {
  it('hides the split-datetime message copy inside container cells', () => {
    expect(cellCss).toMatch(
      /\.csc-container-cell__editor \.split-datetime__error \{ display: none; \}/,
    );
  });

  it('keeps the cell-level error line as the visible channel', () => {
    expect(cellCss).toMatch(
      /\.csc-container-cell__error \{ display: block;/,
    );
  });
});
