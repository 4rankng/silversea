import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cwd = process.cwd();

function read(relativePath: string): string {
  return readFileSync(resolve(cwd, relativePath), 'utf8');
}

const pageCss = read('src/pages/AccountingWorkspacePage.css');
const registerTsx = read('src/features/accounting/AccountingTransportRegister.tsx');
const inboxTsx = read('src/features/accounting/AccountingWorkInbox.tsx');

describe('accounting workspace list-screen contract', () => {
  it('adopts the shared record-table base for both the register and the inbox lanes', () => {
    for (const [name, source] of [
      ['register', registerTsx],
      ['inbox', inboxTsx],
    ] as const) {
      expect(source, `${name} wrap`).toContain('record-table-wrap');
      expect(source, `${name} table`).toContain('record-table ops-table');
    }
    // The page owns the recipe import once, for every view rendered under it.
    expect(read('src/pages/AccountingWorkspacePage.tsx')).toContain(
      'styles/record-table.css',
    );
  });

  it('keeps phone date and party filters in equal columns with shared control styling', () => {
    expect(pageCss).toMatch(/accounting-period__fields[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(pageCss).not.toMatch(/accounting-period__fields[^}]*grid-template-columns: 1fr/);
    expect(registerTsx).not.toMatch(/\sinline\s*\n/);
    expect(registerTsx).not.toContain('controlClassName="accounting-register__select"');
  });

  it('renders the transport strip on the shared bar and declares no filter layout of its own', () => {
    // Card 20260927_152 (L1/L2/L4): ONE wrapping row owns the strip; the four
    // criteria live in `Bộ lọc`, whose Đặt lại clears exactly them. The page
    // rules that laid the strip out (flex row + gap, the search cell, the
    // `flex: 1 1 150px` select stretch and the two toolbar grid bands) are
    // deleted, not re-pinned — a page rule may not size or stretch a control.
    expect(registerTsx).toContain('<FilterBar');
    expect(registerTsx).toContain('<FilterDropdown');
    expect(registerTsx).toContain('onReset={onResetSecondary}');
    expect(pageCss).not.toMatch(/\.accounting-register__(toolbar|search)\s*[,{]/);
    const resetRule = pageCss.match(/\.accounting-register__reset\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(resetRule).toContain('var(--filter-control-h)');
    expect(resetRule).not.toMatch(/width|flex:|grid|display/);
  });

  it('never caps or inner-scrolls a master table — the app-body owns the scroll', () => {
    expect(pageCss).not.toMatch(/table-wrap[\s\S]{0,200}max-height/);
    expect(pageCss).not.toMatch(
      /accounting-register__wrap[\s\S]{0,160}(overflow\s*:\s*auto|overflow\s*:\s*scroll)/,
    );
  });

  it('keeps responsive record actions inset and touchable without nested card chrome', () => {
    expect(pageCss).toMatch(/td\.record-table__action\s*\{\s*padding-inline: 14px/);
    expect(pageCss).toMatch(/record-table__action a\s*\{\s*min-height: var\(--control-touch-h\)/);
    expect(pageCss).not.toMatch(/accounting-register__wrap[^}]*border-radius/);
    expect(pageCss).toMatch(/tbody td\.num\s*\{\s*text-align: left/);
  });

  it('emits data-labels on every register table cell so container-query cards stay labelled', () => {
    const body = registerTsx.slice(registerTsx.indexOf('<tbody>'));
    const cells = body.match(/<td[^>]*>/g) ?? [];
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell, `${cell} must carry data-label`).toContain('data-label');
    }
  });

  // Card 20260929_207: the checkbox column is gone; the row carries the state
  // on `data-selected` / `aria-selected`. The selection-state contract then
  // decides how that state is DRAWN: neutral ink structure (a neutral surface
  // plus a 3px inset ink edge), never a brand/semantic tint and never an
  // accent-filled row — the accent `border-left` this test used to pin is the
  // superseded recipe, so the pins below name the sanctioned one.
  it('marks the picked row structurally (data-selected) and draws it in neutral ink, never an accent', () => {
    expect(registerTsx).toContain('data-selected={selected || undefined}');
    expect(registerTsx).toContain('aria-selected={pickable ? selected : undefined}');
    const selected = pageCss.match(/tr\[data-selected\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(selected).toContain('background: var(--surface)');
    expect(selected).toContain('box-shadow: inset 3px 0 0 var(--ink)');
    expect(pageCss).not.toMatch(/border-left:\s*[2-6]px solid/);
    expect(pageCss).not.toMatch(/tr\[data-selected\][^{]*\{[^}]*(var\(--accent\)|var\(--brand\))/);
  });
});
