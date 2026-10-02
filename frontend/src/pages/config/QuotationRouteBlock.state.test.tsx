import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RouteBlock } from './QuotationRouteBlock';
import fixture from './QuotationRouteBlock.state.fixture.json';

const originalMedia = window.matchMedia;
function viewport(width: number) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: /max-width/.test(query) && width <= Number(query.match(/max-width:\s*(\d+)/)?.[1] ?? 0),
    media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
}
afterEach(() => { window.matchMedia = originalMedia; });
const [first, second] = fixture.frames;
const label = `Hệ số ${first.routeName} ${first.cells[0].vehicleSizeClassCode}`;

describe('UI35 quotation draft identity and pending blur', () => {
  it('retains identical five fact cells and class context across desktop rows and phone records', () => {
    viewport(1440);
    const view = render(<RouteBlock block={first} saving={false} onSaveHeSo={() => { throw new Error('Read-only render cannot save'); }} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(10);
    const desktop = rows.map((row) => ({
      title: within(row).getByRole('rowheader').querySelector('.data-token')?.textContent,
      subtitle: within(row).getByRole('rowheader').querySelector('.row-meta')?.textContent,
      facts: within(row).getAllByRole('cell').map((cell) => ({ text: cell.textContent, value: cell.querySelector('input')?.value })),
    }));
    view.unmount(); viewport(390);
    render(<RouteBlock block={first} saving={false} onSaveHeSo={() => { throw new Error('Read-only render cannot save'); }} />);
    const records = screen.getAllByRole('article');
    expect(records).toHaveLength(10);
    records.forEach((record, index) => {
      expect(record).toHaveAttribute('aria-label', desktop[index].title);
      expect(record.querySelector('.panel__subtitle')).toHaveTextContent(desktop[index].subtitle!);
      const facts = [...record.querySelectorAll('.ledger-record__fact dd')];
      expect(facts).toHaveLength(5);
      expect(facts.map((fact) => ({ text: fact.textContent, value: fact.querySelector('input')?.value }))).toEqual(desktop[index].facts);
      facts.forEach((fact) => expect(fact).toHaveAttribute('data-align', 'end'));
    });
  });

  it('keeps a blank coefficient distinct from an explicit valid zero', () => {
    const saves: Array<Array<{ routeId: number; vehicleSizeClassCode: string; heSo: number }>> = [];
    render(<RouteBlock block={first} saving={false} onSaveHeSo={(cells) => saves.push(cells)} />);
    for (const value of ['', ' ', 'not-a-number', '-1']) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      fireEvent.blur(screen.getByLabelText(label));
      expect(saves).toEqual([]);
      expect(screen.getByLabelText(label)).toHaveValue(String(first.cells[0].heSo));
    }
    fireEvent.change(screen.getByLabelText(label), { target: { value: '0' } });
    fireEvent.blur(screen.getByLabelText(label));
    expect(saves).toHaveLength(1);
    expect(saves[0]).toEqual(first.cells.map((cell, index) => ({
      routeId: cell.routeId, vehicleSizeClassCode: cell.vehicleSizeClassCode,
      heSo: index === 0 ? 0 : cell.heSo,
    })));
  });

  it('does not emit a second save when pending disables a dirty coefficient', () => {
    const saves: unknown[] = [];
    const onSaveHeSo = (cells: unknown) => { saves.push(cells); };
    const view = render(<RouteBlock block={first} saving={false} onSaveHeSo={onSaveHeSo} />);
    fireEvent.change(screen.getByLabelText(label), { target: { value: '1.1' } });
    view.rerender(<RouteBlock block={first} saving onSaveHeSo={onSaveHeSo} />);
    fireEvent.blur(screen.getByLabelText(label));
    expect(saves).toEqual([]);
    expect(screen.getByLabelText(label)).toHaveValue('1.1');
  });

  it('keeps a same-quotation draft and clears it across the real quotation identity boundary', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/config/QuotationConfigPage.tsx'), 'utf8');
    expect(source).toContain('key={`${selectedId}:${block.routeId}`}');
    const saves: unknown[] = [];
    const onSaveHeSo = (cells: unknown) => { saves.push(cells); };
    const view = render(<RouteBlock key={`${first.id}:${first.routeId}`} block={first} saving={false} onSaveHeSo={onSaveHeSo} />);
    fireEvent.change(screen.getByLabelText(label), { target: { value: '1.1' } });
    view.rerender(<RouteBlock key={`${first.id}:${first.routeId}`} block={{ ...first }} saving={false} onSaveHeSo={onSaveHeSo} />);
    expect(screen.getByLabelText(label)).toHaveValue('1.1');
    view.rerender(<RouteBlock key={`${second.id}:${second.routeId}`} block={second} saving={false} onSaveHeSo={onSaveHeSo} />);
    expect(screen.getByLabelText(label)).toHaveValue(String(second.cells[0].heSo));
    expect(saves).toEqual([]);
  });
});
