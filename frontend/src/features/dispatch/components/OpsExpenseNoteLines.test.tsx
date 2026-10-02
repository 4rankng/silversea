import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OpsExpenseNoteLines } from './OpsExpenseNoteLines';

// Card 20260928_162 — this component is the ONE rendering of the OPS
// expense-note family on both ruled surfaces (dispatch plan grids, phơi-phiếu
// board), so the contract below is what both surfaces inherit: the reason is
// readable as text on the surface, not hidden behind a hover.
describe('OpsExpenseNoteLines', () => {
  it('renders each note as its own OPS-labelled line, keeping stored line breaks', () => {
    const { container } = render(
      <OpsExpenseNoteLines notes={['Đã bao gồm trong đơn giá trọn gói', 'Thu khách: Phí lưu bãi']} />,
    );
    const lines = container.querySelectorAll('.ops-expense-note-line');
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toBe('OPS: Đã bao gồm trong đơn giá trọn gói');
    expect(lines[1]!.textContent).toBe('OPS: Thu khách: Phí lưu bãi');
  });

  it('preserves the reason\'s own newlines — the line count the writer typed is the line count the reader sees', () => {
    const { container } = render(
      <OpsExpenseNoteLines notes={['Đã bao gồm trong đơn giá\nGhi rõ thêm điều kiện']} />,
    );
    const line = container.querySelector('.ops-expense-note-line')!;
    expect(line.textContent).toContain('\n');
    // The CSS carries the wrap contract (§4: wrap, never clip).
    const css = readFileSync(resolve(__dirname, './OpsExpenseNoteLines.css'), 'utf8');
    expect(css).toContain('white-space: pre-wrap');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).not.toContain('line-clamp');
    expect(css).not.toContain('text-overflow: ellipsis');
  });

  it('renders nothing for an empty or blank-only family — the surface decides its own empty marker', () => {
    const { container } = render(<OpsExpenseNoteLines notes={[]} />);
    expect(container.querySelector('.ops-expense-note-line')).toBeNull();
    const blank = render(<OpsExpenseNoteLines notes={['   ', '']} />);
    expect(blank.container.querySelector('.ops-expense-note-line')).toBeNull();
  });

  it('tolerates the field being absent (older backend payload) without crashing the row', () => {
    const { container } = render(<OpsExpenseNoteLines />);
    expect(container.querySelector('.ops-expense-note-line')).toBeNull();
    expect(screen.queryByText(/OPS/)).toBeNull();
  });
});
