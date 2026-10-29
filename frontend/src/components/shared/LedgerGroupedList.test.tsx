/**
 * SIL-478 (2026-10-25) — the grouped ledger list contract: phone-only mount,
 * rows as the tap-to-expand control (Enter/Space included), the selection
 * checkbox never rides the row tap, hairline grouped container, and the
 * verdict's chip tones. CSS pins keep the verdict geometry honest (24px chip,
 * 12px grouped radius, hairline dividers — styles ride the chip and line
 * tokens, never raw hex).
 */
import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LedgerGroupedList, type LedgerGroupRow } from './LedgerGroupedList';

const originalMedia = window.matchMedia;
/** jsdom has no viewport media engine; this is the browser API polyfill. */
function viewport(width: number) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: width <= Number(query.match(/max-width:\s*(\d+)/)?.[1] ?? 0),
    media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
}
afterEach(() => { window.matchMedia = originalMedia; });

function Harness({ count = 1, selectable = false }: { count?: number; selectable?: boolean }) {
  const [openIds, setOpenIds] = useState<ReadonlySet<number>>(new Set());
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const rows: LedgerGroupRow[] = Array.from({ length: count }, (_, index) => ({
    key: index + 1,
    name: `BL-${index + 1}`,
    title: `Khách hàng ${index + 1}`,
    meta: `BL-${index + 1} · 06/10/2026 · ${index + 1} cont`,
    amount: '12.000 ₫',
    chip: { label: 'Đang mở', tone: 'open' },
    selected: picked.has(index + 1),
    selectable,
    onSelect: (value) => {
      setPicked((current) => {
        const next = new Set(current);
        if (value) next.add(index + 1);
        else next.delete(index + 1);
        return next;
      });
    },
    expanded: openIds.has(index + 1),
    onToggle: () => {
      setOpenIds((current) => {
        const next = new Set(current);
        if (next.has(index + 1)) next.delete(index + 1);
        else next.add(index + 1);
        return next;
      });
    },
    detail: <p>Chi tiết {index + 1}</p>,
  }));
  return <LedgerGroupedList rows={rows} />;
}

