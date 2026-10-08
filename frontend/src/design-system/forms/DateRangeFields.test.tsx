import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DateRangeFields, type DateRangeValue } from './DateRangeFields';

const css = readFileSync(resolve(process.cwd(), 'src/design-system/forms/DateRangeFields.css'), 'utf8');

describe('UI48 independent date range content allocation', () => {
  it('gives the pair the host grid row and bounds its width without clipping its date segments', () => {
    const owner = css.match(/\.date-range-fields\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(owner).toMatch(/grid-column:\s*1\s*\/\s*-1;/);
    expect(owner).toMatch(/width:\s*min\(100%,\s*348px\);/);
    expect(owner).not.toMatch(/overflow:\s*(?:hidden|clip)/);
  });

  it('keeps two native labelled fields and their complete dates in either container', () => {
    for (const placement of ['inline', 'dialog']) {
      const { unmount } = render(<div className={placement === 'inline' ? 'filter-bar' : 'filter-dropdown__body'}>
        <DateRangeFields id="range" ariaLabel="Khoảng ngày" from="2026-10-01" to="2026-10-31" onChange={() => {}} />
      </div>);
      const from = screen.getByLabelText('Từ ngày').closest<HTMLElement>('.date-seg-group')!;
      const to = screen.getByLabelText('Đến ngày').closest<HTMLElement>('.date-seg-group')!;
      expect(within(from).getByLabelText('Tháng — Từ ngày')).toHaveValue('10');
      expect(within(from).getByLabelText('Năm — Từ ngày')).toHaveValue('2026');
      expect(within(to).getByLabelText('Năm — Đến ngày')).toHaveValue('2026');
      expect(document.querySelector('#range')).toBe(screen.getByLabelText('Từ ngày'));
      expect(document.querySelector('#range-to')).toBe(screen.getByLabelText('Đến ngày'));
      expect(screen.getByRole('group', { name: 'Khoảng ngày' }).querySelectorAll('.date-seg-group')).toHaveLength(2);
      unmount();
    }
  });

  it('preserves min/max rejection and only emits a complete valid independent date', () => {
    const changes: DateRangeValue[] = [];
    render(<DateRangeFields id="range" ariaLabel="Khoảng ngày" from="2026-10-01" to="2026-10-31" onChange={value => changes.push(value)} />);
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '01/11/2026' } });
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '30/09/2026' } });
    expect(changes).toEqual([]);
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '02/10/2026' } });
    expect(changes).toEqual([{ from: '2026-10-02', to: '2026-10-31' }]);
  });

  it('retains a partial draft locally and emits the cleared endpoint only when all its segments are empty', () => {
    const changes: DateRangeValue[] = [];
    render(<DateRangeFields id="range" ariaLabel="Khoảng ngày" from="" to="2026-10-31" onChange={value => changes.push(value)} />);
    const from = screen.getByLabelText('Từ ngày').closest<HTMLElement>('.date-seg-group')!;
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '1' } });
    expect(screen.getByLabelText('Từ ngày')).toHaveValue('1');
    expect(changes).toEqual([]);
    for (const input of within(from).getAllByRole('textbox')) fireEvent.change(input, { target: { value: '' } });
    expect(changes).toEqual([{ from: '', to: '2026-10-31' }]);
  });

  it('keeps a native invalid-date helper below the prefix control without stealing segment space (UI53)', () => {
    const changes: DateRangeValue[] = [];
    render(<><DateRangeFields id="range" ariaLabel="Khoảng ngày" from="2026-10-01" to="2026-10-31" onChange={value => changes.push(value)} /><button>Tiếp theo</button></>);
    const from = screen.getByLabelText('Từ ngày');
    fireEvent.change(from, { target: { value: '33/10/2026' } });
    fireEvent.blur(from, { relatedTarget: screen.getByRole('button', { name: 'Tiếp theo' }) });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Nhập ngày hợp lệ theo DD/MM/YYYY.');
    const boundary = from.closest('[data-date-boundary]');
    expect(boundary, 'the prefix and segments have their own visible boundary').not.toBeNull();
    expect(boundary).not.toContainElement(alert);
    expect(alert.parentElement).toBe(from.closest('[data-input-wrapper]'));
    expect(boundary).toHaveTextContent('Từ');
    expect(within(boundary as HTMLElement).getAllByRole('textbox')).toHaveLength(3);
    expect(within(boundary as HTMLElement).getByLabelText('Năm — Từ ngày')).toHaveValue('2026');
    expect(changes).toEqual([]);
    fireEvent.change(from, { target: { value: '02/10/2026' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(changes).toEqual([{ from: '2026-10-02', to: '2026-10-31' }]);
  });
});
