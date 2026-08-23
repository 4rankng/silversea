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

  it('never caps or inner-scrolls a master table — the app-body owns the scroll', () => {
    expect(pageCss).not.toMatch(/table-wrap[\s\S]{0,200}max-height/);
    expect(pageCss).not.toMatch(
      /accounting-register__wrap[\s\S]{0,160}(overflow\s*:\s*auto|overflow\s*:\s*scroll)/,
    );
  });

  it('emits data-labels on every register table cell so container-query cards stay labelled', () => {
    const body = registerTsx.slice(registerTsx.indexOf('<tbody>'));
    const cells = body.match(/<td[^>]*>/g) ?? [];
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell, `${cell} must carry data-label`).toContain('data-label');
    }
  });

  it('marks selected rows structurally (is-selected), never with an accent fill', () => {
    expect(registerTsx).toContain("className={selected ? 'is-selected' : undefined}");
    expect(pageCss).not.toMatch(/is-selected[\s\S]{0,160}background/);
  });

  it('keeps nested controls independent of the whole-row toggle', () => {
    // The checkbox label and the debt link stop propagation so one click is
    // one action, not a row toggle plus a control toggle.
    expect(registerTsx).toContain('event.stopPropagation()');
    expect(registerTsx.match(/onClick=\{stop\}/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