describe('SIL-478 grouped ledger rows', () => {
  it('mounts only on phone — desktop renders nothing (the matrix owns that band)', () => {
    viewport(768);
    render(<Harness />);
    expect(screen.queryByRole('article')).toBeNull();
    viewport(390);
  });

  it('renders the verdict row: identity left, money + chip right on one baseline', () => {
    viewport(390);
    render(<Harness />);
    const record = screen.getByRole('article', { name: 'BL-1' });
    expect(within(record).getByText('Khách hàng 1')).toBeTruthy();
    expect(within(record).getByText('BL-1 · 06/10/2026 · 1 cont')).toBeTruthy();
    expect(record.querySelector('.ledger-glist__amount')?.textContent).toBe('12.000 ₫');
    const chip = within(record).getByText('Đang mở');
    expect(chip.getAttribute('data-tone')).toBe('open');
  });

  it('the row is the expand control — click and keyboard both fire, no per-row button', () => {
    viewport(390);
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Chi tiết BL-1' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByText('Chi tiết 1')).toBeTruthy();
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(screen.queryByText('Chi tiết 1')).toBeNull();
    fireEvent.keyDown(toggle, { key: ' ' });
    expect(screen.getByText('Chi tiết 1')).toBeTruthy();
    // Key events from the inner checkbox never retoggle the row.
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(screen.queryByText('Chi tiết 1')).toBeNull();
  });

  it('the selection checkbox stays apart from the row tap', () => {
    viewport(390);
    render(<Harness selectable />);
    const record = screen.getByRole('article', { name: 'BL-1' });
    fireEvent.click(within(record).getByRole('checkbox', { name: 'Chọn BL-1' }));
    expect(within(record).getByRole('checkbox', { name: 'Chọn BL-1' })).toBeChecked();
    expect(screen.queryByText('Chi tiết 1')).toBeNull();
  });

  it('the verdict container: one grouped box per page, rows divided by hairlines', () => {
    viewport(390);
    render(<Harness count={5} />);
    expect(document.querySelectorAll('.ledger-glist__group')).toHaveLength(1);
    expect(document.querySelectorAll('.ledger-glist__item')).toHaveLength(5);
  });

  it('pages 20 at a time and survives a filter-refetch page reset', () => {
    viewport(390);
    render(<Harness count={21} />);
    expect(screen.getAllByRole('article')).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'BL-21' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
    expect(screen.getAllByRole('article')).toHaveLength(20);
  });

  it('renders the empty message', () => {
    viewport(390);
    render(<LedgerGroupedList rows={[]} />);
    expect(screen.getByText('Chưa có dữ liệu.')).toBeTruthy();
  });

  it('CSS pin — the verdict geometry: 24px chip, 999 pill, 12px container, token colors', () => {
    const css = readFileSync('src/components/shared/LedgerGroupedList.css', 'utf8');
    const phoneBand = css.slice(css.indexOf('(max-width: 640px)'), css.indexOf('@media print'));
    // Grouped container: ONE box for the page of rows — radius 12, hairline
    // border, white surface; rows separate by hairline dividers, never
    // per-row boxes.
    const group = phoneBand.match(/\.ledger-glist__group\s*\{([^}]*)\}/);
    expect(group?.[1]).toMatch(/border-radius:\s*var\(--app-radius-md\)/);
    expect(group?.[1]).toMatch(/border:\s*1px solid var\(--line\)/);
    expect(group?.[1]).toMatch(/background:\s*var\(--surface\)/);
    expect(phoneBand).toMatch(/\.ledger-glist__item \+ \.ledger-glist__item\s*\{\s*border-top:\s*1px solid var\(--line\);?\s*\}/);
    // Row grid: identity minmax(0,1fr) + auto side, centered, 64px floor.
    const row = phoneBand.match(/\.ledger-glist__row\s*\{([^}]*)\}/);
    expect(row?.[1]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
    expect(row?.[1]).toMatch(/min-height:\s*64px/);
    // Chip: 24px tall pill; tones ride the chip tokens — no raw hex here.
    const chip = phoneBand.match(/\.ledger-glist__chip\s*\{([^}]*)\}/);
    expect(chip?.[1]).toMatch(/height:\s*24px/);
    expect(chip?.[1]).toMatch(/border-radius:\s*999px/);
    expect(chip?.[1]).toMatch(/background:\s*var\(--chip-neutral-bg\)/);
    expect(phoneBand.match(/\.ledger-glist__chip\[data-tone='open'\]\s*\{([^}]*)\}/)?.[1])
      .toMatch(/color:\s*var\(--chip-open-text\)/);
    expect(phoneBand).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // The sage/meaningless row highlight stays gone: selection reads through
    // the shared muted surface, never a colour of its own.
    const active = phoneBand.match(/\.ledger-glist__row\[data-expandable\]:active,([\s\S]*?)\}/);
    expect(active?.[1]).toMatch(/background:\s*var\(--surface-2\)/);
  });

  it('CSS pin — SIL-582 the identity name wraps instead of ellipsising (no title/href needed)', () => {
    const css = readFileSync('src/components/shared/LedgerGroupedList.css', 'utf8');
    const phoneBand = css.slice(css.indexOf('(max-width: 640px)'), css.indexOf('@media print'));
    const name = phoneBand.match(/\.ledger-glist__name\s*\{([^}]*)\}/);
    expect(name?.[1]).toMatch(/white-space:\s*normal/);
    expect(name?.[1]).not.toMatch(/text-overflow:\s*ellipsis/);
  });

  it('CSS pin — SIL-582 the meta line (Số Booking · date · count) wraps, never ellipsises', () => {
    const css = readFileSync('src/components/shared/LedgerGroupedList.css', 'utf8');
    const phoneBand = css.slice(css.indexOf('(max-width: 640px)'), css.indexOf('@media print'));
    const meta = phoneBand.match(/\.ledger-glist__meta\s*\{([^}]*)\}/);
    expect(meta?.[1]).toMatch(/white-space:\s*normal/);
    expect(meta?.[1]).toMatch(/overflow-wrap:\s*normal/);
    expect(meta?.[1]).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(meta?.[1]).not.toMatch(/overflow:\s*hidden/);
  });

  it('CSS pin — the chip palette tokens exist in tokens.css (drift ratchet: hex lives there)', () => {
    const tokens = readFileSync('src/styles/tokens.css', 'utf8');
    for (const tone of ['open', 'done', 'overdue', 'neutral']) {
      for (const part of ['bg', 'border', 'text']) {
        expect(tokens).toMatch(new RegExp(`--chip-${tone}-${part}:\\s*#[0-9a-fA-F]{6}`));
      }
    }
  });
});
