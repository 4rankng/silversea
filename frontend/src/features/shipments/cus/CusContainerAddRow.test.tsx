import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CusContainerAddRow, EMPTY_ADD_FIELDS, type AddContainerFields } from './CusContainerAddRow';

/**
 * Card 191026100000 (chungtu-dieuvan A.6) — the drawer's add-container row
 * surfaces the ISO 6346 pre-check live: a well-formed number that fails the
 * check digit shows the warning plus the closest valid number as a one-tap
 * correction, so the strict server gate ("Sai số kiểm tra…") never dead-ends
 * the "sửa lô thiếu container" flow. Mirrors the trip container card's
 * checkContainerNumber contract; the server stays the sole authority — the
 * hint never blocks the submit.
 */
function renderAddRow(fields: Partial<AddContainerFields>, onChange = vi.fn()) {
  render(
    <table>
      <tbody>
        <CusContainerAddRow
          fields={{ ...EMPTY_ADD_FIELDS, ...fields }}
          containerTypes={[{ id: 1, code: '20DC' }]}
          adding={false}
          onChange={onChange}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      </tbody>
    </table>,
  );
  return onChange;
}

describe('add-row ISO 6346 hint (A.6, card 191026100000)', () => {
  it('warns on a failing check digit and offers the corrected number as a one-tap fix', () => {
    const onChange = renderAddRow({ containerNumber: 'MSCU4615853' });

    expect(screen.getByRole('note').textContent).toContain('Số cont sai chữ số kiểm tra');
    const fix = screen.getByRole('button', { name: 'Đổi thành MSCU4615859' });
    fireEvent.click(fix);
    expect(onChange).toHaveBeenCalledWith({ containerNumber: 'MSCU4615859' });
  });

  it('stays silent on a valid number', () => {
    renderAddRow({ containerNumber: 'MSCU4615859' });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText(/Sai số kiểm tra|sai chữ số/)).toBeNull();
  });

  it('warns on a wrong format without a correction suggestion', () => {
    renderAddRow({ containerNumber: 'ABC123' });
    expect(screen.getByRole('note').textContent).toContain('Số cont sai định dạng');
    expect(screen.queryByRole('button', { name: /Đổi thành/ })).toBeNull();
  });

  it('renders nothing when the field is empty', () => {
    renderAddRow({});
    expect(screen.queryByRole('note')).toBeNull();
  });
});
